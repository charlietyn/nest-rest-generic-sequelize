import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { inspectPackage, parsePackOutput } from './check-package.mjs';
import { registry, rootDir, run } from './process.mjs';
import { auditDependencies } from './audit-dependencies.mjs';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const nestMajor = process.env.NEST_VERSION || require('@nestjs/core/package.json').version.split('.')[0];
if (!['11', '12'].includes(nestMajor)) throw new Error('NEST_VERSION must be 11 or 12.');
const temporary = mkdtempSync(join(tmpdir(), 'nest-rest-consumer-'));
try {
  const pack = parsePackOutput(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { capture: true }).stdout);
  inspectPackage(pack);
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  const dependencies = {
    [pkg.name]: `file:${join(temporary, pack.filename).replaceAll('\\', '/')}`,
    '@nestjs/common': `^${nestMajor}.0.0`, '@nestjs/core': `^${nestMajor}.0.0`,
    '@nestjs/sequelize': `^${nestMajor}.0.0`, '@nestjs/testing': `^${nestMajor}.0.0`,
    '@nestjs/platform-express': `^${nestMajor}.0.0`,
    sequelize: pkg.peerDependencies.sequelize, 'sequelize-typescript': pkg.peerDependencies['sequelize-typescript'],
    'reflect-metadata': pkg.peerDependencies['reflect-metadata'], rxjs: pkg.peerDependencies.rxjs,
    typescript: pkg.devDependencies.typescript, '@types/node': pkg.devDependencies['@types/node'],
  };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`], { cwd: consumer });
  auditDependencies({ cwd: consumer, label: `consumer-nest${nestMajor}-upstream`, runtime: true, baseline: true });
  // Library overrides are not inherited by npm consumers. Exercise the exact
  // supported root configuration documented in README, including optional peers.
  const overrides = { sequelize: pkg.overrides.sequelize, exceljs: pkg.overrides.exceljs };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies, overrides }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`], { cwd: consumer });
  const installed = join(consumer, 'node_modules', ...pkg.name.split('/'));
  assert.ok(existsSync(join(installed, 'dist/index.js')));
  assert.ok(!existsSync(join(installed, 'src')));
  const common = `
const assert = require('node:assert/strict');
require('reflect-metadata');
const lib = require('${pkg.name}');
const { Test } = require('@nestjs/testing');
async function verify() {
  assert.equal(typeof lib.BaseService, 'function');
  assert.equal(typeof lib.RestController, 'function');
  assert.equal(typeof lib.RelationManager, 'function');
  assert.deepEqual(lib.parseConditionString('price|>=|5'), { field: 'price', operator: '>=', value: '5' });
  assert.throws(() => lib.parseConditionString('invalid'), /Invalid condition/);
  const module = await Test.createTestingModule({ imports: [lib.GenericRestModule.forRoot({ config: { cache: { enabled: true } } })] }).compile();
  assert.equal(module.get(lib.REST_GENERIC_CONFIG).cache.ttl, 60);
  await module.close();
  assert.throws(() => require('${pkg.name}/dist/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  for (const name of ['exceljs', 'pdfkit']) assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
  await assert.rejects(lib.ExportService.toExcel([], []), /npm install exceljs/);
  await assert.rejects(lib.ExportService.toPdf([], []), /npm install pdfkit/);
  console.log('CommonJS import, DI, errors, exports and absent optional dependencies: OK');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
`;
  writeFileSync(join(consumer, 'consumer.cjs'), common);
  writeFileSync(join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { BaseService, RestController, GenericRestModule, parseConditionString } from '${pkg.name}';
assert.equal(typeof BaseService, 'function');
assert.equal(typeof RestController, 'function');
assert.ok(GenericRestModule.forRoot().providers.length);
assert.equal(parseConditionString('id|=|1').field, 'id');
console.log('Native ESM named imports: OK');
`);
  const typeConsumer = `
import { BaseModel, BaseService, RestController, GenericRestModule, mergeConfig, Scenario } from '${pkg.name}';
import type { RestGenericConfigInput, FilterParams, WriteResult, RgcCacheStore, OneToManyConfig } from '${pkg.name}';
const config: RestGenericConfigInput = { cache: { enabled: true }, filtering: { maxDepth: 4 } };
GenericRestModule.forRoot({ config });
mergeConfig(config);
const query: FilterParams = { oper: { and: ['id|=|1'] }, pagination: { pageSize: 10 } };
class Item extends BaseModel {}
class Service extends BaseService<Item> {}
class Controller extends RestController<Item> {
  constructor(service: Service) { super(service); }
  scenarioValue(@Scenario('default') value: string): string { return value; }
}
declare const service: Service;
const result: Promise<WriteResult> = service.create({ name: 'test' });
const store: RgcCacheStore = { get: () => undefined, set: () => undefined };
declare const relation: OneToManyConfig;
void [query, Controller, result, store, relation];
// @ts-expect-error unknown fields must not become public configuration
GenericRestModule.forRoot({ config: { missing: true } });
`;
  writeFileSync(join(consumer, 'consumer.cts'), typeConsumer);
  writeFileSync(join(consumer, 'consumer.mts'), typeConsumer);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', types: ['node'], strict: true, noEmit: true, skipLibCheck: false, experimentalDecorators: true, emitDecoratorMetadata: true, useDefineForClassFields: false },
    include: ['*.cts', '*.mts'],
  }));
  run(process.execPath, ['consumer.cjs'], { cwd: consumer });
  run(process.execPath, ['consumer.mjs'], { cwd: consumer });
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: consumer });
  // Unlike a root --omit=dev audit, this sees the real installed runtime peers.
  auditDependencies({ cwd: consumer, label: `consumer-nest${nestMajor}-mitigated`, runtime: true });
  dependencies.exceljs = pkg.peerDependencies.exceljs;
  dependencies.pdfkit = pkg.peerDependencies.pdfkit;
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, dependencies, overrides }, null, 2));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`], { cwd: consumer });
  writeFileSync(join(consumer, 'optional.cjs'), `
const assert = require('node:assert/strict');
require('reflect-metadata');
const { ExportService } = require('${pkg.name}');
const ExcelJS = require('exceljs');
async function verify() {
  const file = await ExportService.toExcel([{ name: 'Alice', total: 42 }], ['name', 'total']);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  assert.equal(workbook.worksheets[0].getCell('A2').value, 'Alice');
  assert.equal(workbook.worksheets[0].getCell('B2').value, 42);
  const pdf = await ExportService.toPdf([{ name: 'Alice' }], ['name']);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  console.log('Installed optional peers: Excel round-trip and PDF export OK');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
`);
  run(process.execPath, ['optional.cjs'], { cwd: consumer });
  auditDependencies({ cwd: consumer, label: `consumer-nest${nestMajor}-optional`, runtime: true });
  console.log(`Tarball consumer passed with NestJS ${nestMajor} on ${process.version}.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
