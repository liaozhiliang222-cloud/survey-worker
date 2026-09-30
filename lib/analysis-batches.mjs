import {enqueueDataJob,publicDataJob} from './data-jobs.mjs';
import {validateRecipe,validateRecipeTarget} from './analysis-recipes.mjs';
export async function startAnalysisBatch({store,fileStorage,userId,projectId,input}){
 const recipe=validateRecipe(input.recipe);if(!/^[A-Za-z0-9_-]{8,64}$/.test(input.request_key||''))throw new Error('缺少有效的批次请求键');
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>10)throw new Error('每批需选择 1–10 个数据集');
 if(new Set(input.items.map(i=>i.dataset_id)).size!==input.items.length)throw new Error('同一批次不能重复选择数据集');
 const items=[];for(const item of input.items){const result=await validateRecipeTarget({store,fileStorage,projectId,datasetId:item.dataset_id,recipe,mapping:item.mapping||{}});if(!result.valid)throw new Error(result.errors.join('；'));items.push({dataset_id:item.dataset_id,mapping:result.mapping});}
 const batch=await store.createAnalysisBatch(userId,projectId,{id:input.request_key,name:recipe.name,input:{recipe,items}});return advanceAnalysisBatch(store,batch);
}
export async function advanceAnalysisBatch(store,batch){
 const input=JSON.parse(batch.input),items=[];let active=false;
 for(const [index,item] of input.items.entries()){
  const key=`recipe:${batch.id}:${index}`;let job=await store.getDataJobByKey(batch.project_id,key);
  if(!job&&!active){await enqueueDataJob(store,batch.user_id,batch.project_id,'crosstab',{dataset_id:item.dataset_id,recipe:input.recipe,mapping:item.mapping},key);job=await store.getDataJobByKey(batch.project_id,key);}
  if(!job||job.status!=='completed')active=true;
  items.push({dataset_id:item.dataset_id,job:job?publicDataJob(job):null,status:job?.status||'waiting'});
 }
 return {id:batch.id,name:batch.name,created_at:batch.created_at,items,status:items.every(i=>i.status==='completed')?'completed':items.some(i=>['failed','cancelled'].includes(i.status))?'attention':'running'};
}
export async function listAnalysisBatches(store,pid){return Promise.all((await store.listAnalysisBatches(pid)).map(b=>advanceAnalysisBatch(store,b)));}
