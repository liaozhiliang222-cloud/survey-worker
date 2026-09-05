import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest,createResearchStore} from '../functions/api/research/[[path]].js';
const db=new DatabaseSync(':memory:');
for(const f of fs.readdirSync('migrations').filter(f=>/^\d{4}.*sql$/.test(f)).sort())db.exec(fs.readFileSync('migrations/'+f,'utf8'));
const bind=(sql,args=[])=>({async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:db.prepare(sql).run(...args)};}});
const d1={prepare(sql){return {...bind(sql),bind(...args){return bind(sql,args);}};},async batch(items){const r=[];for(const i of items)r.push(await i.run());return r;}};
const repo=createResearchStore(d1),project=await repo.createProject('anonymous:r3',{title:'人工 HTTP 断流验收'});
await repo.setSession(project.id,'sse-session');
let socket,calls=0;let release;const barrier=new Promise(r=>release=r);
class Socket extends EventTarget {accept(){}close(){this.dispatchEvent(new Event('close'));}event(event){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'server-request',payload:{type:'session/event',sessionId:'sse-session',event}})}));}}
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=String(input);if(!url.startsWith('https://r3-harness.test'))return originalFetch(input,init);
 if(url.endsWith('/api/events.mux')){socket=new Socket();return {status:101,webSocket:socket};}
 const body=JSON.parse(init.body);let value={};
 if(body.method==='session.list')value={items:[{sessionId:'sse-session',running:false,agentPreset:'test'}]};
 if(body.method==='session.prompt'){
  calls++;value={accepted:true};
  setTimeout(async()=>{socket.event({type:'assistant/chunk',data:{chunk:{type:'text',text:'已生成的前半段。'}}});await barrier;socket.event({type:'assistant/chunk',data:{chunk:{type:'text',text:'断开后完成的后半段。'}}});socket.event({type:'turn/end',data:{reason:{kind:'completed'}}});},10);
 }
 return new Response(JSON.stringify({type:'server-response',result:{ok:true,value}}));
};
const pending=[];
const env={RESEARCH_DB:d1,RESEARCH_ANONYMOUS_USER_ID:'r3',HARNESS_BASE_URL:'https://r3-harness.test',HARNESS_API_STYLE:'dsh-rpc',HARNESS_USERNAME:'test',HARNESS_PASSWORD:'test',HARNESS_AGENT_PRESET:'test',HARNESS_TIMEOUT:'5000'};
const server=http.createServer(async(req,res)=>{
 try{let raw='';for await(const c of req)raw+=c;const response=await onRequest({env,request:new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(raw?{body:raw}:{})}),waitUntil:p=>pending.push(p)});
 res.writeHead(response.status,Object.fromEntries(response.headers));const reader=response.body.getReader();res.on('close',()=>reader.cancel().catch(()=>{}));
 while(!res.destroyed){const {done,value}=await reader.read();if(done)break;res.write(value);}res.end();
 }catch(e){res.destroy(e);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/api/research/projects/${project.id}/messages`;
const body=JSON.stringify({message:'人工测试，生成两段说明',client_request_id:'r3-disconnect'});
try {
 const response=await originalFetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body});assert.equal(response.status,200);
 const reader=response.body.getReader();let text='';
 while(!text.includes('已生成的前半段')){const {value,done}=await reader.read();assert.ok(!done);text+=new TextDecoder().decode(value);}
 await reader.cancel();
 await new Promise(r=>setTimeout(r,30));
 const run=db.prepare('SELECT * FROM research_ai_runs WHERE project_id=?').get(project.id);assert.match(run.partial_content,/已生成的前半段/);
 release();await Promise.all(pending);
 const replay=await originalFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body});const result=await replay.json();assert.equal(result.idempotent_replay,true);
 const messages=await repo.listMessages(project.id);assert.equal(messages.length,2);assert.equal(calls,1);assert.equal(messages.find(m=>m.role==='assistant').content,'已生成的前半段。断开后完成的后半段。');
 console.log('R3 actual HTTP disconnect: partial persisted, background completion, idempotent replay passed.');
} finally {release();await Promise.allSettled(pending);globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
