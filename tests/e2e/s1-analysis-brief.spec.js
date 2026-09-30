const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));});

test('researcher selects all 13 fields, saves versioned brief and downloads Markdown/Word',async({page})=>{
 const {buildAnalysisBrief}=await import(pathToFileURL(path.resolve(__dirname,'../../lib/analysis-brief.mjs')).href);
 const project={id:'s1-project',title:'S1 研究',status:'active'};
 const fields=Array.from({length:13},(_,i)=>`Q${i+1}`);
 const dataset={id:'raw-s1',name:'原始数据',type:'raw',row_count:2,column_count:13,metadata:{schema_version:1,fields}};
 let variables=[],artifacts=[];
 const full={weighted:false,results:fields.map(variable=>({variable,banner:'__surveykit_total__',metric:'distribution',base:2,categories:[{category:'是',groups:[{segment:'总体',count:2,base:2,percent:100}]}]}))};
 const record={id:'result-s1',dataset_id:dataset.id,type:'crosstab',input:{variables:fields},result:full};
 await page.route('**/api/research/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  const reply=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  if(p==='/api/research/projects')return reply({projects:[project]});
  if(p.endsWith('/s1-project'))return reply({project});
  if(p.endsWith('/datasets'))return reply({datasets:[dataset,{...dataset,id:'clean-s1',name:'清洗版本',type:'cleaned',parent_dataset_id:dataset.id}]});
  if(p.endsWith('/crosstab')){variables=route.request().postDataJSON().variables;return reply({job:{id:'job-s1',project_id:project.id,status:'completed',result:{data:{result_id:'result-s1'}}}});}
  if(p.endsWith('/analysis-brief')){const brief=buildAnalysisBrief({dataset,analyses:[record],project});const artifact={id:'artifact-s1',type:'analysis',title:brief.title,content:brief.content,version:1};artifacts=[artifact];return reply({artifact});}
  if(p.endsWith('/artifacts'))return reply({artifacts});
  if(p.endsWith('/data-jobs'))return reply({jobs:[]});
  return reply({messages:[],artifacts:[],files:[],workflows:[],tool_results:[],evidence:[],insights:[]});
 });
 await page.goto('/#research');await page.locator('.research-project-card').click();
 await page.locator('#researchGenerateBrief').click();
 await expect(page.locator('#researchBriefCoverage')).toContainText('已选 13/13');
 await page.locator('#researchBriefRun').click();
 await expect(page.locator('#researchFeedback')).toContainText('简报已保存');expect(variables).toEqual(fields);
 await expect(page.locator('#researchArtifactDetail')).toContainText('Q13');
 for(const label of ['导出 Markdown','导出 Word']){
  const pending=page.waitForEvent('download');await page.locator('#researchArtifactDetail').getByRole('button',{name:label,exact:true}).click();
  const d=await pending,bytes=fs.readFileSync(await d.path());
  if(label.includes('Markdown'))expect(bytes.toString()).toContain('已选 13 题，已计算 13 题');
  else {const xml=await page.evaluate(b=>readZipText(new Uint8Array(b).buffer,'word/document.xml'),[...bytes]);expect(xml).toContain('Q13');expect(xml).toContain('result-s1');}
 }
 await page.locator('.research-dataset-item').filter({hasText:'清洗版本'}).click();
 await expect(page.locator('#researchArtifactList')).toContainText('此简报来自其他数据版本');
 await page.locator('#researchArtifactDetail').getByRole('button',{name:'基于此版本派生',exact:true}).click();
 await expect(page.locator('.research-dataset-item.selected')).toContainText('原始数据');
 await page.reload();await page.locator('.research-project-card').click();await expect(page.locator('#researchArtifactList')).toContainText('分析简报');
});

test('PPT preview exports aggregate brief with 0 and 100 intact',async({page})=>{
 const json=(route,body)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 await page.route('**/api/pptx-report/report/**',route=>json(route,{ok:true}));
 await page.route('**/pptx-api/report/**',route=>json(route,{ok:true}));
 await page.route('**/pptx-api/parse',route=>json(route,{segments:['Total'],questions:2,dimension_groups:[]}));
 await page.route('**/pptx-api/preview?**',route=>json(route,{title:'交叉表简报',total_pages:1,renderable_questions:2,pages:[{page_idx:1,title:'事实',chapter:'概览',questions:[{code:'Q1',title:'选择'}],segments:['Total'],chart_type:'bar'}],question_catalog:[{code:'Q1',title:'选择'},{code:'Q2',title:'未选题'}]}));
 await page.route('**/pptx-api/insight-context',route=>json(route,{report_id:'aggregate-s1',pages:[{questions:[{code:'Q1',title:'选择',base:{Total:2},rows:[{option:'是',values:{Total:100}},{option:'否',values:{Total:0}}]}]}]}));
 await page.goto('/#pptx-report');
 await page.locator('#pptxFileInput').setInputFiles(path.resolve(__dirname,'../fixtures/imports/standard-crosstab.xlsx'));
 await page.locator('#pptxParseBtn').click();await expect(page.locator('#pptxPreviewBtn')).toBeEnabled();
 await page.locator('#pptxPreviewBtn').click();await expect(page.locator('#pptxAnalysisBrief')).toBeVisible();
 await page.locator('#pptxAnalysisBrief').click();
 await expect(page.locator('#pptxBriefDialog')).toContainText('包含 1 题');
 for(const label of ['导出 Markdown','导出 Word']){
  const pending=page.waitForEvent('download');await page.locator('#pptxBriefDialog').getByRole('button',{name:label,exact:true}).click();
  const d=await pending,bytes=fs.readFileSync(await d.path());
  const content=label.includes('Markdown')?bytes.toString():await page.evaluate(b=>readZipText(new Uint8Array(b).buffer,'word/document.xml'),[...bytes]);
  expect(content).toContain('100');expect(content).toContain('不执行样本级检验');
 }
});
