import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/internal/data.js';
import {createResearchStore} from '../functions/api/research/[[path]].js';
import {enqueueDataJob} from '../lib/data-jobs.mjs';
import {createJobStage} from '../lib/data-job-stage.mjs';
import {remoteDataStorage} from '../lib/data-executor-client.mjs';
import {requestDataExecutor} from '../lib/data-executor-transport.mjs';

const db=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync('migrations/'+file,'utf8'));
function prepared(sql,args=[]){const statement=db.prepare(sql);return {bind:(...values)=>prepared(sql,values),all:async()=>({results:statement.all(...args)}),first:async()=>statement.get(...args)||null,run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})};}
const d1={prepare:prepared,async batch(commands){db.exec('BEGIN');try{const results=[];for(const command of commands)results.push(await command.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
const objects=new Map();const secret='acceptance-only-'+crypto.randomUUID();
const env={DATA_EXECUTOR_SECRET:secret,RESEARCH_DB:d1,RESEARCH_FILES:{async put(key,body){objects.set(key,new Uint8Array(await new Response(body).arrayBuffer()));},async get(key){const bytes=objects.get(key);return bytes?{body:new Response(bytes).body,size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;},async delete(key){objects.delete(key);}}};
const server=http.createServer(async(req,res)=>{try{const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const response=await onRequest({request,env});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500);res.end(String(error));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,store=createResearchStore(d1);
async function child(payload){return new Promise((resolve,reject)=>{const processChild=spawn(process.execPath,['--max-old-space-size=320','deploy/data-executor-child.mjs'],{env:{...process.env,DATA_STORAGE_BASE:base,DATA_EXECUTOR_SECRET:secret},stdio:['pipe','pipe','pipe'],windowsHide:true});let output='',stderr='';processChild.stdout.on('data',data=>output+=data);processChild.stderr.on('data',data=>stderr+=data);processChild.on('error',reject);processChild.on('close',()=>{if(process.env.DATA_EXECUTOR_BENCH_ROWS)console.log(stderr.trim());try{resolve(JSON.parse(output));}catch{reject(Error(stderr));}});processChild.stdin.end(JSON.stringify(payload));});}
try {
 const originalFetch=globalThis.fetch;
 try {globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid'}});};await assert.rejects(()=>requestDataExecutor({DATA_EXECUTOR_URL:'https://executor.invalid',DATA_EXECUTOR_SECRET:secret},{}),{code:'DATA_EXECUTOR_REDIRECT'});}finally{globalThis.fetch=originalFetch;}
 const unauthorized=await fetch(base+'/api/internal/data');assert.equal(unauthorized.status,401);
 const forbidden=await fetch(base+'/api/internal/data',{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({method:'constructor',args:[]})});assert.equal(forbidden.status,400);
 const sourceWrite=await fetch(base+'/api/internal/data?key='+encodeURIComponent('research/'+('a'.repeat(24))+'/source.csv'),{method:'PUT',headers:{Authorization:'Bearer '+secret},body:'x'});assert.equal(sourceWrite.status,403);
 const project=await store.createProject('executor-test-user',{title:'synthetic executor test'});
 const count=Number(process.env.DATA_EXECUTOR_BENCH_ROWS||5);const csv=count===5?'id,GROUP,NPS\n1,A,10\n2,A,0\n3,B,9\n4,B,8\n5,B,\n':['id,GROUP,NPS,'+Array.from({length:17},(_,i)=>'Q'+i).join(','),...Array.from({length:count},(_,i)=>[i,i%2?'A':'B',i%11,...Array(17).fill(i%5)].join(','))].join('\n');const format=process.env.DATA_EXECUTOR_BENCH_FILE?.split('.').pop()||'csv';const key='datasets/'+project.id+'/source.'+format;objects.set(key,process.env.DATA_EXECUTOR_BENCH_FILE?new Uint8Array(fs.readFileSync(process.env.DATA_EXECUTOR_BENCH_FILE)):new TextEncoder().encode(csv));
 const file=await store.createFile('executor-test-user',project.id,{id:crypto.randomUUID(),file_name:'synthetic.'+format,file_type:format,mime_type:'text/csv',file_size:objects.get(key).length,category:'data',storage_key:key});
 const scope={userId:'executor-test-user',projectId:project.id};
 const parsedFile=await child({...scope,operation:'parse',fileId:file.id});assert.ok(!parsedFile.error,JSON.stringify(parsedFile));assert.equal((await store.getFile(project.id,file.id)).parse_status,'completed');
 const denied=await child({...scope,userId:'someone-else',operation:'register',fileId:file.id});assert.ok(denied.error);
 const registration=await child({...scope,operation:'register',fileId:file.id});assert.ok(!registration.error,JSON.stringify(registration));const dataset=registration.result;assert.equal(dataset.row_count,count);
 const repeat=await child({...scope,operation:'register',fileId:file.id});assert.equal(repeat.result.id,dataset.id);
 const pending=await enqueueDataJob(store,scope.userId,project.id,'crosstab',{dataset_id:dataset.id,variables:['NPS'],banner:['GROUP']},'remote-job-key-1');
 const done=await child({...scope,operation:'job',jobId:pending.id});assert.equal(done.result,true,JSON.stringify(done));
 const job=await store.getDataJob(project.id,pending.id);assert.equal(job.status,'completed');const result=JSON.parse(job.result);assert.ok(result.data.excel_file_id);const exported=await store.getFile(project.id,result.data.excel_file_id);assert.equal(Buffer.from(objects.get(exported.storage_key)).subarray(0,2).toString(),'PK');
 const replay=await enqueueDataJob(store,scope.userId,project.id,'crosstab',{dataset_id:dataset.id,variables:['NPS'],banner:['GROUP']},'remote-job-key-1');assert.equal(replay.id,pending.id);
 const analyses=await store.listAnalysisResults(project.id);assert.equal(analyses.length,1);
 const cancelled=await enqueueDataJob(store,scope.userId,project.id,'data_profile',{dataset_id:dataset.id},'remote-job-key-2');await store.controlDataJob(project.id,cancelled.id,'cancel');assert.equal((await child({...scope,operation:'job',jobId:cancelled.id})).result,false);assert.equal((await store.getDataJob(project.id,cancelled.id)).status,'cancelled');
 // Cancel/expiry wins atomically over a late remote publication, including every staged INSERT.
 const remote=remoteDataStorage({base,secret}).store;
 for(const mode of ['cancel','expire']) {
  const late=await enqueueDataJob(store,scope.userId,project.id,'data_profile',{dataset_id:dataset.id},'remote-late-'+mode);
  const token=crypto.randomUUID();await store.claimDataJob(project.id,late.id,token,mode==='expire'?1:120000,600000);
  const stage=createJobStage(store,project.id,scope.userId);await stage.store.createAnalysisResult(project.id,{dataset_id:dataset.id,type:'profile',input:{},result:{},compact_result:{}});
  if(mode==='cancel')await store.controlDataJob(project.id,late.id,'cancel');else await new Promise(resolve=>setTimeout(resolve,10));
  await assert.rejects(()=>remote.publishDataJob(project.id,late.id,token,stage.records,{}));
  assert.equal((await store.listAnalysisResults(project.id)).length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM research_data_job_commits WHERE job_id=?').get(late.id).n,0);
 }
 console.log('Remote executor: authentication, scoped registration, real child + HTTP storage, atomic crosstab, download, idempotency and cancellation passed.');
} finally {await new Promise(resolve=>server.close(resolve));db.close();}
