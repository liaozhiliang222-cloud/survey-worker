import { parseProjectFile, safeFileName, validateProjectFile } from "../../../lib/project-file-parser.mjs";
import { buildProjectContext, contextLimitsFromEnv } from "../../../lib/project-context.mjs";
import { chunkProjectText, searchProjectChunks } from "../../../lib/project-memory.mjs";
import { compareArtifacts } from "../../../lib/artifact-diff.mjs";
import { isOcrConfigured, requestProjectOcr } from "../../../lib/project-ocr.mjs";

const TYPES = new Set(["research_plan", "questionnaire", "interview_guide", "other"]);
const FILE_CATEGORIES = new Set(["brief", "historical_report", "questionnaire", "interview", "data", "other"]);
const MAX_BODY = 2 * 1024 * 1024;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const clean = (value, max = 100000) => String(value ?? "").trim().slice(0, max);
const pub = (project) => { if (!project) return null; const { user_id, ...safe } = project; return safe; };
const parsedObject = (value) => { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } };
const pubFile = (file, detail = false) => { if (!file) return null; const { user_id, storage_key, parsed_text, structured_data, ...safe } = file; return detail ? { ...safe, structured_data: parsedObject(structured_data), preview: String(parsed_text || "").slice(0, 20_000) } : { ...safe, structure_kind: parsedObject(structured_data).kind || null }; };
const integer = (value, fallback, minimum, maximum) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback; };
const decodedHeader = (value) => { try { return decodeURIComponent(String(value || "")); } catch { return ""; } };

function json(payload, status = 200, requestId = "") {
  return new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID, X-Research-File-Name, X-Research-File-Category",
    ...(requestId ? { "X-Research-Request-ID": requestId } : {}),
  } });
}
function fail(message, type, requestId, retryable = false, status = 400) { return json({ error: { message, type, request_id: requestId, retryable } }, status, requestId); }
function streamError(error, requestId) {
  if(error?.code==="HARNESS_TIMEOUT")return {message:"AI 研究员响应超时，请稍后重试。",type:"harness_timeout",request_id:requestId,retryable:true};
  if(error?.code==="HARNESS_MAX_TOKENS")return {message:"AI 研究员连续达到输出 token 上限，已保留生成内容，请缩短任务或重试。",type:"harness_max_tokens",request_id:requestId,retryable:true};
  if(error?.code==="HARNESS_TOOL_BLOCKED")return {message:"AI 研究员未能按正文模式完成本轮，请重试。",type:"harness_tool_blocked",request_id:requestId,retryable:true};
  if(error?.code==="HARNESS_UPSTREAM"&&error?.status===429)return {message:"AI 研究员模型额度不足，请充值或稍后重试。",type:"harness_quota",request_id:requestId,retryable:true};
  if(error?.code==="HARNESS_UPSTREAM"&&[401,403].includes(error?.status))return {message:"AI 研究员服务认证失败，请联系管理员。",type:"harness_auth",request_id:requestId,retryable:false};
  if(String(error?.code||"").startsWith("HARNESS_"))return {message:"AI 研究员暂时无法连接，请稍后重试。",type:"harness_unavailable",request_id:requestId,retryable:true};
  return {message:"AI 研究员服务暂时不可用，请稍后重试。",type:"internal_error",request_id:requestId,retryable:true};
}
function sseFrame(event, payload) { return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`; }
function sseResponse(runId, requestId, task) {
  const encoder = new TextEncoder(); let controller; let connected = true;
  const stream = new ReadableStream({ start(value) { controller = value; }, cancel() { connected = false; } });
  const emit = (event, payload) => { if (!connected) return; try { controller.enqueue(encoder.encode(sseFrame(event, payload))); } catch { connected = false; } };
  const heartbeat = setInterval(() => emit("progress", { run_id: runId, stage: "heartbeat" }), 10_000);
  emit("start", { run_id: runId, request_id: requestId });
  const completion = Promise.resolve().then(() => task(emit)).finally(() => { clearInterval(heartbeat); if (connected) { try { controller.close(); } catch {} } });
  return { response: new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Research-Request-ID": requestId } }), completion };
}
function requestId(request) { const supplied = clean(request.headers.get("X-Request-ID"), 128); return /^[\w.:-]{8,128}$/.test(supplied) ? supplied : id(); }
function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function accessToken(request) {
  const header = clean(request.headers.get("Cf-Access-Jwt-Assertion"), 20_000);
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}
export async function verifyAccessIdentity(request, env, fetchImpl = fetch) {
  if (String(env.RESEARCH_AUTH_MODE || "").toLowerCase() !== "access") return "";
  const teamDomain = clean(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN, 320).replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const allowedAudiences = clean(env.CLOUDFLARE_ACCESS_AUD, 2_000).split(",").map((item) => item.trim()).filter(Boolean);
  const token = accessToken(request);
  if (!teamDomain || !allowedAudiences.length || !token) return "";
  const sections = token.split(".");
  if (sections.length !== 3) return "";
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(sections[0])));
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(sections[1])));
  } catch { return ""; }
  if (header.alg !== "RS256" || !header.kid) return "";
  const nowSeconds = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const expectedIssuer = `https://${teamDomain}`;
  if (claims.iss !== expectedIssuer || !claims.exp || claims.exp <= nowSeconds || (claims.nbf && claims.nbf > nowSeconds + 30)) return "";
  if (!audiences.some((audience) => allowedAudiences.includes(String(audience)))) return "";
  try {
    const certResponse = await fetchImpl(`${expectedIssuer}/cdn-cgi/access/certs`);
    if (!certResponse.ok) return "";
    const certs = await certResponse.json();
    const jwk = certs?.keys?.find((key) => key.kid === header.kid);
    if (!jwk) return "";
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(sections[2]),
      new TextEncoder().encode(`${sections[0]}.${sections[1]}`),
    );
    if (!valid) return "";
  } catch { return ""; }
  return clean(claims.sub, 320) || clean(claims.email, 320).toLowerCase();
}
export async function resolveResearchIdentity(request, env, fetchImpl = fetch) {
  const mode = clean(env.RESEARCH_AUTH_MODE || "anonymous", 32).toLowerCase();
  if (mode === "anonymous") {
    const workspace = clean(env.RESEARCH_ANONYMOUS_USER_ID || "shared-workspace", 200);
    return `anonymous:${workspace}`;
  }
  if (mode === "access") return verifyAccessIdentity(request, env, fetchImpl);
  return "";
}
async function body(request) {
  const length = Number(request.headers.get("Content-Length") || 0); if (length > MAX_BODY) throw Object.assign(new Error(), { code: "TOO_LARGE" });
  const text = await request.text(); if (new TextEncoder().encode(text).length > MAX_BODY) throw Object.assign(new Error(), { code: "TOO_LARGE" });
  try { return JSON.parse(text || "{}"); } catch { throw Object.assign(new Error(), { code: "INVALID" }); }
}
async function boundedArrayBuffer(request, maximum) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maximum) throw Object.assign(new Error(), { code: "FILE_TOO_LARGE" });
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maximum) { await reader.cancel(); throw Object.assign(new Error(), { code: "FILE_TOO_LARGE" }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined.buffer;
}

function store(db) {
  const first = async (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const run = async (sql, ...args) => db.prepare(sql).bind(...args).run();
  return {
    listProjects: (uid) => all("SELECT * FROM research_projects WHERE user_id=? ORDER BY updated_at DESC", uid),
    getProject: (uid, pid) => first("SELECT * FROM research_projects WHERE user_id=? AND id=?", uid, pid),
    async createProject(uid, input) { const pid = clean(input.client_project_id, 128) || id(); const ts = now(); await run("INSERT INTO research_projects(id,user_id,title,client_name,brief,research_goal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", pid, uid, clean(input.title,200), clean(input.client_name,200), clean(input.brief), clean(input.research_goal), clean(input.status,32)||"active", ts, ts); return this.getProject(uid,pid); },
    async updateProject(uid,pid,input) { const current=await this.getProject(uid,pid); if(!current)return null; for(const key of ["title","client_name","brief","research_goal","status"]) if(Object.prototype.hasOwnProperty.call(input,key)) current[key]=clean(input[key], key==="title"||key==="client_name"?200:key==="status"?32:100000); await run("UPDATE research_projects SET title=?,client_name=?,brief=?,research_goal=?,status=?,updated_at=? WHERE user_id=? AND id=?",current.title,current.client_name,current.brief,current.research_goal,current.status,now(),uid,pid); return this.getProject(uid,pid); },
    deleteProject: (uid,pid) => run("DELETE FROM research_projects WHERE user_id=? AND id=?",uid,pid),
    listMessages: (pid) => all("SELECT * FROM research_messages WHERE project_id=? ORDER BY created_at,COALESCE(reply_to,id),CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END,id",pid),
    async findRequest(pid,rid) { const user=await first("SELECT * FROM research_messages WHERE project_id=? AND role='user' AND client_request_id=?",pid,rid); return user?{user,assistant:await first("SELECT * FROM research_messages WHERE reply_to=?",user.id)}:null; },
    async saveExchange(pid,rid,userText,assistantText) { const existing=await this.findRequest(pid,rid); if(existing)return{...existing,duplicate:true}; const uid=id(),aid=id(); try { await db.batch([db.prepare("INSERT INTO research_messages(id,project_id,role,content,client_request_id,reply_to,created_at) VALUES(?,?,?,?,?,?,?)").bind(uid,pid,"user",userText,rid,null,now()),db.prepare("INSERT INTO research_messages(id,project_id,role,content,client_request_id,reply_to,created_at) VALUES(?,?,?,?,?,?,?)").bind(aid,pid,"assistant",assistantText,null,uid,now()),db.prepare("UPDATE research_projects SET updated_at=? WHERE id=?").bind(now(),pid)]); } catch(error) { const replay=await this.findRequest(pid,rid); if(replay)return{...replay,duplicate:true}; throw error; } return{user:await first("SELECT * FROM research_messages WHERE id=?",uid),assistant:await first("SELECT * FROM research_messages WHERE id=?",aid),duplicate:false}; },
    getRun: (pid,runId) => first("SELECT * FROM research_ai_runs WHERE project_id=? AND id=?",pid,runId),
    getRunByRequest: (pid,rid) => first("SELECT * FROM research_ai_runs WHERE project_id=? AND client_request_id=?",pid,rid),
    async createRun(pid,rid) { const runId=id(),ts=now();await run("INSERT OR IGNORE INTO research_ai_runs(id,project_id,client_request_id,status,partial_content,result,error,created_at,updated_at) VALUES(?,?,?,'queued','','','',?,?)",runId,pid,rid,ts,ts);const item=await this.getRunByRequest(pid,rid);return {run:item,created:item?.id===runId}; },
    async resetFailedRun(pid,runId) { const ts=now();const result=await run("UPDATE research_ai_runs SET status='queued',partial_content='',result='',error='',started_at=NULL,completed_at=NULL,updated_at=? WHERE project_id=? AND id=? AND status='failed'",ts,pid,runId);return {run:await this.getRun(pid,runId),reset:Number(result?.meta?.changes||0)>0}; },
    updateRunPartial: (pid,runId,partial) => run("UPDATE research_ai_runs SET partial_content=?,updated_at=? WHERE project_id=? AND id=? AND status IN ('queued','running')",clean(partial,2097152),now(),pid,runId),
    async updateRun(pid,runId,input) { const current=await this.getRun(pid,runId);if(!current)return null;for(const key of ["status","partial_content","result","error"])if(Object.prototype.hasOwnProperty.call(input,key))current[key]=clean(input[key],key==="partial_content"?2097152:key==="result"?4194304:key==="error"?10000:32);await run("UPDATE research_ai_runs SET status=?,partial_content=?,result=?,error=?,started_at=CASE WHEN ?='running' THEN COALESCE(started_at,?) ELSE started_at END,completed_at=CASE WHEN ? IN ('completed','failed') THEN ? ELSE completed_at END,updated_at=? WHERE project_id=? AND id=?",current.status,current.partial_content,current.result,current.error,current.status,now(),current.status,now(),now(),pid,runId);return this.getRun(pid,runId); },
    getSession: (pid) => first("SELECT * FROM research_agent_sessions WHERE project_id=?",pid),
    async setSession(pid,sid) { const ts=now(); await run("INSERT INTO research_agent_sessions(id,project_id,harness_session_id,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET harness_session_id=excluded.harness_session_id,updated_at=excluded.updated_at",id(),pid,sid,ts,ts); return this.getSession(pid); },
    async acquireProjectLock(pid, owner, leaseMs) { const current=Date.now(),expires=current+leaseMs; await run("INSERT INTO research_project_locks(project_id,owner,expires_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE research_project_locks.expires_at < ?",pid,owner,expires,current); const lock=await first("SELECT owner FROM research_project_locks WHERE project_id=?",pid); return lock?.owner===owner; },
    releaseProjectLock: (pid,owner) => run("DELETE FROM research_project_locks WHERE project_id=? AND owner=?",pid,owner),
    listArtifacts: (pid) => all("SELECT * FROM research_artifacts WHERE project_id=? ORDER BY updated_at DESC",pid),
    getArtifact: (pid,aid) => first("SELECT * FROM research_artifacts WHERE project_id=? AND id=?",pid,aid),
    async createArtifact(pid,input) { const aid=id(),ts=now(),type=clean(input.type,32),parent=clean(input.parent_artifact_id,128)||null; await run("INSERT INTO research_artifacts(id,project_id,parent_artifact_id,type,title,version,content,created_at,updated_at) SELECT ?,?,?,?,?,COALESCE(MAX(version),0)+1,?,?,? FROM research_artifacts WHERE project_id=? AND type=?",aid,pid,parent,type,clean(input.title,300),clean(input.content,2000000),ts,ts,pid,type); return this.getArtifact(pid,aid); },
    async updateArtifact(pid,aid,input) { const item=await this.getArtifact(pid,aid); if(!item)return null; if(Object.prototype.hasOwnProperty.call(input,"title"))item.title=clean(input.title,300); await run("UPDATE research_artifacts SET title=?,updated_at=? WHERE project_id=? AND id=?",item.title,now(),pid,aid); return this.getArtifact(pid,aid); },
    deleteArtifact: (pid,aid) => run("DELETE FROM research_artifacts WHERE project_id=? AND id=?",pid,aid),
    listFiles: (pid) => all("SELECT * FROM research_project_files WHERE project_id=? ORDER BY created_at DESC",pid),
    getFile: (pid,fid) => first("SELECT * FROM research_project_files WHERE project_id=? AND id=?",pid,fid),
    async createFile(uid,pid,input) { const ts=now(); await run("INSERT INTO research_project_files(id,project_id,user_id,file_name,file_type,mime_type,file_size,category,storage_key,parse_status,parsed_text,summary,parse_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'pending','','','',?,?)",input.id,pid,uid,input.file_name,input.file_type,input.mime_type,input.file_size,input.category,input.storage_key,ts,ts); return this.getFile(pid,input.id); },
    async updateFile(pid,fid,input) { const current=await this.getFile(pid,fid);if(!current)return null;for(const key of ["category","parse_status","parsed_text","summary","structured_data","parse_note","ocr_status","ocr_note"])if(Object.prototype.hasOwnProperty.call(input,key))current[key]=clean(input[key],key==="parsed_text"?750000:key==="structured_data"?100000:key==="summary"?10000:key==="parse_note"||key==="ocr_note"?1000:32);await run("UPDATE research_project_files SET category=?,parse_status=?,parsed_text=?,summary=?,structured_data=?,parse_note=?,ocr_status=?,ocr_note=?,updated_at=? WHERE project_id=? AND id=?",current.category,current.parse_status,current.parsed_text,current.summary,current.structured_data||"{}",current.parse_note,current.ocr_status||"not_requested",current.ocr_note||"",now(),pid,fid);return this.getFile(pid,fid); },
    deleteFile: (pid,fid) => run("DELETE FROM research_project_files WHERE project_id=? AND id=?",pid,fid),
    listChunks: (pid) => all("SELECT * FROM research_file_chunks WHERE project_id=? ORDER BY file_id,chunk_index",pid),
    async replaceFileChunks(pid,fid,chunks) { const statements=[db.prepare("DELETE FROM research_file_chunks WHERE project_id=? AND file_id=?").bind(pid,fid)];const ts=now();for(const [index,chunk] of chunks.entries())statements.push(db.prepare("INSERT INTO research_file_chunks(id,project_id,file_id,chunk_index,heading,content,char_count,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id(),pid,fid,Number(chunk.chunk_index??index),clean(chunk.heading,200),clean(chunk.content,8000),Number(chunk.char_count||String(chunk.content||"").length),ts));await db.batch(statements);return chunks;},
    async consumeUsage(key,limit,ttlMs) { if(!limit)return true;const current=Date.now(),expires=current+ttlMs;const row=await first("INSERT INTO research_usage_counters(counter_key,count,expires_at) VALUES(?,1,?) ON CONFLICT(counter_key) DO UPDATE SET count=CASE WHEN research_usage_counters.expires_at<=? THEN 1 ELSE research_usage_counters.count+1 END,expires_at=CASE WHEN research_usage_counters.expires_at<=? THEN excluded.expires_at ELSE research_usage_counters.expires_at END RETURNING count",key,expires,current,current);return Number(row?.count||0)<=limit; },
  };
}
export const createResearchStore = store;

function harness(env) {
  const continuationPrompt="继续上一条因达到输出 token 上限而中断的回答。请从最后一个字符之后直接续写，仅输出尚未完成的剩余正文；不要复述已有内容，不要解释，不要添加‘继续’或‘续写’等前缀。";
  const base=clean(env.HARNESS_BASE_URL).replace(/\/+$/,""); const style=clean(env.HARNESS_API_STYLE||"opencode").toLowerCase(); const selectedSessions=new Set();
  if(!["opencode","dsh-rpc"].includes(style))throw Object.assign(new Error(),{code:"HARNESS_CONFIG"});
  const timeout=(configured=env.HARNESS_TIMEOUT)=>{const value=Number(configured);return Number.isFinite(value)&&value>0?Math.min(300000,Math.max(1,Math.round(value))):120000;};
  const continuationLimit=()=>{const value=Number(env.HARNESS_MAX_CONTINUATIONS);return Number.isFinite(value)?Math.min(5,Math.max(0,Math.round(value))):3;};
  const isMaxTokensReason=(reason)=>String(reason?.kind||"").trim().toLowerCase()==="max-tokens";
  const pollInterval=()=>{const value=Number(env.HARNESS_POLL_INTERVAL);return Number.isFinite(value)&&value>0?Math.min(10000,Math.max(100,Math.round(value))):1000;};
  const basicAuth=()=>{const username=clean(env.HARNESS_USERNAME,320),password=String(env.HARNESS_PASSWORD||"");if(!username||!password)return "";const bytes=new TextEncoder().encode(`${username}:${password}`);let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);return `Basic ${btoa(binary)}`;};
  const failure=(source={})=>{const code=clean(source.code,100).toLowerCase(),status=Number(source.status||source.details?.status||source.details?.error?.status||0);if(status===429||code==="quota"||code.includes("rate-limit"))return Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:429});if([404,410].includes(status)||code.includes("session-not-found")||code.includes("session-removed"))return Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:410});return Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:status||502});};
  async function call(path,payload,rid,maximum=timeout()) { if(!base)throw Object.assign(new Error(),{code:"HARNESS_NOT_CONFIGURED"}); const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,maximum));const headers={"Content-Type":"application/json",Accept:"application/json"};const auth=style==="dsh-rpc"?basicAuth():(clean(env.HARNESS_API_KEY)?`Bearer ${clean(env.HARNESS_API_KEY)}`:"");if(auth)headers.Authorization=auth;try{const response=await fetch(base+path,{method:"POST",headers,body:JSON.stringify(payload),signal:controller.signal});const text=await response.text().catch(()=>"");let data=null;try{data=text?JSON.parse(text):null;}catch{}if(!response.ok)throw Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:response.status});return data;}catch(error){if(error.code)throw error;const timedOut=error.name==="AbortError";console.error(JSON.stringify({event:"research_harness_error",request_id:rid,error_type:timedOut?"timeout":"unreachable"}));throw Object.assign(new Error(),{code:timedOut?"HARNESS_TIMEOUT":"HARNESS_UNREACHABLE"});}finally{clearTimeout(timer);} }
  async function rpc(method,payload,rid,maximum){const envelope=await call(`/api/${encodeURIComponent(method)}`,{type:"client-request",rpcId:id(),method,payload},rid,maximum);if(envelope?.type!=="server-response"||!envelope?.result)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});if(!envelope.result.ok)throw failure(envelope.result.error);return envelope.result.value;}
  async function ensureModel(sid,rid,maximum){const model=clean(env.HARNESS_MODEL,200);const sessionId=clean(sid,320);if(!model||selectedSessions.has(sessionId))return;const payload={sessionId,provider:clean(env.HARNESS_MODEL_PROVIDER||"newapi",100)||"newapi",model};const reasoningEffort=clean(env.HARNESS_REASONING_EFFORT,50);if(reasoningEffort)payload.reasoningEffort=reasoningEffort;await rpc("session.selectModel",payload,rid,maximum);selectedSessions.add(sessionId);}
  const dshReply=(events)=>{const message=events.filter(entry=>entry?.event?.type==="assistant/message").at(-1)?.event?.data?.message?.content;if(Array.isArray(message)){const reply=message.filter(part=>part?.type==="text"&&typeof part.text==="string").map(part=>part.text).join("\n").trim();if(reply)return reply.slice(0,2097152);}return events.filter(entry=>entry?.event?.type==="assistant/chunk").map(entry=>entry.event.data?.chunk).filter(chunk=>typeof chunk?.text==="string").map(chunk=>chunk.text).join("").trim().slice(0,2097152);};
  const interactiveCall=(events)=>events.filter(entry=>entry?.event?.type==="tool/call"&&["ask_user_question","request_user_input"].includes(String(entry.event.data?.name||""))).at(-1)||null;
  async function createDsh(title,rid){const payload={};if(clean(env.HARNESS_CWD))payload.cwd=clean(env.HARNESS_CWD,1000);const created=await rpc("session.create",payload,rid);const sid=clean(created?.sessionId,320);if(!sid)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});const preset=clean(env.HARNESS_AGENT_PRESET||"survey-research",100);if(preset)await rpc("agentPreset.select",{sessionId:sid,agentPreset:preset},rid);await ensureModel(sid,rid);if(clean(title))await rpc("session.rename",{sessionId:sid,title:clean(title,300)},rid);return sid;}
  async function cancelDsh(sid,rid){try{return await rpc("session.cancel",{sessionId:sid},rid,5000);}catch(error){console.error(JSON.stringify({event:"research_harness_cancel_error",request_id:rid,error_type:String(error?.code||"unknown")}));return null;}}
  async function dshState(sid,rid,maximum){const listed=await rpc("session.list",{},rid,maximum);const items=Array.isArray(listed?.items)?listed.items:Array.isArray(listed)?listed:[];const session=items.find(item=>String(item?.sessionId||item?.id||"")===String(sid));if(!session)throw Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:410});return {running:Boolean(session.running),updatedAt:Number(session.updatedAt||0)};}
  async function waitTurnEnd(sid,baseline,rid,deadline){const remaining=()=>Math.max(1,deadline-Date.now());while(Date.now()<deadline){const latest=await rpc("session.history",{sessionId:sid,maxMessages:1},rid,remaining());const events=(Array.isArray(latest?.events)?latest.events:[]).filter(entry=>Number(entry?.event?.seq??-1)>baseline);if(events.some(entry=>entry?.event?.type==="turn/end"))return;await new Promise(resolve=>setTimeout(resolve,Math.min(pollInterval(),remaining())));}throw Object.assign(new Error(),{code:"HARNESS_TIMEOUT"});}
  async function runDshTurn(sid,prompt,rid,deadline,forbidTools){const remaining=()=>Math.max(1,deadline-Date.now());const initial=await dshState(sid,rid,remaining());await rpc("session.prompt",{sessionId:sid,mode:"queue",content:[{type:"text",text:prompt}],clientTimeZone:clean(env.HARNESS_CLIENT_TIME_ZONE||"Asia/Shanghai",100)},rid,remaining());let observedRunning=false,lastHistoryAt=0;while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,Math.min(pollInterval(),remaining())));const state=await dshState(sid,rid,remaining());observedRunning||=state.running;const completed=!state.running&&(observedRunning||state.updatedAt>initial.updatedAt);if(!completed&&Date.now()-lastHistoryAt<10000)continue;lastHistoryAt=Date.now();const latest=await rpc("session.history",{sessionId:sid,maxMessages:1},rid,remaining());const events=Array.isArray(latest?.events)?latest.events:[];const turnEnd=events.filter(entry=>entry?.event?.type==="turn/end").at(-1);const toolCall=forbidTools?events.find(entry=>entry?.event?.type==="tool/call"):null;if(toolCall){if(!turnEnd){await cancelDsh(sid,rid);const baseline=Math.max(-1,...events.map(entry=>Number(entry?.event?.seq??-1)));await waitTurnEnd(sid,baseline,rid,deadline);}return {toolBlocked:true};}if(!turnEnd){const reply=interactiveCall(events)?dshReply(events):"";if(!reply)continue;const cancellation=await cancelDsh(sid,rid);if(cancellation?.accepted)return {reply};continue;}const reason=turnEnd.event.data?.reason;if(reason?.kind==="error")throw failure(reason.error);const reply=dshReply(events);if(!reply)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});return {reply,maxTokens:isMaxTokensReason(reason)};}throw Object.assign(new Error(),{code:"HARNESS_TIMEOUT"});}
  async function sendDsh(sid,prompt,rid,options={}){const deadline=Date.now()+timeout(options.timeoutMs);const remaining=()=>Math.max(1,deadline-Date.now());try{await ensureModel(sid,rid,remaining());const segments=[];let continuationRounds=0,retriedToolCall=false,nextPrompt=prompt;while(Date.now()<deadline){const result=await runDshTurn(sid,nextPrompt,rid,deadline,Boolean(options.forbidTools));if(result.toolBlocked){if(retriedToolCall||continuationRounds>0)throw Object.assign(new Error(),{code:"HARNESS_TOOL_BLOCKED"});retriedToolCall=true;nextPrompt="【强制正文直出重试】上一轮因尝试调用工具已被系统取消。不要调用任何工具，不要创建或读取文件，不要解释执行过程；请基于上一条用户要求，立即在本轮回复正文中给出完整成果。";continue;}segments.push(result.reply);if(!result.maxTokens)return segments.join("").slice(0,2097152);if(continuationRounds>=continuationLimit())throw Object.assign(new Error(),{code:"HARNESS_MAX_TOKENS"});continuationRounds+=1;nextPrompt=continuationPrompt;}throw Object.assign(new Error(),{code:"HARNESS_TIMEOUT"});}catch(error){if(error?.code==="HARNESS_TIMEOUT")await cancelDsh(sid,rid);throw error;}}
  async function openDshMux(rid){
    if(style!=="dsh-rpc")throw Object.assign(new Error(),{code:"HARNESS_STREAM_UNSUPPORTED"});
    const muxUrl=new URL(base);muxUrl.pathname=`${muxUrl.pathname.replace(/\/+$/,"")}/api/events.mux`;muxUrl.search="";muxUrl.hash="";
    let response;try{response=await fetch(muxUrl.toString(),{headers:{Upgrade:"websocket",Authorization:basicAuth()}});}catch{throw Object.assign(new Error(),{code:"HARNESS_UNREACHABLE"});}
    if(response.status!==101||!response.webSocket)throw Object.assign(new Error(),{code:"HARNESS_UPSTREAM",status:response.status||502});
    const socket=response.webSocket;socket.accept();return socket;
  }
  async function sendDshStream(sid,prompt,rid,options={}){
    const deadline=Date.now()+timeout(options.timeoutMs),remaining=()=>Math.max(1,deadline-Date.now());
    await ensureModel(sid,rid,remaining());
    const runAttempt=async(attemptPrompt)=>{
      const socket=await openDshMux(rid);const events=[];let settled=false,timer,toolBlocked=false,endReason=null;
      const completion=new Promise((resolve,reject)=>{
        const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);try{socket.close(1000,"complete");}catch{}error?reject(error):resolve();};
        timer=setTimeout(()=>finish(Object.assign(new Error(),{code:"HARNESS_TIMEOUT"})),remaining());
        socket.addEventListener("message",async ({data})=>{try{
          const envelope=typeof data==="string"?JSON.parse(data):JSON.parse(new TextDecoder().decode(data));const frame=envelope?.payload||{};
          if(frame.type!=="session/event"||String(frame.sessionId||"")!==String(sid))return;
          const event=frame.event;if(!event||typeof event!=="object")return;events.push({event});
          if(event.type==="assistant/chunk"&&typeof event.data?.chunk?.text==="string")options.onDelta?.(event.data.chunk.text);
          if(options.forbidTools&&event.type==="tool/call"&&!toolBlocked){toolBlocked=true;await cancelDsh(sid,rid);}
          if(event.type==="turn/end"){endReason=event.data?.reason||null;if(endReason?.kind==="error")finish(failure(endReason.error));else finish();}
        }catch{ /* Ignore malformed or unrelated mux frames. */ }});
        socket.addEventListener("close",()=>{if(!settled)finish(Object.assign(new Error(),{code:"HARNESS_UNREACHABLE"}));});
        socket.addEventListener("error",()=>finish(Object.assign(new Error(),{code:"HARNESS_UNREACHABLE"})));
      });
      try{await rpc("session.prompt",{sessionId:sid,mode:"queue",content:[{type:"text",text:attemptPrompt}],clientTimeZone:clean(env.HARNESS_CLIENT_TIME_ZONE||"Asia/Shanghai",100)},rid,remaining());await completion;return {reply:dshReply(events),toolBlocked,maxTokens:isMaxTokensReason(endReason)};}
      catch(error){try{socket.close(1011,"aborted");}catch{}throw error;}
    };
    try{const segments=[];let continuationRounds=0,retriedToolCall=false,nextPrompt=prompt;while(Date.now()<deadline){const result=await runAttempt(nextPrompt);if(result.toolBlocked){if(retriedToolCall||continuationRounds>0)throw Object.assign(new Error(),{code:"HARNESS_TOOL_BLOCKED"});retriedToolCall=true;options.onReset?.();nextPrompt="【强制正文直出重试】上一轮因尝试调用工具已被系统取消。不要调用任何工具，不要创建或读取文件，不要解释执行过程；请基于上一条用户要求，立即在本轮回复正文中给出完整成果。";continue;}if(!result.reply)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});segments.push(result.reply);if(!result.maxTokens)return segments.join("").slice(0,2097152);if(continuationRounds>=continuationLimit())throw Object.assign(new Error(),{code:"HARNESS_MAX_TOKENS"});continuationRounds+=1;nextPrompt=continuationPrompt;}throw Object.assign(new Error(),{code:"HARNESS_TIMEOUT"});}
    catch(error){if(error?.code==="HARNESS_TIMEOUT")await cancelDsh(sid,rid);throw error;}
  }
  return { configured:Boolean(base&&(style!=="dsh-rpc"||(clean(env.HARNESS_USERNAME)&&String(env.HARNESS_PASSWORD||"")))), streaming:style==="dsh-rpc", async create(title,rid){if(style==="dsh-rpc")return createDsh(title,rid);const data=await call("/session",{title},rid);const sid=clean(data?.id||data?.session?.id||data?.data?.id);if(!sid)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});return sid;}, async send(sid,prompt,rid,options={}){if(style==="dsh-rpc")return sendDsh(sid,prompt,rid,options);const data=await call(`/session/${encodeURIComponent(sid)}/message`,{parts:[{type:"text",text:prompt}]},rid,options.timeoutMs?timeout(options.timeoutMs):undefined);const parts=data?.parts||data?.message?.parts||data?.data?.parts||data?.data?.message?.parts;const reply=Array.isArray(parts)?parts.filter(part=>part?.type==="text"&&typeof part.text==="string").map(part=>part.text).join("\n").trim():"";if(!reply)throw Object.assign(new Error(),{code:"HARNESS_BAD_RESPONSE"});return reply.slice(0,2097152);}, stream(sid,prompt,rid,options={}){return sendDshStream(sid,prompt,rid,options);} };
}
export const createHarnessClient = harness;
function publicRun(run){if(!run)return null;return {id:run.id,project_id:run.project_id,client_request_id:run.client_request_id,status:run.status,partial_content:run.partial_content||"",result:run.result?parsedObject(run.result):null,error:run.error?parsedObject(run.error):null,created_at:run.created_at,started_at:run.started_at||null,completed_at:run.completed_at||null,updated_at:run.updated_at};}
function runStaleMs(env){const normal=integer(env.HARNESS_TIMEOUT,120000,1,300000),long=integer(env.HARNESS_LONG_TASK_TIMEOUT,180000,1,300000);return Math.max(normal,long)*2+60000;}
async function checkedRun(repo,env,pid,runId,rid){let run=await repo.getRun(pid,runId);if(run&&["queued","running"].includes(run.status)&&Date.now()-Date.parse(run.updated_at)>runStaleMs(env)){await repo.updateRun(pid,run.id,{status:"failed",error:JSON.stringify({message:"后台任务已超时，可安全重试。",type:"run_stale",request_id:rid,retryable:true})});run=await repo.getRun(pid,run.id);}return run;}
async function hashText(value){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value||"")));return [...new Uint8Array(digest)].map(item=>item.toString(16).padStart(2,"0")).join("");}
async function usageKey(uid,request){const source=uid.startsWith("anonymous:")?`${uid}:${request.headers.get("CF-Connecting-IP")||"unknown"}`:uid;return hashText(source);}
async function checkUsage(repo,uid,request,env){const key=await usageKey(uid,request);const minute=integer(env.RESEARCH_AI_REQUESTS_PER_MINUTE,12,0,10000),day=integer(env.RESEARCH_AI_REQUESTS_PER_DAY,500,0,1000000);if(!await repo.consumeUsage(`minute:${key}:${Math.floor(Date.now()/60000)}`,minute,120000)||!await repo.consumeUsage(`day:${key}:${Math.floor(Date.now()/86400000)}`,day,172800000))throw Object.assign(new Error(),{code:"RATE_LIMIT"});}
async function parseStoredFile(repo,env,file,bytes){await repo.updateFile(file.project_id,file.id,{parse_status:"processing",parse_note:""});try{const source=bytes||await (await env.RESEARCH_FILES.get(file.storage_key))?.arrayBuffer();if(!source)throw Object.assign(new Error(),{code:"FILE_STORAGE_MISSING"});const parsed=await parseProjectFile(source,{extension:file.file_type,fileName:file.file_name,maxParsedChars:env.RESEARCH_MAX_PARSED_CHARS,summaryChars:env.RESEARCH_FILE_SUMMARY_CHARS});await repo.updateFile(file.project_id,file.id,{parse_status:parsed.status,parsed_text:parsed.parsedText,summary:parsed.summary,structured_data:JSON.stringify(parsed.structuredData||{}),parse_note:parsed.parseNote,ocr_status:"not_requested",ocr_note:""});await repo.replaceFileChunks(file.project_id,file.id,parsed.status==="completed"?chunkProjectText(parsed.parsedText,{targetChars:env.RESEARCH_MEMORY_CHUNK_CHARS,overlapChars:env.RESEARCH_MEMORY_CHUNK_OVERLAP,maxChunks:env.RESEARCH_MAX_CHUNKS_PER_FILE}):[]);}catch(error){console.error(JSON.stringify({event:"research_file_parse_error",file_id:file.id,error_type:error.code||error.message||"parse_failed"}));await repo.updateFile(file.project_id,file.id,{parse_status:"failed",parsed_text:"",summary:"",parse_note:"文件解析失败，请检查文件是否损坏。"});await repo.replaceFileChunks(file.project_id,file.id,[]);}}
async function runFileOcr(repo,env,file){await repo.updateFile(file.project_id,file.id,{ocr_status:"processing",ocr_note:"OCR 处理中。"});try{const source=await (await env.RESEARCH_FILES.get(file.storage_key))?.arrayBuffer();if(!source)throw Object.assign(new Error(),{code:"FILE_STORAGE_MISSING"});const result=await requestProjectOcr({env,file,bytes:source});const text=clean(result.text,integer(env.RESEARCH_MAX_PARSED_CHARS,250000,2000,750000));await repo.updateFile(file.project_id,file.id,{parse_status:"completed",parsed_text:text,summary:text.slice(0,integer(env.RESEARCH_FILE_SUMMARY_CHARS,2000,300,8000)),parse_note:"文本由外部 OCR 服务提取。",ocr_status:"completed",ocr_note:`已通过 ${result.provider} 完成 OCR。`});await repo.replaceFileChunks(file.project_id,file.id,chunkProjectText(text,{targetChars:env.RESEARCH_MEMORY_CHUNK_CHARS,overlapChars:env.RESEARCH_MEMORY_CHUNK_OVERLAP,maxChunks:env.RESEARCH_MAX_CHUNKS_PER_FILE}));}catch(error){console.error(JSON.stringify({event:"research_file_ocr_error",file_id:file.id,error_type:error.code||error.message||"ocr_failed"}));await repo.updateFile(file.project_id,file.id,{ocr_status:"failed",ocr_note:"OCR 未完成，请检查外部 OCR 服务配置后重试。"});}}
async function projectChunks(repo,env,pid,files){const existing=await repo.listChunks(pid),indexed=new Set(existing.map(chunk=>String(chunk.file_id)));for(const file of files){if(indexed.has(String(file.id))||file.parse_status!=="completed"||!clean(file.parsed_text))continue;const saved=await repo.replaceFileChunks(pid,file.id,chunkProjectText(file.parsed_text,{targetChars:env.RESEARCH_MEMORY_CHUNK_CHARS,overlapChars:env.RESEARCH_MEMORY_CHUNK_OVERLAP,maxChunks:env.RESEARCH_MAX_CHUNKS_PER_FILE}));existing.push(...saved);indexed.add(String(file.id));}return existing;}

export async function onRequest(context) {
  const {request,env}=context;const waitUntil=(promise)=>typeof context.waitUntil==="function"?context.waitUntil(promise):promise;
  const rid = requestId(request); const started = Date.now();
  const log = (status, outcome, extra = {}) => console.log(JSON.stringify({ event: "research_api", request_id: rid, method: request.method, status, outcome, duration_ms: Date.now() - started, ...extra }));
  if (request.method === "OPTIONS") return json(null, 204, rid);
  const authMode = clean(env.RESEARCH_AUTH_MODE || "anonymous", 32).toLowerCase();
  const accessConfigured = clean(env.CLOUDFLARE_ACCESS_TEAM_DOMAIN, 320) && clean(env.CLOUDFLARE_ACCESS_AUD, 2000);
  if (authMode === "access" && !accessConfigured) return fail("AI 研究员登录验证尚未配置。", "auth_not_configured", rid, false, 503);
  const uid = await resolveResearchIdentity(request, env);
  if (!uid) return authMode === "access" ? fail("请先登录后再使用 AI 研究员。", "unauthorized", rid, false, 401) : fail("AI 研究员身份模式配置无效。", "auth_not_configured", rid, false, 503);
  if (!env.RESEARCH_DB) return fail("AI 研究员数据库尚未配置。", "not_configured", rid, false, 503);
  const repo = store(env.RESEARCH_DB); const agent = harness(env);
  const requestUrl = new URL(request.url);
  const segments = requestUrl.pathname.replace(/^\/api\/research\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const isFileUpload = segments.length === 3 && segments[2] === "files" && request.method === "POST";
  try {
    let input = {};
    if (["POST", "PATCH"].includes(request.method) && !isFileUpload) input = await body(request);
    if (segments[0] !== "projects") return fail("Not found", "not_found", rid, false, 404);
    if (segments.length === 1 && request.method === "GET") return json({ projects: (await repo.listProjects(uid)).map(pub) }, 200, rid);
    if (segments.length === 1 && request.method === "POST") {
      if (!clean(input.title)) return fail("项目名称不能为空。", "invalid_request", rid);
      try { return json({ project: pub(await repo.createProject(uid, input)) }, 201, rid); }
      catch (error) { if (/unique|constraint/i.test(error.message)) return fail("项目标识已存在。", "conflict", rid, false, 409); throw error; }
    }
    const pid = segments[1]; const project = await repo.getProject(uid, pid);
    if (!project) return fail("项目不存在。", "not_found", rid, false, 404);
    if (segments.length === 2 && request.method === "GET") return json({ project: pub(project) }, 200, rid);
    if (segments.length === 2 && request.method === "PATCH") return json({ project: pub(await repo.updateProject(uid, pid, input)) }, 200, rid);
    if (segments.length === 2 && request.method === "DELETE") {
      const files = await repo.listFiles(pid);
      if (files.length && !env.RESEARCH_FILES) return fail("项目文件存储尚未配置。", "file_storage_not_configured", rid, false, 503);
      if (files.length) await env.RESEARCH_FILES.delete(files.map((file) => file.storage_key));
      await repo.deleteProject(uid, pid); return json(null, 204, rid);
    }

    if (segments.length === 3 && segments[2] === "files" && request.method === "GET") return json({ files: (await repo.listFiles(pid)).map((file) => pubFile(file)) }, 200, rid);
    if (isFileUpload) {
      if (!env.RESEARCH_FILES) return fail("项目文件存储尚未配置。", "file_storage_not_configured", rid, false, 503);
      const maximum = integer(env.RESEARCH_MAX_FILE_BYTES, 10 * 1024 * 1024, 1024, 25 * 1024 * 1024);
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > maximum) return fail("文件过大。", "file_too_large", rid, false, 413);
      const currentFiles = await repo.listFiles(pid); const fileLimit = integer(env.RESEARCH_MAX_FILES_PER_PROJECT, 30, 1, 200);
      if (currentFiles.length >= fileLimit) return fail(`每个项目最多上传 ${fileLimit} 个文件。`, "file_limit", rid, false, 409);
      const bytes = await boundedArrayBuffer(request, maximum);
      const validation = validateProjectFile({ fileName: decodedHeader(request.headers.get("X-Research-File-Name")), mimeType: request.headers.get("Content-Type"), size: bytes.byteLength, maxBytes: maximum });
      if (!validation.ok) return fail(validation.message, validation.code.toLowerCase(), rid, false, validation.code === "FILE_TOO_LARGE" ? 413 : 400);
      const requestedCategory = clean(request.headers.get("X-Research-File-Category"), 32);
      const category = FILE_CATEGORIES.has(requestedCategory) ? requestedCategory : "other";
      const fileId = id(); const projectScope = (await hashText(pid)).slice(0, 24); const storageKey = `research/${projectScope}/${fileId}.${validation.extension}`;
      await env.RESEARCH_FILES.put(storageKey, bytes, { httpMetadata: { contentType: validation.mimeType }, customMetadata: { projectId: pid, fileId } });
      let file;
      try { file = await repo.createFile(uid, pid, { id: fileId, file_name: safeFileName(validation.fileName), file_type: validation.extension, mime_type: validation.mimeType, file_size: bytes.byteLength, category, storage_key: storageKey }); }
      catch (error) { await env.RESEARCH_FILES.delete(storageKey); throw error; }
      waitUntil(parseStoredFile(repo, env, file, bytes));
      return json({ file: pubFile(file) }, 201, rid);
    }
    if (segments.length === 4 && segments[2] === "files" && request.method === "GET") {
      const file = await repo.getFile(pid, segments[3]); return file ? json({ file: pubFile(file, true) }, 200, rid) : fail("文件不存在。", "not_found", rid, false, 404);
    }
    if (segments.length === 5 && segments[2] === "files" && segments[4] === "structure" && request.method === "GET") { const file=await repo.getFile(pid,segments[3]);return file?json({file_id:file.id,file_name:file.file_name,structure:parsedObject(file.structured_data)},200,rid):fail("文件不存在。","not_found",rid,false,404); }
    if (segments.length === 4 && segments[2] === "files" && request.method === "PATCH") {
      const category = clean(input.category, 32); if (!FILE_CATEGORIES.has(category)) return fail("文件分类无效。", "invalid_request", rid);
      const file = await repo.updateFile(pid, segments[3], { category }); return file ? json({ file: pubFile(file) }, 200, rid) : fail("文件不存在。", "not_found", rid, false, 404);
    }
    if (segments.length === 4 && segments[2] === "files" && request.method === "DELETE") {
      const file = await repo.getFile(pid, segments[3]); if (!file) return fail("文件不存在。", "not_found", rid, false, 404);
      if (!env.RESEARCH_FILES) return fail("项目文件存储尚未配置。", "file_storage_not_configured", rid, false, 503);
      await env.RESEARCH_FILES.delete(file.storage_key); await repo.deleteFile(pid, file.id); return json(null, 204, rid);
    }
    if (segments.length === 5 && segments[2] === "files" && segments[4] === "reparse" && request.method === "POST") {
      const file = await repo.getFile(pid, segments[3]); if (!file) return fail("文件不存在。", "not_found", rid, false, 404);
      if (!env.RESEARCH_FILES) return fail("项目文件存储尚未配置。", "file_storage_not_configured", rid, false, 503);
      await repo.updateFile(pid, file.id, { parse_status: "pending", parse_note: "等待重新解析。" });
      waitUntil(parseStoredFile(repo, env, file)); return json({ file: pubFile(await repo.getFile(pid, file.id)) }, 202, rid);
    }
    if (segments.length === 5 && segments[2] === "files" && segments[4] === "ocr" && request.method === "POST") { const file=await repo.getFile(pid,segments[3]);if(!file)return fail("文件不存在。","not_found",rid,false,404);if(!env.RESEARCH_FILES)return fail("项目文件存储尚未配置。","file_storage_not_configured",rid,false,503);if(!isOcrConfigured(env))return fail("外部 OCR 服务尚未配置。","ocr_not_configured",rid,false,503);if(file.file_type!=="pdf")return fail("当前仅对 PDF 提供按需 OCR。","ocr_unsupported",rid);await repo.updateFile(pid,file.id,{ocr_status:"processing",ocr_note:"OCR 已进入处理队列。"});waitUntil(runFileOcr(repo,env,file));return json({file:pubFile(await repo.getFile(pid,file.id))},202,rid); }
    if (segments.length === 4 && segments[2] === "memory" && segments[3] === "search" && request.method === "GET") { const query=clean(requestUrl.searchParams.get("q"),500);if(!query)return fail("请输入检索词。","invalid_request",rid);const files=await repo.listFiles(pid);const matches=searchProjectChunks(await projectChunks(repo,env,pid,files),files,query,{limit:integer(requestUrl.searchParams.get("limit"),8,1,12)}).map(item=>({...item,content:clean(item.content,1600)}));return json({query,matches},200,rid); }

    if (segments.length === 3 && segments[2] === "messages" && request.method === "GET") return json({ messages: await repo.listMessages(pid) }, 200, rid);
    if (segments.length === 4 && segments[2] === "runs" && request.method === "GET") { const run=await checkedRun(repo,env,pid,segments[3],rid);return run?json({run:publicRun(run)},200,rid):fail("运行记录不存在。","not_found",rid,false,404); }
    if (segments.length === 3 && segments[2] === "messages" && request.method === "POST") {
      const wantsStream=(request.headers.get("Accept")||"").toLowerCase().includes("text/event-stream");
      const message = clean(input.message, 200000); if (!message) return fail("消息内容不能为空。", "invalid_request", rid);
      const crid = clean(input.client_request_id, 128) || id();
      const replay = await repo.findRequest(pid, crid);
      if (replay?.assistant) {
        const payload={ message: replay.assistant, user_message: replay.user, reply: replay.assistant.content, client_request_id: crid, idempotent_replay: true };
        if(!wantsStream)return json(payload,200,rid);const prior=await repo.getRunByRequest(pid,crid);const streamed=sseResponse(prior?.id||crid,rid,async emit=>emit("done",{...payload,run_id:prior?.id||null}));waitUntil(streamed.completion);return streamed.response;
      }
      const requestedFileIds = Array.isArray(input.selected_file_ids) ? [...new Set(input.selected_file_ids.map((value) => clean(value, 128)).filter(Boolean))] : [];
      const maxSelected = integer(env.RESEARCH_MAX_SELECTED_FILES, 8, 1, 12);
      if (requestedFileIds.length > maxSelected) return fail(`每次最多选择 ${maxSelected} 个文件作为上下文。`, "invalid_request", rid);
      const allFiles = await repo.listFiles(pid); const selectedFiles = requestedFileIds.map((fileId) => allFiles.find((file) => file.id === fileId)).filter(Boolean);
      if (selectedFiles.length !== requestedFileIds.length) return fail("所选项目文件不存在。", "not_found", rid, false, 404);
      let artifact = null;
      if (input.artifact_id) { artifact = await repo.getArtifact(pid, clean(input.artifact_id, 128)); if (!artifact) return fail("成果不存在。", "not_found", rid, false, 404); }
      const priorRecord=await repo.getRunByRequest(pid,crid);const priorRun=priorRecord?await checkedRun(repo,env,pid,priorRecord.id,rid):null;let retriedRun=null;
      if(priorRun){
        if(priorRun.status==="failed"){const reset=await repo.resetFailedRun(pid,priorRun.id);if(reset.reset)retriedRun=reset.run;else{const current=reset.run;if(!wantsStream)return json({run:publicRun(current),client_request_id:crid,idempotent_replay:true},202,rid);const streamed=sseResponse(current.id,rid,async emit=>{let item=current;while(["queued","running"].includes(item.status)){emit("progress",{run_id:item.id,stage:item.status,partial_content:item.partial_content||""});await new Promise(resolve=>setTimeout(resolve,1000));item=await checkedRun(repo,env,pid,item.id,rid);}if(item.status==="completed")emit("done",{...parsedObject(item.result),run_id:item.id,idempotent_replay:true});else emit("error",{run_id:item.id,error:parsedObject(item.error)});});waitUntil(streamed.completion);return streamed.response;}}
        else {if(!wantsStream)return json({run:publicRun(priorRun),client_request_id:crid,idempotent_replay:true},priorRun.status==="completed"?200:202,rid);const streamed=sseResponse(priorRun.id,rid,async emit=>{let current=priorRun;while(["queued","running"].includes(current.status)){emit("progress",{run_id:current.id,stage:current.status,partial_content:current.partial_content||""});await new Promise(resolve=>setTimeout(resolve,1000));current=await checkedRun(repo,env,pid,current.id,rid);}if(current.status==="completed")emit("done",{...(parsedObject(current.result)),run_id:current.id,idempotent_replay:true});else emit("error",{run_id:current.id,error:parsedObject(current.error)});});waitUntil(streamed.completion);return streamed.response;}
      }
      await checkUsage(repo, uid, request, env);
      const createdRun=retriedRun?{run:retriedRun,created:true}:await repo.createRun(pid,crid);
      if(!createdRun.created){const current=createdRun.run;if(!wantsStream)return json({run:publicRun(current),client_request_id:crid,idempotent_replay:true},202,rid);const streamed=sseResponse(current.id,rid,async emit=>{let item=current;while(["queued","running"].includes(item.status)){emit("progress",{run_id:item.id,stage:item.status,partial_content:item.partial_content||""});await new Promise(resolve=>setTimeout(resolve,1000));item=await checkedRun(repo,env,pid,item.id,rid);}if(item.status==="completed")emit("done",{...parsedObject(item.result),run_id:item.id,idempotent_replay:true});else emit("error",{run_id:item.id,error:parsedObject(item.error)});});waitUntil(streamed.completion);return streamed.response;}
      const runId=createdRun.run.id;
      const configuredTimeout = Number(env.HARNESS_TIMEOUT); const boundedTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.min(300000, configuredTimeout) : 120000;
      const configuredLongTimeout = Number(env.HARNESS_LONG_TASK_TIMEOUT); const boundedLongTimeout = Number.isFinite(configuredLongTimeout) && configuredLongTimeout > 0 ? Math.min(300000, configuredLongTimeout) : 180000;
      const leaseMs = Math.max(boundedTimeout,boundedLongTimeout) * 3 + 60000; const lockOwner = id();
      if (!await repo.acquireProjectLock(pid, lockOwner, leaseMs)) { await repo.updateRun(pid,runId,{status:"failed",error:JSON.stringify({message:"AI 研究员正在处理该项目的上一条消息，请稍后重试。",type:"project_busy",request_id:rid,retryable:true})});return fail("AI 研究员正在处理该项目的上一条消息，请稍后重试。", "project_busy", rid, true, 409); }
      let partial="",partialWrites=Promise.resolve();const execute=async(emit=()=>{})=>{try {
        await repo.updateRun(pid,runId,{status:"running"});emit("progress",{run_id:runId,stage:"preparing"});
        const lockedReplay = await repo.findRequest(pid, crid);
        if (lockedReplay?.assistant) { const result={message:lockedReplay.assistant,user_message:lockedReplay.user,reply:lockedReplay.assistant.content,client_request_id:crid,idempotent_replay:true,run_id:runId};await repo.updateRun(pid,runId,{status:"completed",partial_content:result.reply,result:JSON.stringify(result)});return result; }
        const recentMessages = await repo.listMessages(pid);
        const retrievedChunks=input.auto_retrieve===false?[]:searchProjectChunks(await projectChunks(repo,env,pid,allFiles),allFiles,clean(input.context_query,500)||message,{excludeFileIds:requestedFileIds,limit:integer(env.RESEARCH_MAX_RETRIEVED_CHUNKS,5,1,12)});
        const buildPrompt = (includeRecentMessages) => buildProjectContext({ project, files: selectedFiles, retrievedChunks, artifact, recentMessages, userMessage: message, taskType: input.task_type, includeRecentMessages, limits: contextLimitsFromEnv(env) });
        let session = await repo.getSession(pid); let recreated = false;
        if (!session) { session = await repo.setSession(pid, await agent.create(project.title, rid)); recreated = true; }
        let built = buildPrompt(recreated); let reply; const sendOptions=()=>({forbidTools:Boolean(built.context.direct_reply_only),timeoutMs:built.context.direct_reply_only?boundedLongTimeout:boundedTimeout});
        let lastPartialWrite=0;const persistPartial=(snapshot)=>{partialWrites=partialWrites.then(()=>repo.updateRunPartial(pid,runId,snapshot)).catch(()=>{});};const onDelta=(text)=>{partial=(partial+text).slice(0,2097152);emit("delta",{run_id:runId,text});const timestamp=Date.now();if(timestamp-lastPartialWrite>=1000){lastPartialWrite=timestamp;persistPartial(partial);}};const onReset=()=>{partial="";lastPartialWrite=Date.now();emit("progress",{run_id:runId,stage:"retrying",partial_content:""});persistPartial("");};
        emit("progress",{run_id:runId,stage:"generating"});
        try { reply = wantsStream&&agent.streaming?await agent.stream(session.harness_session_id,built.prompt,rid,{...sendOptions(),onDelta,onReset}):await agent.send(session.harness_session_id, built.prompt, rid, sendOptions()); }
        catch (error) {
          if (!recreated && error.code === "HARNESS_UPSTREAM" && [404, 410].includes(error.status)) {
            session = await repo.setSession(pid, await agent.create(project.title, rid)); recreated = true; built = buildPrompt(true); reply = wantsStream&&agent.streaming?await agent.stream(session.harness_session_id,built.prompt,rid,{...sendOptions(),onDelta,onReset}):await agent.send(session.harness_session_id, built.prompt, rid, sendOptions());
          } else throw error;
        }
        await partialWrites;
        const saved = await repo.saveExchange(pid, crid, message, reply);
        const result={ message: saved.assistant, user_message: saved.user, reply: saved.assistant.content, client_request_id: crid, idempotent_replay: saved.duplicate, session_recreated: recreated, applied_context: built.context, run_id:runId };
        await repo.updateRun(pid,runId,{status:"completed",partial_content:result.reply,result:JSON.stringify(result),error:""});return result;
      }catch(error){await partialWrites;const safe=streamError(error,rid);await repo.updateRun(pid,runId,{status:"failed",partial_content:partial,error:JSON.stringify(safe)});throw error;}finally{await repo.releaseProjectLock(pid,lockOwner);}};
      if(wantsStream){const streamed=sseResponse(runId,rid,async emit=>{try{const result=await execute(emit);emit("done",result);}catch(error){emit("error",{run_id:runId,error:streamError(error,rid)});}});waitUntil(streamed.completion);return streamed.response;}
      return json(await execute(),200,rid);
    }

    if (segments.length === 3 && segments[2] === "artifacts" && request.method === "GET") return json({ artifacts: await repo.listArtifacts(pid) }, 200, rid);
    if (segments.length === 5 && segments[2] === "artifacts" && segments[4] === "compare" && request.method === "GET") { const target=await repo.getArtifact(pid,segments[3]);if(!target)return fail("成果不存在。","not_found",rid,false,404);const baseId=clean(requestUrl.searchParams.get("with")||target.parent_artifact_id,128);const base=baseId?await repo.getArtifact(pid,baseId):null;if(!base)return fail("该成果没有可对比的父版本。","comparison_unavailable",rid,false,409);return json({comparison:compareArtifacts(base,target)},200,rid); }
    if (segments.length === 3 && segments[2] === "artifacts" && request.method === "POST") {
      if (!TYPES.has(input.type) || !clean(input.title) || !clean(input.content)) return fail("成果类型、标题或内容无效。", "invalid_request", rid);
      if (input.parent_artifact_id) { const parent = await repo.getArtifact(pid, clean(input.parent_artifact_id, 128)); if (!parent || parent.type !== input.type) return fail("父版本成果不存在或类型不一致。", "not_found", rid, false, 404); }
      return json({ artifact: await repo.createArtifact(pid, input) }, 201, rid);
    }
    if (segments.length === 4 && segments[2] === "artifacts" && request.method === "PATCH") { const artifactItem = await repo.updateArtifact(pid, segments[3], input); return artifactItem ? json({ artifact: artifactItem }, 200, rid) : fail("成果不存在。", "not_found", rid, false, 404); }
    if (segments.length === 4 && segments[2] === "artifacts" && request.method === "DELETE") { const existing = await repo.getArtifact(pid, segments[3]); if (!existing) return fail("成果不存在。", "not_found", rid, false, 404); await repo.deleteArtifact(pid, segments[3]); return json(null, 204, rid); }
    return fail("Method not allowed", "method_not_allowed", rid, false, 405);
  } catch (error) {
    let response;
    if (error.code === "TOO_LARGE") response = fail("请求内容过大。", "invalid_request", rid, false, 413);
    else if (error.code === "FILE_TOO_LARGE") response = fail("文件过大。", "file_too_large", rid, false, 413);
    else if (error.code === "INVALID") response = fail("请求内容无效。", "invalid_request", rid);
    else if (error.code === "RATE_LIMIT") response = fail("AI 研究员请求过于频繁，请稍后再试。", "rate_limited", rid, true, 429);
    else if (error.code === "HARNESS_TIMEOUT") response = fail("AI 研究员响应超时，请稍后重试。", "harness_timeout", rid, true, 504);
    else if (error.code === "HARNESS_MAX_TOKENS") response = fail("AI 研究员连续达到输出 token 上限，已保留生成内容，请缩短任务或重试。", "harness_max_tokens", rid, true, 502);
    else if (error.code === "HARNESS_TOOL_BLOCKED") response = fail("AI 研究员未能按正文模式完成本轮，请重试。", "harness_tool_blocked", rid, true, 502);
    else if (error.code === "HARNESS_NOT_CONFIGURED") response = fail("AI 研究员尚未完成配置，请联系管理员。", "harness_not_configured", rid, false, 503);
    else if (error.code === "HARNESS_UPSTREAM" && error.status === 429) response = fail("AI 研究员模型额度不足，请充值或稍后重试。", "harness_quota", rid, true, 429);
    else if (error.code === "HARNESS_UPSTREAM" && [401, 403].includes(error.status)) response = fail("AI 研究员服务认证失败，请联系管理员。", "harness_auth", rid, false, 502);
    else if (String(error.code || "").startsWith("HARNESS_")) response = fail("AI 研究员暂时无法连接，请稍后重试。", "harness_unavailable", rid, true, 502);
    else response = fail("AI 研究员服务暂时不可用，请稍后重试。", "internal_error", rid, true, 500);
    log(response.status, "error", { error_type: error.code || "internal" }); return response;
  }
}
