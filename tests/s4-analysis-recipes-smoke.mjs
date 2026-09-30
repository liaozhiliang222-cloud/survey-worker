import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createResearchHandler} from '../lib/research-handler.js';
import {DatabaseSync} from 'node:sqlite';
import {JsonResearchStore} from '../lib/research-store.js';
import {LocalResearchFileStorage} from '../lib/research-file-storage.js';
import {createResearchStore,dataStorage,onRequest} from '../functions/api/research/[[path]].js';
import {registerRawDataset,loadDatasetTable,createDataToolExecutor} from '../lib/data-engine.mjs';
import {captureRecipe,validateRecipe,validateRecipeTarget} from '../lib/analysis-recipes.mjs';
import {startAnalysisBatch,advanceAnalysisBatch} from '../lib/analysis-batches.mjs';
import {sweepLocalDataJobs} from '../lib/data-jobs-local.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'surveykit-s4-'));
const db=new DatabaseSync(':memory:');
for(const f of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())db.exec(fs.readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
function bound(sql,args=[]){return {async all(){return{results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return{meta:db.prepare(sql).run(...args)};}};}
const d1={prepare(sql){return{...bound(sql),bind(...args){return bound(sql,args);}};},async batch(items){db.exec('BEGIN');try{const r=[];for(const s of items)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
const objects=new Map(),r2={async put(k,b){objects.set(k,Buffer.from(b));},async get(k){const b=objects.get(k);return b?{async arrayBuffer(){return Uint8Array.from(b).buffer;}}:null;},async delete(k){objects.delete(k);}};
const exportSource=fs.readFileSync(new URL('../src/shared/export.js',import.meta.url),'utf8');
const {buildExcelWorkbookXlsxBytes}=await import(`data:text/javascript;base64,${Buffer.from(exportSource).toString('base64')}`);
try{for(const [adapter,initialStore,storage] of [['json',new JsonResearchStore(path.join(temp,'store.json')),new LocalResearchFileStorage(path.join(temp,'files'))],['d1',createResearchStore(d1),dataStorage({RESEARCH_FILES:r2})]]){
 let store=initialStore;const uid='anonymous:s4',project=await store.createProject(uid,{title:'S4 acceptance'}),pid=project.id;
 const bytes=buildExcelWorkbookXlsxBytes(['Wave1','Wave2','Unused'].map((name,i)=>({name,rows:[['SCORE','GROUP'],[0,'A'],[i===1?10:5,'A'],[10,'B']].map(row=>({cells:row.map(value=>({value}))}))})));
 const key=storage.key(pid,crypto.randomUUID(),'xlsx');await storage.put(key,bytes);
 const file=await store.createFile(uid,pid,{id:crypto.randomUUID(),file_size:bytes.byteLength,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',file_name:'waves.xlsx',file_type:'xlsx',category:'data',storage_key:key,storage_path:key});
 const registration={store,fileStorage:storage,userId:uid,projectId:pid,file};
 const a=await registerRawDataset({...registration,sheetName:'Wave1'}),b=await registerRawDataset({...registration,sheetName:'Wave2'}),unused=await registerRawDataset({...registration,sheetName:'Unused'});
 assert.notEqual(a.id,b.id);assert.equal((await registerRawDataset({...registration,sheetName:'Wave2'})).id,b.id);
 await store.deleteDataset(pid,unused.id);assert.equal((await loadDatasetTable({store,fileStorage:storage,projectId:pid,dataset:b})).rows[1].SCORE,'10');assert.ok(await storage.get(key));
 const args={store,fileStorage:storage,projectId:pid};
 const recipe=await captureRecipe({...args,datasetId:a.id,input:{name:'NPS method',family:'satisfaction_nps',variables:['SCORE'],banners:['GROUP'],metrics:{SCORE:'nps'}}});
 assert.equal(recipe.fields[0].domain.max,10);assert.equal(validateRecipe({...recipe,rows:[{secret:'old respondent'}],conclusion:'old'}).rows,undefined);
 assert.throws(()=>validateRecipe({...recipe,fields:recipe.fields.map(f=>f.key==='SCORE'?{...f,domain:{kind:'category',values:['0']}}:f)}));
 assert.equal((await validateRecipeTarget({...args,datasetId:b.id,recipe})).valid,true);
 assert.equal((await validateRecipeTarget({...args,datasetId:b.id,recipe,mapping:{SCORE:'absent'}})).valid,false);
 assert.equal((await validateRecipeTarget({...args,datasetId:b.id,recipe:{...recipe,fields:recipe.fields.map(f=>f.key==='GROUP'?{...f,domain:{kind:'category',values:['A']}}:f)}})).valid,false);
 assert.equal((await validateRecipeTarget({...args,datasetId:b.id,recipe:{...recipe,weighting:{mode:'rim',targets:[{variable:'GROUP',categories:[{value:'A',share:.99},{value:'B',share:.01}]}],trim:{min:.9,max:1.1}}}})).valid,false,'nonconverging weights must block');
 assert.equal((await validateRecipeTarget({...args,datasetId:b.id,recipe:{...recipe,metrics:{SCORE:'mean'},fields:recipe.fields.map(f=>f.key==='SCORE'?{...f,domain:{kind:'numeric',min:0,max:5,integer:true}}:f)}})).valid,false,'changed scale must block');
 await assert.rejects(()=>store.deleteFile(pid,file.id));
 // Declared questionnaire domains allow valid answers absent from the first wave.
 const method={name:'full questionnaire scale',family:'concept',variables:['SCORE'],banners:['GROUP'],metrics:{SCORE:'mean'}};
 const declared=await captureRecipe({...args,datasetId:a.id,input:{...method,domains:{SCORE:{kind:'numeric',min:0,max:12,integer:true},GROUP:{kind:'category',values:['A','B','C']}}}});
 assert.equal(declared.fields[0].domain_source,'declared');assert.equal(recipe.fields[0].domain_source,'fixed');
 const nextBytes=new TextEncoder().encode('SCORE,GROUP\n12,C\n1.5,A\n');const nextKey=storage.key(pid,crypto.randomUUID(),'csv');await storage.put(nextKey,nextBytes);
 const nextFile=await store.createFile(uid,pid,{id:crypto.randomUUID(),file_name:'next.csv',file_type:'csv',category:'data',mime_type:'text/csv',file_size:nextBytes.length,storage_key:nextKey,storage_path:nextKey});
 const nextDataset=await registerRawDataset({...registration,file:nextFile});
 const integerCheck=await validateRecipeTarget({...args,datasetId:nextDataset.id,recipe:declared});assert.equal(integerCheck.valid,false);assert.equal(integerCheck.field_checks[0].invalid_count,1);assert.equal(integerCheck.field_checks[1].valid,true);
 const decimalRecipe=await captureRecipe({...args,datasetId:a.id,input:{...method,domains:{SCORE:{kind:'numeric',min:0,max:12,integer:false},GROUP:{kind:'category',values:['A','B','C']}}}});
 assert.equal((await validateRecipeTarget({...args,datasetId:nextDataset.id,recipe:decimalRecipe})).valid,true);
 const oldCheck=await validateRecipeTarget({...args,datasetId:nextDataset.id,recipe});assert.equal(oldCheck.field_checks[0].invalid_count,2);assert.equal(oldCheck.field_checks[1].invalid_count,1);
 await assert.rejects(()=>captureRecipe({...args,datasetId:a.id,input:{...method,domains:{SCORE:{kind:'numeric',min:0,max:5,integer:true}}}}),/当前数据超出/);
 await assert.rejects(()=>captureRecipe({...args,datasetId:a.id,input:{...method,domains:{GROUP:{kind:'category',values:['A']}}}}),/当前数据超出/);
 await assert.rejects(()=>captureRecipe({...args,datasetId:a.id,input:{...method,metrics:{SCORE:'nps'},domains:{SCORE:{kind:'numeric',min:0,max:12,integer:true}}}}),/NPS/);
 await assert.rejects(()=>captureRecipe({...args,datasetId:nextDataset.id,input:{...method,metrics:{SCORE:'nps'}}}),/NPS|当前数据超出/);
 for(const values of [[],['A','A'],['A',' ']])assert.throws(()=>validateRecipe({...declared,fields:declared.fields.map(f=>f.key==='GROUP'?{...f,domain:{kind:'category',values}}:f)}),/类别值域/);
 assert.equal(validateRecipe({...declared,fields:declared.fields.map(({domain_source,...f})=>f)}).fields[0].domain_source,'observed','v1 recipes remain compatible');
 const batchInput={request_key:'s4-serial-001',recipe,items:[{dataset_id:a.id},{dataset_id:b.id}]};
 let batch=await startAnalysisBatch({...args,userId:uid,input:batchInput});assert.equal(batch.items[0].status,'pending');assert.equal(batch.items[1].status,'waiting');
 await assert.rejects(()=>store.deleteDataset(pid,b.id));
 assert.equal((await startAnalysisBatch({...args,userId:uid,input:batchInput})).items[0].job.id,batch.items[0].job.id);
 // A restart resumes persisted input; concurrent scans enqueue exactly one item.
 store=adapter==='json'?new JsonResearchStore(path.join(temp,'store.json')):createResearchStore(d1);
 const persisted=(await store.listAnalysisBatches(pid))[0];await Promise.all([advanceAnalysisBatch(store,persisted),advanceAnalysisBatch(store,persisted)]);
 assert.equal((await store.listDataJobs(pid)).length,1);
 const badStorage={...storage,get:async()=>{throw new Error('synthetic read failure');},key:storage.key.bind(storage),put:storage.put.bind(storage)};
 await sweepLocalDataJobs({store,fileStorage:badStorage,limit:1});batch=await advanceAnalysisBatch(store,persisted);assert.equal(batch.items[0].status,'failed');assert.equal(batch.items[1].status,'waiting');assert.equal((await store.listAnalysisResults(pid)).length,0);
 await store.controlDataJob(pid,batch.items[0].job.id,'retry');await sweepLocalDataJobs({store,fileStorage:storage,limit:1});batch=await advanceAnalysisBatch(store,persisted);assert.equal(batch.items[0].status,'completed',batch.items[0].job.error);assert.equal(batch.items[1].status,'pending');
 await sweepLocalDataJobs({store,fileStorage:storage,limit:1});batch=await advanceAnalysisBatch(store,persisted);assert.equal(batch.status,'completed',JSON.stringify(batch));
 assert.equal((await store.listAnalysisResults(pid)).length,2);await sweepLocalDataJobs({store,fileStorage:storage,limit:1});assert.equal((await store.listAnalysisResults(pid)).length,2);
 const results=await store.listAnalysisResults(pid);assert.equal(JSON.parse(results.find(r=>r.dataset_id===a.id).result).results[0].overall,-33.3);assert.equal(JSON.parse(results.find(r=>r.dataset_id===b.id).result).results[0].overall,33.3);
 // Weighting targets are rerun on fresh data and staged atomically with the analysis.
 const weighting={mode:'rim',targets:[{variable:'GROUP',categories:[{value:'A',share:.5},{value:'B',share:.5}]}],trim:{min:.5,max:2}};
 batch=await startAnalysisBatch({store,fileStorage:storage,projectId:pid,userId:uid,input:{request_key:'s4-weighted-001',recipe:{...recipe,weighting},items:[{dataset_id:b.id}]}});
 await sweepLocalDataJobs({store,fileStorage:storage,limit:1});batch=await advanceAnalysisBatch(store,(await store.listAnalysisBatches(pid)).find(b=>b.id==='s4-weighted-001'));assert.equal(batch.status,'completed',JSON.stringify(batch));
 const weighted=(await store.listDatasets(pid)).find(d=>d.type==='weighted');assert.ok(weighted);assert.equal(JSON.parse((await store.listAnalysisResults(pid)).find(r=>r.dataset_id===weighted.id&&r.type==='crosstab').result).results[0].overall,50);
 const captured=await captureRecipe({store,fileStorage:storage,projectId:pid,datasetId:weighted.id,input:{name:'weighted method',family:'ua',variables:['SCORE'],banners:['GROUP'],metrics:{SCORE:'mean'}}});assert.deepEqual(captured.weighting.trim,{min:.5,max:2});assert.equal(captured.fields.some(f=>f.key==='__weight'),false);
 if(adapter==='json'){
  const server=http.createServer(createResearchHandler({env:{RESEARCH_DEV_USER_ID:uid},store,fileStorage:storage,harnessAdapter:{},logger:{log(){},error(){}}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const base=`http://127.0.0.1:${server.address().port}/api/research/projects/${pid}`;
   const saved=await fetch(base+'/analysis-recipes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipe})});assert.equal(saved.status,201,await saved.text());
   assert.equal((await (await fetch(base+'/analysis-recipes')).json()).recipes.length,1);
   assert.equal((await (await fetch(base+'/analysis-batches')).json()).batches.length,2);
   const blocked=await fetch(base+'/datasets/'+b.id,{method:'DELETE'});assert.equal(blocked.status,409);await blocked.text();
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
 if(adapter==='d1'){
  const env={RESEARCH_DB:d1,RESEARCH_FILES:r2,RESEARCH_ANONYMOUS_USER_ID:'s4'};
  const req=(suffix,body,user='s4')=>onRequest({request:new Request(`https://test.example/api/research/projects/${pid}/${suffix}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env:{...env,RESEARCH_ANONYMOUS_USER_ID:user}});
  const saved=await req('analysis-recipes',{recipe});assert.equal(saved.status,201,await saved.text());assert.equal((await (await req('analysis-recipes')).json()).recipes.length,1);
  assert.equal((await req('analysis-batches')).status,200);assert.equal((await req('analysis-batches',null,'other')).status,404);
 }
 await store.deleteProject(uid,pid);assert.equal((await store.listAnalysisBatches(pid)).length,0);
 console.log(`S4 ${adapter}: independent sheets, domains, metrics, restart, failure/retry, serial idempotency, fresh weights and atomic publication passed`);
}}finally{db.close();if(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('surveykit-s4-'))fs.rmSync(temp,{recursive:true,force:true});}
