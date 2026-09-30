const {test,expect}=require('@playwright/test');
test('S4 researcher saves methods, registers Sheets, maps fields and starts one serial batch',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
 const project={id:'s4-project',title:'S4 研究',status:'active'},sheets=[{name:'Wave1',row_count:3},{name:'Wave2',row_count:3}];
 const base={name:'第一期',source_file_id:'source-file',type:'raw',row_count:3,column_count:2,metadata:{schema_version:1,fields:['SCORE','GROUP'],sheet_name:'Wave1',sheets}};
 let holdValidation=false,releaseValidation;
 let datasets=[{...base,id:'wave1'}],artifacts=[],batches=[],saved=null,batchInput=null,submissions=0;
 const recipe={schema_version:'surveykit.analysis_recipe.v1',name:'NPS 追踪',family:'satisfaction_nps',fields:[{key:'SCORE',label:'',missing:{kind:'none'},value_labels:[],domain:{kind:'numeric',min:0,max:10,integer:true}},{key:'GROUP',label:'',missing:{kind:'none'},value_labels:[],domain:{kind:'category',values:['A','B']}}],variables:['SCORE'],banners:['GROUP'],metrics:{SCORE:'nps'},weighting:{mode:'none'},page_plan:[{kind:'comparison',variable:'SCORE',banners:['GROUP']}]};
 await page.route('**/api/research/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():null;
  const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(p==='/api/research/projects')return reply({projects:[project]});
  if(p.endsWith('/s4-project'))return reply({project});
  if(p.endsWith('/datasets')){if(body){if(!datasets.some(d=>d.metadata.sheet_name===body.sheet_name))datasets.push({...base,id:'wave2',name:body.sheet_name,metadata:{...base.metadata,sheet_name:body.sheet_name}});return reply({dataset:datasets[1]},201);}return reply({datasets});}
  if(p.endsWith('/datasets/wave2')&&req.method()==='DELETE'){datasets=datasets.filter(d=>d.id!=='wave2');return reply({deleted:true});}
  if(p.endsWith('/analysis-recipes')){
   if(body?.action==='validate'&&holdValidation)await new Promise(resolve=>{releaseValidation=resolve;});
   if(body?.action==='validate')return reply({valid:body.mapping.SCORE==='SCORE',errors:body.mapping.SCORE==='SCORE'?[]:['缺字段，请选择对应字段'],field_checks:[{field:'SCORE',target:body.mapping.SCORE,expected:'0–10（整数）',valid:body.mapping.SCORE==='SCORE',issues:body.mapping.SCORE==='SCORE'?[]:['缺字段，请选择对应字段']}]});
   if(body){saved=body;const r=body.recipe||recipe,artifact={id:'recipe-'+artifacts.length,type:'other',version:1,title:'分析配方 · '+r.name,content:JSON.stringify(r)};artifacts.push(artifact);return reply({artifact,recipe:r},201);}return reply({recipes:artifacts});
  }
  if(p.endsWith('/analysis-batches')){if(body){submissions++;batchInput=body;batches=[{id:body.request_key,name:recipe.name,items:body.items.map((i,n)=>({...i,status:n?'waiting':'pending'}))}];return reply(batches[0],202);}return reply({batches});}
  if(p.endsWith('/data-jobs/batch-job1/retry')){batches[0].items[0]={...batches[0].items[0],status:'completed',job:{id:'batch-job1',result:{data:{excel_file_id:'output'}}}};return reply({job:batches[0].items[0].job});}
  if(p.endsWith('/files/output/download'))return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename=output.xlsx'},body:Buffer.from('mock-download')});
  if(p.endsWith('/artifacts'))return reply({artifacts});
  if(p.endsWith('/data-jobs'))return reply({jobs:[]});
  return reply({messages:[],files:[],workflows:[],tool_results:[],evidence:[],insights:[]});
 });
 await page.goto('/#research');await page.locator('.research-project-card').click();
 await page.getByRole('button',{name:'追加工作表',exact:true}).click();
 let dialog=page.getByRole('dialog');await expect(dialog.getByLabel(/Wave1/)).toBeDisabled();await dialog.getByLabel(/Wave2/).check();await dialog.getByRole('button',{name:'登记所选工作表'}).click();
 await expect(page.locator('.research-dataset-item')).toHaveCount(2);await expect(page.locator('.research-dataset-item').first()).toContainText('2 个工作表引用');
 await page.getByRole('button',{name:'保存分析配方',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByPlaceholder('配方名称').fill(recipe.name);await dialog.getByLabel('SCORE',{exact:true}).selectOption('nps');await expect(dialog.getByLabel('SCORE 范围来源',{exact:true})).toBeDisabled();await dialog.getByLabel('GROUP',{exact:true}).selectOption('banner');await dialog.getByLabel('GROUP 范围来源',{exact:true}).selectOption('category');await dialog.getByLabel('GROUP 类别列表',{exact:true}).fill('A\nB\nC');await dialog.getByRole('button',{name:'保存配方',exact:true}).click();await expect(dialog).toHaveCount(0);expect(saved.variables).toEqual(['SCORE']);expect(saved.metrics).toEqual({SCORE:'nps'});expect(saved.domains.GROUP).toEqual({kind:'category',values:['A','B','C']});
 await page.getByRole('button',{name:'复用配方 / 串行批量',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel(/Wave2 · raw/).check();await dialog.getByLabel('SCORE →',{exact:true}).selectOption('');await dialog.getByRole('button',{name:'校验目标数据',exact:true}).click();await expect(dialog).toContainText('缺字段');
 await dialog.getByLabel('SCORE →',{exact:true}).selectOption('SCORE');await dialog.getByRole('button',{name:'校验目标数据',exact:true}).click();await expect(dialog).toContainText('Wave2：通过');await expect(dialog).toContainText('允许 0–10（整数）');
 holdValidation=true;await dialog.getByRole('button',{name:'校验目标数据',exact:true}).click();await expect.poll(()=>typeof releaseValidation).toBe('function');await dialog.getByLabel('SCORE →',{exact:true}).selectOption('');holdValidation=false;releaseValidation();await expect(dialog).toContainText('配置已变更，请重新校验');await dialog.getByLabel('SCORE →',{exact:true}).selectOption('SCORE');
 const download=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载配方 JSON'}).click();expect((await download).suggestedFilename()).toBe('NPS 追踪.json');
 await dialog.getByRole('button',{name:'校验并创建串行批次'}).click();await expect(dialog).toContainText('批次已保存');await expect(dialog.getByRole('button',{name:'校验并创建串行批次'})).toBeDisabled();expect(submissions).toBe(1);expect(batchInput.items.map(i=>i.dataset_id)).toEqual(['wave1','wave2']);
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('#researchDataJobs')).toContainText('等待前项完成');
 await page.screenshot({path:'.data/s4-recipe-workbench.png',fullPage:true});
 batches[0].items[0]={...batches[0].items[0],status:'failed',job:{id:'batch-job1',retryable:true}};
 await page.reload();await page.locator('.research-project-card').click();await expect(page.locator('#researchDataJobs')).toContainText('等待前项完成');
 await page.locator('#researchDataJobs').getByRole('button',{name:'重试此项'}).click();await expect(page.locator('#researchDataJobs')).toContainText('已完成');const excel=page.waitForEvent('download');await page.locator('#researchDataJobs').getByRole('button',{name:'下载交叉表 Excel'}).click();expect((await excel).suggestedFilename()).toMatch(/xlsx$/);
 // Missing original fields remain unassigned after import; no first-column substitution.
 await page.getByRole('button',{name:'复用配方 / 串行批量',exact:true}).click();dialog=page.getByRole('dialog');const imported={...recipe,name:'异名字段',fields:recipe.fields.map(f=>f.key==='SCORE'?{...f,key:'Q_NEW'}:f),variables:['Q_NEW'],metrics:{Q_NEW:'nps'}};
 await dialog.locator('input[type=file]').setInputFiles({name:'recipe.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});await expect(dialog.getByLabel('Q_NEW →',{exact:true})).toHaveValue('');
 await page.setViewportSize({width:390,height:844});await expect(dialog).toBeVisible();expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.screenshot({path:'.data/s4-recipe-mobile.png'});
});

test('S4 declared numeric range requires both bounds and stays editable after an error',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
 let saved;
 await page.route('**/api/research/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  let response={messages:[],files:[],artifacts:[],datasets:[],batches:[],jobs:[],workflows:[],evidence:[],insights:[]};
  if(p==='/api/research/projects')response={projects:[{id:'domain-project',title:'量表定义'}]};
  if(p.endsWith('/domain-project'))response={project:{id:'domain-project',title:'量表定义'}};
  if(p.endsWith('/datasets'))response={datasets:[{id:'d',type:'raw',name:'第一期',row_count:2,column_count:1,metadata:{fields:['Q1']}}]};
  if(p.endsWith('/analysis-recipes')){saved=route.request().postDataJSON();response={artifact:{id:'a'}};}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
 });
 await page.goto('/#research');await page.locator('.research-project-card').click();await page.getByRole('button',{name:'保存分析配方',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Q1',{exact:true}).selectOption('mean');await dialog.getByLabel('Q1 范围来源',{exact:true}).selectOption('numeric');await dialog.getByLabel('Q1 下限',{exact:true}).fill('0');
 await dialog.getByRole('button',{name:'保存配方',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('填写量表上下限');expect(saved).toBeUndefined();
 await dialog.getByLabel('Q1 上限',{exact:true}).fill('5');await dialog.getByLabel('仅允许整数',{exact:true}).uncheck();
 await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:'.data/s4-domain-mobile.png'});
 await dialog.getByRole('button',{name:'保存配方',exact:true}).click();await expect(dialog).toHaveCount(0);expect(saved.domains.Q1).toEqual({kind:'numeric',min:0,max:5,integer:false});
});
