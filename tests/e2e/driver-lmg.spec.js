const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('surveykit_tour_done', '1')); await page.goto('/#driver-analysis'); await expect(page.locator('#driverUpload')).toBeVisible(); });
function csv(n = 360) {
  let s = 25; const r = () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 4294967296; };
  return ['A,B,Y', ...Array.from({ length: n }, () => { const a = r() * 10, b = .8 * a + r() * 4; return [a, b, 2 * a - b + .3 * r()].join(','); })].join('\n');
}
async function single(page, n = 360) {
  await page.locator('#driverFileInput').setInputFiles({ name: 'weights.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(n)) });
  await page.locator('#driverDialogNext').click(); await page.locator('#driverPickY').click();
  await page.locator('[data-picker-tab="available"]').click(); await page.locator('[data-driver-y="Y"]').check(); await page.locator('#driverPickerApply').click();
  await page.locator('#driverPickX').click(); await page.locator('[data-driver-x="A"]').check(); await page.locator('[data-driver-x="B"]').check(); await page.locator('#driverPickerApply').click();
  await page.locator('#driverDialogRun').click(); await expect(page.locator('#driverLmgProgress')).toContainText('已检查');
}
async function real(page) {
  const file = process.env.SURVEYKIT_DRIVER_REAL_SAV; test.skip(!file, 'Set SURVEYKIT_DRIVER_REAL_SAV for customer-file acceptance.');
  await page.locator('#driverFileInput').setInputFiles(file);
  await expect(page.locator('#driverLmgScope')).toHaveValue('questionnaire');
  await expect(page.locator('#driverWeightMethod')).toHaveValue('beta-abs');
  await expect(page.locator('#driverDialogUseNpsPlan')).toBeVisible(); await page.locator('#driverDialogUseNpsPlan').click();
  await page.locator('#runDriverAnalysis').click(); await expect(page.locator('#driverLmgProgress')).toContainText('已检查 37', { timeout: 90000 });
}
test('default beta absolute weights preserve original B, beta and negative sign with LMG comparison', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await single(page);
  await expect(page.locator('#driverResults')).toContainText('可输出组内权重'); await expect(page.locator('#driverResults')).toContainText('负向关联');
  const m = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(m.formalWeights).toBe(true); expect(m.results.reduce((v, r) => v + r.weight, 0)).toBeCloseTo(1, 10);
  expect(m.results.find(r => r.id === 'B').weight).toBeGreaterThan(0); expect(m.results.find(r => r.id === 'B').beta).toBeLessThan(0);
  expect(m.weightMethod).toBe('beta-abs'); expect(m.results.find(r=>r.id==='B').rawB).toBeLessThan(0);
  const total=m.results.reduce((s,r)=>s+Math.abs(r.beta),0);
  for(const r of m.results) expect(r.weight).toBeCloseTo(Math.abs(r.beta)/total,12);
  await expect(page.locator('#driverResults')).toContainText('非标准化 B'); await expect(page.locator('#driverResults')).toContainText('LMG 对照权重');
  await expect(page.locator('#exportDriverPptx')).toBeEnabled();
  const download = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click(); const file = await download;
  expect(file.suggestedFilename()).toBe('关键驱动分组权重与诊断.xlsx');
  const xml = await page.evaluate(bytes => readZipText(new Uint8Array(bytes).buffer, 'xl/worksheets/sheet1.xml'), [...fs.readFileSync(await file.path())]);
  expect(xml).toContain('LMG 权重'); expect(xml).toContain('非标准化 B'); expect(xml).toContain('主权重区间下限'); expect(xml).toContain('系数正负');
  await page.locator('#driverResults').screenshot({ path: testInfo.outputPath('lmg-directions.png') }); expect(errors).toEqual([]);
});
test('small estimable model shows exploratory weights and exports the status with signed coefficients', async ({ page }) => {
  await single(page, 30); await expect(page.locator('#driverResults')).toContainText('探索性结果');
  await expect(page.locator('.driver-lmg-bars')).toHaveCount(1); await expect(page.locator('#exportDriverPptx')).toBeEnabled();
  const m = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(m.exploratory).toBe(true); expect(m.formalWeights).toBe(false); expect(m.results.every(r => r.weight >= 0 && r.importance === r.weight)).toBe(true);
  const download = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click(); const file = await download;
  const bytes = [...fs.readFileSync(await file.path())];
  const text = await page.evaluate(bytes => readZipText(new Uint8Array(bytes).buffer, 'xl/worksheets/sheet1.xml'), bytes);
  expect(text).toContain('探索性结果'); expect(text).toContain('低于本页可靠性门槛'); expect(text).toContain('标准化 β');
});

test('switching primary method uses the same cohort and keeps B/beta/signs unchanged',async({page})=>{
  await single(page);
  const before=await page.evaluate(()=>projectDataBus.get('modelResults.driver'));
  await page.locator('#driverWeightMethod').selectOption('lmg');
  const after=await page.evaluate(()=>projectDataBus.get('modelResults.driver'));
  expect(after.weightMethod).toBe('lmg'); expect(after.n).toBe(before.n); expect(after.r2).toBe(before.r2);
  for(const r of after.results){const old=before.results.find(v=>v.id===r.id);expect(r.rawB).toBe(old.rawB);expect(r.beta).toBe(old.beta);expect(r.sign).toBe(old.sign);expect(r.weight).toBe(old.lmgWeight);expect(r.comparisonWeight).toBe(old.weight);}
  await expect(page.locator('#driverResults')).toContainText('LMG 主权重');
  await page.locator('#driverWeightMethod').selectOption('beta-abs');
  const restored=await page.evaluate(()=>projectDataBus.get('modelResults.driver')); expect(restored.results.map(r=>r.weight)).toEqual(before.results.map(r=>r.weight));
});

test('exploratory PPT payload carries B/beta and status; switching method cancels stale downloads',async({page})=>{
  await single(page,30);
  let release,payload; const gate=new Promise(resolve=>{release=resolve;});
  await page.route('**/pptx-api/model-chart',async route=>{payload=route.request().postDataJSON();await gate;await route.fulfill({status:200,contentType:'application/octet-stream',body:'mock-render-response'});});
  const downloads=[];page.on('download',d=>downloads.push(d));
  await page.locator('#exportDriverPptx').click();
  await expect.poll(()=>payload?.data.n).toBe(30);
  expect(payload.data.exploratory).toBe(true);expect(payload.data.dvName).toContain('探索性结果');expect(payload.data.weightMethod).toBe('beta-abs');
  expect(payload.data.results.find(r=>r.id==='B').rawB).toBeLessThan(0);
  await page.locator('#driverWeightMethod').selectOption('lmg'); release();
  await expect(page.locator('#exportDriverPptx')).toHaveText('导出可编辑 PPT'); await expect(page.locator('#exportDriverPptx')).toBeEnabled();
  expect(downloads).toHaveLength(0);expect((await page.evaluate(()=>projectDataBus.get('modelResults.driver'))).weightMethod).toBe('lmg');
});
test('cancel and edits invalidate running computations and both export paths', async ({ page }) => {
  await single(page);
  await page.evaluate(() => {
    window.originalLmgWorker = window.Worker;
    window.Worker = class extends window.originalLmgWorker { postMessage(...args) { window.releaseLmgWorker = () => super.postMessage(...args); } };
  });
  await page.locator('#runDriverAnalysis').click(); await page.locator('#driverLmgCancel').click();
  await expect(page.locator('#driverResults')).toContainText('计算已取消'); await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await page.evaluate(() => { window.Worker = window.originalLmgWorker; window.releaseLmgWorker(); });
  await page.waitForTimeout(250); expect(await page.evaluate(() => projectDataBus.get('modelResults.driver'))).toBeNull();
  await page.locator('#runDriverAnalysis').click(); await expect(page.locator('#driverLmgProgress')).toContainText('已检查');
  await page.locator('#driverMissingCodes').evaluate(el => { el.value = '99'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#exportDriverExcel')).toBeDisabled(); await expect(page.locator('#exportDriverPptx')).toBeDisabled();
  expect(await page.evaluate(() => projectDataBus.get('modelResults.driverLmgGroups'))).toBeNull();
});
test('real SAV defaults to all 11 weights while retaining platform experience groups and export', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); await real(page);
  const saved = await page.evaluate(() => projectDataBus.get('modelResults.driverLmgGroups'));
  expect(saved.models).toHaveLength(37); expect(saved.models.filter(m => m.formalWeights)).toHaveLength(14);
  expect(saved.models.filter(m=>m.hasWeights&&!m.formalWeights)).toHaveLength(22); expect(saved.models.filter(m=>!m.hasWeights)).toHaveLength(1);
  expect(saved.models.filter(m=>m.lmgFormalWeights)).toHaveLength(25);
  expect(saved.models.filter(m => m.kind === 'platform').map(m => m.n)).toEqual([900, 900, 900, 900]);
  expect(saved.models.filter(m => m.experience === '进行售后').map(m => m.n)).toEqual([117, 41, 63, 44]);
  for (const m of saved.models) {
    expect(m.fieldIds.every(id => ['A1__1', 'Q16__1', 'Q19__1', 'Q25__1', 'Q30__1', 'Q35__1', 'Q38__1', 'Q40__1', 'Q42__1', 'Q45__1', 'Q49__1', 'Q12__1'].includes(id))).toBe(true);
    if (m.hasWeights) {expect(m.results.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(1, 10);expect(m.results.every(r=>Number.isFinite(r.rawB)&&Number.isFinite(r.beta))).toBe(true);}
    else expect(m.results.every(r => r.weight === null && r.rawB === null && r.lmg === null)).toBe(true);
  }
  const full=await page.evaluate(()=>projectDataBus.get('modelResults.driver'));
  expect(full.id).toBe('all-secondary'); expect(full.total).toBe(3600); expect(full.n).toBe(15); expect(full.k).toBe(11); expect(full.exploratory).toBe(true);
  expect(full.results.map(r=>r.id).sort()).toEqual(['A1__1','Q16__1','Q19__1','Q25__1','Q30__1','Q35__1','Q38__1','Q40__1','Q42__1','Q45__1','Q49__1'].sort());
  expect(full.results.reduce((s,r)=>s+r.weight,0)).toBeCloseTo(1,12);
  await expect(page.locator('#driverLmgPlatform')).toHaveValue('全部样本'); await expect(page.locator('#driverLmgGroup')).toHaveValue('all-secondary');
  await expect(page.locator('.driver-lmg-coefficients tbody tr')).toHaveCount(11); await expect(page.locator('.driver-result-bar')).toHaveCount(11);
  await expect(page.locator('#driverResults')).toContainText('探索性结果'); await expect(page.locator('#driverResults')).toContainText('不能代表全部导入样本');
  await page.locator('#driverResults').screenshot({ path: testInfo.outputPath('all11-default.png') });
  await page.locator('#driverLmgPlatform').selectOption('官方商城'); await page.locator('#driverLmgGroup').selectOption('1-base');
  await expect(page.locator('.driver-lmg-coefficients tbody tr')).toHaveCount(5); await expect(page.locator('#driverResults')).toContainText('N=900');
  await expect(page.locator('#driverViewAllIndicators')).toBeEnabled(); await page.locator('#driverViewAllIndicators').click();
  await expect(page.locator('.driver-lmg-coefficients tbody tr')).toHaveCount(11); await expect(page.locator('#driverLmgGroup')).toHaveValue('all-secondary');
  await page.locator('#driverWeightMethod').selectOption('lmg');
  await expect(page.locator('.driver-lmg-coefficients tbody tr')).toHaveCount(11);
  const contrast=await page.evaluate(()=>projectDataBus.get('modelResults.driver')); expect(contrast.n).toBe(15);
  for(const r of contrast.results)expect(r.rawB).toBe(full.results.find(v=>v.id===r.id).rawB);
  await page.locator('#driverWeightMethod').selectOption('beta-abs');
  await page.locator('#driverLmgPlatform').selectOption('京东'); await page.locator('#driverLmgGroup').selectOption('3-Q7__5');
  await expect(page.locator('#driverResults')).toContainText('N=63'); await expect(page.locator('#driverResults')).toContainText('探索性结果');
  await expect(page.locator('#exportDriverPptx')).toBeEnabled();
  await page.locator('#driverLmgGroup').selectOption('3-member'); await expect(page.locator('#driverResults')).toContainText('口径待核实');
  await page.locator('#driverLmgPlatform').selectOption('官方商城'); await page.locator('#driverLmgGroup').selectOption('1-joint');
  await expect(page.locator('#driverResults')).toContainText('N=15'); await expect(page.locator('[data-lmg-weight]').first()).toContainText('%');
  await expect(page.locator('#driverResults')).toContainText('探索性结果'); await expect(page.locator('#driverResults')).toContainText('区间未确认');
  await page.locator('#driverResults').screenshot({ path: testInfo.outputPath('real-beta-exploratory.png') });
  await page.locator('#driverLmgPlatform').selectOption('抖音'); await page.locator('#driverLmgGroup').selectOption('4-joint');
  await expect(page.locator('#driverResults')).toContainText('无法估计权重'); await expect(page.locator('[data-lmg-weight]').first()).toHaveText('—'); await expect(page.locator('#exportDriverPptx')).toBeDisabled();
  await page.locator('#driverWeightMethod').selectOption('lmg');
  const dl = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click(); const file = await dl; await file.saveAs(testInfo.outputPath('real-lmg-primary.xlsx'));
  await page.locator('#driverWeightMethod').selectOption('beta-abs');
  const db = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click(); const betaFile = await db; await betaFile.saveAs(testInfo.outputPath('real-beta-groups.xlsx'));
  await fs.promises.writeFile(testInfo.outputPath('real-beta-browser.json'), JSON.stringify(saved, null, 2));
  await page.locator('#driverViewAllIndicators').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.driver-lmg-coefficients tbody tr')).toHaveCount(11);
  const b = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); expect(b.scroll).toBeLessThanOrEqual(b.width + 1);
  expect(errors).toEqual([]);
});
test('group plan can be changed to a manual model and project changes cannot revive results', async ({ page }) => {
  await real(page); await page.locator('#driverLmgScope').selectOption('single'); await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await page.locator('#runDriverAnalysis').click(); await expect(page.locator('#driverLmgProgress')).toContainText('已检查 1');
  await expect(page.locator('#driverResults')).toContainText('N=15');
  await page.locator('#driverUseNpsPlan').click(); await page.locator('#runDriverAnalysis').click();
  await page.evaluate(() => projectDataBus.attachToProject('lmg-project-isolation'));
  await expect(page.locator('#driverSourceSummary')).toContainText('尚未导入'); await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await page.waitForTimeout(300); expect(await page.evaluate(() => projectDataBus.get('modelResults.driver'))).toBeNull();
});
