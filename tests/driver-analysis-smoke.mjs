import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { readDriverFile } from '../src/shared/driver-import.mjs';
import fixtures from './fixtures/driver-fixtures.cjs';
const require = createRequire(import.meta.url), C = require('../driver-core.js');
const choice = { y: 'QY', xs: ['Q1', 'Q2'] };
const data = () => C.normalizeTable(C.parseDelimited(fixtures.csv()), 'fixture.csv');
const file = (name, bytes) => new File([bytes], name);
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('recognizes numeric scores and excludes identifiers, strings, empty/constant and nominal fields', () => {
  const d = data();
  for (const id of ['QY', 'Q1', 'Q2']) assert.equal(d.fields.find(f => f.id === id).eligible, true);
  for (const id of ['ID', 'CITY', 'EMPTY', 'CONST']) assert.equal(d.fields.find(f => f.id === id).eligible, false);
  const nominal = C.normalizeTable({ headers: ['G'], rows: [[1], [2]], variables: [{ measure: 'nominal' }] });
  assert.match(nominal.fields[0].reason, /类别/);
  assert.equal(C.numeric('4abc'), null); assert.equal(C.numeric(''), null); assert.equal(C.numeric(0), 0);
});
test('uses only selected fields for complete cases, supports Y at any column, preserves zero and user missing', () => {
  const d = data(), p = C.prepare(d, choice, [99]);
  assert.deepEqual(p.errors, []); assert.equal(p.n, 46); assert.equal(p.excluded, 2);
  assert.equal(p.data.rows[0][0], 0);
  const reordered = C.normalizeTable({ headers: [...fixtures.headers].reverse(), rows: fixtures.rows });
  const a = C.analyze(p.data), b = C.analyze(C.prepare(reordered, choice, [99]).data);
  close(a.r2, b.r2); a.results.forEach((r, i) => close(r.beta, b.results[i].beta));
});
test('SAV and compressed SAV preserve Chinese labels, numeric codes, system/user missing and range missing', async () => {
  const baseline = C.analyze(C.prepare(data(), choice, [99]).data);
  for (const options of [{}, { range: true }, { compressed: true }]) {
    const sheets = await readDriverFile(file('问卷.sav', await fixtures.sav(options)));
    const d = C.normalizeTable(sheets[0], '问卷.sav'), p = C.prepare(d, choice);
    assert.deepEqual(p.errors, []); assert.equal(p.n, 46);
    assert.equal(d.rows[5].Q1, 5); assert.equal(d.rows[47].QY, null); assert.equal(d.rows[46].Q2, null);
    assert.equal(d.fields.find(f => f.id === 'Q1').valueLabels.find(v => v.value === 5).label, '非常满意');
    assert.equal(d.fields.find(f => f.id === 'QY').label, '总体满意度');
    const result = C.analyze(p.data); close(result.r2, baseline.r2);
    result.results.forEach((r, i) => close(r.beta, baseline.results[i].beta));
  }
});
test('CSV and workbook tables match SAV model results', async () => {
  const csv = C.normalizeTable(C.parseDelimited((await readDriverFile(file('sample.csv', fixtures.csv())))[0].text));
  const workbook = await readDriverFile(file('sample.xlsx', 'PK'), async () => [{ name: 'Data', rows: [fixtures.headers, ...fixtures.rows.map(r => fixtures.headers.map(h => r[h]))] }]);
  const xlsx = C.normalizeTable(workbook[0]);
  close(C.analyze(C.prepare(csv, choice, [99]).data).r2, C.analyze(C.prepare(xlsx, choice, [99]).data).r2);
});
test('blocks insufficient samples, Y=X, constant-after-exclusion and rank deficiency', () => {
  assert.match(C.prepare(data(), { y: 'QY', xs: ['QY'] }).errors.join(''), /同时/);
  const small = C.normalizeTable({ headers: ['Y', 'A', 'B'], rows: [[1, 1, 2], [2, 2, 1], [3, 3, 2]] });
  assert.match(C.prepare(small, { y: 'Y', xs: ['A', 'B'] }).errors.join(''), /完整样本/);
  const same = C.normalizeTable({ headers: ['Y', 'A', 'B'], rows: [[1, 1, 2], [2, 2, 4], [3, 3, 6], [4, 4, 8], [5, 5, 10]] });
  assert.match(C.prepare(same, { y: 'Y', xs: ['A', 'B'] }).errors.join(''), /共线/);
  const constant = C.normalizeTable({ headers: ['Y', 'A', 'B'], rows: [[1, 1, 1], [2, 1, 2], [3, 1, 3], [4, 1, 4], [null, 2, 5]] });
  assert.match(C.prepare(constant, { y: 'Y', xs: ['A'] }).errors.join(''), /没有变化/);
});
test('analytic independent model keeps positive and negative effects and correct importance', () => {
  const rows = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) rows.push([a, 4 + 2 * a - b, b]);
  const r = C.analyze({ headers: ['a', 'Y', 'b'], rows, dvIndex: 1 });
  close(r.r2, 1); close(r.results[0].beta, 2 / Math.sqrt(5)); close(r.results[1].beta, -1 / Math.sqrt(5));
  close(r.results[0].importance, 2 / 3); close(r.results[1].importance, 1 / 3);
});
test('handles quoted commas/newlines, BOM, duplicate headers and strict malformed input', () => {
  const d = C.normalizeTable(C.parseDelimited('\uFEFF"产品,体验",Y,Y\n"4",3,2\n5,4,3'));
  assert.deepEqual(d.headers, ['产品,体验', 'Y', 'Y_2']); assert.equal(d.notices.length, 1);
  assert.equal(C.parseDelimited('A,B\n"line\ntext",1').rows[0][0], 'line\ntext');
  assert.throws(() => C.parseDelimited('1,2\n3,4'), /字段名/);
  assert.throws(() => C.parseDelimited('A,B\n"broken,1'), /引号/);
  assert.throws(() => C.normalizeTable(C.parseDelimited('A,B\n1,2,3')), /列数/);
  assert.throws(() => C.missingCodes('99,abc'), /缺失码/);
});
test('rejects corrupt SAV, unsupported extension and oversized file without reading it', async () => {
  await assert.rejects(readDriverFile(file('broken.sav', 'not SAV')), /SAV 读取失败/);
  await assert.rejects(readDriverFile(file('sample.xls', 'x')), /支持 SAV/);
  await assert.rejects(readDriverFile({ name: 'big.sav', size: 21 * 1024 * 1024, arrayBuffer() { throw Error('should not read'); } }), /20MB/);
});
test('legacy render computation uses the same verified numeric engine', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function computeDriverAnalysis('), end = app.indexOf('\nfunction renderDriverAnalysis', start);
  const context = vm.createContext({ window: { DriverCore: C } }); vm.runInContext(app.slice(start, end), context);
  const p = C.prepare(data(), choice, [99]); close(context.computeDriverAnalysis(p.data).r2, C.analyze(p.data).r2);
});

test('role-specific recommendations hide non-scores and low coverage without removing manual choices', () => {
  const headers = ['TOTAL', 'Q12_1', 'Q12_2', 'LOW', 'BIN', 'CITY', 'ID'];
  const variables = headers.map(id => ({ label: id === 'TOTAL' ? '总体满意度' : id.startsWith('Q12') || id === 'LOW' ? '服务评分' : id === 'CITY' ? '城市' : '', measure: id === 'CITY' ? 'nominal' : 'unknown' }));
  const rows = Array.from({ length: 20 }, (_, i) => [i % 11, i % 5, Math.floor(i / 4), i < 5 ? i : null, i % 2, i % 3, i + 1]);
  const d = C.normalizeTable({ headers, variables, rows });
  assert.deepEqual(C.candidateFields(d, 'y').recommended.map(f => f.id), ['TOTAL']);
  const xs = C.candidateFields(d, 'x', { y: 'TOTAL' });
  assert.deepEqual(xs.recommended.map(f => f.id), ['Q12_1', 'Q12_2']);
  assert.ok(xs.available.some(f => f.id === 'LOW')); assert.ok(xs.available.some(f => f.id === 'BIN'));
  assert.ok(xs.excluded.some(f => f.id === 'TOTAL')); assert.ok(xs.excluded.some(f => f.id === 'CITY'));
  assert.equal(C.variableGroup({ id: 'Q12_1' }), 'Q12'); assert.equal(C.variableGroup({ id: 'Q52_3__5' }), 'Q52_3');
});

test('opaque field names fall back to usable numeric candidates without preselecting them', () => {
  const d = C.normalizeTable({ headers: ['Y', 'A', 'B'], rows: [[1, 1, 2], [2, 2, 1], [3, 3, 2], [4, 4, 3]] });
  assert.deepEqual(C.candidateFields(d, 'y').recommended.map(f => f.id), ['Y']);
  assert.deepEqual(C.candidateFields(d, 'x', { y: 'Y' }).recommended.map(f => f.id), ['A', 'B']);
});

test('nominal SAV metadata does not exclude an explicit NPS/rating question', async () => {
  const table = (await readDriverFile(file('nominal.sav', await fixtures.sav({ nominal: true, nps: true }))))[0];
  assert.equal(table.variables.find(v => v.name === 'QY').measure, 'nominal');
  const d = C.normalizeTable(table), target = d.fields.find(f => f.id === 'QY');
  assert.equal(target.eligible, true); assert.equal(target.scoreKind, 'nps'); assert.match(target.measureNotice, /文件标记为类别/);
  assert.equal(C.candidateFields(d, 'y').recommended[0].id, 'QY');
  assert.equal(d.fields.find(f => f.id === 'Q1').eligible, true);
  assert.equal(d.fields.find(f => f.id === 'Q2').eligible, true);
  assert.equal(C.prepare(d, choice).n, 46);
});

test('numeric contacts and grouped NPS/categories remain excluded while recommendation-content scores are factors', () => {
  const headers = ['NPS', 'Q17_3', 'PHONE_open', 'NPS_group', 'GENDER', 'CHECK', 'WILL'];
  const variables = [
    { label: '您有多大意愿推荐此平台？请用0分到10分评分。', measure: 'nominal' },
    { label: '交互体验满意度【打分】请用0分到10分评分：推荐内容符合需求', measure: 'nominal' },
    { measure: 'scale' },
    { label: 'NPS分组', measure: 'nominal', valueLabels: [{ value: 1, label: '贬损者' }, { value: 2, label: '中立者' }, { value: 3, label: '推荐者' }] },
    { label: '您的性别', measure: 'nominal' },
    { label: '请打0分到10分，本行打9分', measure: 'nominal' },
    { label: '推荐意愿【单选】', measure: 'nominal', valueLabels: [{ value: 1, label: '是' }, { value: 2, label: '否' }] },
  ];
  const rows = Array.from({ length: 30 }, (_, i) => [i % 11, i % 7 + 3, 13800000000 + i, i % 3 + 1, i % 2 + 1, i % 10, i % 2 + 1]);
  const d = C.normalizeTable({ headers, rows, variables });
  assert.match(d.fields.find(f => f.id === 'PHONE_open').reason, /联系方式/);
  for (const id of ['NPS_group', 'GENDER', 'CHECK', 'WILL']) assert.equal(d.fields.find(f => f.id === id).eligible, false);
  assert.deepEqual(C.candidateFields(d, 'y').recommended.map(f => f.id), ['NPS']);
  assert.deepEqual(C.candidateFields(d, 'x', { y: 'NPS' }).recommended.map(f => f.id), ['Q17_3']);
});

test('saved profiles can be reclassified from their original labels and numeric rows', async () => {
  const table = (await readDriverFile(file('nominal.sav', await fixtures.sav({ nominal: true, nps: true }))))[0];
  const saved = C.normalizeTable(table); saved.fields.forEach(f => { if (f.measure === 'nominal') { f.eligible = false; f.reason = '旧识别规则'; } });
  const restored = C.normalizeTable(saved);
  assert.equal(restored.fields.find(f => f.id === 'QY').eligible, true);
  assert.equal(C.candidateFields(restored, 'y').recommended[0].id, 'QY');
});

test('NPS factors prefer module ratings, retain routed modules and exclude matrix details, contacts and QC', () => {
  const headers = ['NPS', 'D1__1', 'D2__1', 'D3__1', 'ITEM__1', 'ITEM__2', 'PHONE', 'QC'];
  const variables = [
    { label: '有多大意愿推荐？请用0分到10分评分。' },
    { label: '总体而言，您对宣传推广满意程度如何？请用0分到10分评分。' },
    { label: '基于本次体验，您对会员服务满意程度如何？请用0分到10分评分。' },
    { label: '总体而言，您对售后服务满意程度如何？请用0分到10分评分。' },
    { label: '具体而言，以下方面满意程度如何？请用0分到10分评分：响应速度' },
    { label: '具体而言，以下方面满意程度如何？请用0分到10分评分：客服态度' },
    { label: '联系方式', measure: 'scale' },
    { label: '请用0分到10分评分，本行打9分' },
  ].map(v => ({ measure: 'nominal', ...v }));
  const rows = Array.from({ length: 40 }, (_, i) => [i % 11, i % 10, i % 9, i < 5 ? i : null, i % 8, i % 7, 13800000000 + i, i % 10]);
  const d = C.normalizeTable({ headers, variables, rows });
  const xs = C.candidateFields(d, 'x', { y: 'NPS' });
  assert.equal(xs.factorLevel, 'dimension');
  assert.deepEqual(xs.recommended.map(f => f.id), ['D1__1', 'D2__1', 'D3__1']);
  assert.match(xs.recommended[2].recommendationReason, /跳题/);
  assert.ok(xs.available.some(f => f.id === 'ITEM__1'));
  for (const id of ['PHONE', 'QC', 'NPS']) assert.ok(xs.excluded.some(f => f.id === id));
  const p = C.prepare(d, { y: 'NPS', xs: ['D3__1'] });
  assert.ok(p.warnings.some(w => /12.5%/.test(w) && /不能直接代表全样本/.test(w)));
});
