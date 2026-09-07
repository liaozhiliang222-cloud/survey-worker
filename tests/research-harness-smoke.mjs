import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-research-"));
const dataFile = path.join(temp, "research.json");
const children = [];
const calls = [];
let nextSession = 0;
const expired = new Set();
const activeMessages = new Map();
const latestConcurrentMarker = new Map();
let maxConcurrentMessages = 0;

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
function freePort() { const server = http.createServer(); return listen(server).then((port) => new Promise((resolve) => server.close(() => resolve(port)))); }
function ready(child) { return new Promise((resolve, reject) => { let output=""; const timer=setTimeout(()=>reject(new Error(output||"server timeout")),10000); const onData=(chunk)=>{output+=chunk;if(output.includes("Research toolbox running")){clearTimeout(timer);resolve();}}; child.stdout.on("data",onData); child.stderr.on("data",onData); child.once("exit",(code)=>reject(new Error(`server exited ${code}: ${output}`))); }); }
async function start(user, harnessUrl, extra={}) { const port=await freePort(); const child=spawn(process.execPath,["server.js"],{cwd:root,env:{...process.env,PORT:String(port),RESEARCH_DEV_USER_ID:user,RESEARCH_DATA_FILE:dataFile,HARNESS_BASE_URL:harnessUrl,HARNESS_API_STYLE:"opencode",HARNESS_API_KEY:"server-secret",HARNESS_TIMEOUT:"1000",...extra}}); children.push(child); await ready(child); return `http://127.0.0.1:${port}`; }
async function api(base, route, options={}) { const response=await fetch(base+route,{...options,headers:{"Content-Type":"application/json","X-Request-ID":"test-request-123",...(options.headers||{})}}); const payload=response.status===204?null:await response.json(); return {response,payload}; }
const post=(base,route,value)=>api(base,route,{method:"POST",body:JSON.stringify(value)});
const patch=(base,route,value)=>api(base,route,{method:"PATCH",body:JSON.stringify(value)});

const mock=http.createServer((req,res)=>{let raw="";req.on("data",c=>raw+=c);req.on("end",()=>{const payload=raw?JSON.parse(raw):null;calls.push({url:req.url,auth:req.headers.authorization,payload});if(req.method==="POST"&&req.url==="/session"){const sid=`session-${++nextSession}`;res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({id:sid}));return;}const match=req.url.match(/^\/session\/([^/]+)\/message$/);if(req.method==="POST"&&match){if(expired.has(match[1])){res.writeHead(410,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"expired"}));return;}const prompt=String(payload?.parts?.[0]?.text||"");if(prompt.endsWith("UPSTREAM_DIAGNOSTIC")){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"private-provider-detail"}));return;}const marker=["concurrent-first","concurrent-second","concurrent-duplicate"].find(value=>prompt.endsWith(value));if(marker){const sessionId=match[1];const active=(activeMessages.get(sessionId)||0)+1;activeMessages.set(sessionId,active);maxConcurrentMessages=Math.max(maxConcurrentMessages,active);latestConcurrentMarker.set(sessionId,marker);setTimeout(()=>{const reply=`reply-${latestConcurrentMarker.get(sessionId)}`;activeMessages.set(sessionId,(activeMessages.get(sessionId)||1)-1);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({parts:[{type:"text",text:reply}]}));},marker==="concurrent-first"?80:20);return;}res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({parts:[{type:"reasoning",text:"hidden"},{type:"text",text:`reply-${calls.filter(c=>/\/message$/.test(c.url)).length}`}]}));return;}res.writeHead(404).end();});});
const mockPort=await listen(mock); const harnessUrl=`http://127.0.0.1:${mockPort}`;

try {
  const a=await start("user-a",harnessUrl);
  const aChild=children.at(-1);
  let result=await api(a,"/api/research/%E0%A4%A");
  assert.equal(result.response.status,400); assert.equal(result.payload.error.type,"invalid_request");
  result=await api(a,"/api/research/health"); assert.equal(result.response.status,200); assert.equal(result.payload.ok,true); assert.equal(aChild.exitCode,null,"malformed URL must not terminate the Node process");
  result=await post(a,"/api/research/projects",{title:"NPS研究",client_name:"客户A",brief:"年轻用户",research_goal:"定位流失原因",client_project_id:"project-a",user_id:"evil"});
  assert.equal(result.response.status,201); assert.equal(result.payload.project.id,"project-a"); assert.ok(!("user_id" in result.payload.project));
  result=await api(a,"/api/research/projects"); assert.equal(result.payload.projects.length,1);
  result=await patch(a,"/api/research/projects/project-a",{title:"NPS研究新版"}); assert.equal(result.payload.project.title,"NPS研究新版");

  result=await post(a,"/api/research/projects/project-a/messages",{message:"设计调研方案",client_request_id:"request-1"});
  assert.equal(result.response.status,200); assert.equal(result.payload.reply,"reply-1"); assert.equal(result.payload.session_recreated,true); assert.ok(!("sessionId" in result.payload)); assert.ok(!JSON.stringify(result.payload).includes("session-"));
  const createCall=calls.find(c=>c.url==="/session"); assert.deepEqual(createCall.payload,{title:"NPS研究新版"}); assert.equal(createCall.auth,"Bearer server-secret");
  const firstPrompt=calls.find(c=>/\/message$/.test(c.url)).payload.parts[0].text; assert.match(firstPrompt,/项目背景：年轻用户/); assert.match(firstPrompt,/研究目标：定位流失原因/);

  result=await post(a,"/api/research/projects/project-a/messages",{message:"设计调研方案",client_request_id:"request-1"}); assert.equal(result.payload.idempotent_replay,true); assert.equal(calls.filter(c=>/\/message$/.test(c.url)).length,1);
  await patch(a,"/api/research/projects/project-a",{brief:"更新后的项目背景"});
  result=await post(a,"/api/research/projects/project-a/messages",{message:"继续细化",client_request_id:"request-2"}); assert.equal(result.payload.session_recreated,false); assert.equal(calls.filter(c=>c.url==="/session").length,1);
  assert.match(calls.filter(c=>/\/message$/.test(c.url)).at(-1).payload.parts[0].text,/项目背景：更新后的项目背景/);

  const [firstConcurrent,secondConcurrent]=await Promise.all([
    post(a,"/api/research/projects/project-a/messages",{message:"concurrent-first",client_request_id:"request-concurrent-first"}),
    post(a,"/api/research/projects/project-a/messages",{message:"concurrent-second",client_request_id:"request-concurrent-second"}),
  ]);
  assert.equal(firstConcurrent.payload.reply,"reply-concurrent-first"); assert.equal(secondConcurrent.payload.reply,"reply-concurrent-second");
  assert.equal(maxConcurrentMessages,1,"one project must never send concurrent messages to the same Harness session");
  const duplicateCallsBefore=calls.filter(c=>/\/message$/.test(c.url)).length;
  const [duplicateA,duplicateB]=await Promise.all([
    post(a,"/api/research/projects/project-a/messages",{message:"concurrent-duplicate",client_request_id:"request-concurrent-duplicate"}),
    post(a,"/api/research/projects/project-a/messages",{message:"concurrent-duplicate",client_request_id:"request-concurrent-duplicate"}),
  ]);
  assert.equal(duplicateA.payload.reply,"reply-concurrent-duplicate"); assert.equal(duplicateB.payload.reply,"reply-concurrent-duplicate");
  assert.equal(calls.filter(c=>/\/message$/.test(c.url)).length,duplicateCallsBefore+1,"matching client_request_id requests must share one Harness operation");

  expired.add("session-1");
  result=await post(a,"/api/research/projects/project-a/messages",{message:"重建后继续",client_request_id:"request-3"}); assert.equal(result.payload.session_recreated,true); assert.equal(calls.filter(c=>c.url==="/session").length,2); const recreatedPrompt=calls.at(-1).payload.parts[0].text; assert.match(recreatedPrompt,/【项目基础信息】/); assert.match(recreatedPrompt,/【Session 恢复：最近有效对话】/);

  result=await post(a,"/api/research/projects/project-a/artifacts",{type:"research_plan",title:"方案",content:"V1"}); assert.equal(result.payload.artifact.version,1); const artifactId=result.payload.artifact.id;
  result=await post(a,"/api/research/projects/project-a/artifacts",{type:"research_plan",title:"方案",content:"V2"}); assert.equal(result.payload.artifact.version,2);
  result=await patch(a,`/api/research/projects/project-a/artifacts/${artifactId}`,{title:"新方案名"}); assert.equal(result.payload.artifact.title,"新方案名");
  result=await api(a,"/api/research/projects/project-a/artifacts"); assert.equal(result.payload.artifacts.length,2);
  result=await api(a,`/api/research/projects/project-a/artifacts/${artifactId}`,{method:"DELETE"}); assert.equal(result.response.status,204);
  result=await api(a,"/api/research/projects/project-a/messages"); assert.equal(result.payload.messages.length,12);

  const b=await start("user-b",harnessUrl);
  result=await api(b,"/api/research/projects/project-a"); assert.equal(result.response.status,404,"user B must not access user A project");
  result=await api(b,"/api/research/projects"); assert.deepEqual(result.payload.projects,[]);

  const hanging=http.createServer(()=>{}); const hangingPort=await listen(hanging); const c=await start("user-c",`http://127.0.0.1:${hangingPort}`,{HARNESS_TIMEOUT:"20",RESEARCH_DATA_FILE:path.join(temp,"timeout.json")});
  await post(c,"/api/research/projects",{title:"Timeout",client_project_id:"timeout-project"}); result=await post(c,"/api/research/projects/timeout-project/messages",{message:"test",client_request_id:"timeout-request"}); assert.equal(result.response.status,504); assert.equal(result.payload.error.type,"harness_timeout"); assert.ok(!JSON.stringify(result.payload).includes(`127.0.0.1:${hangingPort}`)); hanging.close();

  result=await post(a,"/api/research/projects/project-a/messages",{message:"UPSTREAM_DIAGNOSTIC",client_request_id:"diagnostic-upstream"});
  assert.equal(result.payload.error.cause_code,"HARNESS_UPSTREAM");
  assert.equal(result.payload.error.upstream_status,503);
  assert.match(result.payload.error.message,/HTTP 503/);
  assert.ok(!JSON.stringify(result.payload).includes("private-provider-detail"));
  result=await api(a,"/api/research/projects/project-a",{method:"DELETE"}); assert.equal(result.response.status,204); result=await api(a,"/api/research/projects/project-a"); assert.equal(result.response.status,404);
  assert.ok(calls.every(c=>c.auth==="Bearer server-secret"));
  console.log("research-harness-smoke: PASS");
} finally {
  for(const child of children) child.kill();
  await new Promise(resolve=>mock.close(resolve));
  fs.rmSync(temp,{recursive:true,force:true});
}
