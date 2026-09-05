// Acceptance-only REST transport. Credentials stay in process memory and are never logged.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
export function createR1RestBindings({wrangler,config,resources,token,onObjectWrite}) {
 function auth(args) {
  const result=spawnSync(process.execPath,[wrangler,...args,'--json','--config',config],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,'Wrangler authentication unavailable');
  return JSON.parse(result.stdout);
 }
 const identity=auth(['whoami']);
 assert.equal(identity.accounts.length,1,'Set up an unambiguous single-account Wrangler profile');
 const account=identity.accounts[0].id;
 const credential=auth(['auth','token']);
 assert.ok(credential.token,'Token authentication required');
 async function api(resource,options={}) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${resource}`,{...options,headers:{...options.headers,Authorization:`Bearer ${credential.token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok&&response.status!==404)throw Error(`Cloudflare ${options.method||'GET'} failed: HTTP ${response.status}`);
  return response;
 }
 const env={R1_ACCEPTANCE:'synthetic-only',R1_RUN_TOKEN:token};
 for(const target of ['source','restore']) {
  const database=resources.find(r=>r.kind==='d1'&&r.name.endsWith(`-${target}`));
  const bucket=resources.find(r=>r.kind==='r2'&&r.name.endsWith(`-${target}`));
  if(!database&&!bucket)continue;
  assert.ok(database&&bucket);
  async function query(sql,params) {
   const response=await api(`/d1/database/${database.id}/query`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sql,params})});
   const body=await response.json();assert.equal(body.success,true,JSON.stringify(body.errors));
   assert.equal(body.result.length,1,'Expected exactly one SQL result');return body.result[0];
  }
  function prepared(sql,params=[]) {return {bind(...values){return prepared(sql,values);},async all(){return query(sql,params);},async first(){return (await query(sql,params)).results[0]||null;},async run(){return query(sql,params);}}; } 
  env[`${target.toUpperCase()}_DB`]={prepare:prepared,batch(){throw Error('REST acceptance transport does not emulate transactional batch');}};
  const objectPath=key=>`/r2/buckets/${bucket.name}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  env[`${target.toUpperCase()}_FILES`]={
   async put(key,bytes){onObjectWrite(bucket.name,key);const r=await api(objectPath(key),{method:'PUT',body:bytes});assert.ok(r.ok);await r.arrayBuffer();},
   async get(key){const r=await api(objectPath(key));return r.status===404?null:r;},
   async delete(key){const r=await api(objectPath(key),{method:'DELETE'});await r.arrayBuffer();}
  };
 }
 return env;
}

