import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { isMain, rootDir, run } from './process.mjs';

/** npm <=11 returns an array; npm 12 returns a package-name keyed object. */
export function parsePackOutput(stdout) {
  const value = JSON.parse(stdout);
  const entries = Array.isArray(value) ? value : Object.values(value);
  if (entries.length !== 1 || !Array.isArray(entries[0]?.files)) throw new Error('Expected exactly one package from npm pack.');
  return entries[0];
}

export function inspectPackage(pack, root = rootDir) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!pack || !Array.isArray(pack.files) || !pack.files.length) throw new Error('npm pack returned an empty file list.');
  if (pack.name !== pkg.name || pack.version !== pkg.version) throw new Error('Tarball metadata differs from package.json.');
  const paths = new Set(pack.files.map((file) => file.path));
  const rootFiles = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  for (const path of paths) {
    if (!rootFiles.has(path) && !/^dist\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|d\.ts)$/.test(path)) {
      throw new Error(`Unexpected packaged file: ${path}`);
    }
    if (/(?:^|\/)(?:example|test|tests|node_modules)(?:\/|$)/i.test(path)) throw new Error(`Development file in package: ${path}`);
    const absolute = resolve(root, path);
    if (!absolute.startsWith(resolve(root) + sep) || !statSync(absolute).isFile()) throw new Error(`Invalid packaged path: ${path}`);
    const content = readFileSync(absolute, 'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bnpm_[A-Za-z0-9]{30,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|(?:_authToken|_auth)\s*=\s*\S+/m.test(content)) {
      throw new Error(`Possible credential in package: ${path}`);
    }
  }
  const targets = [pkg.main, pkg.types, ...Object.values(pkg.exports['.'])];
  for (const target of [...targets, 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    if (!paths.has(target.replace(/^\.\//, ''))) throw new Error(`Missing package entry: ${target}`);
  }
  return paths;
}

export function checkPackage(root = rootDir) {
  const output = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, capture: true });
  const pack = parsePackOutput(output.stdout);
  const paths = inspectPackage(pack, root);
  console.log(`Package ${pack.name}@${pack.version}: ${paths.size} files, ${pack.size} bytes compressed.`);
  for (const path of paths) console.log(`  ${path}`);
  return pack;
}

if (isMain(import.meta.url)) {
  try { checkPackage(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
