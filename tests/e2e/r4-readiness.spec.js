const {test,expect}=require('@playwright/test');
for(const width of [1280,390])test(`结果口径与项目下一步 ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
 await page.route('**/api/research/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  let result={messages:[],artifacts:[],files:[],workflows:[],tool_results:[],evidence:[],insights:[],jobs:[]};
  if(p.endsWith('/projects'))result={projects:[{id:'r4',title:'结果口径验收'}]};
  else if(p.endsWith('/projects/r4'))result={project:{id:'r4',title:'结果口径验收'}};
  else if(p.endsWith('/datasets'))result={datasets:[{id:'d',name:'加权版',type:'weighted',row_count:100,column_count:3,metadata:{schema_version:1,sheet_name:'Sheet 2',weighting:{diagnostics:{converged:false,effective_n:72.4}}}}]};
  else if(p.endsWith('/readiness'))result={readiness:{label:'成果待更新',next:'来源发生变化，请派生更新。',counts:{degraded_reports:0},datasets:[{dataset_id:'d',weight_label:'已加权',convergence_label:'最终权重未收敛',sheet_name:'Sheet 2',effective_n:72.4,missing_policy:'按题剔除缺失',base_note:'按题目计算',bases:[{variable:'NPS',base:87}]}]}};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto('/');if(width<600)await page.locator('#mobileMenuBtn').click();await page.locator('[data-view="research"]').click();await page.locator('.research-project-card').click();
 await expect(page.locator('#researchProjectReadiness')).toContainText('成果待更新');
 if(width<600)await page.locator('[data-research-tab="project"]').click();
 await expect(page.locator('#researchDatasetList')).toContainText('最终权重未收敛');
 await expect(page.locator('#researchDatasetList')).toContainText('Sheet 2');
 await expect(page.locator('#researchDatasetList')).toContainText('72.4');
 await expect(page.locator('#researchDatasetList')).toContainText('有效 base：87');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
