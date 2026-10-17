const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const fixtures = require('../fixtures/driver-fixtures.cjs');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surveykit_tour_done', '1'));
  await page.goto('/#driver-analysis');
  await expect(page.locator('#driverUpload')).toBeVisible();
});
async function upload(page, name = '问卷.sav', bytes) {
  await page.locator('#driverFileInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes || await fixtures.sav() });
  await expect(page.locator('#driverVariableDialog')).toBeVisible();
}
async function select(page, y = 'QY', xs = ['Q1', 'Q2']) {
  await page.locator('#driverDialogNext').click();
  await pickY(page, y); await pickXs(page, xs);
}
async function pickY(page, id) {
  await page.locator('#driverPickY').click();
  if (!await page.locator(`[data-driver-y="${id}"]`).count()) await page.locator('[data-picker-tab="available"]').click();
  await page.locator(`[data-driver-y="${id}"]`).check(); await page.locator('#driverPickerApply').click();
}
async function pickXs(page, ids) {
  await page.locator('#driverPickX').click();
  if (await page.locator('#driverClearXs').isVisible()) await page.locator('#driverClearXs').click();
  for (const id of ids) {
    if (!await page.locator(`[data-driver-x="${id}"]`).count()) await page.locator('[data-picker-tab="available"]').click();
    await page.locator(`[data-driver-x="${id}"]`).check();
  }
  await page.locator('#driverPickerApply').click();
}
async function runSav(page) { await upload(page); await select(page); await page.locator('#driverDialogRun').click(); await expect(page.locator('#driverResults')).toContainText('N=46'); }

test('direct SAV import, automatic field identification, modal selection, analysis and Excel export', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await upload(page);
  await expect(page.locator('#driverDataPreview')).toContainText('总体满意度');
  await expect(page.locator('#driverDialogDataSummary')).toContainText('48 个样本');
  await select(page);
  await page.locator('#driverPickX').click();
  await expect(page.locator('[data-driver-x]')).toHaveCount(2);
  await expect(page.locator('[data-driver-x="ID"]')).toHaveCount(0);
  await expect(page.locator('#driverFieldRows')).toContainText('5＝非常满意');
  await page.screenshot({ path: testInfo.outputPath('sav-factor-picker.png'), fullPage: true });
  await page.locator('[data-picker-tab="excluded"]').click();
  await expect(page.locator('[data-driver-x="ID"]')).toBeDisabled();
  await expect(page.locator('[data-driver-x="CITY"]')).toBeDisabled();
  await expect(page.locator('[data-driver-x="EMPTY"]')).toBeDisabled();
  await expect(page.locator('[data-driver-x="QY"]')).toBeDisabled();
  await page.locator('#driverPickerClose').click();
  await expect(page.locator('#driverDialogChecks')).toContainText('46');
  await page.screenshot({ path: testInfo.outputPath('sav-variable-dialog.png'), fullPage: true });
  await page.locator('#driverDialogRun').click();
  await expect(page.locator('#driverResults')).toContainText('N=46');
  await expect(page.locator('#driverResults')).toContainText('总体满意度');
  await expect(page.locator('#driverResults')).toContainText('缺失排除 2 人');
  const result = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(result.r2).toBeGreaterThan(.99); expect(result.fieldIds).toEqual(['Q1', 'Q2', 'QY']);
  const download = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click();
  const file = await download; expect(file.suggestedFilename()).toBe('关键驱动分组权重与诊断.xlsx');
  const bytes = [...fs.readFileSync(await file.path())];
  const text = await page.evaluate(bytes => readZipText(new Uint8Array(bytes).buffer, 'xl/worksheets/sheet1.xml'), bytes);
  expect(text).toContain('有效 N'); expect(text).toContain('非标准化 B'); expect(text).toContain('探索性结果');
  await page.screenshot({ path: testInfo.outputPath('driver-results-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('CSV, reordered columns and real XLSX with sheet switching produce the same coefficients', async ({ page }) => {
  await runSav(page); const baseline = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  await upload(page, 'sample.csv', Buffer.from(fixtures.csv()));
  await select(page);
  await page.locator('#driverDialogSave').click();
  await page.locator('#driverStandardPanel .driver-advanced summary').click();
  await page.locator('#driverMissingCodes').fill('99');
  await page.locator('#runDriverAnalysis').click();
  await expect(page.locator('#driverLmgProgress')).toContainText('已检查');
  const csv = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(csv.n).toBe(46); expect(csv.r2).toBeCloseTo(baseline.r2, 12);
  const bytes = await page.evaluate(async ({ headers, rows }) => {
    const exporter = window.SurveyKitExcelExport;
    const toSheet = (name, h) => ({ name, rows: [h, ...rows.map(r => h.map(id => r[id] ?? ''))].map(cells => ({ cells })) });
    return [...exporter.buildExcelWorkbookXlsxBytes([toSheet('Data', headers), toSheet('反向列顺序', [...headers].reverse())])];
  }, { headers: fixtures.headers, rows: fixtures.rows });
  await upload(page, 'sample.xlsx', Buffer.from(bytes));
  await page.locator('#driverSheetSelect').selectOption('1');
  await expect(page.locator('#driverDialogDataSummary')).toContainText('48 个样本');
  await select(page); await page.locator('#driverDialogSave').click();
  await page.locator('#driverMissingCodes').fill('99'); await page.locator('#runDriverAnalysis').click();
  await expect(page.locator('#driverLmgProgress')).toContainText('已检查');
  const xlsx = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(xlsx.n).toBe(46); expect(xlsx.r2).toBeCloseTo(baseline.r2, 12);
  xlsx.results.forEach((r, i) => expect(r.beta).toBeCloseTo(baseline.results[i].beta, 12));
});

test('role popups search option labels, preserve drafts on cancel, and keep Y out of X', async ({ page }) => {
  await upload(page); await select(page);
  await page.locator('#driverPickX').click();
  await page.locator('#driverFieldSearch').fill('非常满意');
  await expect(page.locator('[data-driver-x]')).toHaveCount(1);
  await expect(page.locator('[data-driver-x="Q1"]')).toBeChecked();
  await page.locator('[data-driver-x="Q1"]').uncheck();
  await page.locator('#driverPickerClose').click();
  await page.locator('#driverPickX').click();
  await expect(page.locator('[data-driver-x="Q1"]')).toBeChecked();
  await page.locator('#driverPickerClose').click();
  await page.locator('#driverDialogClose').click();
  await page.locator('#driverChooseVariables').click();
  await expect(page.locator('#driverChosenXs')).toContainText('Q1');
  await pickY(page, 'Q1');
  await page.locator('#driverPickX').click();
  await page.locator('[data-picker-tab="excluded"]').click();
  await expect(page.locator('[data-driver-x="Q1"]')).not.toBeChecked();
  await expect(page.locator('[data-driver-x="Q1"]')).toBeDisabled();
});

test('editing data/variables/missing codes immediately invalidates results and export', async ({ page }) => {
  await runSav(page); await expect(page.locator('#exportDriverExcel')).toBeEnabled();
  await page.locator('#driverChooseVariables').click();
  await page.locator('[data-driver-remove="Q2"]').click();
  await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  expect(await page.evaluate(() => projectDataBus.get('modelResults.driver'))).toBeNull();
  await page.locator('#driverDialogSave').click(); await page.locator('#runDriverAnalysis').click();
  await expect(page.locator('#driverResults')).toContainText('N=47');
  await page.locator('#driverStandardPanel .driver-advanced summary').click();
  await page.locator('#driverMissingCodes').fill('0');
  await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await expect(page.locator('#driverResults')).toContainText('重新分析');
  await page.locator('#driverFileInput').setInputFiles({ name: 'broken.sav', mimeType: 'application/octet-stream', buffer: Buffer.from('not SAV') });
  await expect(page.locator('#driverImportStatus')).toContainText('SAV 读取失败');
  await expect(page.locator('#exportDriverPptx')).toBeDisabled();
});

test('blocks collinearity and lets user remove the offending factor', async ({ page }) => {
  const lines = ['Y,A,B', ...Array.from({ length: 12 }, (_, i) => [i + .2 * (i % 2), i, 2 * i].join(','))].join('\n');
  await upload(page, 'collinear.csv', Buffer.from(lines)); await select(page, 'Y', ['A', 'B']);
  await expect(page.locator('#driverDialogChecks')).toContainText('完全共线');
  await expect(page.locator('#driverDialogRun')).toBeDisabled();
  await page.locator('[data-driver-remove="B"]').click();
  await expect(page.locator('#driverDialogRun')).toBeEnabled();
  await page.locator('#driverDialogRun').click(); await expect(page.locator('#driverResults')).toContainText('N=12');
});

test('shared SAV source can fit a hierarchical model and apply weights with its samples', async ({ page }) => {
  await upload(page); await page.locator('#driverDialogClose').click();
  await page.locator('#driverHierarchicalTab').click(); await page.locator('#iwAddModel').click();
  await page.locator('[data-model-choose="0"]').click();
  await pickY(page, 'QY'); await pickXs(page, ['Q1', 'Q2']);
  await page.locator('#driverDialogSave').click();
  await page.locator('#iwFitModels').click();
  await expect(page.locator('#iwModelResults')).toContainText('N=46');
  await expect(page.locator('#iwApplyModels')).toBeEnabled(); await page.locator('#iwApplyModels').click();
  await expect(page.locator('#iwMessage')).toContainText('已保存');
  const config = await page.evaluate(() => window.IndicatorWeightUI.getConfig());
  expect(config.dimensions[0].diagnostics.n).toBe(46);
  expect(config.dimensions[0].items[0].weight).toBeCloseTo(1 / 3, 1);
  const samples = await page.evaluate(() => getWorkingCrosstabData()); expect(samples.rows).toHaveLength(48);
});

test('project changes clear source and results; pending SAV import cannot leak into another project', async ({ page }) => {
  await runSav(page);
  await page.evaluate(csv => { document.querySelector('#crosstabData').value = csv; }, fixtures.csv());
  await page.evaluate(() => projectDataBus.attachToProject('driver-new-project'));
  await expect(page.locator('#driverSourceSummary')).toContainText('尚未导入');
  await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await expect(page.locator('#driverChooseVariables')).toBeDisabled();
  await page.locator('#driverUseProject').click();
  await expect(page.locator('#driverImportStatus')).toContainText('项目尚无样本数据');
  await page.evaluate(async () => {
    const pending = window.DriverAnalysisUI.importFile({ name: 'pending.csv', size: 10, arrayBuffer: () => new Promise(resolve => { window.finishDriverImport = resolve; }) });
    window.pendingDriverImport = pending;
  });
  await page.waitForFunction(() => typeof window.finishDriverImport === 'function');
  await page.evaluate(async () => { await projectDataBus.attachToProject('driver-project-C'); window.finishDriverImport(new TextEncoder().encode('Y,A\n1,2\n2,3\n3,5').buffer); await window.pendingDriverImport; });
  await expect(page.locator('#driverSourceSummary')).toContainText('尚未导入');
});

test('mobile modal stays within viewport and has visible primary actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#loadDriverExample').click(); await page.locator('#driverDialogNext').click();
  await expect(page.locator('#driverDialogSave')).toBeVisible();
  const bounds = await page.locator('#driverVariableDialog').evaluate(e => ({ w: e.getBoundingClientRect().width, left: e.getBoundingClientRect().left, top: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height }));
  expect(bounds.w).toBeLessThanOrEqual(390); expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top + bounds.h).toBeLessThanOrEqual(845);
  await page.locator('#driverPickX').click();
  const picker = await page.locator('#driverFieldDialog').evaluate(e => ({ w: e.getBoundingClientRect().width, sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height, top: e.getBoundingClientRect().top }));
  expect(picker.w).toBeLessThanOrEqual(390); expect(picker.sw).toBeLessThanOrEqual(picker.cw + 1); expect(picker.top + picker.h).toBeLessThanOrEqual(845);
  await page.screenshot({ path: testInfo.outputPath('driver-mobile.png'), fullPage: true });
});

test('pasted TSV and existing project samples both require explicit variable selection', async ({ page }) => {
  await page.locator('.driver-paste summary').click();
  await page.locator('#driverData').fill(fixtures.csv().replaceAll(',', '\t'));
  await page.locator('#driverDetectPaste').click(); await select(page);
  await page.locator('#driverDialogSave').click();
  await expect(page.locator('#driverResults')).toContainText('等待分析');
  await expect(page.locator('#exportDriverExcel')).toBeDisabled();
  await page.evaluate(csv => { document.querySelector('#crosstabData').value = csv; }, fixtures.csv());
  await page.locator('#driverUseProject').click();
  await expect(page.locator('#driverVariableDialog')).toBeVisible();
  await expect(page.locator('#driverDialogDataSummary')).toContainText('48 个样本');
  await page.locator('#driverDialogNext').click();
  await expect(page.locator('#driverChosenY')).toContainText('尚未选择');
});

test('reusing SAV samples from crosstab retains declared missing codes and raw scores', async ({ page }) => {
  const bytes = [...await fixtures.sav({ range: true })];
  await page.evaluate(bytes => { document.querySelector('#crosstabData').value = savToDelimitedTableText(new Uint8Array(bytes).buffer); }, bytes);
  await page.locator('#driverUseProject').click(); await select(page);
  await expect(page.locator('#driverDialogChecks')).toContainText('完整样本 46');
  await page.locator('#driverDialogRun').click(); await expect(page.locator('#driverResults')).toContainText('N=46');
});

test('in-flight PPT export cannot re-enable or download a result invalidated by variable edits', async ({ page }) => {
  const rows = Array.from({ length: 10 }, () => fixtures.rows).flat();
  await upload(page, 'reliable.csv', Buffer.from([fixtures.headers.join(','), ...rows.map(r => fixtures.headers.map(h => r[h] ?? '').join(','))].join('\n')));
  await select(page); await page.locator('#driverDialogSave').click();
  await page.locator('#driverMissingCodes').evaluate(el => { el.value = '99'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#runDriverAnalysis').click(); await expect(page.locator('#driverLmgProgress')).toContainText('已检查');
  await expect(page.locator('#exportDriverPptx')).toBeEnabled();
  let release, payload;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/pptx-api/model-chart', async route => {
    payload = route.request().postDataJSON(); await gate;
    await route.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body: Buffer.from('PK mocked renderer response') });
  });
  const downloads = []; page.on('download', d => downloads.push(d));
  await page.locator('#exportDriverPptx').click();
  await expect.poll(() => payload?.data.n).toBe(460); expect(payload.model_type).toBe('driver');
  await page.locator('#driverChooseVariables').click(); await page.locator('[data-driver-remove="Q2"]').click();
  release();
  await expect(page.locator('#exportDriverPptx')).toHaveText('导出可编辑 PPT');
  await expect(page.locator('#exportDriverPptx')).toBeDisabled(); expect(downloads).toHaveLength(0);
});

test('wide SAV-style questionnaire is prefiltered and factors can be added by question group', async ({ page }, testInfo) => {
  await page.evaluate(() => {
    const headers = ['TOTAL', 'Q12_1', 'Q12_2', 'Q13_1', 'LOW', 'BIN', ...Array.from({ length: 300 }, (_, i) => `Q52_3__${i + 1}`)];
    const variables = headers.map(id => ({ name: id, label: id === 'TOTAL' ? '总体满意度' : id.startsWith('Q12') ? '服务体验评分' : id === 'Q13_1' ? '产品质量评分' : id === 'LOW' ? '低覆盖率评分' : '购买过的权益', measure: id.startsWith('Q52') ? 'nominal' : 'scale' }));
    const rows = Array.from({ length: 40 }, (_, i) => [2 + .2 * (i % 5) + .4 * Math.floor(i / 5), i % 5, Math.floor(i / 5), (i * 7) % 9, i < 8 ? i % 5 : null, i % 2, ...Array.from({ length: 300 }, (_, j) => (i + j) % 2)]);
    window.DriverAnalysisUI.loadWorkbook([{ name: 'Data', headers, rows, variables }], '宽问卷.sav');
  });
  await page.locator('#driverDialogNext').click();
  await page.locator('#driverPickY').click();
  await expect(page.locator('[data-driver-y]')).toHaveCount(1);
  await page.locator('[data-driver-y="TOTAL"]').check(); await page.locator('#driverPickerApply').click();
  await page.locator('#driverPickX').click();
  await expect(page.locator('[data-driver-x]')).toHaveCount(3);
  await expect(page.locator('[data-driver-x="LOW"]')).toHaveCount(0);
  await expect(page.locator('[data-driver-x="BIN"]')).toHaveCount(0);
  await expect(page.locator('[data-driver-x="Q52_3__1"]')).toHaveCount(0);
  await expect(page.locator('#driverPickerSelected')).toContainText('点击候选添加');
  await page.locator('#driverPickerGroup').selectOption('Q12');
  await expect(page.locator('[data-driver-x]')).toHaveCount(2);
  await page.locator('#driverSelectVisible').click();
  await expect(page.locator('#driverPickerSelectionCount')).toContainText('2 个影响因素');
  await page.screenshot({ path: testInfo.outputPath('prefiltered-factor-picker.png'), fullPage: true });
  await page.locator('#driverPickerApply').click();
  await expect(page.locator('#driverChosenXs')).toContainText('Q12_1');
  await expect(page.locator('#driverChosenXs')).toContainText('Q12_2');
  await page.locator('#driverDialogRun').click(); await expect(page.locator('#driverResults')).toContainText('N=40');
});

test('users can inspect excluded fields and add a usable field outside recommendations', async ({ page }) => {
  await upload(page); await select(page);
  await page.locator('#driverPickX').click();
  await page.locator('[data-picker-tab="excluded"]').click();
  await page.locator('#driverFieldSearch').fill('常住城市');
  await expect(page.locator('[data-driver-x="CITY"]')).toBeDisabled();
  await expect(page.locator('#driverFieldRows')).toContainText('文本字段');
  await page.locator('#driverPickerClose').click();
  await page.locator('#driverPickY').click();
  await expect(page.locator('[data-driver-y="Q1"]')).toHaveCount(0);
  await page.locator('[data-picker-tab="available"]').click();
  await page.locator('#driverFieldSearch').fill('产品体验');
  await page.locator('[data-driver-y="Q1"]').check(); await page.locator('#driverPickerApply').click();
  await expect(page.locator('#driverChosenY')).toContainText('产品体验');
  await expect(page.locator('[data-driver-remove="Q1"]')).toHaveCount(0);
});

test('SAV questions marked nominal are recognized as NPS and rating factors', async ({ page }) => {
  await upload(page, 'nominal-nps.sav', await fixtures.sav({ nominal: true, nps: true }));
  await page.locator('#driverDialogNext').click(); await page.locator('#driverPickY').click();
  await expect(page.locator('[data-driver-y]').first()).toHaveAttribute('data-driver-y', 'QY');
  await expect(page.locator('#driverFieldRows')).toContainText('推荐意愿评分');
  await expect(page.locator('#driverFieldRows')).toContainText('文件标记为类别');
  await page.locator('[data-driver-y="QY"]').check(); await page.locator('#driverPickerApply').click();
  await pickXs(page, ['Q1', 'Q2']); await page.locator('#driverDialogRun').click();
  await expect(page.locator('#driverResults')).toContainText('N=46');
});

test('real ecommerce SAV recommends Q12 NPS, excludes contacts and calculates with 3600 samples', async ({ page }, testInfo) => {
  const source = process.env.SURVEYKIT_DRIVER_REAL_SAV;
  test.skip(!source, 'Set SURVEYKIT_DRIVER_REAL_SAV to run local customer-file acceptance.');
  await page.locator('#driverFileInput').setInputFiles(source);
  await expect(page.locator('#driverVariableDialog')).toBeVisible();
  await expect(page.locator('#driverDialogDataSummary')).toContainText('3600 个样本');
  await page.locator('#driverDialogNext').click(); await page.locator('#driverPickY').click();
  await expect(page.locator('[data-driver-y]').first()).toHaveAttribute('data-driver-y', 'Q12__1');
  await expect(page.locator('[data-driver-y="Q12__1"]')).toBeEnabled();
  await expect(page.locator('[data-driver-y="Q62__open"]')).toHaveCount(0);
  await page.locator('#driverFieldDialog').screenshot({ path: testInfo.outputPath('real-sav-nps-candidates.png') });
  await page.locator('[data-driver-y="Q12__1"]').check(); await page.locator('#driverPickerApply').click();
  await pickXs(page, ['A1__1', 'Q19__1', 'Q38__1']); await page.locator('#driverDialogRun').click();
  await expect(page.locator('#driverResults')).toContainText('N=3600');
  const result = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(result.fieldIds).toEqual(['A1__1', 'Q19__1', 'Q38__1', 'Q12__1']);
  expect(result.r2).toBeCloseTo(.5300999897053634, 10);
});

test('real SAV NPS uses exactly 11 secondary ratings and retains small routed sample warnings in results and export', async ({ page }, testInfo) => {
  const source = process.env.SURVEYKIT_DRIVER_REAL_SAV;
  test.skip(!source, 'Set SURVEYKIT_DRIVER_REAL_SAV to run local customer-file acceptance.');
  const xs = ['A1__1', 'Q16__1', 'Q19__1', 'Q25__1', 'Q30__1', 'Q35__1', 'Q38__1', 'Q40__1', 'Q42__1', 'Q45__1', 'Q49__1'];
  await page.locator('#driverFileInput').setInputFiles(source);
  await expect(page.locator('#driverVariableDialog')).toBeVisible();
  await page.locator('#driverDialogClose').click(); await page.locator('#driverLmgScope').selectOption('single'); await page.locator('#driverPreview').click();
  await page.locator('#driverDialogNext').click(); await pickY(page, 'Q12__1');
  await page.locator('#driverPickX').click();
  const recommended = await page.locator('[data-driver-x]').evaluateAll(els => els.map(el => el.dataset.driverX));
  expect([...recommended].sort()).toEqual([...xs].sort());
  await expect(page.locator('#driverPickerHint')).toContainText('二级指标');
  await expect(page.locator('[data-driver-x="Q45__1"]').locator('..')).toContainText('跳题');
  await page.locator('#driverFieldDialog').screenshot({ path: testInfo.outputPath('secondary-factor-recommendations.png') });
  await page.locator('[data-picker-tab="available"]').click();
  for (const id of ['Q20__6', 'Q43__4', 'Q62__open', 'Q62', 'rid', 'Q6']) await expect(page.locator(`[data-driver-x="${id}"]`)).toHaveCount(0);
  await page.locator('[data-picker-tab="recommended"]').click();
  await page.locator('#driverSelectVisible').click(); await page.locator('#driverPickerApply').click();
  await expect(page.locator('#driverDialogChecks')).toContainText('完整样本 15');
  await page.locator('#driverDialogRun').click();
  await expect(page.locator('#driverResults')).toContainText('N=15');
  await expect(page.locator('#driverResults')).toContainText('不能直接代表全样本');
  const result = await page.evaluate(() => projectDataBus.get('modelResults.driver'));
  expect(result.fieldIds.slice(0, -1).sort()).toEqual([...xs].sort());
  expect(result.fieldIds.at(-1)).toBe('Q12__1');
  expect(result.r2).toBeCloseTo(.976680997187577, 10);
  expect(result.maxVif).toBeCloseTo(30.443792738961786, 8);
  await fs.promises.writeFile(testInfo.outputPath('secondary-model.json'), JSON.stringify(result, null, 2));
  const download = page.waitForEvent('download'); await page.locator('#exportDriverExcel').click();
  const file = await download; await file.saveAs(testInfo.outputPath('secondary-model.xlsx'));
  const bytes = [...fs.readFileSync(await file.path())];
  const xml = await page.evaluate(bytes => readZipText(new Uint8Array(bytes).buffer, 'xl/worksheets/sheet1.xml'), bytes);
  expect(xml).toContain('完整样本 15'); expect(xml).toContain('不能直接代表全样本');
  await page.locator('#driverResults').screenshot({ path: testInfo.outputPath('secondary-model-results.png') });
});
