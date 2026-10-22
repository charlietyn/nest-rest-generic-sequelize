import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain, registry, rootDir, run } from './process.mjs';

const uuidAdvisory = 'https://github.com/advisories/GHSA-w5hq-g745-h8pq';

// Only the unmitigated consumer probe may report this known upstream issue.
// Repository and supported consumer configurations have no exceptions.
export function assessAudit(report, { baseline = false } = {}) {
  if (report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities
      || !Number.isInteger(report.metadata.vulnerabilities.total)) {
    throw new Error('Invalid npm audit response; security status cannot be established.');
  }
  const entries = Object.entries(report.vulnerabilities);
  if (entries.length !== report.metadata.vulnerabilities.total) {
    throw new Error('Inconsistent npm audit vulnerability count.');
  }
  if (!entries.length) return 'clean';
  if (!baseline) throw new Error(`Dependency audit found ${entries.length} vulnerable packages.`);
  const visit = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error('Cyclic npm audit advisory chain.');
    const entry = report.vulnerabilities[name];
    if (!entry || entry.severity !== 'moderate' || !entry.via?.length) {
      throw new Error(`Unexpected baseline vulnerability: ${name}.`);
    }
    const next = new Set([...seen, name]);
    for (const via of entry.via) {
      if (typeof via === 'string') visit(via, next);
      else if (via.name !== 'uuid' || via.url !== uuidAdvisory || via.severity !== 'moderate') {
        throw new Error(`Unexpected baseline advisory in ${name}.`);
      }
    }
  };
  for (const [name] of entries) visit(name);
  return 'upstream-uuid-unmitigated';
}

export function auditDependencies({ cwd = rootDir, label = 'repository', runtime = false, baseline = false } = {}) {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid audit report label.');
  const result = run('npm', ['audit', '--json', '--audit-level=moderate',
    ...(runtime ? ['--omit=dev'] : []), `--registry=${registry}`], { cwd, capture: true, allowFailure: true });
  const reportDir = resolve(process.env.AUDIT_REPORT_DIR || join(rootDir, '.artifacts', 'audit'));
  mkdirSync(reportDir, { recursive: true });
  // Preserve the response even when the audit service or assessment fails.
  writeFileSync(join(reportDir, `${label}.json`), result.stdout);
  if (![0, 1].includes(result.status)) throw new Error(`npm audit failed (${result.status}); see ${label}.json.`);
  const report = JSON.parse(result.stdout);
  const state = assessAudit(report, { baseline });
  if (state === 'clean' && result.status !== 0) throw new Error('npm audit failed despite an empty report.');
  console.log(`Dependency audit [${label}]: ${state}; ${report.metadata.vulnerabilities.total} vulnerable packages.`);
  if (state !== 'clean') console.warn('Unmitigated upstream consumer: apply the root overrides documented in README. This is not a clean consumer audit.');
  return report;
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 1 || args[0] !== '--runtime')) throw new Error('Usage: audit-dependencies.mjs [--runtime]');
    auditDependencies({ runtime: args.includes('--runtime'), label: args.length ? 'repository-runtime' : 'repository' });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
