const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4288';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  async function pageFor(workerBody){
   const page=await browser.newPage({serviceWorkers:'block'});
   if(workerBody) await page.route('**/cluster-worker.js*',route=>route.fulfill({contentType:'application/javascript',body:workerBody}));
   await page.addInitScript(()=>localStorage.setItem('surveykit_tour_done','1'));
   await page.goto(base);await page.evaluate(()=>showView('cluster-analysis'));await page.locator('#clusterLoadExample').click();return page;
  }
  const page=await pageFor();
  await page.locator('#clusterRunButton').click();await page.waitForFunction(()=>Object.keys(ClusterAnalysis.getState().results).length);
  await page.locator('#kmK').fill('4');await page.locator('#kmK').dispatchEvent('change');
  assert.equal(await page.evaluate(()=>Object.keys(ClusterAnalysis.getState().results).length),0);
  assert.equal(await page.locator('#clusterExportPanel').isVisible(),false);
  await page.locator('#clusterKmeansOptions .cluster-model-advanced summary').click();
  await page.locator('#kmRunDiagnostics').click();await page.waitForFunction(()=>ClusterAnalysis.getState().diagnostics?.entries.length>0);
  assert.ok(await page.evaluate(()=>ClusterAnalysis.getState().diagnostics.entries.some(e=>e.k===3)));await page.close();
  const hierarchy=await pageFor();
  await hierarchy.locator('.cluster-method-choice summary').click();
  await hierarchy.locator('[data-cluster-method=hierarchical]').click();
  await hierarchy.locator('#hiSelectedK').fill('4');await hierarchy.locator('#hiSelectedK').dispatchEvent('change');
  await hierarchy.locator('#clusterRunButton').click();await hierarchy.waitForFunction(()=>ClusterAnalysis.getState().results.hierarchical);
  assert.equal(await hierarchy.locator('#clusterKSwitch').inputValue(),'4');
  assert.equal(await hierarchy.locator('#clusterKmeansOptions').isVisible(),false);
  await hierarchy.locator('#clusterKSwitch').selectOption('2');
  const current=await hierarchy.evaluate(()=>{const r=ClusterAnalysis.getState().results.hierarchical;return {k:r.selectedK,groups:new Set(r.assignments.map(a=>a.clusterId)).size,sizes:r.clusterSizes.length};});
  assert.deepEqual(current,{k:2,groups:2,sizes:2});
  await hierarchy.evaluate(()=>{globalThis.downloadCsv=(name,rows)=>{globalThis.exportedClusterRows=rows;};});
  await hierarchy.locator('#clusterExportCsv').click();
  const exported=await hierarchy.evaluate(()=>exportedClusterRows);
  assert.equal(new Set(exported.slice(1).map(r=>r[2])).size,2);
  await hierarchy.close();
  const stalled=await pageFor('self.onmessage=()=>{while(true){}};');
  await stalled.locator('#clusterRunButton').click();
  assert.equal(await stalled.locator('#clusterClearData').isDisabled(),true);
  assert.equal(await stalled.locator('#kmK').isDisabled(),true);
  await stalled.locator('#clusterCancelButton').click();await stalled.waitForFunction(()=>!ClusterAnalysis.getState().running);
  assert.equal(await stalled.locator('#clusterRunButton').isDisabled(),false);
  assert.equal(await stalled.evaluate(()=>ClusterAnalysis.getState().worker),null);await stalled.close();
  const failure=await pageFor('self.onmessage=e=>self.postMessage({type:"cluster_error",requestId:e.data.requestId,message:"test-invalid-model"});');
  await failure.evaluate(()=>{globalThis.syncCalls=0;const fn=ClusterCore.kmeansCluster;ClusterCore.kmeansCluster=(...args)=>{syncCalls++;return fn(...args);};});
  await failure.locator('#clusterRunButton').click();await failure.waitForFunction(()=>!ClusterAnalysis.getState().running);
  assert.match(await failure.locator('#clusterRunStatus').innerText(),/test-invalid-model/);
  assert.equal(await failure.evaluate(()=>syncCalls),0);await failure.close();
  console.log('PASS: stale result invalidation, background K diagnostics, cancellation of busy worker, locked configuration, no repeat on domain errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
