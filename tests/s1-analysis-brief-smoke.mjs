import { Readable } from 'node:stream';
import { createResearchHandler } from '../lib/research-handler.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonResearchStore } from '../lib/research-store.js';
import { LocalResearchFileStorage } from '../lib/research-file-storage.js';
import { createDataToolExecutor, registerRawDataset } from '../lib/data-engine.mjs';
import { buildAnalysisBrief, buildCrosstabBrief } from '../lib/analysis-brief.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'surveykit-s1-'));
try {
 const store=new JsonResearchStore(path.join(root,'db.json')),storage=new LocalResearchFileStorage(path.join(root,'files'));
 const project=await store.createProject('s1-user',{title:'S1 简报',research_goal:'比较各题表现'});
 const headers=['分群',...Array.from({length:13},(_,i)=>`Q${i+1}`)];
 const rows=Array.from({length:8},(_,i)=>[i<4?'A':'B',...Array.from({length:13},(_,j)=>j===12?(i<4?'是':'否'):i===7?'':i%2)]);
 async function dataset(name,bytes,ext='csv') {
  const id=crypto.randomUUID(),key=storage.key(project.id,id,ext);await storage.put(key,bytes);
  const file=await store.createFile('s1-user',project.id,{id,file_name:`${name}.${ext}`,file_type:ext,category:'data',storage_path:key,file_size:bytes.length});
  return registerRawDataset({store,fileStorage:storage,userId:'s1-user',projectId:project.id,file,name});
 }
 const raw=await dataset('原始',new TextEncoder().encode([headers,...rows].map(row=>row.join(',')).join('\n')));
 const execute=createDataToolExecutor({store,fileStorage:storage});
 const run=(id,args)=>execute({agentToolId:'crosstab',args:{dataset_id:id,...args},scope:{project,user_id:'s1-user'}});
 const analyzed=await run(raw.id,{variables:headers.slice(1),banner:[]});
 assert.equal(analyzed.result.results.length,13);
 assert.equal(analyzed.result.coverage.filter(x=>x.status==='included').length,13);
 const first=analyzed.result.results[0];assert.equal(first.base,7);
 assert.ok(first.categories.some(c=>c.category==='0'));
 assert.equal(first.value_type,'percent');
 assert.equal(analyzed.result.source.dataset_id,raw.id);
 const brief=buildAnalysisBrief({dataset:raw,analyses:await store.listAnalysisResults(project.id),project,resultId:analyzed.result.result_id});
 assert.match(brief.content,/Q13/);assert.match(brief.content,/已选 13 题，已计算 13 题/);
 const artifact=await store.createArtifact(project.id,{type:'analysis',title:brief.title,content:brief.content});
 assert.equal(artifact.freshness.status,'current');
 await run(raw.id,{variables:headers.slice(1),banner:[]});
 assert.equal((await store.getArtifact(project.id,artifact.id)).freshness.status,'stale');
 assert.throws(()=>buildAnalysisBrief({dataset:{...raw,id:'other'},analyses:[{dataset_id:raw.id,type:'crosstab',result:analyzed.result}]}),/没有可用分析结果/);
 const currentBrief=buildAnalysisBrief({dataset:raw,analyses:await store.listAnalysisResults(project.id)});
 const currentArtifact=await store.createArtifact(project.id,{type:'analysis',title:currentBrief.title,content:currentBrief.content});
 const subset=await run(raw.id,{variables:['Q13'],banner:[]});
 const stale=(await store.getArtifact(project.id,currentArtifact.id)).freshness;
 assert.equal(stale.status,'stale');assert.ok(stale.reasons.some(reason=>reason.replacement_result_id===subset.result.result_id));
 const source=await fs.readFile(new URL('../src/shared/export.js',import.meta.url),'utf8');
 const {buildExcelWorkbookXlsxBytes}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const bytes=buildExcelWorkbookXlsxBytes([{name:'raw',rows:[headers,...rows].map(row=>({cells:row.map(value=>({value}))}))}]);
 const excel=await dataset('Excel',bytes,'xlsx');const x=await run(excel.id,{variables:headers.slice(1),banner:[]});
 assert.deepEqual(x.result.results.map(({dataset_id,result_id,...rest})=>rest),analyzed.result.results.map(({dataset_id,result_id,...rest})=>rest));
 const handler=createResearchHandler({env:{RESEARCH_DEV_USER_ID:'s1-user',RESEARCH_DATA_FILE:path.join(root,'db.json'),RESEARCH_FILES_DIR:path.join(root,'files')},logger:{log(){},error(){}}});
 async function request(url,body={}) {
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url=url;req.headers={'content-type':'application/json'};
  return new Promise((resolve,reject)=>{const res={headersSent:false,writeHead(status){this.status=status;this.headersSent=true;},end(bytes){resolve({status:this.status,body:JSON.parse(String(bytes))});}};Promise.resolve(handler(req,res)).catch(reject);});
 }
 const saved=await request(`/api/research/projects/${project.id}/datasets/${raw.id}/analysis-brief`,{result_id:analyzed.result.result_id});
 assert.equal(saved.status,201,JSON.stringify(saved.body));assert.match(saved.body.artifact.content,/Q13/);
 const other=await store.createProject('s1-user',{title:'另一个项目'});
 const wrong=await request(`/api/research/projects/${other.id}/datasets/${raw.id}/analysis-brief`);assert.equal(wrong.status,404);
 const missing=await request(`/api/research/projects/${project.id}/datasets/${raw.id}/analysis-brief`,{result_id:'missing'});assert.equal(missing.status,409);
 const weighted=await execute({agentToolId:'data_weight',args:{dataset_id:raw.id,confirmed:true,targets:[{variable:'分群',categories:[{value:'A',share:0.25},{value:'B',share:0.75}]}]},scope:{project,user_id:'s1-user'}});
 const weightedDataset=await store.getDataset(project.id,weighted.result.weighted_dataset_id);
 const w=await run(weightedDataset.id,{variables:['Q13'],banner:['分群']});
 assert.equal(w.result.weighted,true);assert.equal(w.result.results[0].significant,false);
 const wb=buildAnalysisBrief({dataset:weightedDataset,analyses:await store.listAnalysisResults(project.id),resultId:w.result.result_id});
 assert.match(wb.content,/已加权/);assert.match(wb.content,/未执行复杂抽样设计校正/);assert.match(wb.content,/100%/);assert.match(wb.content,/0%/);
 assert.throws(()=>buildAnalysisBrief({dataset:raw,analyses:[{id:'wrong',dataset_id:raw.id,type:'crosstab',result:{weighted:true,results:[]}}]}),/口径/);
 await assert.rejects(()=>run(raw.id,{variables:Array(1001).fill(0).map((_,i)=>`field${i}`),banner:[]}),e=>e.code==='CROSSTAB_LIMIT_EXCEEDED');
 const wide=await dataset('开放题',new TextEncoder().encode('Q1,open\n'+Array.from({length:101},(_,i)=>`是,原声${i}`).join('\n')));
 const partial=await run(wide.id,{variables:['Q1','open'],banner:[]});
 const excluded=partial.result.coverage.find(item=>item.variable==='open');assert.equal(excluded.status,'excluded');assert.match(excluded.reason,/类别过多/);
 const pb=buildAnalysisBrief({dataset:wide,analyses:await store.listAnalysisResults(project.id),resultId:partial.result.result_id});
 assert.match(pb.content,/已选 2 题，已计算 1 题/);assert.match(pb.content,/类别过多/);
 const aggregate=buildCrosstabBrief({pages:[{questions:[{code:'Q13',base:{Total:8},rows:[{option:'A',values:{Total:0}},{option:'B',values:{Total:99.5}},{option:'C',values:{Total:100}}]}]}]},{totalQuestions:13});
 assert.match(aggregate.content,/包含 1 题/);assert.match(aggregate.content,/99.5/);assert.match(aggregate.content,/不执行样本级检验/);
 console.log('S1 brief regression passed: 13 questions, CSV/XLSX equivalence, zeros/missing, weighted bases, stale provenance, aggregate limits');
} finally { await fs.rm(root,{recursive:true,force:true}); }
