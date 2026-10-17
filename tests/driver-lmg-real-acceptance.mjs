import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readDriverFile } from '../src/shared/driver-import.mjs';
const require = createRequire(import.meta.url), C = require('../driver-core.js'), L = require('../driver-lmg.js');
const source = process.env.SURVEYKIT_DRIVER_REAL_SAV;
assert.ok(source, 'Set SURVEYKIT_DRIVER_REAL_SAV explicitly to the local acceptance SAV.');
const [table] = await readDriverFile(new File([fs.readFileSync(source)], path.basename(source))), d = C.normalizeTable(table);
assert.equal(L.matchQuestionnaire(d), true);
const jobs = L.questionnaireJobs(d), models = [], started = Date.now();
for (const job of jobs) {
  const m = L.runJob(d, job); models.push(m);
  assert.ok(m.fieldIds.every(id => id === 'Q12__1' || L.INDICATORS.some(f => f.id === id)));
  assert.equal(m.weightMethod, 'beta-abs');
  if (m.hasWeights) {
    assert.ok(Math.abs(m.results.reduce((v, r) => v + r.weight, 0) - 1) < 1e-9);
    assert.ok(Math.abs(m.results.reduce((v, r) => v + r.lmgWeight, 0) - 1) < 1e-9);
    const totalBeta = m.results.reduce((s,r)=>s+Math.abs(r.beta),0);
    assert.ok(m.results.every(r => r.weight >= 0 && Math.abs(r.weight-Math.abs(r.beta)/totalBeta)<1e-12 && Number.isFinite(r.beta) && Number.isFinite(r.rawB) && Math.sign(r.rawB)===Math.sign(r.beta)));
    if (!m.formalWeights) assert.equal(m.status, '探索性结果');
    if (!m.bootstrap.intervalsAvailable) assert.ok(m.results.every(r=>r.weightLow===null && r.rawBLow===null && r.firstRate===null));
  } else assert.ok(m.results.every(r => r.weight === null && r.weightLow === null && r.rawB === null));
  console.log(`${m.label}: N=${m.n}/${m.total}, K=${m.k}, ${m.status}, CV=${m.cv?.mean?.toFixed(3) ?? '—'}`);
}
assert.equal(models.length, 37);
assert.equal(jobs[0].id, 'all-secondary');
assert.deepEqual(jobs[0].xs, L.INDICATORS.map(f=>f.id));
assert.equal(models[0].k,11); assert.equal(models[0].n,15); assert.equal(models[0].total,3600);
assert.equal(models[0].hasWeights,true); assert.equal(models[0].formalWeights,false); assert.equal(models[0].status,'探索性结果');
assert.ok(models[0].results.every(r=>r.weight!==null && Number.isFinite(r.rawB) && Number.isFinite(r.beta)));
assert.deepEqual(models.filter(m => m.kind === 'platform').map(m => m.n), [900, 900, 900, 900]);
assert.deepEqual(models.filter(m => m.experience === '进行售后').map(m => m.n), [117, 41, 63, 44]);
assert.ok(models.filter(m => m.experience === '进行售后' || m.kind === 'diagnostic').every(m => !m.formalWeights));
assert.ok(models.filter(m => m.kind === 'membership' && ['京东', '抖音'].includes(m.platform)).every(m => !m.formalWeights));
const out = path.resolve('.data/driver-all11-20261017'); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'real-all11-results.json'), JSON.stringify({ source: path.basename(source), n: d.rows.length, version: L.VERSION, models }, null, 2));
console.log(JSON.stringify({ models: models.length, formal: models.filter(m => m.formalWeights).length, exploratory:models.filter(m=>m.hasWeights&&!m.formalWeights).length, unestimable:models.filter(m=>!m.hasWeights).length, elapsedSeconds: (Date.now() - started) / 1000 }));
