import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {JsonResearchStore} from '../lib/research-store.js';
import {createResearchHandler} from '../lib/research-handler.js';
import {createResearchStore,onRequest} from '../functions/api/research/[[path]].js';
const db=new DatabaseSync(':memory:');for(const name of fs.readdirSync('migrations').filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())db.exec(fs.readFileSync('migrations/'+name,'utf8'));
function bound(sql,args=[]){const st=db.prepare(sql);return {async all(){return {results:st.all(...args)};},async first(){return st.get(...args)||null;},async run(){return st.run(...args);}};}
const d1={prepare(sql){return {...bound(sql),bind(...args){return bound(sql,args);}};},async batch(items){return Promise.all(items.map(i=>i.run()));}};
fs.mkdirSync('.data/s3-http',{recursive:true});const database=path.resolve('.data/s3-http/db-'+Date.now()+'.json');
for(const kind of ['local','d1']){
 const store=kind==='local'?new JsonResearchStore(database):createResearchStore(d1),user=kind==='local'?'s3-user':'anonymous:s3';
 const project=await store.createProject(user,{title:'S3 endpoint'});
 const dataset=await store.createDataset(user,project.id,{name:'raw',type:'raw',row_count:20,column_count:1,status:'ready',storage_key:'unused',metadata:{fields:['Q1']}});
 const finding={variable:'Q1',value:100,base:20,unit:'%'};
 const source=await store.createAnalysisResult(project.id,{dataset_id:dataset.id,type:'crosstab',input:{},result:{coverage:[{variable:'Q1',status:'included'}]},compact_result:{key_findings:[finding]}});
 const evidence=await store.createEvidence(project.id,{type:'quantitative',claim:'选择比例',value:finding,source_type:'crosstab',source_id:source.id});
 const artifact=await store.createArtifact(project.id,{type:'ppt_script',title:'报告',content:JSON.stringify({title:'报告',pages:[{id:'page',page_type:'data_insight',title:'比例',evidence_ids:[evidence.id],data_points:[{label:'选择',value:'100',unit:'%',evidence_id:evidence.id,data_source_id:source.id}]}]})});
 const handler=kind==='local'?createResearchHandler({env:{RESEARCH_DEV_USER_ID:user,RESEARCH_DATA_FILE:database,RESEARCH_FILES_DIR:path.resolve('.data/s3-http/files')},logger:{log(){},error(){}}}):null;
 async function request(pid,id,body){const url=`/api/research/projects/${pid}/artifacts/${id}/report-delivery`;
  if(kind==='d1'){const response=await onRequest({request:new Request('https://example.test'+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env:{RESEARCH_DB:d1,RESEARCH_ANONYMOUS_USER_ID:'s3'}});return {status:response.status,body:await response.json()};}
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:'POST',url,headers:{'content-type':'application/json'}});
  return new Promise((resolve,reject)=>{const res={headersSent:false,writeHead(status){this.status=status;this.headersSent=true;},end(bytes){resolve({status:this.status,body:JSON.parse(String(bytes))});}};Promise.resolve(handler(req,res)).catch(reject);});
 }
 let r=await request(project.id,artifact.id,{});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.can_export,false);
 r=await request(project.id,artifact.id,{action:'review',page_ids:['page']});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.can_export,true,JSON.stringify({pages:r.body.pages,records:r.body.records,conflicts:r.body.conflicts}));assert.notEqual(r.body.artifact.id,artifact.id);
 const other=await store.createProject(user,{title:'other'});assert.equal((await request(other.id,artifact.id,{})).status,400);
 assert.equal(JSON.parse((await store.getArtifact(project.id,artifact.id)).content).pages[0].delivery_snapshot,undefined);
 console.log(kind+' endpoint: source review persisted, immutable history and project isolation passed');
}
db.close();
