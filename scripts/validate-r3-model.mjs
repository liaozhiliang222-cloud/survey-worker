// Explicit opt-in acceptance: <=3 requests, <=6000 output tokens each, no retries.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadEnv} from 'vite';
import {JsonResearchStore} from '../lib/research-store.js';
import {finalizeQualitativeAnalysis} from '../lib/qualitative-analysis.mjs';
import {buildEvidenceIndex,buildReportStorylinePrompt,finalizeReportStoryline} from '../lib/report-storyline.mjs';
import {buildPptScriptEvidenceContext,buildPptScriptPrompt,finalizePptScript,validatePptScriptEvidenceScope} from '../lib/ppt-script-workflow.mjs';

assert.ok(process.argv.includes('--run') || process.argv.includes('--replay'), 'Use --run for bounded calls or --replay for saved responses');
const latest=JSON.parse(fs.readFileSync('.data/r3-delivery/latest.json','utf8'));
const item=latest.results.find(x=>x.adapter==='local'&&x.case==='qualitative');
const store=new JsonResearchStore(path.join(latest.run,'research.json'));
const project=await store.getProject('r3',item.project_id);
const transcripts=await store.listTranscripts(project.id);
const segments=[];for(const t of transcripts)segments.push(...await store.listTranscriptSegments(project.id,t.id));
const env={...process.env,...loadEnv('development',process.cwd(),'')};
assert.equal(env.HARNESS_API_STYLE,'openai-chat');
const key=env.HARNESS_API_KEY||env.VOLCENGINE_AGENT_PLAN_API_KEY||env.ARK_AGENT_PLAN_API_KEY||env.ARK_API_KEY;
assert.ok(key);
const dir=path.resolve('.data/r3-model');fs.mkdirSync(dir,{recursive:true});
const records=fs.existsSync(path.join(dir,'acceptance.json'))?JSON.parse(fs.readFileSync(path.join(dir,'acceptance.json'),'utf8')):[];
async function call(stage,prompt) {
  if(process.argv.includes('--replay'))return fs.readFileSync(path.join(dir,`${stage}-reply.txt`),'utf8');
  if(typeof prompt==='object')prompt=prompt.prompt;
  assert.ok(records.length<3);assert.ok(Buffer.byteLength(prompt)<48000);
  const record={stage,model:env.HARNESS_MODEL,max_tokens:6000,input_bytes:Buffer.byteLength(prompt),started_at:new Date().toISOString()};
  records.push(record);fs.writeFileSync(path.join(dir,'acceptance.json'),JSON.stringify(records,null,2));
  fs.writeFileSync(path.join(dir,`${stage}-prompt.txt`),prompt);
  const response=await fetch(env.HARNESS_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model:env.HARNESS_MODEL,messages:[{role:'user',content:prompt}],max_tokens:6000,reasoning_effort:'low',stream:false,temperature:0.2}),signal:AbortSignal.timeout(180000)});
  record.http_status=response.status;assert.ok(response.ok,`Model HTTP ${response.status}`);
  const result=await response.json();record.usage=result.usage;record.finish_reason=result.choices?.[0]?.finish_reason;
  const reply=result.choices?.[0]?.message?.content||'';
  fs.writeFileSync(path.join(dir,`${stage}-reply.txt`),reply);assert.ok(reply);assert.notEqual(record.finish_reason,'length');return reply;
}
try {
 const evidence=(await store.listEvidence(project.id)).filter(e=>e.type==='transcript_quote');
 // The exhausted analysis attempt remains recorded; downstream calls use fixed verified evidence.
 const outline={artifact:await store.getArtifact(project.id,item.source_outline_id)};
 const context=buildPptScriptEvidenceContext({outlineArtifact:outline.artifact,evidence});
 const scriptReply=await call('script',buildPptScriptPrompt({project,message:'生成4至6页定性脚本，包含封面、原声证据和行动建议。原声从Evidence逐字复制，使用quote_evidence或qualitative_insight，不生成定量图表。内容简洁。',outlineArtifact:outline.artifact,evidenceContext:context}));
 const script=await finalizePptScript({store,projectId:project.id,projectTitle:project.title,reply:scriptReply,outlineArtifact:outline.artifact,evidence});
 assert.ok(validatePptScriptEvidenceScope(script.artifact.content,evidence).valid);assert.ok(script.script.pages.some(p=>p.quotes.length));
 const scriptRecord=records.findLast(r=>r.stage==='script');
 scriptRecord.quality=script.quality;scriptRecord.artifact_id=script.artifact.id;
 scriptRecord.replay_after_fix=process.argv.includes('--replay');
 fs.writeFileSync(path.join(dir,'script.json'),JSON.stringify(script.script,null,2));
 console.log('Fixed validated outline → real script passed. Earlier attempt records are retained.');
} finally {fs.writeFileSync(path.join(dir,'acceptance.json'),JSON.stringify(records,null,2));}
