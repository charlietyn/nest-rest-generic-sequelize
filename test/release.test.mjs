import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, nextVersion, release } from '../scripts/release.mjs';
import { inspectPackage, parsePackOutput } from '../scripts/check-package.mjs';

function fixture(t, behavior = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = {
    name: '@charlietyn/nest-rest-sequelize', version: '1.2.3', license: 'MIT',
    main: 'dist/index.js', types: 'dist/index.d.ts', files: ['dist'],
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
    publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' }, engines: { node: '>=22' },
  };
  mkdirSync(join(root, 'dist'));
  for (const file of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'CHANGELOG.md']) writeFileSync(join(root, file), 'fixture\n');
  const writeVersion = (version) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version, packages: { '': { name: pkg.name, version } } }));
  };
  writeVersion(pkg.version);
  const original = readFileSync(join(root, 'package.json'), 'utf8');
  const calls = [];
  const logs = [];
  const pack = () => ({
    name: pkg.name, version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    filename: 'package.tgz', size: 100,
    files: ['package.json', 'dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE', 'CHANGELOG.md'].map(path => ({ path })),
  });
  const runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.join(' ')}`;
    if (behavior.fail?.(cmd, args)) throw new Error(`Simulated failure: ${key}`);
    let stdout = '';
    if (key === 'git rev-parse --show-toplevel') stdout = root;
    else if (key === 'git status --porcelain --untracked-files=all') stdout = behavior.dirty ? ' M README.md' : '';
    else if (key === 'git rev-parse HEAD') stdout = 'abc123';
    else if (key === 'git branch --show-current') stdout = behavior.branch || 'main';
    else if (key.startsWith('git tag --list')) stdout = behavior.tag ? args.at(-1) : '';
    else if (key === 'git ls-remote --exit-code origin refs/heads/main') stdout = `${behavior.diverged ? 'other' : 'abc123'}\trefs/heads/main`;
    else if (cmd === 'npm' && args[0] === 'pack') stdout = JSON.stringify([pack()]);
    else if (cmd === 'npm' && args[0] === 'view') {
      if (behavior.registryError) return { status: 1, stdout: JSON.stringify({ error: { code: behavior.registryError } }), stderr: 'registry error' };
      stdout = JSON.stringify(behavior.versions || ['1.2.3']);
    } else if (cmd === 'npm' && args[0] === 'version') writeVersion(args[1]);
    return { status: 0, stdout, stderr: '' };
  };
  return { root, calls, logs, pkg, original, pack, runner, run: args => release(args, { root, runner, log: message => logs.push(message) }) };
}

test('default bump is patch; arguments are validated', () => {
  assert.deepEqual(parseArgs([]), { bump: 'patch', dryRun: false });
  assert.deepEqual(parseArgs(['minor', '--dry-run']), { bump: 'minor', dryRun: true });
  assert.deepEqual(parseArgs(['minor'], { npm_config_dry_run: 'true' }), { bump: 'minor', dryRun: true });
  assert.deepEqual(parseArgs([], { NPM_CONFIG_DRY_RUN: 'true' }), { bump: 'patch', dryRun: true });
  for (const args of [['invalid'], ['major', 'patch'], ['--dry-run', '--dry-run'], ['--force']]) assert.throws(() => parseArgs(args), /Invalid argument/);
});

for (const [bump, expected] of [['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']]) {
  test(`${bump} uses actual package version; dry-run has no mutations`, t => {
    const f = fixture(t);
    assert.equal(nextVersion('1.2.3', bump), expected);
    assert.equal(f.run([bump, '--dry-run']).version, expected);
    assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), f.original);
    assert.ok(f.calls.some(c => c[0] === 'npm' && c[1] === 'run' && c[2] === 'validate'));
    assert.ok(f.calls.some(c => c[1] === 'pack' && c.includes('--dry-run')));
    assert.ok(!f.calls.some(c => ['version', 'publish', 'commit', 'push', 'whoami', 'add'].includes(c[1])));
    assert.ok(!f.calls.some(c => c[1] === 'tag' && c[2] !== '--list'));
  });
}

test('rejects prereleases and invalid versions', () => {
  for (const value of ['bad', '1.0.0-beta.1']) assert.throws(() => nextVersion(value, 'patch'), /stable SemVer/);
});

test('parses npm 10/11 and npm 12 pack output and rejects ambiguous output', () => {
  const pack = { name: '@charlietyn/example', files: [] };
  assert.deepEqual(parsePackOutput(JSON.stringify([pack])), pack);
  assert.deepEqual(parsePackOutput(JSON.stringify({ [pack.name]: pack })), pack);
  assert.throws(() => parsePackOutput(JSON.stringify([pack, pack])), /exactly one/);
});

for (const [name, behavior, error] of [
  ['dirty worktree', { dirty: true }, /not clean/],
  ['wrong branch', { branch: 'feature' }, /main/],
  ['existing tag', { tag: true }, /already exists/],
  ['validation failure', { fail: (c, a) => c === 'npm' && a[0] === 'run' }, /Simulated/],
  ['existing npm version', { versions: ['1.2.4'] }, /already exists/],
  ['registry outage', { registryError: 'E503' }, /Cannot verify/],
  ['malformed registry response', { versions: { unknown: true } }, /Cannot verify/],
]) {
  test(`${name} stops before versioning or publication`, t => {
    const f = fixture(t, behavior);
    assert.throws(() => f.run(['--dry-run']), error);
    assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), f.original);
    assert.ok(!f.calls.some(c => ['version', 'publish', 'commit', 'push'].includes(c[1])));
  });
}

test('unpublished package E404 permits a dry run', t => {
  const f = fixture(t, { registryError: 'E404' });
  assert.equal(f.run(['--dry-run']).published, false);
});

test('unsafe package metadata fails early', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ ...f.pkg, name: 'wrong-scope' }));
  assert.throws(() => f.run([]), /@charlietyn/);
  assert.equal(f.calls.length, 0);
});

// These tests exercise the complete release control flow with a fake process
// runner. Neither npm publish nor git push can execute here.
for (const bump of ['patch', 'minor', 'major']) {
  test(`${bump} publishes inspected artifact once, then pushes its exact tag`, t => {
    const previousCI = process.env.CI;
    delete process.env.CI;
    t.after(() => { if (previousCI !== undefined) process.env.CI = previousCI; });
    const f = fixture(t);
    const result = f.run([bump]);
    const publish = f.calls.findIndex(c => c[1] === 'publish');
    const version = f.calls.findIndex(c => c[1] === 'version');
    assert.ok(version > f.calls.findIndex(c => c[1] === 'whoami'));
    assert.ok(publish > f.calls.findIndex(c => c[1] === 'commit'));
    assert.ok(f.calls[publish][2].endsWith('.tgz'));
    assert.equal(f.calls.filter(c => c[1] === 'publish').length, 1);
    assert.deepEqual(f.calls.at(-1), ['git', 'push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/v${result.version}`]);
  });
}

for (const [name, behavior, expected] of [
  ['authentication failure', { fail: (c, a) => c === 'npm' && a[0] === 'whoami' }, /Simulated/],
  ['unsynchronized remote', { diverged: true }, /synchronized/],
  ['failed pack after bump', { fail: (c, a) => c === 'npm' && a[0] === 'pack' && !a.includes('--dry-run') }, /Original versions restored/],
  ['uncertain publication', { fail: (c, a) => c === 'npm' && a[0] === 'publish' }, /result may be uncertain/],
  ['failed push after publication', { fail: (c, a) => c === 'git' && a[0] === 'push' && a.includes('--atomic') }, /IS ALREADY PUBLISHED/],
]) {
  test(`${name} reports the correct recovery state`, t => {
    const previousCI = process.env.CI;
    delete process.env.CI;
    t.after(() => { if (previousCI !== undefined) process.env.CI = previousCI; });
    const f = fixture(t, behavior);
    assert.throws(() => f.run([]), expected);
    assert.ok(f.calls.filter(c => c[1] === 'publish').length <= 1);
    if (!f.calls.some(c => c[1] === 'commit')) assert.equal(readFileSync(join(f.root, 'package.json'), 'utf8'), f.original);
  });
}

test('package inspection rejects files outside allowlist and missing exports', t => {
  const f = fixture(t);
  for (const path of ['.env', '.npmrc', 'src/index.ts', 'dist/example/model.js', 'dist/private.pem']) {
    const pack = f.pack(); pack.files.push({ path });
    assert.throws(() => inspectPackage(pack, f.root), /Unexpected|Development/);
  }
  const pack = f.pack(); pack.files = pack.files.filter(file => file.path !== 'dist/index.d.ts');
  assert.throws(() => inspectPackage(pack, f.root), /Missing package entry/);
});

test('package inspection detects credential signatures without printing their values', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'dist/index.js'), '-----BEGIN PRIVATE KEY-----');
  assert.throws(() => inspectPackage(f.pack(), f.root), /Possible credential in package: dist\/index.js/);
});
