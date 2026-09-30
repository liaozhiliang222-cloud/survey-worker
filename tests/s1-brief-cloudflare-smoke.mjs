import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createResearchStore, onRequest } from '../functions/api/research/[[path]].js';
const db=new DatabaseSync(':memory:');
for(const file of fs.readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort())db.exec(fs.readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
function bound(sql,args=[]){const statement=db.prepare(sql);return{async all(){return{results:statement.all(...args)};},async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);}};}
const d1={prepare(sql){return{...bound(sql),bind(...args){return bound(sql,args);}};},async batch(items){return Promise.all(items.map(item=>item.run()));}};
try {
 const store=createResearchStore(d1),user='anonymous:s1';
 const project=await store.createProject(user,{title:'Cloud brief parity'});
 const dataset=await store.createDataset(user,project.id,{name:'Raw',type:'raw',row_count:2,column_count:1,status:'ready',storage_key:'unused',metadata:{schema_version:1,fields:['Q13']}});
 const record=await store.createAnalysisResult(project.id,{dataset_id:dataset.id,type:'crosstab',input:{variables:['Q13'],banner:[]},result:{weighted:false,results:[{variable:'Q13',banner:'__surveykit_total__',metric:'distribution',base:2,categories:[{category:'是',groups:[{segment:'总体',count:2,base:2,percent:100}]}]}]},compact_result:{}});
 async function request(pid,did,rid,userId='s1'){
  const response=await onRequest({request:new Request(`https://test.example/api/research/projects/${pid}/datasets/${did}/analysis-brief`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({result_id:rid})}),env:{RESEARCH_DB:d1,RESEARCH_ANONYMOUS_USER_ID:userId}});
  return {status:response.status,body:await response.json()};
 }
 const response=await request(project.id,dataset.id,record.id);
 assert.equal(response.status,201,JSON.stringify(response.body));assert.match(response.body.artifact.content,/Q13/);
 assert.equal((await store.listArtifacts(project.id)).length,1);
 assert.equal((await request(project.id,dataset.id,record.id,'other')).status,404);
 assert.equal((await request(project.id,dataset.id,'missing')).status,409);
 assert.equal((await request(project.id,'missing',record.id)).status,404);
 console.log('S1 Cloudflare handler passed: D1 artifact persistence, scope isolation and missing source rejection');
}finally{db.close();}
