import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SavWriter } from 'savfilewriter';
import { JsonResearchStore } from '../lib/research-store.js';
import { LocalResearchFileStorage } from '../lib/research-file-storage.js';
import { createResearchStore, dataStorage } from '../functions/api/research/[[path]].js';
import { createDataToolExecutor, loadDatasetTable, registerRawDataset } from '../lib/data-engine.mjs';
import { enqueueDataJob, executeDataJob, sweepDataJobs } from '../lib/data-jobs.mjs';
import { runDataToolThread } from '../lib/data-jobs-local.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'surveykit-r2-'));
const db = new DatabaseSync(':memory:');
for (const name of fs.readdirSync(new URL('../migrations/', import.meta.url)).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) db.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url),'utf8'));
function bound(sql,args=[]) { return { async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:db.prepare(sql).run(...args)};} }; }
const d1 = { prepare(sql){return {...bound(sql),bind(...args){return bound(sql,args);}};},async batch(items){db.exec('BEGIN');try{const result=[];for(const s of items)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}} };
const objects = new Map();
const r2 = {async put(k,b){objects.set(k,Buffer.from(b));},async get(k){const b=objects.get(k);return b?{async arrayBuffer(){return Uint8Array.from(b).buffer;}}:null;},async delete(k){objects.delete(k);} };
const baseSav=Buffer.from(SavWriter.write({encoding:'UTF-8',sysvars:[{name:'Q1',type:0,label:'您有多大可能向朋友推荐本产品'},{name:'GROUP',type:0,label:'分组',values:Object.fromEntries(Array.from({length:120},(_,i)=>[i+1,i===0?'A':i===1?'B':`Label${i+1}`]))},{name:'ID',type:0,label:'编号'}]},[{Q1:0,GROUP:1,ID:1},{Q1:9,GROUP:1,ID:2},{Q1:10,GROUP:2,ID:3},{Q1:99,GROUP:2,ID:4}]));
// The fixture writer does not support user missing values: insert the SAV
// numeric variable missing-value record after Q1's padded label.
assert.equal(baseSav.readInt32LE(176),2);
const labelBytes=baseSav.readInt32LE(208);
const insertion=212+Math.ceil(labelBytes/4)*4;
baseSav.writeInt32LE(1,188);
const missingCode=Buffer.alloc(8);missingCode.writeDoubleLE(99);
const bytes=Buffer.concat([baseSav.subarray(0,insertion),missingCode,baseSav.subarray(insertion)]);
const report=[];
try {
for (const [adapter,store,storage] of [['local',new JsonResearchStore(path.join(temp,'store.json')),new LocalResearchFileStorage(path.join(temp,'files'))],['d1-r2',createResearchStore(d1),dataStorage({RESEARCH_FILES:r2})]]) {
 const start=performance.now();
 const project=await store.createProject('r2',{title:'R2 synthetic'}),pid=project.id;
 const sourceKey=storage.key(pid,'source','sav'); await storage.put(sourceKey,bytes);
 const file=await store.createFile('r2',pid,{id:crypto.randomUUID(),file_name:'fixture.sav',file_type:'sav',mime_type:'application/octet-stream',file_size:bytes.byteLength,category:'data',storage_key:sourceKey,storage_path:sourceKey});
 const raw=await registerRawDataset({store,fileStorage:storage,userId:'r2',projectId:pid,file});
 const executor=createDataToolExecutor({store,fileStorage:storage});
 const execute=(id,tool,args={})=>executor({agentToolId:tool,args:{dataset_id:id,...args},scope:{project,user_id:'r2'}});
 const rawTable=await loadDatasetTable({store,fileStorage:storage,projectId:pid,dataset:raw});
 assert.equal(rawTable.variables.find(v=>v.name==='GROUP').value_labels.length,120);
 assert.notEqual(rawTable.variables.find(v=>v.name==='Q1').missing.kind,'none');
 assert.equal(rawTable.rows.at(-1).Q1,'');
 const clean=await execute(raw.id,'data_clean',{rules:[{type:'blank_row'}],confirmed:true});
 const cleaned=await store.getDataset(pid,clean.result.clean_dataset_id);
 const weighted=await execute(cleaned.id,'data_weight',{targets:[{variable:'GROUP',categories:[{value:'A',share:0.5},{value:'B',share:0.5}]}],confirmed:true});
 const weightedDataset=await store.getDataset(pid,weighted.result.weighted_dataset_id);
 for(const dataset of [raw,cleaned,weightedDataset]) {
   const table=await loadDatasetTable({store,fileStorage:storage,projectId:pid,dataset});
   assert.deepEqual(JSON.parse(JSON.stringify(table.variables.filter(v=>v.name!=='__weight'))),JSON.parse(JSON.stringify(rawTable.variables)));
   const result=await execute(dataset.id,'crosstab',{banner:['GROUP'],variables:['Q1']});
   assert.equal(result.result.results[0].metric,'nps'); assert.equal(result.result.results[0].overall,33.3);
   assert.equal(result.result.results[0].base,3);
   const metadata=JSON.parse(dataset.metadata);assert.equal(metadata.source_version.file_id,file.id);assert.equal(metadata.sheet_name,rawTable.name);
   assert.equal(metadata.weight_status,dataset.type==='weighted'?'weighted':'unweighted');
 }
 assert.deepEqual(Buffer.from(await storage.get(sourceKey)),Buffer.from(bytes));
 const changed=Buffer.from(bytes);changed[changed.length-1]^=1;await storage.put(sourceKey,changed);
 await assert.rejects(loadDatasetTable({store,fileStorage:storage,projectId:pid,dataset:raw}),e=>e.code==='DATASET_SOURCE_CHANGED');
 await storage.put(sourceKey,bytes);
 const args={dataset_id:raw.id,rules:[{type:'blank_row'}],confirmed:true};
 const before=(await store.listDatasets(pid)).length;
 const duplicate=await Promise.all(Array.from({length:12},()=>enqueueDataJob(store,'r2',pid,'data_clean',args,'duplicate-key')));
 assert.equal(new Set(duplicate.map(j=>j.id)).size,1);
 await assert.rejects(enqueueDataJob(store,'r2',pid,'data_clean',{...args,name:'different'},'duplicate-key'),e=>e.code==='DATA_JOB_KEY_CONFLICT');
 const job=await store.getDataJob(pid,duplicate[0].id);
 await Promise.all([executeDataJob({store,fileStorage:storage,job}),executeDataJob({store,fileStorage:storage,job})]);
 assert.equal((await store.getDataJob(pid,job.id)).status,'completed');assert.equal((await store.listDatasets(pid)).length,before+1);
 assert.equal((await store.controlDataJob(pid,job.id,'retry')).status,'completed');

 // Cancel after the output object has been written but before publication.
 const cancelled=await enqueueDataJob(store,'r2',pid,'data_clean',args,'cancelled-key');
 const cancelStorage={key:storage.key.bind(storage),get:storage.get.bind(storage),delete:storage.delete.bind(storage),async put(k,b){await storage.put(k,b);await store.controlDataJob(pid,cancelled.id,'cancel');}};
 await executeDataJob({store,fileStorage:cancelStorage,job:await store.getDataJob(pid,cancelled.id)});
 assert.equal((await store.getDataJob(pid,cancelled.id)).status,'cancelled');assert.equal((await store.listDatasets(pid)).length,before+1);

 // An expired attempt cannot publish after a newer retry has completed.
 const stale=await enqueueDataJob(store,'r2',pid,'data_clean',args,'expired-key');
 await store.claimDataJob(pid,stale.id,'old-token',1,1);await new Promise(r=>setTimeout(r,5));await store.expireDataJobs();
 assert.equal((await store.getDataJob(pid,stale.id)).status,'failed');
 await store.controlDataJob(pid,stale.id,'retry');await sweepDataJobs({store,fileStorage:storage});
 assert.equal((await store.getDataJob(pid,stale.id)).status,'completed');
 const empty=Object.fromEntries(['datasets','files','cleaningLogs','analysisResults','evidence','toolResults'].map(k=>[k,[]]));
 const oldPublish=await store.publishDataJob(pid,stale.id,'old-token',empty,{}).catch(()=>false);assert.equal(oldPublish,false);

 // Truncated storage write must not publish any dataset or result.
 const partial=await enqueueDataJob(store,'r2',pid,'data_clean',args,'partial-key');
 const partialStorage={key:storage.key.bind(storage),get:storage.get.bind(storage),delete:storage.delete.bind(storage),put:(k,b)=>storage.put(k,b.subarray(0,12))};
 const counts=(await store.listDatasets(pid)).length;
 await executeDataJob({store,fileStorage:partialStorage,job:await store.getDataJob(pid,partial.id)});
 assert.equal((await store.getDataJob(pid,partial.id)).status,'failed');assert.equal((await store.listDatasets(pid)).length,counts);
 await store.controlDataJob(pid,partial.id,'retry');await sweepDataJobs({store,fileStorage:storage});assert.equal((await store.getDataJob(pid,partial.id)).status,'completed');

 const missing=await enqueueDataJob(store,'r2',pid,'data_clean',args,'missing-key');await storage.delete(sourceKey);
 await sweepDataJobs({store,fileStorage:storage});assert.equal((await store.getDataJob(pid,missing.id)).status,'failed');
 await storage.put(sourceKey,bytes);await store.controlDataJob(pid,missing.id,'retry');await sweepDataJobs({store,fileStorage:storage});assert.equal((await store.getDataJob(pid,missing.id)).status,'completed');

 if(adapter==='local') {
   const pending=await enqueueDataJob(store,'r2',pid,'data_profile',{dataset_id:raw.id},'restart-key');
   const reopened=new JsonResearchStore(store.filePath); await sweepDataJobs({store:reopened,fileStorage:storage,runTool:runDataToolThread});
   assert.equal((await reopened.getDataJob(pid,pending.id)).status,'completed');
   const timeout=await enqueueDataJob(store,'r2',pid,'data_profile',{dataset_id:raw.id},'timeout-key');
   await executeDataJob({store,fileStorage:storage,job:await store.getDataJob(pid,timeout.id),timeout:1,runTool:runDataToolThread});
   assert.equal((await store.getDataJob(pid,timeout.id)).status,'failed');
 }
 report.push({adapter,passed:true,duration_ms:Math.round(performance.now()-start)});
}
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({test:'r2-recovery',results:report},null,2));
} finally {db.close();if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('surveykit-r2-'))fs.rmSync(temp,{recursive:true,force:true});}
