import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), L = require('../driver-lmg.js'), C = require('../driver-core.js');
const close = (a, b, e = 1e-10) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
function random() { let n = 177; return () => { n = Math.imul(n, 1664525) + 1013904223 | 0; return (n >>> 0) / 4294967296; }; }
function data(n = 400) { const r = random(); return Array.from({ length: n }, () => { const a = r() * 10, b = .8 * a + r() * 4; return [a, b, 2 * a - b + .3 * r()]; }); }
const fields = ['A', 'B', 'Y'].map(id => ({ id, label: id }));
test('exact orthogonal LMG partitions R² into known 16:4:1 shares', () => {
  const rows = []; for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) for (const c of [-1, 0, 1]) rows.push([a, b, c, 2 * a - b + .5 * c]);
  const r = L.decompose(rows); close(r.r2, 1); r.shares.forEach((v, i) => close(v, [16, 4, 1][i] / 21));
});
test('correlated LMG equals independent explicit averaging over predictor orders', () => {
  const rows = data(), r = L.decompose(rows), r2 = ids => ids.length ? C.analyze({ headers: [...ids.map(String), 'Y'], rows: rows.map(row => [...ids.map(i => row[i]), row[2]]), dvIndex: ids.length }).r2 : 0;
  const contributions = [(r2([0]) + r2([0, 1]) - r2([1])) / 2, (r2([1]) + r2([0, 1]) - r2([0])) / 2];
  r.raw.forEach((v, i) => close(v, contributions[i])); close(r.raw.reduce((a, b) => a + b, 0), r.r2);
  assert.ok(r.shares.every(v => v >= 0)); close(r.shares.reduce((a, b) => a + b, 0), 1);
});
test('LMG shares are invariant to column order, translation and score scale', () => {
  const rows = data(), a = L.decompose(rows), b = L.decompose(rows.map(r => [100 + 7 * r[1], 3 - .5 * r[0], 99 + 2 * r[2]]));
  close(a.shares[0], b.shares[1]); close(a.shares[1], b.shares[0]);
});
test('default beta absolute shares retain signed B and beta with an independent LMG comparison', () => {
  const r = L.analyze(data(), fields, {}, { bootstrap: 200, seed: 5 });
  assert.equal(r.formalWeights, true, JSON.stringify(r.reasons));
  const b = r.results.find(r => r.id === 'B'); assert.ok(b.weight > 0); assert.ok(b.beta < 0); assert.equal(b.direction, '负向关联');
  assert.equal(r.weightMethod, 'beta-abs'); assert.ok(b.rawB < 0); assert.equal(b.sign, '负向');
  assert.ok(b.weightLow >= 0 && b.weightHigh <= 1); close(b.weight, Math.abs(b.beta) / r.results.reduce((s, r) => s + Math.abs(r.beta), 0));
  assert.notEqual(b.weight, b.lmgWeight); close(r.results.reduce((v, r) => v + r.lmg, 0), r.r2);
});
test('reproducible bootstrap and prediction diagnostics report complete validation metadata', () => {
  const a = L.analyze(data(), fields, {}, { bootstrap: 200, seed: 42 }), b = L.analyze(data(), fields, {}, { bootstrap: 200, seed: 42 });
  assert.deepEqual(a, b); assert.equal(a.cv.repeats, 10); assert.equal(a.bootstrap.valid, 200); assert.ok(a.cv.mean > .8);
});
test('estimable small/biased cohorts and unresolved scope retain clearly exploratory weight values', () => {
  for (const [rows, context] of [[data(15), {}], [data(), { total: 1000 }], [data(), { issues: ['口径待核实'] }]]) {
    const r = L.analyze(rows, fields, context); assert.equal(r.formalWeights, false); assert.equal(r.hasWeights, true); assert.equal(r.status, '探索性结果'); assert.ok(r.reasons.length);
    close(r.results.reduce((s, r) => s + r.weight, 0), 1); close(r.results.reduce((s, r) => s + r.lmgWeight, 0), 1);
  }
});
test('selected missing scores are excluded, observed zero remains and extra codes are respected', () => {
  const rows = data(); rows[0][0] = 0; rows[1][0] = null; rows[2][1] = 99;
  const r = L.analyze(rows, fields, { total: rows.length, extraMissing: [99] }, { bootstrap: 200 });
  assert.equal(r.n, 398); assert.equal(r.excluded, 2);
  close(r.results.find(r => r.id === 'A').mean, rows.filter((_, i) => ![1, 2].includes(i)).reduce((v, r) => v + r[0], 0) / 398);
});
test('constant and singular models are diagnostics, not invented zero/equal weights', () => {
  for (const rows of [data().map(r => [1, r[1], r[2]]), data().map(r => [r[0], 2 * r[0], r[2]])]) {
    const r = L.analyze(rows, fields); assert.equal(r.formalWeights, false); assert.ok(r.results.every(r => r.weight === null));
  }
});
test('high collinearity, weak prediction and insufficient bootstrap warn without erasing estimable weights', () => {
  const r = random();
  const cases = [L.analyze(data().map(x => [x[0], x[0] + .001 * x[1], x[2]]), fields), L.analyze(data().map(x => [x[0], x[1], r()]), fields), L.analyze(data(), fields, {}, { bootstrap: 20 })];
  for (const result of cases) { assert.equal(result.formalWeights, false); assert.equal(result.hasWeights, true); assert.ok(result.results.every(r => r.weight >= 0 && Number.isFinite(r.rawB))); }
  assert.ok(cases[2].results.every(r => r.weightLow === null && r.rawBLow === null && r.firstRate === null));
  assert.throws(() => L.decompose([Array(14).fill(1), Array(14).fill(2)]), /1–12/);
});
test('unrelated questionnaires cannot silently use the named ecommerce grouping preset', () => {
  const d = C.normalizeTable({ headers: ['A', 'B', 'Y'], rows: data() });
  assert.equal(L.matchQuestionnaire(d), false); assert.throws(() => L.questionnaireJobs(d), /未匹配/);
});

test('wide weight intervals are visible with an exploratory status rather than hidden', () => {
  let seed = 99; const r = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  const rows = Array.from({ length: 120 }, () => { const a = 10 * r(), b = 10 * r(); return [a, b, .5 * a + .5 * b + 8 * (r() - .5)]; });
  const result = L.analyze(rows, fields, {}, { bootstrap: 200, seed: 8 });
  assert.ok(result.cv.mean > .5); assert.ok(result.bootstrap.lmgMaxWidth > .30);
  assert.equal(result.lmgFormalWeights, false); assert.match(result.lmgReasons.join(''), /区间过宽/);
  assert.equal(result.formalWeights, true); // Each method has its own interval-width assessment.
  assert.equal(result.hasWeights, true); assert.ok(result.results.every(r => r.weight >= 0 && r.weightLow >= 0 && r.lmgWeight >= 0));
});

test('raw B and intercept predict on the original scale while beta uses sample deviations', () => {
  const rows = data(400).map(r => [100 + 7*r[0], 50 + .1*r[1], 20 + 3*r[2]]);
  const model = L.analyze(rows, fields, {}, { bootstrap: 200, seed: 17 });
  const ordered = fields.slice(0,-1).map(f => model.results.find(r => r.id === f.id));
  const mean = j => rows.reduce((s,r) => s+r[j]/rows.length,0), sd = j => Math.sqrt(rows.reduce((s,r) => s+(r[j]-mean(j))**2,0)/(rows.length-1));
  ordered.forEach((r,j) => close(r.beta,r.rawB*sd(j)/sd(2)));
  close(model.intercept,mean(2)-ordered.reduce((s,r,j) => s+r.rawB*mean(j),0));
  assert.ok(ordered[1].rawB < -20); assert.ok(ordered[1].rawBLow < ordered[1].rawB && ordered[1].rawBHigh > ordered[1].rawB);
  const original=L.analyze(data(400),fields,{}, {bootstrap:200,seed:17});
  ordered.forEach(r => close(r.weight,original.results.find(v=>v.id===r.id).weight));
});

test('15 complete respondents and 11 factors expose exploratory points without misleading bootstrap intervals', () => {
  const rnd=random(), rows=Array.from({length:15},()=>{const xs=Array.from({length:11},()=>rnd()*10);return [...xs,xs.reduce((s,v,j)=>s+(j%2?-.2:.3)*v,0)+rnd()];});
  const fs=Array.from({length:12},(_,i)=>({id:`v${i}`}));
  const result=L.analyze(rows,fs,{total:3600},{bootstrap:200,seed:31});
  assert.equal(result.hasWeights,true); assert.equal(result.formalWeights,false); assert.equal(result.status,'探索性结果');
  assert.ok(result.bootstrap.valid<180); assert.equal(result.bootstrap.intervalsAvailable,false);
  assert.ok(result.results.every(r=>r.weight>=0 && r.lmgWeight>=0 && r.weightLow===null && r.betaLow===null && r.rawBLow===null && r.firstRate===null));
});

test('underidentified models cannot invent any weights or signed coefficients',()=>{
  const r=L.analyze(data(3),fields);
  assert.equal(r.hasWeights,false); assert.equal(r.status,'无法估计权重'); assert.ok(r.results.every(v=>v.weight===null && v.rawB===null && v.beta===null));
});
