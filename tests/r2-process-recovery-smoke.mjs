import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { JsonResearchStore } from '../lib/research-store.js';
import { LocalResearchFileStorage } from '../lib/research-file-storage.js';
import { createResearchHandler } from '../lib/research-handler.js';
import { registerRawDataset } from '../lib/data-engine.mjs';

if (process.argv.includes('--child')) {
  const store = new JsonResearchStore(path.join(process.env.R2_TEST_ROOT,'store.json'));
  const storage = new LocalResearchFileStorage(path.join(process.env.R2_TEST_ROOT,'files'));
  if (process.env.R2_HOLD === '1') storage.get = () => new Promise(() => {});
  const handler = createResearchHandler({ store, fileStorage:storage,env:{RESEARCH_DEV_USER_ID:'r2',RESEARCH_DATA_JOB_LEASE_MS:'1000'},logger:{log(){},error(){}} });
  const server = http.createServer((req,res) => {
    if (req.headers['x-drop-response']) res.end = () => res.destroy();
    void handler(req,res);
  });
  server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
} else {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'surveykit-r2-process-'));
  let child;
  const start=async(hold=false)=>{
    child=fork(import.meta.filename,['--child'],{env:{...process.env,R2_TEST_ROOT:temp,R2_HOLD:hold?'1':'0'},stdio:['ignore','ignore','pipe','ipc']});
    let errors='';child.stderr.on('data',b=>{errors+=b;});
    const ready=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(errors||'child exited');})]);
    return `http://127.0.0.1:${ready[0].port}/api/research`;
  };
  const stop=async()=>{if(child&&child.exitCode===null){const exit=once(child,'exit');child.kill();await exit;}child=null;};
  const until=async(fn)=>{for(let i=0;i<100;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50));}throw new Error('condition timeout');};
  try {
    const store=new JsonResearchStore(path.join(temp,'store.json')),storage=new LocalResearchFileStorage(path.join(temp,'files'));
    const p=await store.createProject('r2',{title:'Process recovery'});
    const bytes=Buffer.from('ID,NPS\n1,0\n2,10\n'),key=storage.key(p.id,'raw','csv');await storage.put(key,bytes);
    const f=await store.createFile('r2',p.id,{id:crypto.randomUUID(),file_name:'test.csv',file_type:'csv',file_size:bytes.length,mime_type:'text/csv',category:'data',storage_path:key});
    const raw=await registerRawDataset({store,fileStorage:storage,userId:'r2',projectId:p.id,file:f});
    let base=await start(true);
    const endpoint=`/projects/${p.id}/datasets/${raw.id}/clean`;
    const input={async:true,confirmed:true,idempotency_key:'process-crash-key',rules:[{type:'blank_row'}]};
    const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
    const queued=await (await post(base+endpoint,input)).json();
    await until(async()=>(await store.getDataJob(p.id,queued.job.id)).status==='running');
    await stop(); await new Promise(r=>setTimeout(r,1100));
    base=await start();
    await until(async()=>(await store.getDataJob(p.id,queued.job.id)).status==='failed');
    await post(`${base}/projects/${p.id}/data-jobs/${queued.job.id}/retry`,{});
    await until(async()=>(await store.getDataJob(p.id,queued.job.id)).status==='completed');
    assert.equal((await store.listDatasets(p.id)).length,2);
    const network={...input,idempotency_key:'network-loss-key'};
    await assert.rejects(post(base+endpoint,network,{'x-drop-response':'1'}));
    const replay=await (await post(base+endpoint,network)).json();
    await until(async()=>(await store.getDataJob(p.id,replay.job.id)).status==='completed');
    assert.equal((await store.listDatasets(p.id)).length,3);
    assert.equal((await store.listDataJobs(p.id)).length,2);
    console.log('R2 process exit, restart sweep, retry and lost HTTP response: passed');
  } finally {await stop();if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('surveykit-r2-process-'))fs.rmSync(temp,{recursive:true,force:true});}
}
