const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('surveykit_tour_done', '1'));
  await page.goto('/#crosstab-analysis');
});

test('mapped imports retain codes; programmatic same-header replacement invalidates rows and metadata', async ({page}) => {
  const result = await page.evaluate(() => {
    const input = document.querySelector('#crosstabData');
    input.value = '性别,Q1\n男,满意\n女,一般';
    lastCrosstabDataContext = {
      displayHeaders:['性别','Q1'], rawHeaders:['gender','q1'],
      displayRows:[{'性别':'男',Q1:'满意'},{'性别':'女',Q1:'一般'}],
      rawRows:[{gender:'1',q1:'1'},{gender:'2',q1:'2'}], headerInfos:[]
    };
    const mapped = getWorkingCrosstabData();
    input.value = '性别,Q1\n女,不满意\n女,不满意';
    const replaced = getWorkingCrosstabData();
    return {mapped,replaced,cleared:lastCrosstabDataContext === null};
  });
  expect(result.mapped.rawRows[0]).toEqual({gender:'1',q1:'1'});
  expect(result.replaced.rows[0]).toEqual({'性别':'女',Q1:'不满意'});
  expect(result.replaced.rawHeaders).toEqual(['性别','Q1']);
  expect(result.cleared).toBe(true);
  await page.locator('#detectCrosstabFields').click();
  const pending = page.waitForEvent('download');
  await page.locator('#runQuestionPivot').click();
  const download = await pending;
  const bytes = [...fs.readFileSync(await download.path())];
  const sheets = await page.evaluate(bytes => xlsxToWorkbookSheets(new Uint8Array(bytes).buffer), bytes);
  const exported = JSON.stringify(sheets);
  expect(exported).toContain('不满意');
  expect(exported).not.toContain('一般');
});

test('CSV import cannot inherit raw codes even when display cells are identical', async ({page}) => {
  await page.evaluate(() => {
    const text = rowsToDelimitedTableWithContext([['Q1'],['满意']]);
    lastCrosstabDataContext.rawRows = [{Q1:'1'}];
    renderCrosstabImportState(text, 'previous.xlsx');
    handleCrosstabImport(new File(['Q1\n满意'], 'replacement.csv', {type:'text/csv'}));
  });
  await expect.poll(() => page.evaluate(() => getWorkingCrosstabData().rawRows[0]?.Q1)).toBe('满意');
});

test('legacy report remains readable without restoring the retired generation entry', async ({page}) => {
  await page.goto('/?legacy-report=1#ai-report');
  await expect(page.locator('[data-view="ai-report"]')).toHaveCount(0);
  await expect(page.locator('#generateAiReport')).toHaveCount(0);
  await page.locator('#legacyReportFile').setInputFiles({name:'历史.md',mimeType:'text/markdown',buffer:Buffer.from('# 历史报告\n\n旧版统计结果')});
  await expect(page.locator('#aiReportResults')).toContainText('旧版统计结果');
  const pending=page.waitForEvent('download');await page.locator('#exportAiReportMd').click();
  expect(fs.readFileSync(await (await pending).path(),'utf8')).toContain('旧版统计结果');
});
