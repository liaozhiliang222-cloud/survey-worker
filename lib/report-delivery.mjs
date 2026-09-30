import {createHash} from 'node:crypto';
import {preferredTranscriptSegments} from './transcript-correction.mjs';
const obj=v=>{if(v&&typeof v==='object')return v;try{return JSON.parse(v||'{}');}catch{return {};}};
const clone=v=>JSON.parse(JSON.stringify(v));
const list=v=>Array.isArray(v)?v:[];
const hash=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)).digest('hex');
export const REPORT_PAGE_TYPES=['cover','section_intro','data_insight','comparison','quote_evidence','qualitative_insight','qualitative_summary','summary','executive_summary','recommendation'];
export function pageEvidenceIds(page){return [...new Set([...list(page.evidence_ids),...list(page.data_points).map(x=>x.evidence_id),...list(page.quotes).map(x=>x.evidence_id),...list(page.supporting_findings).flatMap(x=>list(x.evidence_ids))])].filter(Boolean);}
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^-?\d+(\.\d+)?%?$/.test(v.trim())?Number(v.replace('%','')):null;
function actualPoint(point,evidence){const field=point.value_field||'value';return ['value','total','overall','base','total_base','mean','nps','percent'].includes(field)?obj(evidence?.value)[field]:undefined;}
function samePoint(point,evidence){const actual=actualPoint(point,evidence);return ['quantitative','tool_result'].includes(evidence?.type)&&actual!==undefined&&actual!==null&&numeric(actual)!==null&&numeric(point.value)===numeric(actual)&&(!obj(evidence.value).unit||point.unit===obj(evidence.value).unit)&&(!point.data_source_id||point.data_source_id===evidence.source_id);}
async function evidenceRecord(store,pid,id,transcriptCache){
 const raw=await store.getEvidence(pid,id);if(!raw)return {id,unavailable:'证据已删除或不属于当前项目'};
 const evidence={...raw,value:obj(raw.value)},v=evidence.value;let source=null;
 if(raw.source_type==='crosstab')source=await store.getAnalysisResult(pid,raw.source_id);
 else if(raw.source_type==='transcript_segment'&&v.transcript_id){
  if(typeof store.listTranscriptSegments==='function'){
   if(!transcriptCache.has(v.transcript_id))transcriptCache.set(v.transcript_id,preferredTranscriptSegments({store,projectId:pid,transcriptId:v.transcript_id}));
   const preferred=await transcriptCache.get(v.transcript_id),segment=preferred.segments.find(s=>(s.raw_segment_id||s.id)===raw.source_id||s.id===v.segment_id);
   source=segment?{...segment,transcript_version:preferred.version?{id:preferred.version.id,type:preferred.version.type,version:preferred.version.version}:null}:null;
  }else source=await store.getTranscriptSegment(pid,v.transcript_id,raw.source_id);
 }
 else if(raw.source_type==='artifact')source=await store.getArtifact(pid,raw.source_id);
 else if(raw.source_type==='file')source=await store.getFile(pid,raw.source_id);
 else if(raw.source_type==='tool_result')source=(await store.listToolResults(pid)).find(x=>x.id===raw.source_id);
 const dataset=source?.dataset_id?await store.getDataset(pid,source.dataset_id):null;
 const record={id,evidence,source:source?{...source,result:obj(source.result),compact_result:obj(source.compact_result)}:null,dataset:dataset?{id:dataset.id,type:dataset.type,name:dataset.name,metadata:obj(dataset.metadata)}:null};
 record.fingerprint=hash({evidence,source,dataset:record.dataset});
 if(!source||[true,1,'1','true'].includes(raw.excluded))record.unavailable='来源不存在或证据已排除';
 if(raw.source_type==='transcript_segment'&&source){const content=source.corrected_text||source.text||source.content||'';if(!content.includes(v.quote||'')||!v.quote)record.unavailable='原声已不匹配当前访谈片段';}
 if(raw.source_type==='crosstab'&&source){const findings=list(obj(source.compact_result).key_findings);if(!findings.some(f=>hash(f)===hash(v)))record.unavailable='证据与当前分析结果不一致，请重新分析并替换证据引用';}
 return record;
}
function inspectPage(page,records){
 const ids=pageEvidenceIds(page),refs=ids.map(id=>records.find(r=>r.id===id)),issues=[];
 if(String(page.title||'').length>160)issues.push('标题超过 160 字，请先精简');
 if(list(page.data_points).length&&!['none','text_summary','bar_chart','comparison','table',undefined].includes(page.visual_spec?.type))issues.push('首批定量交付只支持横向对比图');
 if(!REPORT_PAGE_TYPES.includes(page.page_type))issues.push('交付包尚不支持此页型');
 if(!['cover','section_intro'].includes(page.page_type)&&!ids.length)issues.push('结论缺少证据，待验证');
 for(const r of refs)if(r.unavailable)issues.push(`${r.id}：${r.unavailable}`);
 for(const p of list(page.data_points)){const r=refs.find(x=>x.id===p.evidence_id);if(!r?.evidence||!samePoint(p,r.evidence))issues.push(`${p.label}：数值与源证据不一致或缺失`);}
 for(const q of list(page.quotes)){const r=refs.find(x=>x.id===q.evidence_id);if(!q.text||!String(r?.evidence?.value?.quote||'').includes(q.text))issues.push('原声无法逐字定位');}
 const allowed=new Set();
 const collect=v=>{if(numeric(v)!==null)allowed.add(numeric(v));else if(v&&typeof v==='object')Object.values(v).forEach(collect);};
 refs.forEach(r=>{collect(r.evidence?.value);for(const token of String(r.evidence?.value?.quote||'').match(/-?\d+(?:\.\d+)?/g)||[])allowed.add(Number(token));});
 const prose=[page.title,page.key_message,page.subtitle,...list(page.supporting_points),...list(page.content_structure).flatMap(b=>[b.title,b.body,...list(b.items)])].filter(Boolean).join(' ').replace(/\b[QPV]\d+\b/g,'');
 if((prose.match(/-?\d+(?:\.\d+)?/g)||[]).some(n=>!allowed.has(Number(n))))issues.push('标题或结论中有未匹配源证据的数字，请补充证据或改写');
 const changed=refs.filter(r=>page.delivery_snapshot?.[r.id]!==r.fingerprint).map(r=>r.id);
 const tracked=!!page.delivery_snapshot;
 const status=issues.length?'blocked':changed.length?(tracked?'stale':'needs_review'):page.delivery_review_pending?'needs_review':'current';
 return {id:page.id,title:page.title,status,issues,changed_evidence_ids:changed,evidence_ids:ids,locked:!!page.content_locked,manual:!!page.manually_edited};
}
export async function reportDelivery(store,projectId,artifactId,{action='inspect',page_ids=[]}={}){
 const artifact=await store.getArtifact(projectId,artifactId);if(!artifact||artifact.type!=='ppt_script')throw new Error('PPT 脚本不存在');
 if(action==='undo'){
  const parent=artifact.parent_artifact_id?await store.getArtifact(projectId,artifact.parent_artifact_id):null;
  if(!parent||parent.type!=='ppt_script')throw new Error('上一版本不可用');
  const saved=await store.createArtifact(projectId,{type:'ppt_script',title:artifact.title,content:parent.content,parent_artifact_id:artifact.id});
  return reportDelivery(store,projectId,saved.id);
 }
 const script=clone(obj(artifact.content));if(!list(script.pages).length||script.pages.length>80)throw new Error('报告需包含 1–80 页');
 const ids=[...new Set(script.pages.flatMap(pageEvidenceIds))];if(ids.length>1000)throw new Error('证据超过 1000 条，请拆分报告');
 const transcriptCache=new Map();const records=await Promise.all(ids.map(id=>evidenceRecord(store,projectId,id,transcriptCache)));
 let pages=script.pages.map(p=>inspectPage(p,records));
 if(!['inspect','refresh','review','lock'].includes(action))throw new Error('未知报告操作');
 let saved=null;const conflicts=[];
 if(action!=='inspect'){
  if(!page_ids.length||page_ids.some(id=>!script.pages.some(p=>p.id===id)))throw new Error('请选择有效页面');
  let updated=0;
  for(const page of script.pages.filter(p=>page_ids.includes(p.id))){
   const state=pages.find(p=>p.id===page.id),refs=state.evidence_ids.map(id=>records.find(r=>r.id===id));
   if(action==='lock'){page.content_locked=!page.content_locked;updated++;continue;}
   if(page.content_locked||(action==='refresh'&&page.manually_edited)){conflicts.push({id:page.id,reason:'已锁定或人工编辑，请先解锁并逐页核对'});continue;}
   if(refs.some(r=>r.unavailable)){conflicts.push({id:page.id,reason:'来源不可用，请替换证据'});continue;}
   if(action==='refresh'){
    for(const point of list(page.data_points)){const r=refs.find(r=>r.id===point.evidence_id);const value=actualPoint(point,r?.evidence);if(numeric(value)!==null){point.value=String(value);point.data_source_id=r.evidence.source_id;}}
    page.delivery_review_pending=true;
   }else if(state.issues.length){conflicts.push({id:page.id,reason:state.issues.join('；')});continue;}else page.delivery_review_pending=false;
   page.delivery_snapshot=Object.fromEntries(refs.map(r=>[r.id,r.fingerprint]));updated++;
  }
  if(updated){saved=await store.createArtifact(projectId,{type:'ppt_script',title:artifact.title,content:JSON.stringify(script),parent_artifact_id:artifact.id});pages=script.pages.map(p=>inspectPage(p,records));}
 }
 const coverage=[];
 for(const r of records){if(r.source?.result?.coverage)for(const row of r.source.result.coverage)if(!coverage.some(x=>x.result_id===r.source.id&&x.variable===row.variable))coverage.push({...row,result_id:r.source.id,report_page_ids:script.pages.filter(p=>pageEvidenceIds(p).some(id=>{const ref=records.find(e=>e.id===id);return ref?.evidence?.source_id===r.source.id&&ref.evidence.value.variable===row.variable;})).map(p=>p.id)});}
 return {schema_version:'surveykit.report_delivery.v1',project_id:projectId,artifact:saved||artifact,script,pages,records,coverage,conflicts,can_export:pages.every(p=>p.status==='current'),captured_at:new Date().toISOString()};
}
