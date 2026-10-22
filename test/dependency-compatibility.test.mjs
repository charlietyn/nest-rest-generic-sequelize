import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);

for (const dependency of ['sequelize', 'exceljs']) {
  test(`${dependency} resolves UUID with working CommonJS exports and buffer bounds checks`, () => {
    const dependencyRequire = createRequire(require.resolve(dependency));
    const { v1, v3, v4, v5, v6, validate, version } = dependencyRequire('uuid');
    assert.ok(validate(v1()));
    assert.equal(version(v4()), 4);
    for (const fn of [v3, v5]) {
      const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      assert.throws(() => fn('x', namespace, new Uint8Array(8), 4), RangeError);
      assert.ok(validate(fn('x', namespace)));
    }
    assert.throws(() => v6({}, new Uint8Array(8), 4), RangeError);
  });
}

test('Sequelize persists UUID defaults and commits/rolls back transactions', async () => {
  const { Sequelize, DataTypes } = require('sequelize');
  const { validate, version } = createRequire(require.resolve('sequelize'))('uuid');
  const db = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  try {
    const Item = db.define('UuidCompatibility', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      timeId: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV1 },
    });
    await db.sync({ force: true });
    await db.transaction(async transaction => {
      assert.ok(validate(transaction.id));
      const item = await Item.create({}, { transaction });
      assert.equal(version(item.get('id')), 4);
      assert.equal(version(item.get('timeId')), 1);
    });
    await assert.rejects(db.transaction(async transaction => {
      await Item.create({}, { transaction });
      throw new Error('rollback probe');
    }), /rollback probe/);
    assert.equal(await Item.count(), 1);
  } finally { await db.close(); }
});

test('ExcelJS round-trips cells and UUID-backed extended conditional formatting', async () => {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Audit');
  sheet.addRows([[1], [2], [3]]);
  sheet.addConditionalFormatting({ ref: 'A1:A3', rules: [{
    type: 'iconSet', iconSet: '3Stars', priority: 1,
    cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }],
  }] });
  const bytes = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(bytes);
  const result = restored.getWorksheet('Audit');
  assert.equal(result.getCell('A2').value, 2);
  assert.equal(result.conditionalFormattings[0].rules[0].iconSet, '3Stars');
  assert.match(result.conditionalFormattings[0].rules[0].x14Id, /^\{[A-F0-9-]{36}\}$/i);
});

test('Istanbul loads YAML configuration and inherited settings with js-yaml 4', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nyc-yaml-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'package.json'), '{"name":"nyc-compatibility","version":"1.0.0"}');
  writeFileSync(join(directory, 'base.yml'), 'all: true\nexclude:\n  - test/**\n');
  writeFileSync(join(directory, '.nycrc.yml'), 'extends: ./base.yml\nreporter:\n  - text\n  - lcov\n');
  const { loadNycConfig } = require('@istanbuljs/load-nyc-config');
  const config = await loadNycConfig({ cwd: directory });
  assert.equal(config.all, true);
  assert.deepEqual(config.exclude, ['test/**']);
  assert.deepEqual(config.reporter, ['text', 'lcov']);
});
