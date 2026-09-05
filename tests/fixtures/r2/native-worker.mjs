// Test-only entry point. The production worker has no HTTP control endpoint.
import { createResearchStore, dataStorage } from '../../../functions/api/research/[[path]].js';
import { enqueueDataJob, executeDataJob, sweepDataJobs } from '../../../lib/data-jobs.mjs';
import { registerRawDataset } from '../../../lib/data-engine.mjs';
import worker from '../../../workers/data-jobs.mjs';
export default {
  scheduled: worker.scheduled,
  async fetch(request, env, ctx) {
    const store=createResearchStore(env.RESEARCH_DB),storage=dataStorage(env);
    if(new URL(request.url).pathname!=='/verify')return new Response('not found',{status:404});
    const project=await store.createProject('r2-native',{title:'Synthetic R2 native'}),pid=project.id;
    const bytes=new TextEncoder().encode('GROUP,NPS\nA,0\nA,10\nB,9\n');
    const fileId=crypto.randomUUID(),key=storage.key(pid,fileId,'csv');await storage.put(key,bytes);
    const file=await store.createFile('r2-native',pid,{id:fileId,file_name:'synthetic.csv',file_type:'csv',mime_type:'text/csv',file_size:bytes.length,category:'data',storage_key:key});
    const raw=await registerRawDataset({store,fileStorage:storage,userId:'r2-native',projectId:pid,file});
    const input={dataset_id:raw.id,rules:[{type:'blank_row'}],confirmed:true};
    const jobs=await Promise.all([enqueueDataJob(store,'r2-native',pid,'data_clean',input,'native-duplicate'),enqueueDataJob(store,'r2-native',pid,'data_clean',input,'native-duplicate')]);
    await worker.scheduled({scheduledTime:Date.now()},env,ctx);
    const completed=await store.getDataJob(pid,jobs[0].id);
    const cancelled=await enqueueDataJob(store,'r2-native',pid,'data_clean',input,'native-cancel');
    await executeDataJob({store,job:await store.getDataJob(pid,cancelled.id),fileStorage:{...storage,async put(k,b){await storage.put(k,b);await store.controlDataJob(pid,cancelled.id,'cancel');}}});
    const crosstab=await enqueueDataJob(store,'r2-native',pid,'crosstab',{dataset_id:raw.id,banner:['GROUP'],variables:['NPS']},'native-crosstab');
    await sweepDataJobs({store,fileStorage:storage});
    const analysis=await store.getDataJob(pid,crosstab.id),datasets=await store.listDatasets(pid);
    const result={duplicate_same_job:jobs[0].id===jobs[1].id,clean_status:completed.status,cancelled_status:(await store.getDataJob(pid,cancelled.id)).status,dataset_count:datasets.length,crosstab_status:analysis.status,crosstab_error:analysis.error};
    return Response.json({...result,passed:result.duplicate_same_job&&result.clean_status==='completed'&&result.cancelled_status==='cancelled'&&result.dataset_count===2&&result.crosstab_status==='completed'});
  },
};
