import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const [wrangler,config,database,bucket]=process.argv.slice(2);
assert.ok(wrangler&&config&&database&&bucket,'Usage: node --use-env-proxy script <wrangler.js> <config> <database-id> <bucket>');
function auth(args) { const r=spawnSync(process.execPath,[wrangler,...args,'--json','--config',config],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,'Wrangler authentication unavailable');return JSON.parse(r.stdout); }
const identity=auth(['whoami']);assert.equal(identity.accounts.length,1);
const credential=auth(['auth','token']);assert.ok(credential.token);
async function api(resource,options={}) {
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${identity.accounts[0].id}${resource}`,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.token}`},signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok,`Read-only inventory HTTP ${response.status}`);const body=await response.json();assert.equal(body.success,true,'Read-only inventory rejected');return body;
}
// Deliberately fixed SELECT: this utility cannot execute caller-supplied SQL.
const records=await api(`/d1/database/${encodeURIComponent(database)}/query`,{method:'POST',body:JSON.stringify({sql:"SELECT storage_key FROM research_project_files WHERE storage_key<>'' UNION SELECT storage_key FROM research_datasets WHERE storage_key<>''",params:[]})});
const referenced=new Set(records.result[0].results.map(r=>r.storage_key));
const objects=new Set();let cursor='';const cursors=new Set();
do {
  const result=await api(`/r2/buckets/${encodeURIComponent(bucket)}/objects?limit=1000${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
  const entries=Array.isArray(result.result)?result.result:result.result?.objects;
  assert.ok(Array.isArray(entries),'Unsupported object inventory response');
  for(const object of entries)objects.add(object.key);
  cursor=result.result_info?.cursor||result.result?.cursor||'';
  if(cursor){assert.ok(!cursors.has(cursor),'Repeated inventory cursor');cursors.add(cursor);}
} while(cursor);
console.log(JSON.stringify({read_only:true,checked_at:new Date().toISOString(),database,bucket,referenced_count:referenced.size,object_count:objects.size,missing:[...referenced].filter(k=>!objects.has(k)),unreferenced:[...objects].filter(k=>!referenced.has(k))},null,2));
