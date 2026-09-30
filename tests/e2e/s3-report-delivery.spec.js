const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
test.beforeAll(()=>{const cwd=path.resolve(__dirname,'../..');execFileSync(process.execPath,['tests/s3-report-delivery-smoke.mjs'],{cwd});execFileSync('python',['tests/s3_report_delivery_test.py'],{cwd});});
test('delivery check locates evidence, downloads package, protects locked pages and restores history',async({page})=>{
 const {reportDelivery}=await import(pathToFileURL(path.resolve(__dirname,'../../lib/report-delivery.mjs')).href);
 const fixture=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../.data/s3-delivery/mixed.json'),'utf8'));
 let artifacts=[fixture.artifact];const records=fixture.records;const project={id:'p',title:'混合报告验收',status:'active'};
 const store={getArtifact:async(pid,id)=>artifacts.find(a=>a.id===id),getEvidence:async(pid,id)=>records.find(r=>r.id===id)?.evidence,getAnalysisResult:async(pid,id)=>records.find(r=>r.source?.id===id)?.source,getDataset:async(pid,id)=>records.find(r=>r.dataset?.id===id)?.dataset,getTranscriptSegment:async()=>({id:'seg',text:records.find(r=>r.id==='eq').evidence.value.quote}),createArtifact:async(pid,input)=>{const a={...input,id:'new'+artifacts.length,version:artifacts.length+1};artifacts.unshift(a);return a;}};
 await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
 await page.route('**/api/research/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname,reply=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(p==='/api/research/projects')return reply({projects:[project]});
  if(p.endsWith('/projects/p'))return reply({project});
  if(p.endsWith('/report-delivery'))return reply(await reportDelivery(store,'p',p.split('/').at(-2),route.request().postDataJSON()));
  if(p.endsWith('/artifacts'))return reply(route.request().method()==='POST'?{artifact:await store.createArtifact('p',route.request().postDataJSON())}:{artifacts});
  if(p.endsWith('/evidence'))return reply({evidence:records.map(r=>r.evidence)});
  if(p.includes('/evidence/')){const r=records.find(r=>r.id===p.split('/').at(-1));return reply({evidence:r.evidence,source:r.source});}
  return reply({files:[],datasets:[],messages:[],workflows:[],jobs:[],insights:[],tool_results:[]});
 });
 await page.route('**/pptx-api/research-report-package',route=>route.fulfill({contentType:'application/zip',body:fs.readFileSync(path.resolve(__dirname,'../../.data/s3-delivery/mixed.zip'))}));
 await page.goto('/#research');await page.locator('.research-project-card').click();
 await page.locator('#researchArtifactList').getByRole('button',{name:'查看',exact:true}).first().click();
 const reader=page.locator('.research-outline-reader[open]');
 await reader.getByRole('button',{name:'检查来源与受影响页'}).click();
 await expect(reader.getByRole('button',{name:'下载完整交付包'})).toBeEnabled();
 await reader.getByRole('button',{name:'未选择=0%'}).click();await expect(reader.locator('.research-evidence-context')).toContainText('key_findings');
 const pending=page.waitForEvent('download');await reader.getByRole('button',{name:'下载完整交付包'}).click();const download=await pending;expect(fs.readFileSync(await download.path()).subarray(0,2).toString()).toBe('PK');
 await reader.getByRole('button',{name:'锁定内容',exact:true}).first().click();await expect(reader.getByRole('button',{name:'解除内容锁定'})).toBeVisible();
 const current=JSON.parse(artifacts[0].content);expect(current.pages[0].content_locked).toBe(true);
 records[0].evidence.value.value=25;records[0].source.compact_result.key_findings[0].value=25;
 await reader.getByRole('button',{name:'检查来源与受影响页'}).click();await expect(reader.getByRole('button',{name:'下载完整交付包'})).toBeDisabled();
 await reader.getByRole('button',{name:'更新受影响页证据'}).click();expect(JSON.parse(artifacts[0].content).pages[0].data_points[0].value).toBe('0');
 await reader.getByRole('button',{name:'解除内容锁定'}).click();await reader.getByRole('button',{name:'检查来源与受影响页'}).click();await reader.getByRole('button',{name:'更新受影响页证据'}).click();expect(JSON.parse(artifacts[0].content).pages[0].data_points[0].value).toBe('25');
 await reader.getByRole('button',{name:'检查来源与受影响页'}).click();await reader.getByRole('button',{name:'确认本页结论已复核'}).click();await reader.getByRole('button',{name:'检查来源与受影响页'}).click();await expect(reader.getByRole('button',{name:'下载完整交付包'})).toBeEnabled();
 await reader.getByRole('button',{name:'恢复上一版本'}).click();expect(JSON.parse(artifacts[0].content).pages[0].delivery_review_pending).toBe(true);
});
