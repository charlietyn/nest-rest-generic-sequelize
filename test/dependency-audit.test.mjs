import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAudit } from '../scripts/audit-dependencies.mjs';

const uuid = { name: 'uuid', severity: 'moderate', url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq' };
const report = vulnerabilities => ({ vulnerabilities, metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } } });
const known = () => report({
  uuid: { severity: 'moderate', via: [uuid] },
  sequelize: { severity: 'moderate', via: ['uuid'] },
});

test('strict audits accept only an empty vulnerability report', () => {
  assert.equal(assessAudit(report({})), 'clean');
  assert.throws(() => assessAudit(known()), /vulnerable packages/);
  assert.throws(() => assessAudit(report({ low: { severity: 'low' } })), /vulnerable packages/);
});

test('baseline probe permits only the known moderate UUID advisory and its dependents', () => {
  assert.equal(assessAudit(known(), { baseline: true }), 'upstream-uuid-unmitigated');
  assert.equal(assessAudit(report({}), { baseline: true }), 'clean');
  const unexpected = known();
  unexpected.vulnerabilities.uuid.via.push({ ...uuid, url: 'https://github.com/advisories/new' });
  assert.throws(() => assessAudit(unexpected, { baseline: true }), /Unexpected baseline advisory/);
  const elevated = known();
  elevated.vulnerabilities.uuid.severity = 'high';
  assert.throws(() => assessAudit(elevated, { baseline: true }), /Unexpected baseline vulnerability/);
});

test('malformed reports, transport errors and unresolved advisory chains fail closed', () => {
  for (const value of [{}, { ...report({}), error: { code: 'E503' } }, { ...report({}), vulnerabilities: known().vulnerabilities }]) {
    assert.throws(() => assessAudit(value), /Invalid|Inconsistent/);
  }
  assert.throws(() => assessAudit(report({ parent: { severity: 'moderate', via: ['missing'] } }), { baseline: true }), /Unexpected/);
  assert.throws(() => assessAudit(report({ parent: { severity: 'moderate', via: ['parent'] } }), { baseline: true }), /Cyclic/);
});
