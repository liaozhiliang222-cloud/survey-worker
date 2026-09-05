import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadEnv} from 'vite';
import {JsonResearchStore} from '../lib/research-store.js';
import {finalizeQualitativeAnalysis} from '../lib/qualitative-analysis.mjs';
import {buildEvidenceIndex,buildReportStorylinePrompt,finalizeReportStoryline} from '../lib/report-storyline.mjs';
import {buildPptScriptEvidenceContext,buildPptScriptPrompt,finalizePptScript,validatePptScriptEvidenceScope} from '../lib/ppt-script-workflow.mjs';
assert.ok(process.argv.includes('--run'),'Explicit --run required');
const output=path.resolve('.data/r4-model');fs.mkdirSync(output,{recursive:true});
const logFile=path.join(output,'acceptance.json');
const log=fs.existsSync(logFile)?JSON.parse(fs.readFileSync(logFile,'utf8')):{attempts:[]};
const latest=JSON.parse(fs.readFileSync('.data/r3-delivery/latest.json','utf8'));
const selected=latest.results.find(r=>r.adapter==='local'&&r.case==='qualitative');
assert.ok(!log.project_id||log.project_id===selected.project_id,'Acceptance source changed');log.project_id=selected.project_id;
const store=new JsonResearchStore(path.join(latest.run,'research.json')),project=await store.getProject('r3',selected.project_id);
const env={...process.env,...loadEnv('development',process.cwd(),'')};
const save=()=>fs.writeFileSync(logFile,JSON.stringify(log,null,2));
async function call(stage,prompt){
 assert.ok(log.attempts.length<6,'Six-call budget exhausted');prompt=typeof prompt==='string'?prompt:prompt.prompt;assert.ok(Buffer.byteLength(prompt)<60000);
 const entry={stage,started_at:new Date().toISOString(),max_tokens:8000,reasoning_effort:'low'};log.attempts.push(entry);save();
 fs.writeFileSync(path.join(output,stage+'-prompt.txt'),prompt);
 const key=env.HARNESS_API_KEY||env.VOLCENGINE_AGENT_PLAN_API_KEY||env.ARK_API_KEY;assert.ok(key);
 const response=await fetch(env.HARNESS_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model:env.HARNESS_MODEL,messages:[{role:'user',content:prompt}],max_tokens:8000,reasoning_effort:'low',stream:false,temperature:0.2}),signal:AbortSignal.timeout(240000)});
 entry.http_status=response.status;assert.ok(response.ok,`Model HTTP ${response.status}`);const data=await response.json();entry.usage=data.usage;entry.finish_reason=data.choices?.[0]?.finish_reason;save();
 const reply=data.choices?.[0]?.message?.content||'';fs.writeFileSync(path.join(output,stage+'-reply.txt'),reply);assert.ok(reply);assert.notEqual(entry.finish_reason,'length');return reply;
}
try{
 const transcripts=await store.listTranscripts(project.id),segments=[];for(const t of transcripts)segments.push(...await store.listTranscriptSegments(project.id,t.id));
 const reply=await call('analysis',`基于人工访谈写三个不同的###主题：发送确认、断网恢复、版本复查。每个主题写一条明确发现，并引用一个不超过120字的连续原文片段。必须至少引用两位角色。引用独立一行，严格格式：> “原文” [segment:ID]。只输出报告正文，明确这是人工验收样本，无总体推论。材料：${JSON.stringify(segments.map(s=>({id:s.id,text:s.content})))}`);
 const qual=await finalizeQualitativeAnalysis({store,projectId:project.id,projectTitle:project.title,reply,transcripts});log.analysis=qual.quality;assert.ok(qual.quality.passed);assert.ok(qual.insights.length>=3);
 const evidence=qual.evidence,insights=(await store.listResearchInsights(project.id)).filter(i=>i.artifact_id===qual.artifact.id);
 const index=buildEvidenceIndex({evidence,insights,artifacts:[qual.artifact]});
 const outlineReply=await call('outline',buildReportStorylinePrompt({project,message:'以三个不同主题组织3条核心发现和3至5页报告，绑定全部相关证据，不合并这三个操作阶段：发送前确认、执行中断网恢复、完成后版本复查。',evidenceIndex:index}));
 const outline=await finalizeReportStoryline({store,projectId:project.id,projectTitle:project.title,reply:outlineReply,evidence});log.outline=outline.quality;assert.ok(outline.quality.passed);
 const context=buildPptScriptEvidenceContext({outlineArtifact:outline.artifact,evidence,insights});
 const scriptReply=await call('script',buildPptScriptPrompt({project,message:'生成5页简洁定性报告，含封面、原声证据和行动建议，不生成定量图表，原声必须连续逐字摘录。',outlineArtifact:outline.artifact,evidenceContext:context}));
 const script=await finalizePptScript({store,projectId:project.id,projectTitle:project.title,reply:scriptReply,outlineArtifact:outline.artifact,evidence});assert.ok(validatePptScriptEvidenceScope(script.script,evidence).valid);assert.ok(script.script.pages.some(p=>p.quotes.length));
 log.script=script.quality;log.artifact_id=script.artifact.id;log.passed=true;fs.writeFileSync(path.join(output,'script.json'),JSON.stringify(script.script,null,2));console.log('R4 real model analysis → evidence → outline → script passed.');
}catch(e){log.passed=false;log.failure=e.message;throw e;}finally{save();}
