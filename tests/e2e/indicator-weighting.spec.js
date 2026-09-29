const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
test.beforeEach(async ({page})=>{await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));});

test('cache activation preserves in-progress imported data',async({page})=>{
  await page.addInitScript(()=>{
    const worker={state:'installing',addEventListener:(name,fn)=>{window.activateTestWorker=()=>{worker.state='activated';fn();};}};
    const registration={installing:worker,update:()=>Promise.resolve(),addEventListener:(name,fn)=>{if(name==='updatefound')fn();}};
    Object.defineProperty(navigator,'serviceWorker',{value:{controller:{},register:()=>Promise.resolve(registration)},configurable:true});
  });
  await load(page);
  await page.waitForFunction(()=>typeof window.activateTestWorker==='function');
  await page.evaluate(()=>window.activateTestWorker());
  await expect(page.locator('#crosstabData')).toHaveValue('brand,a,b\nA,10,9\nA,0,\nB,8,10\nB,,8');
  await expect(page.getByText('页面更新已就绪，请保存当前结果后手动刷新以使用新版本。')).toBeVisible();
});

async function load(page, csv = 'brand,a,b\nA,10,9\nA,0,\nB,8,10\nB,,8') {
  await page.goto('/#crosstab-analysis');
  await page.locator('#crosstabData').fill(csv);
  await page.locator('#detectCrosstabFields').click();
  await expect(page.locator('#iwFile')).toBeAttached();
}
async function weights(page, name = 'weights.csv', values = '维度,变量,权重\n服务,a,0.5\n服务,b,0.5') {
  await page.locator('#iwEnabled').check();
  await page.locator('#iwFile').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(values)});
  await page.locator('#iwReadRows').click();
  await page.locator('#iwSaveDraft').click();
  await expect(page.locator('#iwMessage')).toContainText('已保存');
}
test('import, fixed-weight banners, export, version selection and missing values', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await load(page); await weights(page);
  await page.locator('#iwPreview').click();
  await expect(page.locator('#iwResults')).toContainText('33.3333');
  const grouped=await page.evaluate(async()=>window.IndicatorWeightUI.compute([{label:'A',condition:'brand=A'},{label:'B',condition:'brand=B'},{label:'空',condition:'brand=C'}]));
  expect(grouped.results[0].groups.map(g=>g.value)).toEqual([100/3,50,25,null]);
  expect(grouped.results[0].groups[3].coverage).toBe(0);
  const download=page.waitForEvent('download');await page.locator('#iwExport').click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  const fullDownload=page.waitForEvent('download');await page.locator('#runQuestionPivot').click();
  const file=await fullDownload, bytes=[...fs.readFileSync(await file.path())];
  const workbook=await page.evaluate(bytes=>readZipText(new Uint8Array(bytes).buffer,'xl/workbook.xml'),bytes);
  expect(workbook).toContain('二级加权指标');expect(workbook).toContain('指标模型诊断');
  await weights(page,'second.csv','维度,变量,权重\n服务,a,1\n服务,b,0');
  await page.locator('#iwPreview').click();await expect(page.locator('#iwResults')).toContainText('0.0000');
  await page.locator('#iwScheme').selectOption({index:1});await page.locator('#iwPreview').click();
  await expect(page.locator('#iwResults')).toContainText('33.3333');
  await page.reload();await expect(page.locator('#iwScheme option')).toHaveCount(3);
  await page.locator('#crosstabData').fill('brand,a,b\nA,10,10');await page.locator('#detectCrosstabFields').click();
  await page.locator('#iwPreview').click();await expect(page.locator('#iwResults')).toContainText('100.0000');
  await page.locator('#iwEnabled').uncheck();expect(await page.evaluate(()=>window.IndicatorWeightUI.getConfig())).toBeNull();
  const bounds=await page.locator('#indicatorWeightPanel').evaluate(e=>({w:e.clientWidth,sw:e.scrollWidth}));
  expect(bounds.sw).toBeLessThanOrEqual(bounds.w+2);expect(errors).toEqual([]);
});
test('schemes stay in their project; missing and negative coefficients are blocked',async({page})=>{
  await load(page);await weights(page);
  await page.evaluate(async()=>{workspaceProject={id:'indicator-test-B'};await projectDataBus.attachToProject('indicator-test-B');});
  await expect(page.locator('#iwScheme option')).toHaveCount(1);
  await page.locator('#iwEnabled').check();
  await page.locator('#iwFile').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('维度,变量,权重\n服务,a,-1\n服务,b,2')});
  await page.locator('#iwReadRows').click();await page.locator('#iwSaveDraft').click();
  await expect(page.locator('#iwMessage')).toContainText('为负');
  await expect(page.locator('#iwScheme option')).toHaveCount(1);
  await page.evaluate(async()=>{workspaceProject=null;await projectDataBus.attachToProject(null);});
  await expect(page.locator('#iwScheme option')).toHaveCount(2);
});
test('dimension regression saves B weights and invalidates after input edits',async({page})=>{
  const rows=['a,b,y'];for(let i=0;i<30;i++){const a=i%5,b=Math.floor(i/5),y=1+.4*a+.8*b+(i%2?.05:-.05);rows.push([a,b,y].join(','));}
  await load(page,rows.join('\n'));
  await page.locator('#iwEnabled').check();
  await page.locator('#indicatorWeightPanel [data-jump="driver-analysis"]').click();
  await page.locator('#iwAddModel').click();
  await page.locator('[data-model-prop="name"]').fill('体验');
  await page.locator('[data-model-prop="y"]').selectOption('y');
  await page.locator('[data-model-prop="xs"]').selectOption(['a','b']);
  await page.locator('#iwFitModels').click();await expect(page.locator('#iwApplyModels')).toBeEnabled();
  await expect(page.locator('#iwModelResults')).toContainText('N=30');
  await page.locator('#iwModelFilter').fill('a=1');await page.locator('#iwModelFilter').blur();
  await expect(page.locator('#iwApplyModels')).toBeDisabled();
  await page.locator('#iwModelFilter').fill('');await page.locator('#iwFitModels').click();
  await expect(page.locator('#iwApplyModels')).toBeEnabled();await page.locator('#iwApplyModels').click();
  await expect(page.locator('#iwMessage')).toContainText('已保存');
  const config=await page.evaluate(()=>window.IndicatorWeightUI.getConfig());
  expect(config.dimensions[0].source.kind).toBe('regression');
  expect(config.dimensions[0].items[0].weight).toBeCloseTo(1/3,2);
  expect(config.dimensions[0].diagnostics.n).toBe(30);
});
