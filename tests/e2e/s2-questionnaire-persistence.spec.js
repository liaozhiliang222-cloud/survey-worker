const {test,expect}=require('@playwright/test');
const f=require('../fixtures/questionnaire-quality-cases.cjs');
async function boot(page){
 await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
 await page.route('**/api/ai',route=>route.fulfill({status:200,contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:f.goodDraft}}]})}\n\ndata: [DONE]\n\n`}));
 await page.goto('/#ai-assistant');
 await page.locator('#aiContext').fill('S2验证');await page.locator('#aiInput').fill(f.brief);await page.locator('#aiAudience').fill(f.audience);
 await page.locator('#generateAiBrief').click();
 await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V1');
}
test('ten versions, drafts, old-version pilots and paths survive reload',async({page})=>{
 await boot(page);
 await page.evaluate(()=>{const v=aiQuestionnaireSession.current();for(let i=0;i<9;i++)finalizeAiQuestionnaire(v.text,v.config,'连续修订');restoreQuestionnaireSession();});
 await page.locator('#aiReviseInput').fill('下次修订草稿');
 await page.locator('[data-workflow] summary').filter({hasText:'试访反馈与实测时长'}).click();
 await page.locator('[data-workflow-pilot-version]').selectOption('1');
 await page.locator('[name="minutes"]').fill('12');await page.locator('[name="feedback"]').fill('仅属旧版的反馈');
 await page.locator('[data-workflow-pilot-form] button').click();
 const before=await page.evaluate(()=>aiQuestionnaireSession.export());
 await page.reload();await expect(page.locator('[data-workflow] > .issue-head')).toContainText('V10');
 await expect(page.locator('#aiReviseInput')).toHaveValue('下次修订草稿');
 expect(await page.evaluate(()=>aiQuestionnaireSession.export())).toEqual(before);
 await page.locator('[data-workflow] summary').filter({hasText:'试访反馈与实测时长'}).click();
 await expect(page.locator('[data-workflow-pilot]')).toContainText('尚无试访记录');
 await page.locator('[data-workflow-pilot-version]').selectOption('1');
 await expect(page.locator('[data-workflow-pilot]')).toContainText('12 分钟');
 await page.locator('[data-workflow-action="feedback"]').click();
 await expect(page.locator('[data-workflow-message]')).toContainText('属于旧版本');
});
test('project switching isolates content and draft even after reload',async({page})=>{
 await boot(page);
 const ids=await page.evaluate(()=>{createNewWorkspaceProject();const a=workspaceProject.id;document.querySelector('#aiInput').value='项目A需求';saveQuestionnaireDraft();createNewWorkspaceProject();return {a,b:workspaceProject.id};});
 expect(await page.evaluate(()=>aiQuestionnaireSession.versions().length)).toBe(0);
 await page.evaluate(()=>{document.querySelector('#aiInput').value='项目B需求';saveQuestionnaireDraft();});
 await page.evaluate(id=>activateWorkspaceProject(id),ids.a);
 expect(await page.locator('#aiInput').inputValue()).toBe('项目A需求');
 await page.reload();expect(await page.locator('#aiInput').inputValue()).toBe('项目A需求');
 await page.evaluate(id=>activateWorkspaceProject(id),ids.b);
 expect(await page.locator('#aiInput').inputValue()).toBe('项目B需求');
});
test('quota failure remains exportable and retry persists',async({page})=>{
 await boot(page);
 await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('surveykit_questionnaire_workflow_v2:'))throw new Error('quota');return window.originalStorageSet.call(this,k,v);};});
 await page.locator('#aiReviseInput').fill('额度失败也保留');
 await expect(page.locator('#questionnaireSaveStatus')).toHaveAttribute('data-state','failed');
 expect(await page.evaluate(()=>aiQuestionnaireSession.export().draft.aiReviseInput)).toBe('额度失败也保留');
 await expect(page.locator('#questionnaireRetrySave')).toBeVisible();await expect(page.locator('#questionnaireReload')).toBeHidden();
 const download=page.waitForEvent('download');await page.locator('#exportAiWord').click();expect((await download).suggestedFilename()).toMatch(/\.docx$/);
 await page.evaluate(()=>Storage.prototype.setItem=window.originalStorageSet);
 await page.locator('#questionnaireRetrySave').click();await expect(page.locator('#questionnaireSaveStatus')).toHaveAttribute('data-state','saved');await expect(page.locator('#questionnaireRetrySave')).toBeHidden();
 await page.reload();await expect(page.locator('#aiReviseInput')).toHaveValue('额度失败也保留');
});
test('late AI response cannot write into another project',async({page})=>{
 await boot(page);
 let release, entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 await page.route('**/api/ai',async route=>{entered();await gate;await route.fulfill({status:200,contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:f.goodDraft}}]})}\n\ndata: [DONE]\n\n`});});
 await page.locator('#generateAiBrief').click();await waiting;
 await page.evaluate(()=>createNewWorkspaceProject());release();
 await expect.poll(()=>page.evaluate(()=>aiQuestionnaireBusy)).toBe(false);
 expect(await page.evaluate(()=>aiQuestionnaireSession.current())).toBeNull();
 expect(await page.evaluate(()=>lastAiQuestionnaireText)).toBe('');
});

test('results align with inputs while normal saving stays hidden and failures retain recovery',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await boot(page);
 await expect(page.locator('#questionnaireSaveFeedback')).toBeHidden();
 for(const id of ['questionnaireStorageOptions','questionnaireArchiveExport','questionnaireArchiveImport'])await expect(page.locator('#'+id)).toHaveCount(0);
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 const input=await page.locator('#ai-assistant .link-tester > .panel').boundingBox(),results=await page.locator('#aiResults').boundingBox();
 expect(results.x).toBeGreaterThanOrEqual(input.x+input.width);
 expect(Math.abs(results.y-input.y)).toBeLessThan(2);
 await page.screenshot({path:'.data/questionnaire-results-layout/desktop-candidate.png'});
 await expect(page.locator('#exportAiWord')).toBeEnabled();
 const download=page.waitForEvent('download');await page.locator('#exportAiWord').click();expect((await download).suggestedFilename()).toMatch(/\.docx$/);
 // A conflicting tab cannot be overwritten; recovery is surfaced only on failure.
 await page.evaluate(()=>{const session=aiQuestionnaireSession,key='surveykit_questionnaire_workflow_v2:'+encodeURIComponent(session.status().projectId),stored=JSON.parse(localStorage.getItem(key));stored.savedAt='other-tab';localStorage.setItem(key,JSON.stringify(stored));});
 await page.locator('#aiReviseInput').fill('需要保留的当前修改');
 await expect(page.locator('#questionnaireReload')).toBeVisible();await expect(page.locator('#questionnaireReload')).toHaveText('载入最新内容');
 await expect(page.locator('#questionnaireSaveStatus')).toContainText('另一个页面');
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#questionnaireReload').click();await expect(page.locator('#aiReviseInput')).toHaveValue('需要保留的当前修改');
 await expect(page.locator('#questionnaireSaveFeedback')).toBeVisible();
});
