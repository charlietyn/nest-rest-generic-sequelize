import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = fileURLToPath(new URL('../', import.meta.url));
export const registry = 'https://registry.npmjs.org/';

export function isMain(url) {
  return Boolean(process.argv[1]) && fileURLToPath(url) === resolve(process.argv[1]);
}

export function run(command, args, { cwd = rootDir, capture = false, allowFailure = false, env = process.env } = {}) {
  let executable = command;
  let argv = args;
  if (command === 'npm') {
    const cli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!existsSync(cli)) throw new Error('Run this script through npm run so npm_execpath is available.');
    executable = process.execPath;
    argv = [cli, ...args];
  }
  const result = spawnSync(executable, argv, {
    cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const response = { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal}).\n${response.stderr}`);
  }
  return response;
}
