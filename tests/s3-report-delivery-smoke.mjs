import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reportDelivery} from '../lib/report-delivery.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
const finding={variable:'Q1',value:0,unit:'%',base:20,weighted:false};
const quote='包装上的说明让我更容易理解这款产品。';
const evidence=[{id:'e0',type:'quantitative',source_type:'crosstab',source_id:'r',value:finding},{id:'e1',type:'quantitative',source_type:'crosstab',source_id:'r',value:{...finding,variable:'Q2',value:100}},{id:'eq',type:'transcript_quote',source_type:'transcript_segment',source_id:'seg',value:{quote,transcript_id:'t',segment_id:'seg'}}];
const source={id:'r',dataset_id:'d',compact_result:{key_findings:evidence.slice(0,2).map(e=>e.value)},result:{coverage:[{variable:'Q1',status:'included'},{variable:'Q2',status:'included'},{variable:'Q3',status:'excluded',reason:'未选'}]}};
const pages=[{id:'numbers',page_type:'data_insight',title:'试用偏好存在差异，需结合小样本边界解释',key_message:'结果仅用于方向判断。',evidence_ids:['e0','e1'],data_points:[{label:'未选择',value:'0',unit:'%',value_field:'value',evidence_id:'e0',data_source_id:'r'},{label:'选择',value:'100',unit:'%',value_field:'value',evidence_id:'e1',data_source_id:'r'}],visual_spec:{type:'bar_chart'}},{id:'voice',page_type:'quote_evidence',title:'清晰的信息能帮助受访者理解产品',key_message:'受访者提到包装说明的帮助。',quotes:[{text:quote,evidence_id:'eq',source_label:'受访者A',segment_id:'seg'}],evidence_ids:['eq']}];
let arts=[{id:'a',type:'ppt_script',title:'S3 验证',version:1,content:JSON.stringify({schema_version:'surveykit.ppt_script.v1',title:'S3 验证',pages})}];
const store={getArtifact:async(pid,id)=>pid==='p'?clone(arts.find(a=>a.id===id)||null):null,getEvidence:async(pid,id)=>clone(evidence.find(e=>e.id===id)||null),getAnalysisResult:async()=>clone(source),getDataset:async()=>({id:'d',type:'raw',metadata:{source_version:{sha256:'fixture'}}}),getTranscriptSegment:async()=>({id:'seg',text:quote}),createArtifact:async(pid,input)=>{const a={...input,id:'a'+arts.length,version:arts.length+1};arts.push(a);return a;}};
let result=await reportDelivery(store,'p','a');assert.equal(result.can_export,false);assert.equal(result.pages[0].status,'needs_review');
result=await reportDelivery(store,'p','a',{action:'review',page_ids:pages.map(p=>p.id)});assert.equal(result.can_export,true);
fs.mkdirSync('.data/s3-delivery',{recursive:true});
for(const [name,ids] of [['quantitative',['numbers']],['qualitative',['voice']],['mixed',['numbers','voice']]]){const payload=clone(result);payload.script.pages=payload.script.pages.filter(p=>ids.includes(p.id));fs.writeFileSync(`.data/s3-delivery/${name}.json`,JSON.stringify(payload));}
const baseline=result.artifact.id;
evidence[0].value.value=25;source.compact_result.key_findings[0].value=25;
result=await reportDelivery(store,'p',baseline);assert.equal(result.pages[0].status,'blocked');assert.equal(result.pages[1].status,'current');
result=await reportDelivery(store,'p',baseline,{action:'refresh',page_ids:['numbers']});assert.equal(result.script.pages[0].data_points[0].value,'25');assert.equal(result.pages[0].status,'needs_review');assert.equal(result.script.pages[0].key_message,pages[0].key_message);assert.equal(result.can_export,false);
result=await reportDelivery(store,'p',result.artifact.id,{action:'review',page_ids:['numbers']});assert.equal(result.can_export,true);
const manual=clone(arts.at(-1));manual.id='manual';const content=JSON.parse(manual.content);content.pages[0].manually_edited=true;content.pages[1].content_locked=true;manual.content=JSON.stringify(content);arts.push(manual);
result=await reportDelivery(store,'p','manual',{action:'refresh',page_ids:['numbers','voice']});assert.equal(result.conflicts.length,2);assert.equal(result.artifact.id,'manual');
evidence[1].excluded=true;result=await reportDelivery(store,'p','manual');assert.equal(result.can_export,false);assert.ok(result.pages[0].issues.some(x=>x.includes('排除')));
await assert.rejects(()=>reportDelivery(store,'other','a'));
assert.equal(JSON.parse(arts[0].content).pages[0].data_points[0].value,'0');
console.log('S3 source review, immutable updates, manual/lock conflicts, excluded evidence and project isolation passed; three fixture contracts written.');

const {normalizePptScript}=await import('../lib/ppt-script-workflow.mjs');
const original=normalizePptScript({pages},{evidence});original.pages[0].content_locked=true;
const regenerated=normalizePptScript({pages:[]},{evidence,existingScript:original});
assert.equal(regenerated.pages.find(p=>p.id==='numbers').key_message,original.pages[0].key_message);
assert.deepEqual(regenerated.pages.find(p=>p.id==='numbers').data_points,original.pages[0].data_points);
console.log('AI regeneration preserves locked content even if the model omits the page');

const correctedStore={...store,listTranscriptSegments:async()=>[{id:'seg',content:'旧的转写'}],getPreferredTranscriptVersion:async()=>({id:'corrected',version:2,type:'corrected',status:'approved'}),listTranscriptVersionSegments:async()=>[{id:'new-seg',raw_segment_id:'seg',content:quote}]};
const corrected=await reportDelivery(correctedStore,'p',baseline);
assert.equal(corrected.records.find(r=>r.id==='eq').unavailable,undefined);
assert.equal(corrected.records.find(r=>r.id==='eq').source.transcript_version.id,'corrected');
console.log('Approved corrected transcript version is used for quote validation');
