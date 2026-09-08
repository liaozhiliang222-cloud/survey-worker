const {chromium}=require('@playwright/test');const assert=require('node:assert/strict');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{
 const p=await b.newPage({serviceWorkers:'block'});await p.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4288');
 const result=await p.evaluate(async()=>{
  const m=await loadExcelExportModule();await m.prepareExcelWorkbookExport();
  const sheets=[{name:'大表',rows:Array.from({length:30000},(_,i)=>({cells:[{value:'行'+i,format:'crosstabRowLabel',mergeAcross:1},{value:i/30000,type:'number',format:'percent'}]}))}];
  let ticks=0;const timer=setInterval(()=>ticks++,5);const progress=[];
  const bytes=await m.buildExcelWorkbookXlsxBytesAsync(sheets,p=>progress.push(p));clearInterval(timer);
  const expected=m.buildExcelWorkbookXlsxBytes(sheets);
  const equal=bytes.length===expected.length && bytes.every((n,i)=>n===expected[i]);
  const outputs=await Promise.all([m.buildExcelWorkbookXlsxBytesAsync([{name:'A',rows:[[1]]}]),m.buildExcelWorkbookXlsxBytesAsync([{name:'B',rows:[[2]]}])]);
  return {equal,ticks,phases:progress.map(p=>p.phase),sizes:outputs.map(o=>o.length)};
 });
 assert.equal(result.equal,true);assert.ok(result.ticks>0,'main thread should remain responsive');assert.ok(result.phases.includes('sheet'));assert.ok(result.phases.includes('zip'));assert.ok(result.sizes.every(n=>n>0));
 const blocked=await b.newPage({serviceWorkers:'block'});await blocked.route('**/*excel-export-worker*',r=>r.abort());await blocked.goto(process.env.TEST_BASE_URL||'http://127.0.0.1:4288');
 const error=await blocked.evaluate(async()=>{try{await (await loadExcelExportModule()).prepareExcelWorkbookExport();return '';}catch(e){return e.message;}});assert.match(error,/加载失败/);
 console.log('PASS worker byte parity, responsive page, progress, concurrent exports and worker-load failure',result.ticks);
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
