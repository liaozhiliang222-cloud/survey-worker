import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const wrangler=path.resolve(process.env.R2_WRANGLER_JS || path.join(root,'.data/r1-wrangler/node_modules/wrangler/bin/wrangler.js'));
assert.ok(fs.existsSync(wrangler),'Set R2_WRANGLER_JS to an installed Wrangler CLI');
const directory=path.join(root,'.data',`r2-native-${Date.now()}`);fs.mkdirSync(directory,{recursive:true});
const config=path.join(directory,'wrangler.json'),state=path.join(directory,'state');
fs.writeFileSync(config,JSON.stringify({name:'surveykit-r2-native',main:path.join(root,'tests/fixtures/r2/native-worker.mjs'),compatibility_date:'2026-09-05',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'RESEARCH_DB',database_name:'r2-native',database_id:'00000000-0000-0000-0000-000000000000',migrations_dir:path.join(root,'migrations')}],r2_buckets:[{binding:'RESEARCH_FILES',bucket_name:'r2-native'}]}));
const migration=spawnSync(process.execPath,[wrangler,'d1','migrations','apply','r2-native','--local','--config',config,'--persist-to',state],{cwd:root,encoding:'utf8',timeout:120000,windowsHide:true});
fs.writeFileSync(path.join(directory,'migrations.log'),migration.stdout+migration.stderr);assert.equal(migration.status,0,'Native migrations failed');
const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const child=spawn(process.execPath,[wrangler,'dev','--local','--config',config,'--persist-to',state,'--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',b=>{log+=b;});child.stderr.on('data',b=>{log+=b;});
try {
  let ready=false;
  for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error('Native Worker exited');try {const r=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(500)});await r.text();ready=true;break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'Native Worker startup timed out');
  const response=await fetch(`http://127.0.0.1:${port}/verify`,{signal:AbortSignal.timeout(60000)});assert.ok(response.ok,'Native Worker verification request failed');
  const result=await response.json();assert.equal(result.passed,true,JSON.stringify(result));
  const output=path.join(root,'docs/validation/r2/native-worker.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({runtime:'workerd-local',...result},null,2)+'\n');console.log(JSON.stringify(result));
} finally {
  fs.writeFileSync(path.join(directory,'server.log'),log);
  if(child.exitCode===null){if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}
}
