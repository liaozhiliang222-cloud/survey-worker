import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { SavWriter } from 'savfilewriter';
import { JsonResearchStore } from '../lib/research-store.js';
import { LocalResearchFileStorage } from '../lib/research-file-storage.js';
import { createResearchStore, dataStorage } from '../functions/api/research/[[path]].js';
import { registerRawDataset, loadDatasetTable, createDataToolExecutor } from '../lib/data-engine.mjs';
import { calculateRimWeights, normalizeWeightTargets } from '../lib/data-weighting.mjs';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'surveykit-r1-'));
const db = new DatabaseSync(path.join(temp, 'test.sqlite'));
const migrations = fs.readdirSync(new URL('../migrations/', import.meta.url)).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort();
db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT)');
for (const name of migrations) { db.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')); db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES (?,?)').run(name, 'synthetic'); }
function bound(sql, args = []) { const s = db.prepare(sql); return { async all() { return {results:s.all(...args)}; }, async first() { return s.get(...args) || null; }, async run() { return s.run(...args); } }; }
const d1 = { prepare(sql) { return {...bound(sql), bind(...args) { return bound(sql,args); }}; }, async batch(items) { db.exec('BEGIN'); try { const out=[]; for(const item of items) out.push(await item.run()); db.exec('COMMIT'); return out; } catch(e) {db.exec('ROLLBACK');throw e;} } };
const objects = new Map();
const r2 = { async put(k,b) { objects.set(k,Buffer.from(b)); }, async get(k) { const b=objects.get(k); return b ? {async arrayBuffer(){ return Uint8Array.from(b).buffer; }} : null; }, async delete(k){objects.delete(k);} };
const headers=['GROUP','NPS','VALUE','CHOICE'];
const rows=Array.from({length:13},(_,i)=>({GROUP:i<9?'A':'B',NPS:i===0?0:10,VALUE:i,CHOICE:i===0?'0':'yes'}));
rows.push({GROUP:'A',NPS:null,VALUE:null,CHOICE:''},{GROUP:'A',NPS:null,VALUE:null,CHOICE:'  '},{GROUP:'',NPS:null,VALUE:null,CHOICE:'yes'});
const source=fs.readFileSync(new URL('../src/shared/export.js',import.meta.url),'utf8');
const {buildExcelWorkbookXlsxBytes}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const fixtures={csv:Buffer.from([headers.join(','),...rows.map(r=>headers.map(h=>r[h]??'').join(','))].join('\n')),xlsx:buildExcelWorkbookXlsxBytes([{name:'Data',rows:[headers,...rows.map(r=>headers.map(h=>r[h]??''))].map(r=>({cells:r.map(value=>({value}))}))}]),sav:SavWriter.write({encoding:'UTF-8',sysvars:headers.map(name=>({name,type:['GROUP','CHOICE'].includes(name)?8:0}))},rows)};
if (process.argv.includes("--write-fixtures")) { const directory=new URL("./fixtures/r1/",import.meta.url); fs.mkdirSync(directory,{recursive:true}); for(const [format,bytes] of Object.entries(fixtures)) fs.writeFileSync(new URL(`fixture.${format}`,directory),Buffer.from(bytes)); }
let reference;
try {
 for(const [adapter,store,storage] of [['local',new JsonResearchStore(path.join(temp,'research.json')),new LocalResearchFileStorage(path.join(temp,'files'))],['d1-r2-contract',createResearchStore(d1),dataStorage({RESEARCH_FILES:r2})]]) {
  const project=await store.createProject('r1',{title:'Synthetic R1'});
  const execute=createDataToolExecutor({store,fileStorage:storage});
  for(const [format,bytes] of Object.entries(fixtures)) {
   const key=storage.key(project.id,format,format); await storage.put(key,bytes);
   const file=await store.createFile('r1',project.id,{id:crypto.randomUUID(),file_name:`fixture.${format}`,file_type:format,mime_type:'application/octet-stream',file_size:bytes.byteLength,category:'data',storage_key:key,storage_path:key});
   const raw=await registerRawDataset({store,fileStorage:storage,userId:'r1',projectId:project.id,file});
   assert.equal((await registerRawDataset({store,fileStorage:storage,userId:'r1',projectId:project.id,file})).id,raw.id);
   const table=await loadDatasetTable({store,fileStorage:storage,projectId:project.id,dataset:raw});
   const weightedKey=storage.key(project.id,crypto.randomUUID(),'json');
   await storage.put(weightedKey,Buffer.from(JSON.stringify({...table,headers:[...table.headers,"__weight"],rows:table.rows.map(r=>({...r,__weight:1}))})));
   const weighted=await store.createDataset('r1',project.id,{name:'Equal',type:'weighted',status:'ready',source_dataset_id:raw.id,row_count:rows.length,column_count:4,storage_key:weightedKey});
   for(const dataset of [raw,weighted]) {
    const results=[];
    for(const variable of ['NPS','VALUE','CHOICE']) {
     const out=await execute({agentToolId:'crosstab',args:{dataset_id:dataset.id,variables:[variable],banner:['GROUP']},scope:{project,user_id:'r1'}});
     const result=out.result.results[0];
     results.push({metric:result.metric,overall:result.overall,base:result.base,groups:result.groups?.map(g=>({segment:g.segment,value:g.value,base:g.base})),categories:result.categories?.map(c=>({category:c.category,groups:c.groups.map(g=>({segment:g.segment,percent:g.percent}))}))});
    }
    assert.equal(results[0].overall,84.6); assert.equal(results[0].base,13);
    assert.equal(results[1].overall,6); assert.equal(results[1].base,13);
    assert.equal(results[2].base,13);
    assert.equal(results[2].categories.find(c=>c.category==='yes').groups.find(g=>g.segment==='B').percent,100);
    if(reference) assert.deepEqual(results,reference); else reference=results;
   }
   const trimRows=table.rows.slice(0,10).map((r,i)=>({...r,GROUP:i<9?'A':'B'}));
   const targets=normalizeWeightTargets([{variable:'GROUP',categories:[{value:'A',share:50},{value:'B',share:50}]}],headers,trimRows);
   const trim=calculateRimWeights(trimRows,targets,{trim:{min:0.5,max:2}});
   assert.equal(trim.diagnostics.converged,false); assert.equal(trim.diagnostics.max_margin_delta,0.3); assert.equal(trim.diagnostics.max_weight,2);
   console.log(`${adapter}/${format}: raw + equal weights + bounded weights PASS`);
  }
 }
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const snapshot=path.join(temp,'backup.sqlite'); await backup(db,snapshot);
 const restored=new DatabaseSync(snapshot);
 assert.deepEqual(restored.prepare('SELECT name FROM d1_migrations ORDER BY name').all().map(r=>r.name),migrations);
 for(const table of ['research_projects','research_project_files','research_datasets']) assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
 assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok'); restored.close();
 const backupDir=path.join(temp,'restored-files'); fs.cpSync(path.join(temp,'files'),backupDir,{recursive:true});
 for(const entry of fs.readdirSync(path.join(temp,'files'),{recursive:true,withFileTypes:true}).filter(e=>e.isFile())) { const rel=path.relative(path.join(temp,'files'),path.join(entry.parentPath,entry.name)); assert.deepEqual(fs.readFileSync(path.join(backupDir,rel)),fs.readFileSync(path.join(temp,'files',rel))); }
 console.log('Schema + synthetic ledger + SQLite backup/restore + local file byte comparison PASS; remote infrastructure NOT tested.');
} finally { db.close(); if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('surveykit-r1-')) fs.rmSync(temp,{recursive:true,force:true}); }


