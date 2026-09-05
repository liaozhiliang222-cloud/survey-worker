import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {JsonResearchStore} from '../lib/research-store.js';
import {LocalResearchFileStorage} from '../lib/research-file-storage.js';
import {createResearchStore} from '../functions/api/research/[[path]].js';
const latest=JSON.parse(fs.readFileSync('.data/r3-delivery/latest.json','utf8'));
const renders=JSON.parse(fs.readFileSync('.data/r3-render/acceptance.json','utf8'));
if(fs.existsSync('.data/r3-model/report.pptx')) {
 const attempts=JSON.parse(fs.readFileSync('.data/r3-model/acceptance.json','utf8'));
 const modelScript=attempts.findLast(r=>r.stage==='script'&&r.artifact_id);
 const sample=latest.results.find(r=>r.adapter==='local'&&r.case==='qualitative');
 if(modelScript)renders.push({adapter:'local',case:'qualitative',project_id:sample.project_id,file:path.resolve('.data/r3-model/report.pptx'),engine:'officecli',source_script_id:modelScript.artifact_id,source_outline_id:sample.source_outline_id});
}
const db=new DatabaseSync(path.join(latest.run,'research.sqlite'));
const stmt=(sql,args=[])=>({async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return {meta:db.prepare(sql).run(...args)};}});
const cloud=createResearchStore({prepare(sql){return {...stmt(sql),bind(...args){return stmt(sql,args);}};}});
const bound=[];
try {
 for(const render of renders) {
  const store=render.adapter==='local'?new JsonResearchStore(path.join(latest.run,'research.json')):cloud;
  const storage=new LocalResearchFileStorage(path.join(latest.run,render.adapter==='local'?'files':'cloud-files'));
  const bytes=fs.readFileSync(render.file),pid=render.project_id,id=crypto.randomUUID(),key=storage.key(pid,id,'pptx');
  await storage.put(key,bytes);
  const file=await store.createFile('r3',pid,{id,file_name:path.basename(render.file),file_type:'pptx',mime_type:'application/vnd.openxmlformats-officedocument.presentationml.presentation',file_size:bytes.length,category:'historical_report',storage_key:key,storage_path:key});
  const artifact=await store.createArtifact(pid,{type:'qualitative_ppt',title:path.basename(render.file),content:JSON.stringify({source_ppt_script:render.source_script_id,source_report_outline:render.source_outline_id,generated_file_id:file.id,renderer:render.engine})});
  assert.deepEqual(Buffer.from(await storage.get(key)),bytes);
  const stored=await store.getArtifact(pid,artifact.id);assert.ok(stored.provenance);
  // Mixed scripts were deliberately made stale by recomputation: exporting
  // the historical version must preserve that warning rather than bless it.
  assert.equal(stored.freshness.status,render.case==='mixed'?'stale':'current');
  bound.push({adapter:render.adapter,case:render.case,file_id:file.id,artifact_id:artifact.id,source_script_id:render.source_script_id,freshness:stored.freshness.status,bytes:bytes.length});
 }
 fs.writeFileSync('.data/r3-render/bound-outputs.json',JSON.stringify(bound,null,2));console.log(`R3 ${bound.length} real PPT files stored with source lineage; stale historical exports remain stale.`);
} finally {db.close();}
