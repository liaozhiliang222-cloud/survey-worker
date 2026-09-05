const { test, expect } = require('@playwright/test');

test('数据任务刷新恢复、断网重连、重试和取消', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('surveykit_tour_done','1'));
  const project={id:'r2-project',title:'任务恢复验收',status:'active'};
  const job={id:'r2-job',project_id:project.id,tool_id:'data_clean',status:'failed',retryable:true,cancellable:false,error:'DATA_JOB_LEASE_EXPIRED'};
  let disconnected=false;
  await page.route('**/api/research/**',async(route)=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/research','');
    const reply=(body)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(p==='/projects')return reply({projects:[project]});
    if(p===`/projects/${project.id}`)return reply({project});
    if(p.endsWith('/data-jobs')) { if(disconnected)return route.abort('internetdisconnected');return reply({jobs:[job]}); }
    if(p.endsWith('/retry')){Object.assign(job,{status:'pending',retryable:false,cancellable:true,error:''});return reply({job});}
    if(p.endsWith('/cancel')){Object.assign(job,{status:'cancelled',retryable:false,cancellable:false});return reply({job});}
    if(p.endsWith('/datasets'))return reply({datasets:[{id:'raw',name:'原始数据',type:'raw',row_count:3,column_count:2}]});
    return reply({messages:[],artifacts:[],files:[],workflows:[],tool_results:[],evidence:[],insights:[]});
  });
  const open=async()=>{await page.goto('/');await page.locator('[data-view="research"]').click();await page.locator('.research-project-card').click();};
  await open();
  await expect(page.locator('#researchDataJobs')).toContainText('失败，可重试');
  await page.locator('#researchDataJobs').getByRole('button',{name:'重试',exact:true}).click();
  await expect(page.locator('#researchDataJobs')).toContainText('等待处理');
  // Opening a fresh document recovers solely through the persisted API list.
  await open();await expect(page.locator('#researchDataJobs')).toContainText('等待处理');
  disconnected=true;
  await expect(page.locator('#researchFeedback')).toContainText('任务状态连接中断');
  disconnected=false;
  await page.locator('#researchFeedback').getByRole('button').click();
  await page.locator('#researchDataJobs').getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('#researchDataJobs')).toContainText('已取消');
  await expect(page.locator('#researchDataJobs').getByRole('button',{name:'重试',exact:true})).toHaveCount(0);
});
