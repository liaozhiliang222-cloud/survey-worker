// Creates and removes only uniquely named, synthetic R1 cloud resources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import worker from './r1-cloud-worker.mjs';
import {createR1RestBindings} from './r1-rest-bindings.mjs';
const apiMode=process.argv.includes('--api-transport');
const restoreFrom=process.argv.find(a=>a.startsWith('--restore-from='))?.slice(15);
if(restoreFrom)assert.match(restoreFrom,/^surveykit-r1-\d+-[a-f0-9]{6}$/);
let restEnv;
const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
const wrangler=process.env.R1_WRANGLER_JS || path.join(process.env.APPDATA||'', 'npm/node_modules/wrangler/bin/wrangler.js');
assert.ok(fs.existsSync(wrangler),'Set R1_WRANGLER_JS to installed Wrangler bin/wrangler.js');
const runId=`surveykit-r1-${Date.now()}-${randomUUID().slice(0,6)}`;
const directory=path.join(root,'.data','r1-cloud',runId);
const evidence=path.join(root,'docs','validation','r1','cloud',runId);
fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
const config=path.join(directory,'wrangler.json');
const token=randomUUID();
fs.writeFileSync(path.join(directory,'.dev.vars'), 'R1_RUN_TOKEN='+token+'\n');
const configuration={name:runId,main:path.join(root,'scripts/r1-cloud-worker.mjs'),compatibility_date:'2026-07-02',compatibility_flags:['nodejs_compat'],vars:{R1_ACCEPTANCE:'synthetic-only'},d1_databases:[],r2_buckets:[]};
const summary={runId,startedAt:new Date().toISOString(),mode:apiMode?'Node adapter contracts over real D1/R2 REST API':'temporary remote workerd preview with real D1/R2',resources:[],checks:[],cleanup:[]};
const save=()=>fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(summary,null,2)+'\n');
const writeConfig=()=>fs.writeFileSync(config,JSON.stringify(configuration,null,2));
writeConfig();save();let sequence=0;let dev;
function cli(args,allowFailure=false) {
  const output=spawnSync(process.execPath,[wrangler,...args,'--config',config],{cwd:root,encoding:'utf8',env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},windowsHide:true,timeout:180000,maxBuffer:16*1024*1024});
  fs.writeFileSync(path.join(evidence,`${String(++sequence).padStart(2,'0')}-${args.slice(0,2).join('-')}.txt`),`${args.join(' ')}\n${output.stdout||''}\n${output.stderr||''}`);
  if(output.status!==0&&!allowFailure) throw Error(`Wrangler ${args.slice(0,3).join(' ')} failed (${output.status}): ${(output.stderr||'').slice(-1200)}`);
  return output;
}
function record(name,details={}){summary.checks.push({name,ok:true,...details});save();console.log(name);}
const port=4397;
async function request(input) {
 const init={method:'POST',headers:{'content-type':'application/json','x-r1-token':token},body:JSON.stringify(input),signal:AbortSignal.timeout(180000)};
 const response=apiMode?await worker.fetch(new Request(`http://127.0.0.1:${port}/`,init),restEnv):await fetch(`http://127.0.0.1:${port}/`,init);
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.ok,true);return body;
}
try {
 for(const target of restoreFrom?['restore']:['source','restore']) {
  const name=`${runId}-${target}`;
  const created=cli(['d1','create',name,'--update-config=false']).stdout;
  const id=created.match(/"database_id"\s*:\s*"([a-f0-9-]+)"/)?.[1] || created.match(/database_id\s*=\s*"([a-f0-9-]+)"/)?.[1];
  assert.ok(id,`Cannot identify newly created database ${name}; inspect create log`);
  summary.resources.push({kind:'d1',name,id});save();
  configuration.d1_databases.push({binding:`${target.toUpperCase()}_DB`,database_name:name,database_id:id,preview_database_id:id,migrations_dir:path.join(root,'migrations'),remote:true});writeConfig();
  cli(['r2','bucket','create',name]);summary.resources.push({kind:'r2',name});save();
  configuration.r2_buckets.push({binding:`${target.toUpperCase()}_FILES`,bucket_name:name,preview_bucket_name:name,remote:true});writeConfig();
 }
 if(!restoreFrom){cli(['d1','migrations','apply',`${runId}-source`,'--remote']);record('remote-migrations-0001-0019');}
 if(apiMode) {
  restEnv=createR1RestBindings({wrangler,config,resources:summary.resources,token,onObjectWrite(bucket,key){summary.uploadedObjects ||= [];if(!summary.uploadedObjects.some(o=>o.bucket===bucket&&o.key===key))summary.uploadedObjects.push({bucket,key});save();}});
 } else {
 const devLog=fs.openSync(path.join(evidence,'workerd.txt'),'w');
 dev=spawn(process.execPath,[wrangler,'dev','--remote','--config',config,'--ip','127.0.0.1','--port',String(port),'--show-interactive-dev-session=false'],{cwd:root,env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false'},stdio:['ignore',devLog,devLog],windowsHide:true});fs.closeSync(devLog);
 let ready=false;
 for(let i=0;i<90;i++){if(dev.exitCode!==null)throw Error('Wrangler dev exited; inspect workerd.txt');try{const r=await fetch(`http://127.0.0.1:${port}/ready`,{headers:{'x-r1-token':token},signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}
 assert.ok(ready,'Remote bindings did not become ready');
 }
 const backup=path.join(directory,'source.sql');
 const schemaBackup=path.join(directory,'source-schema.sql');
 const dataBackup=path.join(directory,'source-data.sql');
 const migrations=fs.readdirSync('migrations').filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort();
 let seeded,original,objects;
 if(restoreFrom) {
  const previous=path.join(root,'.data/r1-cloud',restoreFrom);
  const previousEvidence=path.join(root,'docs/validation/r1/cloud',restoreFrom);
  const prior=JSON.parse(fs.readFileSync(path.join(previousEvidence,'result.json'),'utf8'));
  assert.ok(prior.checks.some(c=>c.name==='remote-ledger-and-foreign-keys'&&c.ok));
  const bytes=fs.readFileSync(path.join(previous,'source.sql'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),prior.backup.sqlSha256);
  fs.writeFileSync(backup,bytes);
  objects={objects:JSON.parse(fs.readFileSync(path.join(previous,'objects.json'),'utf8'))};
  for(const item of prior.backup.objects)assert.equal(createHash('sha256').update(Buffer.from(objects.objects[item.key],'base64')).digest('hex'),item.sha256);
  assert.deepEqual(Object.keys(objects.objects).sort(),prior.backup.objects.map(o=>o.key).sort());
  seeded=JSON.parse(fs.readFileSync(path.join(previousEvidence,'statistics-source.json'),'utf8'));
  original={ok:true,results:seeded.results,ledger:migrations.map(name=>({name})),foreignKeys:[]};
  summary.sourceRunId=restoreFrom;record('verified-existing-synthetic-backup');
 } else {
  const fixtures=Object.fromEntries(['csv','xlsx','sav'].map(format=>[format,fs.readFileSync(path.join(root,'tests/fixtures/r1',`fixture.${format}`)).toString('base64')]));
  seeded=await request({action:'seed',fixtures});fs.writeFileSync(path.join(evidence,'statistics-source.json'),JSON.stringify(seeded,null,2));record('remote-six-datasets-statistics-and-trim');
  original=await request({action:'verify',projectId:seeded.projectId});
  assert.deepEqual(original.ledger.map(r=>r.name),migrations);assert.deepEqual(original.foreignKeys,[]);record('remote-ledger-and-foreign-keys');
  cli(['d1','export',`${runId}-source`,'--remote','--output',backup]);
  objects=await request({action:'objects',projectId:seeded.projectId});
 }
 fs.writeFileSync(path.join(directory,'objects.json'),JSON.stringify(objects.objects));
 const prepared=spawnSync('python',['scripts/prepare-d1-restore.py',backup,schemaBackup,dataBackup],{cwd:root,encoding:'utf8',windowsHide:true});
 fs.writeFileSync(path.join(evidence,'restore-preparation.json'),prepared.stdout);assert.equal(prepared.status,0,prepared.stderr);
 summary.backup={sqlSha256:createHash('sha256').update(fs.readFileSync(backup)).digest('hex'),objects:Object.entries(objects.objects).map(([key,b])=>({key,sha256:createHash('sha256').update(Buffer.from(b,'base64')).digest('hex')})),schemaSha256:createHash('sha256').update(fs.readFileSync(schemaBackup)).digest('hex'),dataSha256:createHash('sha256').update(fs.readFileSync(dataBackup)).digest('hex')};save();
 cli(['d1','execute',`${runId}-restore`,'--remote','--file',schemaBackup,'--yes']);
 cli(['d1','execute',`${runId}-restore`,'--remote','--file',dataBackup,'--yes']);
 const restoredObjects=await request({action:'restore-objects',target:'restore',projectId:seeded.projectId,objects:objects.objects});assert.deepEqual(restoredObjects.objects,objects.objects);record('remote-r2-restore-byte-equality');
 const restored=await request({action:'verify',target:'restore',projectId:seeded.projectId});assert.deepEqual(restored,original);record('remote-restored-statistics-ledger-and-lineage');
 const restoredBackup=path.join(directory,'restored.sql');cli(['d1','export',`${runId}-restore`,'--remote','--output',restoredBackup]);
 const rows=spawnSync(process.execPath,['scripts/verify-r1-restored-data.mjs',backup,restoredBackup],{cwd:root,encoding:'utf8',windowsHide:true});
 fs.writeFileSync(path.join(evidence,'restored-rows.json'),rows.stdout);
 assert.equal(rows.status,0,rows.stderr);record('remote-restored-all-table-rows');
 const schema=path.join(directory,'restored-schema.sql');cli(['d1','export',`${runId}-restore`,'--remote','--no-data','--output',schema]);
 const audit=spawnSync(process.execPath,['scripts/audit-d1-migrations.mjs',schema],{encoding:'utf8',windowsHide:true});fs.writeFileSync(path.join(evidence,'restored-schema-audit.txt'),audit.stdout+'\n'+audit.stderr);assert.equal(audit.status,0,audit.stdout+audit.stderr);record('remote-restored-schema');
 summary.ok=true;
} catch(error) { summary.ok=false;summary.error=error.stack;console.error(error.message);process.exitCode=1;
} finally {
 // Only the resource names/IDs successfully created and recorded above are eligible.
 for(const resource of [...summary.resources].reverse()) {
  assert.ok(resource.name.startsWith(`${runId}-`));
  if(resource.kind==='r2') {
   // R2 rejects non-empty bucket deletion; use exact owned keys from the backup and uploaded fixture IDs.
   const objectFile=path.join(directory,'objects.json');
   let keys=fs.existsSync(objectFile)?Object.keys(JSON.parse(fs.readFileSync(objectFile,'utf8'))):[];
   keys=[...new Set([...keys,...(summary.uploadedObjects||[]).filter(o=>o.bucket===resource.name).map(o=>o.key)])];
   if(!keys.length) {
     // Failure before backup: query known uploaded keys using read-only SQL.
     const result=cli(['d1','execute',resource.name,'--remote','--command',"SELECT storage_key FROM research_project_files UNION SELECT storage_key FROM research_datasets WHERE storage_key <> ''",'--json'],true);
     if(result.status===0) try{keys=JSON.parse(result.stdout).flatMap(r=>r.results||[]).map(r=>r.storage_key).filter(Boolean);}catch{}
   }
   for(const key of keys)cli(['r2','object','delete',`${resource.name}/${key}`,'--remote'],true);
  }
  const deleted=cli(resource.kind==='d1'?['d1','delete',resource.id,'--skip-confirmation']:['r2','bucket','delete',resource.name],true);
  summary.cleanup.push({...resource,ok:deleted.status===0});save();
 }
 if(dev&&dev.exitCode===null){dev.kill();}
 summary.completedAt=new Date().toISOString();if(summary.cleanup.some(r=>!r.ok)){summary.ok=false;process.exitCode=1;}save();
 console.log(`Cloud acceptance ${summary.ok?'PASS':'FAIL'}: ${path.join(evidence,'result.json')}`);
}
