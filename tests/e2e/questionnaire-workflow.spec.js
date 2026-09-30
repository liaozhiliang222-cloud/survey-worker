const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const f=require('../fixtures/questionnaire-quality-cases.cjs');
const workflow=require('../../questionnaire-workflow.js');
const oldQuestion=workflow.blocks(f.goodDraft).find(q=>q.id==='D2').text;
const newQuestion=oldQuestion.replace('通常在哪个时点加盐','最近一次做饭时，在哪个时点加盐');
const patch=JSON.stringify({version:1,replacements:[{id:'D2',text:newQuestion}]});
async function setup(page,responses){
  await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
  let requests=[];
  await page.route('**/api/ai',async route=>{
    requests.push(route.request().postDataJSON());
    const text=responses[Math.min(requests.length-1,responses.length-1)];
    if(text===null)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{message:'测试失败'}})});
    await route.fulfill({status:200,contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n`});
  });
  await page.goto('/#ai-assistant');
  await page.locator('#aiInput').fill(f.brief);
  await page.locator('#aiContext').fill('第三批工作流验证');
  await page.locator('#aiAudience').fill(f.audience);
  await page.locator('#generateAiBrief').click();
  await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V1');
  return requests;
}
async function revise(page){
  await page.locator('#aiRevisionMode').selectOption('selected');
  await page.locator('#aiRevisionTargets').fill('D2');
  await page.locator('#aiReviseInput').fill('将加盐时点锚定到最近一次做饭，保留跳题。');
  await page.locator('#reviseAiQuestionnaire').click();
}
test('local revision shows precise differences and restores as a new version',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const requests=await setup(page,[f.goodDraft,patch]);
  await page.locator('[data-workflow] summary').filter({hasText:'作答路径预览'}).click();
  await expect(page.locator('[data-workflow-path]')).toContainText('资格含义待复核');
  await expect(page.locator('[data-workflow-path]')).toContainText('D2');
  await revise(page);
  await expect(page.locator('#aiRevisionStatus')).toContainText('已保存为 V2');
  expect(JSON.stringify(requests[1])).toContain('唯一允许替换的题号：D2');
  const after=await page.locator('#aiResults textarea.prompt-box').inputValue();
  expect(after).toContain('最近一次做饭时');
  await page.locator('[data-workflow] summary').filter({hasText:'版本差异与恢复'}).click();
  await expect(page.locator('[data-workflow-diff]')).toContainText('1项差异');
  await expect(page.locator('[data-workflow-diff]')).toContainText('D2 · 修改');
  await page.locator('[data-workflow-action="restore"]').click();
  await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V3');
  expect(await page.locator('#aiResults textarea.prompt-box').inputValue()).toContain('通常在哪个时点加盐');
  expect(await page.locator('#aiResults textarea.prompt-box').inputValue()).not.toContain('最近一次做饭时');
  expect(errors).toEqual([]);
});
test('scope violation and model failure keep the old version and user instruction',async({page})=>{
  await setup(page,[f.goodDraft,JSON.stringify({version:1,replacements:[{id:'S1',text:'S1. 不应修改'}]}),null]);
  const before=await page.locator('#aiResults textarea.prompt-box').inputValue();
  await revise(page);
  await expect(page.locator('#aiRevisionStatus')).toContainText('范围外');
  await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V1');
  expect(await page.locator('#aiResults textarea.prompt-box').inputValue()).toBe(before);
  await page.locator('#reviseAiQuestionnaire').click();
  await expect(page.locator('#aiRevisionStatus')).toContainText('修改未应用');
  await expect(page.locator('#aiReviseInput')).not.toHaveValue('');
  expect(await page.locator('#aiResults textarea.prompt-box').inputValue()).toBe(before);
});
test('pilot duration separates outcomes and versions, feedback only prepares a revision',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await setup(page,[f.goodDraft,patch]);
  await page.locator('[data-workflow] summary').filter({hasText:'试访反馈与实测时长'}).click();
  const form=page.locator('[data-workflow-pilot-form]');
  for(const [minutes,outcome] of [['10','completed'],['20','completed'],['100','terminated']]){
    await form.locator('[name="minutes"]').fill(minutes);
    await form.locator('[name="outcome"]').selectOption(outcome);
    await form.locator('[name="question"]').fill('D2');
    await form.locator('[name="feedback"]').fill('时点描述不清楚 <script>bad()</script>');
    await form.locator('button[type="submit"]').click();
  }
  await expect(page.locator('[data-workflow-pilot]')).toContainText('完整完成 n=2');
  await expect(page.locator('[data-workflow-pilot]')).toContainText('中位数 15 分钟');
  await expect(page.locator('[data-workflow-pilot]')).toContainText('P75 17.5 分钟');
  await page.locator('[data-workflow-action="feedback"]').first().click();
  await expect(page.locator('#aiRevisionMode')).toHaveValue('selected');
  await expect(page.locator('#aiRevisionTargets')).toHaveValue('D2');
  await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V1');
  await page.locator('[data-workflow]').screenshot({path:'test-results/questionnaire-workflow-mobile.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  const download=page.waitForEvent('download');
  await page.locator('[data-workflow-action="export"]').click();
  const archive=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  expect(archive.pilots).toHaveLength(3);expect(archive.versions).toHaveLength(1);
  await page.locator('#reviseAiQuestionnaire').click();
  await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V2');
  await page.locator('[data-workflow] summary').filter({hasText:'试访反馈与实测时长'}).click();
  await expect(page.locator('[data-workflow-pilot]')).toContainText('尚无试访记录');
});
