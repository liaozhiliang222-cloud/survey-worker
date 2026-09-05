import {readProjectReadiness} from "../lib/research-readiness.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JsonResearchStore } from '../lib/research-store.js';
import { LocalResearchFileStorage } from '../lib/research-file-storage.js';
import { createResearchStore, dataStorage } from '../functions/api/research/[[path]].js';
import { registerRawDataset, createDataToolExecutor } from '../lib/data-engine.mjs';
import { parseProjectFile } from '../lib/project-file-parser.mjs';
import { syncTranscriptFromFile, finalizeQualitativeAnalysis } from '../lib/qualitative-analysis.mjs';
import { finalizeReportStoryline } from '../lib/report-storyline.mjs';
import { finalizePptScript, validatePptScriptEvidenceScope } from '../lib/ppt-script-workflow.mjs';

const output=path.resolve(process.env.R3_OUTPUT_DIR || '.data/r3-delivery');fs.mkdirSync(output,{recursive:true});
const run=path.join(output,`run-${Date.now()}`);fs.mkdirSync(run);
const db=new DatabaseSync(path.join(run,'research.sqlite'));
for(const name of fs.readdirSync('migrations').filter(n=>/^\d{4}.*sql$/.test(n)).sort())db.exec(fs.readFileSync(path.join('migrations',name),'utf8'));
const stmt=(sql,args=[])=>({async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:db.prepare(sql).run(...args)};}});
const d1={prepare(sql){return {...stmt(sql),bind(...args){return stmt(sql,args);}};},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
const disk=new LocalResearchFileStorage(path.join(run,'cloud-files'));
const r2={put:disk.put.bind(disk),delete:disk.delete.bind(disk),async get(key){try{const b=await disk.get(key);return {arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch(e){if(e.code==='ENOENT')return null;throw e;}}};
const cases=JSON.parse(fs.readFileSync('tests/fixtures/r3/cases.json','utf8')).cases;
const results=[];
try {
for(const [adapter,store,storage] of [['local',new JsonResearchStore(path.join(run,'research.json')),new LocalResearchFileStorage(path.join(run,'files'))],['d1',createResearchStore(d1),dataStorage({RESEARCH_FILES:r2})]]) {
 for(const fixture of cases) {
  const started=performance.now(),project=await store.createProject('r3',{title:`人工验收 ${fixture.id}`}),pid=project.id;
  const transcripts=[];let dataset,analysis,qual;
  const execute=createDataToolExecutor({store,fileStorage:storage});
  for(const name of fixture.materials) {
   const bytes=fs.readFileSync(path.join('tests/fixtures/r3',name)),ext=path.extname(name).slice(1),fileId=crypto.randomUUID(),key=storage.key(pid,fileId,ext);
   await storage.put(key,bytes);
   let file=await store.createFile('r3',pid,{id:fileId,file_name:name,file_type:ext,mime_type:ext==='csv'?'text/csv':'text/plain',file_size:bytes.length,category:ext==='csv'?'data':'interview',storage_path:key,storage_key:key});
   if(ext==='csv') {
    dataset=await registerRawDataset({store,fileStorage:storage,userId:'r3',projectId:pid,file});
    analysis=await execute({agentToolId:'crosstab',args:{dataset_id:dataset.id,banner:['GROUP'],variables:['NPS','VALUE']},scope:{project,user_id:'r3'}});
    assert.equal(analysis.result.results[0].overall,84.6);assert.equal(analysis.result.results[1].overall,6);assert.equal(analysis.result.results[0].base,13);
    const excel=await store.getFile(pid,analysis.result.excel_file_id),excelBytes=await storage.get(excel.storage_key||excel.storage_path);
    assert.equal(Buffer.from(excelBytes).subarray(0,2).toString(),'PK');fs.writeFileSync(path.join(run,`${adapter}-${fixture.id}.xlsx`),Buffer.from(excelBytes));
   } else {
    const parsed=await parseProjectFile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{extension:ext,fileName:name});
    file=await store.updateFile(pid,fileId,{parse_status:parsed.status,parsed_text:parsed.parsedText,summary:parsed.summary||''});
    transcripts.push(await syncTranscriptFromFile({store,projectId:pid,file}));
   }
  }
  if(transcripts.length) {
   const segments=[];for(const t of transcripts)segments.push(...await store.listTranscriptSegments(pid,t.id));
   const selected=segments.filter(s=>/我会先|每次修改/.test(s.content));assert.equal(selected.length,2);
   const reply=selected.map((s,i)=>`### ${i?'保留版本让结果可以复查':'先核对再发送让用户保有控制权'}\n需要保留原始材料与操作边界。\n> “${s.content.split('\n').find(line=>/我会先|每次修改/.test(line))}” [segment:${s.id}]`).join('\n\n');
   qual=await finalizeQualitativeAnalysis({store,projectId:pid,projectTitle:project.title,reply,transcripts});assert.equal(qual.quality.verified_quote_count,2);assert.equal(qual.quality.invalid_quote_count,0);
  }
  const evidence=await store.listEvidence(pid),ids=evidence.map(e=>e.id);assert.ok(ids.length>=2);
  const titles=fixture.id==='quantitative'?['推荐结果需要同时交代有效基数','组间差异只作样本内描述','均值与缺失口径保持独立核验']:['对外发送仍需由使用者最终确认','断网恢复必须保留已完成步骤','版本记录是复查结果的基础'];
  const outlineReply={title:project.title+'报告',report_goal:'验证来源到交付的一致性',core_insights:titles.map((title,i)=>({id:`i${i}`,title,statement:title,evidence_ids:ids})),storyline:[{section_id:'s1',section_title:'发现与行动',section_purpose:'解释人工样本的边界',core_message:titles[0],evidence_ids:ids}],chapters:[{title:'发现与行动',pages:titles.map((title,i)=>({page_no:i+1,page_title:title,key_message:title,evidence_ids:ids}))}]};
  const outline=await finalizeReportStoryline({store,projectId:pid,projectTitle:project.title,reply:JSON.stringify(outlineReply),evidence});assert.equal(outline.quality.passed,true);
  const quotes=evidence.filter(e=>e.type==='transcript_quote').map(e=>({text:JSON.parse(e.value).quote,evidence_id:e.id}));
  const numeric=evidence.find(e=>e.type==='quantitative'&&JSON.parse(e.value).metric==='nps');
  const common={evidence_ids:ids,source_notes:'人工验收材料，不代表真实调研',purpose:'验证证据到页面的完整传递',transition_to_next:'由来源核验进入行动边界'};
  const pages=[{id:'cover',page_type:'cover',title:project.title,key_message:'人工材料验收',purpose:'说明材料边界',evidence_ids:[]}];
  if(quotes.length)pages.push({...common,id:'quotes',page_type:'quote_evidence',title:titles[0],key_message:titles[0],quotes,visual_spec:{type:'quote',evidence_ids:ids}});
  pages.push({...common,id:'dense',page_type:'qualitative_insight',title:titles[1],key_message:titles[1],supporting_findings:Array.from({length:9},(_,i)=>({id:`f${i}`,text:`核验项${i+1}：保留原始材料、确认步骤和版本记录。`,evidence_ids:ids})),visual_spec:{type:'text_summary',evidence_ids:ids}});
  if(numeric)pages.push({...common,id:'numbers',page_type:fixture.id==='quantitative'?'data_insight':'qualitative_insight',title:'人工样本总体推荐值为84.6，有效基数为13',key_message:'总体 NPS 84.6；有效 base 13；均值 6。',supporting_findings:[{text:'总体 NPS 84.6；有效 base 13；均值 6。',evidence_ids:[numeric.id]}],data_points:fixture.id==='quantitative'?[{label:'总体NPS',value:84.6,value_field:'total',evidence_id:numeric.id,data_source_id:numeric.source_id}]:[],visual_spec:{type:fixture.id==='quantitative'?'bar_chart':'text_summary',evidence_ids:[numeric.id]}});
  if(quotes.length)pages.push({...common,id:'segments',page_type:'segment_comparison',title:'角色A重视发送控制，角色B强调版本记录',key_message:'两位人工角色关注不同操作边界',content_structure:[{title:'角色A',body:'需要可核对、可撤销的发送步骤。'},{title:'角色B',body:'需要保留上一版本和原声来源。'}],visual_spec:{type:'comparison',evidence_ids:ids}});
  const script=await finalizePptScript({store,projectId:pid,projectTitle:project.title,reply:JSON.stringify({title:project.title,pages}),outlineArtifact:outline.artifact,evidence});
  assert.equal(validatePptScriptEvidenceScope(script.artifact.content,evidence).valid,true);
  for(const quote of quotes)assert.ok(script.script.pages.some(p=>p.quotes.some(q=>q.text===quote.text)),'Long quote must remain complete');
  const scriptPath=path.join(run,`${adapter}-${fixture.id}.json`);fs.writeFileSync(scriptPath,JSON.stringify(script.script,null,2));
  // A fabricated suffix beyond the old 1000-character comparison limit fails.
  if(quotes.length){const forged=structuredClone(script.script);forged.pages.find(p=>p.quotes.length).quotes[0].text+='伪造结尾';assert.equal(validatePptScriptEvidenceScope(forged,evidence).valid,false);}
  if(quotes.length){const excerpt=structuredClone(script.script);const q=excerpt.pages.find(p=>p.quotes.length).quotes[0];q.text=q.text.slice(5,45);assert.equal(validatePptScriptEvidenceScope(excerpt,evidence).valid,true,'Contiguous verbatim excerpts remain traceable');}
  if(numeric){const forged={pages:[{id:'fake',data_points:[{label:'推荐值',value:13,evidence_id:numeric.id,data_source_id:numeric.source_id}]}]};assert.equal(validatePptScriptEvidenceScope(forged,evidence).valid,false,'base cannot masquerade as metric value');}
  const ppt=await store.createArtifact(pid,{type:'qualitative_ppt',title:'输出追溯占位（渲染测试另行绑定）',content:JSON.stringify({source_report_outline:outline.artifact.id,source_ppt_script:script.artifact.id})});
  assert.equal((await store.getArtifact(pid,script.artifact.id)).freshness.status,'current');
  const original=script.artifact.content;
  await store.updateEvidence(pid,ids[0],{excluded:true});
  for(const id of [outline.artifact.id,script.artifact.id,ppt.id])assert.equal((await store.getArtifact(pid,id)).freshness.status,'stale');
  assert.equal((await store.getArtifact(pid,script.artifact.id)).content,original);
  await store.updateEvidence(pid,ids[0],{excluded:false});
  if(dataset){await execute({agentToolId:'crosstab',args:{dataset_id:dataset.id,banner:['GROUP'],variables:['NPS','VALUE']},scope:{project,user_id:'r3'}});assert.equal((await store.getArtifact(pid,script.artifact.id)).freshness.status,'stale');}
  const freshEvidence=(await store.listEvidence(pid)).filter(e=>e.source_type!=='crosstab'||e.source_id!==(dataset?analysis.result.result_id:''));
  const nextIds=freshEvidence.map(e=>e.id),updatedReply=structuredClone(outlineReply);
  updatedReply.core_insights.forEach(i=>i.evidence_ids=nextIds);updatedReply.chapters.forEach(c=>c.pages.forEach(p=>p.evidence_ids=nextIds));updatedReply.storyline.forEach(s=>s.evidence_ids=nextIds);
  const derived=await finalizeReportStoryline({store,projectId:pid,projectTitle:project.title,reply:JSON.stringify(updatedReply),evidence:freshEvidence,parentArtifactId:outline.artifact.id});
  assert.equal(derived.artifact.parent_artifact_id,outline.artifact.id);assert.equal((await store.getArtifact(pid,derived.artifact.id)).freshness.status,'current');
  const readiness=await readProjectReadiness(store,pid);assert.equal(readiness.schema_version,1);assert.ok(readiness.counts.usable_evidence>0);assert.ok(readiness.reports.length);
  results.push({adapter,case:fixture.id,project_id:pid,script_path:scriptPath,evidence_count:ids.length,verified_quotes:quotes.length,source_script_id:script.artifact.id,source_outline_id:outline.artifact.id,duration_ms:Math.round(performance.now()-started),passed:true});
 }
}
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
fs.writeFileSync(path.join(output,'latest.json'),JSON.stringify({run,results},null,2));console.log(JSON.stringify({run,results},null,2));
} finally {db.close();}
