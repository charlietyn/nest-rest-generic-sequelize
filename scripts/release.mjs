import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import semver from 'semver';
import { inspectPackage, parsePackOutput } from './check-package.mjs';
import { isMain, registry, rootDir, run } from './process.mjs';

export function parseArgs(args, env = {}) {
  let bump = 'patch';
  let selected = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run' && !dryRun) dryRun = true;
    else if (['patch', 'minor', 'major'].includes(arg) && !selected) { bump = arg; selected = true; }
    else throw new Error(`Invalid argument: ${arg}. Usage: npm run release -- [patch|minor|major] [--dry-run]`);
  }
  // Some npm/PowerShell combinations consume --dry-run as an npm flag
  // instead of forwarding it. It must never silently become a real release.
  return { bump, dryRun: dryRun || env.npm_config_dry_run === 'true' || env.NPM_CONFIG_DRY_RUN === 'true' };
}

export function nextVersion(version, bump) {
  if (!semver.valid(version) || semver.prerelease(version)) throw new Error('Release requires a stable SemVer version in package.json.');
  return semver.inc(version, bump);
}

// The runner can be replaced in tests; the CLI always uses the real process runner.
export function release(args = process.argv.slice(2), { root = rootDir, runner = run, log = console.log } = {}) {
  const { bump, dryRun } = parseArgs(args, process.env);
  // Child validation needs real installs/builds, even when npm consumed the
  // parent's flag. Only this release orchestrator decides whether to publish.
  const childEnv = { ...process.env, npm_config_dry_run: 'false', NPM_CONFIG_DRY_RUN: 'false' };
  const exec = (cmd, argv, options = {}) => runner(cmd, argv, { cwd: root, env: childEnv, ...options });
  const git = (...argv) => exec('git', argv, { capture: true }).stdout.trim();
  const pkgPath = join(root, 'package.json');
  const lockPath = join(root, 'package-lock.json');
  const originalPkg = readFileSync(pkgPath, 'utf8');
  const originalLock = readFileSync(lockPath, 'utf8');
  const pkg = JSON.parse(originalPkg);
  const lock = JSON.parse(originalLock);
  if (!/^@charlietyn\/[a-z0-9][a-z0-9._-]*$/.test(pkg.name)) throw new Error('Package name must start with @charlietyn/.');
  if (pkg.private || pkg.publishConfig?.access !== 'public' || pkg.publishConfig?.registry !== registry) throw new Error('Package must be public and target the official npm registry.');
  if (pkg.license !== 'MIT' || !pkg.files?.length || !pkg.exports?.['.']) throw new Error('Review package license, files and exports before releasing.');
  if (lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package-lock.json is out of sync. Run npm install and commit it.');
  if (!semver.satisfies(process.version, pkg.engines.node)) throw new Error(`Node ${pkg.engines.node} is required.`);
  const target = nextVersion(pkg.version, bump);
  const tag = `v${target}`;
  const assertClean = () => {
    if (git('status', '--porcelain', '--untracked-files=all')) throw new Error('Working tree is not clean. Commit or stash changes before release; nothing was published.');
  };
  if (git('rev-parse', '--show-toplevel').replaceAll('\\', '/').toLowerCase() !== root.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()) throw new Error('Run release from the repository root.');
  assertClean();
  const head = git('rev-parse', 'HEAD');
  const branch = git('branch', '--show-current');
  if (branch !== 'main') throw new Error('Releases must run from main.');
  if (git('tag', '--list', tag)) throw new Error(`Local tag ${tag} already exists.`);
  const assertRemoteSynchronized = () => {
    const remote = git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0];
    if (remote !== head) throw new Error('Local main and origin/main must be synchronized before release. Fetch origin, review ahead/behind commits, then synchronize main and retry. Nothing was published.');
  };
  // Fail before expensive validation, including in dry-run mode. Read the actual
  // remote instead of trusting a potentially stale origin/main tracking ref.
  assertRemoteSynchronized();
  log(`${dryRun ? 'DRY RUN' : 'RELEASE'}: ${pkg.name} ${pkg.version} -> ${target} (${bump})`);

  exec('npm', ['run', 'validate']);
  const preview = parsePackOutput(exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { capture: true }).stdout);
  inspectPackage(preview, root);
  log(`Validated package: ${preview.files.length} files (${preview.size} bytes).`);
  const versionsResult = exec('npm', ['view', pkg.name, 'versions', '--json', `--registry=${registry}`], { capture: true, allowFailure: true });
  if (versionsResult.status === 0) {
    const value = JSON.parse(versionsResult.stdout);
    const versions = Array.isArray(value) ? value : [value];
    if (!versions.every(version => typeof version === 'string' && semver.valid(version))) throw new Error('Cannot verify registry version: unexpected npm response.');
    if (versions.includes(target)) throw new Error(`${pkg.name}@${target} already exists on npm.`);
  } else {
    let code;
    try { code = JSON.parse(versionsResult.stdout).error?.code; } catch { /* Not a registry JSON error. */ }
    if (code !== 'E404') throw new Error(`Cannot verify registry version: ${versionsResult.stderr || versionsResult.stdout}`);
  }
  assertClean();
  if (git('rev-parse', 'HEAD') !== head) throw new Error('HEAD changed during validation. Restart release.');
  assertRemoteSynchronized();
  if (dryRun) {
    log(`Dry run complete. Would publish ${pkg.name}@${target}, commit and tag ${tag}, then push main and that tag. Authentication and Git push permissions are checked only for a real release. No version, commit, tag, publication or push was made.`);
    return { version: target, published: false, dryRun: true };
  }
  if (process.env.CI) throw new Error('Publication is local only. CI validates but never publishes.');
  exec('npm', ['whoami', `--registry=${registry}`]);
  assertRemoteSynchronized();
  if (git('ls-remote', 'origin', `refs/tags/${tag}`)) throw new Error(`Remote tag ${tag} already exists.`);
  exec('git', ['push', '--dry-run', 'origin', 'HEAD:refs/heads/main']);
  assertClean();
  if (git('rev-parse', 'HEAD') !== head) throw new Error('HEAD changed during preflight. Restart release.');
  git('var', 'GIT_AUTHOR_IDENT');
  git('var', 'GIT_COMMITTER_IDENT');
  const temp = mkdtempSync(join(tmpdir(), 'nest-rest-release-'));
  let committed = false;
  let published = false;
  let publishAttempted = false;
  try {
    exec('npm', ['version', target, '--no-git-tag-version', '--ignore-scripts']);
    const pack = parsePackOutput(exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { capture: true }).stdout);
    inspectPackage(pack, root);
    exec('git', ['add', '--', 'package.json', 'package-lock.json']);
    exec('git', ['commit', '-m', `chore(release): ${tag}`]);
    committed = true;
    exec('git', ['tag', '-a', tag, '-m', `Release ${pkg.name}@${target}`]);
    publishAttempted = true;
    // Publish the exact inspected artifact. Source prepublishOnly intentionally
    // blocks bypassing release; the tarball contains no publishing scripts.
    exec('npm', ['publish', join(temp, pack.filename), '--access', 'public', `--registry=${registry}`, '--ignore-scripts']);
    published = true;
    exec('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
    log(`Published ${pkg.name}@${target}; main and ${tag} synchronized.`);
    return { version: target, published: true, dryRun: false };
  } catch (error) {
    if (published) throw new Error(`${pkg.name}@${target} IS ALREADY PUBLISHED, but Git push failed. Do not republish. Recover with: git push --atomic origin HEAD:refs/heads/main refs/tags/${tag}\n${error.message}`, { cause: error });
    if (!committed) {
      writeFileSync(pkgPath, originalPkg);
      writeFileSync(lockPath, originalLock);
      // No reset: leave any index changes visible for review.
    }
    throw new Error(`${publishAttempted ? 'Publish was attempted; its result may be uncertain. Check npm before doing anything else. Never retry automatically.' : 'Nothing was published.'} ${committed ? `The local release commit/tag for ${target} remain for inspection; resolve them manually before another release.` : 'Original versions restored; review Git status.'}\n${error.message}`, { cause: error });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  try { release(); } catch (error) { console.error(`Release stopped: ${error.message}`); process.exitCode = 1; }
}
