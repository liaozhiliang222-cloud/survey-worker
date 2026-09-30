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
test('invalid import is atomic; v1 import appends and remaps',async({page})=>{
 await boot(page);await page.locator('#questionnaireStorageOptions summary').click();const before=await page.evaluate(()=>aiQuestionnaireSession.export());
 const upload=async obj=>page.locator('#questionnaireArchiveImport').setInputFiles({name:'archive.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(obj))});
 await upload({...before,pilots:[{id:1,version:99}]});
 await expect(page.locator('#questionnaireArchiveMessage')).toContainText('导入失败');
 expect(await page.evaluate(()=>aiQuestionnaireSession.export())).toEqual(before);
 await upload({...before,version:1});
 await expect(page.locator('#questionnaireArchiveMessage')).toContainText('已追加 1');
 expect(await page.evaluate(()=>aiQuestionnaireSession.versions().map(v=>v.id))).toEqual([1,2]);
});
test('quota failure remains exportable and retry persists',async({page})=>{
 await boot(page);
 await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('surveykit_questionnaire_workflow_v2:'))throw new Error('quota');return window.originalStorageSet.call(this,k,v);};});
 await page.locator('#aiReviseInput').fill('额度失败也保留');
 await expect(page.locator('#questionnaireSaveStatus')).toHaveAttribute('data-state','failed');
 expect(await page.evaluate(()=>aiQuestionnaireSession.export().draft.aiReviseInput)).toBe('额度失败也保留');
 await expect(page.locator('#questionnaireRetrySave')).toBeVisible();await expect(page.locator('#questionnaireReload')).toBeHidden();
 await page.locator('#questionnaireStorageOptions summary').click();
 const download=page.waitForEvent('download');await page.locator('#questionnaireArchiveExport').click();await download;
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

test('normal questionnaire flow shows compact saving status and keeps recovery in advanced options',async({page})=>{
 await boot(page);
 await expect(page.locator('#questionnaireSaveStatus')).toHaveText('已自动保存到当前浏览器');
 for(const id of ['questionnaireRetrySave','questionnaireReload','questionnaireArchiveExport','questionnaireArchiveImport'])await expect(page.locator('#'+id)).toBeHidden();
 await expect(page.locator('#questionnaireStorageOptions')).not.toHaveAttribute('open','');
 await expect(page.locator('#exportAiWord')).toBeEnabled();
 const download=page.waitForEvent('download');await page.locator('#exportAiWord').click();expect((await download).suggestedFilename()).toMatch(/\.docx$/);
 await page.locator('.questionnaire-persistence').screenshot({path:'.data/questionnaire-compact-save.png'});
 // A conflicting tab cannot be overwritten; recovery is surfaced only on failure.
 await page.evaluate(()=>{const session=aiQuestionnaireSession,key='surveykit_questionnaire_workflow_v2:'+encodeURIComponent(session.status().projectId),stored=JSON.parse(localStorage.getItem(key));stored.savedAt='other-tab';localStorage.setItem(key,JSON.stringify(stored));});
 await page.locator('#aiReviseInput').fill('需要保留的当前修改');
 await expect(page.locator('#questionnaireReload')).toBeVisible();await expect(page.locator('#questionnaireReload')).toHaveText('载入最新内容');
 await expect(page.locator('#questionnaireSaveStatus')).toContainText('另一个页面');
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#questionnaireReload').click();await expect(page.locator('#aiReviseInput')).toHaveValue('需要保留的当前修改');
 await page.locator('#questionnaireStorageOptions summary').click();await expect(page.getByRole('button',{name:'备份问卷',exact:true})).toBeVisible();
});
