// Local-only acceptance entrypoint. Never configure production bindings here.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { createResearchStore, dataStorage } from '../functions/api/research/[[path]].js';
import { registerRawDataset, loadDatasetTable, createDataToolExecutor } from '../lib/data-engine.mjs';
import { normalizeWeightTargets, calculateRimWeights, weightedNps, weightedMean } from '../lib/data-weighting.mjs';

async function statistics(store, storage, project, persist = true) {
  const execute = createDataToolExecutor({ store, fileStorage: storage });
  const datasets = await store.listDatasets(project.id);
  assert.equal(datasets.length, 6);
  const stored = persist ? [] : await store.listAnalysisResults(project.id);
  if (!persist) assert.equal(stored.length,6);
  let reference;
  const results = [];
  for (const dataset of datasets.sort((a,b) => a.name.localeCompare(b.name))) {
    const metrics = [];
    const out = persist
      ? (await execute({ agentToolId: 'crosstab', args: { dataset_id: dataset.id, variables: ['NPS','VALUE','CHOICE'], banner: ['GROUP'] }, scope: { project, user_id: 'r1-synthetic' } })).result
      : JSON.parse(stored.find(r=>r.dataset_id===dataset.id).result);
    assert.deepEqual(out.variables,['NPS','VALUE','CHOICE']);
    for (const r of out.results) {
      metrics.push({ metric: r.metric, overall: r.overall, base: r.base, groups: r.groups?.map(g => ({ segment:g.segment,value:g.value,base:g.base })), categories:r.categories?.map(c=>({category:c.category,groups:c.groups.map(g=>({segment:g.segment,percent:g.percent}))})) });
    }
    assert.equal(metrics[0].overall, 84.6); assert.equal(metrics[0].base, 13);
    assert.equal(metrics[1].overall, 6); assert.equal(metrics[1].base, 13);
    assert.equal(metrics[2].base, 13);
    assert.equal(metrics[2].categories.find(c=>c.category==='yes').groups.find(g=>g.segment==='B').percent,100);
    if (reference) assert.deepEqual(metrics,reference); else reference=metrics;
    const table=await loadDatasetTable({store,fileStorage:storage,projectId:project.id,dataset});
    const equalRows=table.rows.map(r=>({...r,__weight:1}));
    assert.equal(weightedNps(equalRows,'NPS').value,84.6);
    assert.equal(weightedMean(equalRows,'VALUE').value,6);
    assert.equal(weightedNps(equalRows.filter(r=>r.GROUP==='A'),'NPS').value,77.8);
    assert.equal(weightedNps(equalRows.filter(r=>r.GROUP==='B'),'NPS').value,100);
    const rows=table.rows.slice(0,10).map((r,i)=>({...r,GROUP:i<9?'A':'B'}));
    const targets=normalizeWeightTargets([{variable:'GROUP',categories:[{value:'A',share:50},{value:'B',share:50}]}],table.headers,rows);
    const trimmed=calculateRimWeights(rows,targets,{trim:{min:0.5,max:2}});
    assert.equal(trimmed.diagnostics.max_margin_delta,0.3); assert.equal(trimmed.diagnostics.max_weight,2); assert.equal(trimmed.diagnostics.converged,false);
    if(dataset.type==='weighted') assert.ok(await store.getDataset(project.id,dataset.parent_dataset_id));
    results.push({name:dataset.name,metrics,trim:trimmed.diagnostics});
  }
  return results;
}

export default {
  async fetch(request, env) {
    const provided = Buffer.from(request.headers.get('x-r1-token') || '');
    const expected = Buffer.from(env.R1_RUN_TOKEN || '');
    if (env.R1_ACCEPTANCE !== 'synthetic-only' || !expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return new Response('Acceptance session required',{status:403});
    if(request.method==='GET' && new URL(request.url).pathname==='/ready') return Response.json({ok:true});
    if(request.method!=='POST' || !request.headers.get('content-type')?.includes('application/json')) return new Response('JSON POST required',{status:400});
    // Every caller is the local runner, with only small synthetic fixtures.
    const reader=request.body?.getReader(); let size=0; const chunks=[];
    if(reader) for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();return new Response('Too large',{status:413});}chunks.push(Buffer.from(value));}
    try {
      const input=JSON.parse(Buffer.concat(chunks).toString());
      const restored=input.target==='restore';
      const database=restored?env.RESTORE_DB:env.SOURCE_DB;
      const bucket=restored?env.RESTORE_FILES:env.SOURCE_FILES;
      const store=createResearchStore(database); const storage=dataStorage({RESEARCH_FILES:bucket});
      if(input.action==='seed') {
        assert.equal(restored,false);
        assert.equal((await store.listProjects('r1-synthetic')).length,0,'Use a fresh test database');
        const project=await store.createProject('r1-synthetic',{title:'R1 synthetic acceptance'});
        assert.deepEqual(Object.keys(input.fixtures).sort(),['csv','sav','xlsx']);
        for(const [format,base64] of Object.entries(input.fixtures)) {
          const bytes=Buffer.from(base64,'base64'); const key=storage.key(project.id,format,format); await storage.put(key,bytes);
          const file=await store.createFile('r1-synthetic',project.id,{id:crypto.randomUUID(),file_name:`fixture.${format}`,file_type:format,mime_type:'application/octet-stream',file_size:bytes.length,category:'data',storage_key:key});
          const raw=await registerRawDataset({store,fileStorage:storage,userId:'r1-synthetic',projectId:project.id,file,name:`${format}-raw`});
          assert.equal((await registerRawDataset({store,fileStorage:storage,userId:'r1-synthetic',projectId:project.id,file})).id,raw.id);
          const table=await loadDatasetTable({store,fileStorage:storage,projectId:project.id,dataset:raw});
          const weightedKey=storage.key(project.id,crypto.randomUUID(),'json');
          await storage.put(weightedKey,Buffer.from(JSON.stringify({...table,headers:[...table.headers,'__weight'],rows:table.rows.map(r=>({...r,__weight:1}))})));
          await store.createDataset('r1-synthetic',project.id,{name:`${format}-weighted`,type:'weighted',parent_dataset_id:raw.id,status:'ready',row_count:table.rows.length,column_count:table.headers.length+1,storage_key:weightedKey});
        }
        return Response.json({ok:true,projectId:project.id,results:await statistics(store,storage,project)});
      }
      const project=await store.getProject('r1-synthetic',input.projectId); assert.ok(project);
      const keys=[...new Set([...(await store.listFiles(project.id)),...(await store.listDatasets(project.id))].map(r=>r.storage_key).filter(Boolean))].sort();
      assert.equal(keys.length,12);
      if(input.action==='restore-objects') {
        assert.equal(restored,true); assert.deepEqual(Object.keys(input.objects).sort(),keys);
        for(const key of keys) await storage.put(key,Buffer.from(input.objects[key],'base64'));
      }
      if(input.action==='objects' || input.action==='restore-objects') {
        const objects={}; for(const key of keys) objects[key]=Buffer.from(await storage.get(key)).toString('base64');
        return Response.json({ok:true,objects});
      }
      if(input.action==='verify') return Response.json({ok:true,results:await statistics(store,storage,project,false),ledger:(await database.prepare('SELECT name FROM d1_migrations ORDER BY name').all()).results,foreignKeys:(await database.prepare('PRAGMA foreign_key_check').all()).results});
      return new Response('Unknown action',{status:400});
    } catch(error) {return Response.json({ok:false,error:error.message,stack:error.stack},{status:500});}
  }
};
