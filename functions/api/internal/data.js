import { createResearchStore } from '../research/[[path]].js';
import { authorizedDataExecutor, boundedBytes } from '../../../lib/data-executor-transport.mjs';

// This endpoint accepts only a dedicated service credential, never research anonymous identity.
const methods = new Set(['getProject','getDataset','getFile','listDatasets','listAnalysisResults','createDataset','createFile','updateFile','deleteFile','replaceFileChunks','createCleaningLog','createAnalysisResult','createEvidence','createToolResult','getDataJob','listRunnableDataJobs','listPendingDataFiles','claimDataJob','heartbeatDataJob','expireDataJobs','failDataJob','publishDataJob']);
const objectKey = /^(research\/[a-f0-9]{24}|datasets\/[A-Za-z0-9_%:-]{1,256})\/[A-Za-z0-9_-]{1,128}\.[a-z0-9]{1,8}$/;
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function onRequest({request,env}) {
  if (!authorizedDataExecutor(request,env.DATA_EXECUTOR_SECRET)) return json({error:{code:'UNAUTHORIZED'}},401);
  if (!env.RESEARCH_DB || !env.RESEARCH_FILES) return json({error:{code:'STORAGE_UNAVAILABLE'}},503);
  try {
    const url = new URL(request.url), key = url.searchParams.get('key');
    if (key !== null) {
      if (!objectKey.test(key)) return json({error:{code:'OBJECT_KEY_INVALID'}},400);
      if (request.method === 'GET') { const object = await env.RESEARCH_FILES.get(key); return object ? new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','Content-Length':String(object.size)}}) : json({error:{code:'DATASET_FILE_NOT_FOUND'}},404); }
      if (!key.startsWith('datasets/')) return json({error:{code:'SOURCE_WRITE_FORBIDDEN'}},403);
      if (request.method === 'PUT') {
        const size = Number(request.headers.get('Content-Length'));
        if (!Number.isSafeInteger(size) || size < 1 || size > 64*1024*1024) return json({error:{code:'OBJECT_SIZE_LIMIT'}},413);
        await env.RESEARCH_FILES.put(key,request.body); return json({result:true});
      }
      if (request.method === 'DELETE') { await env.RESEARCH_FILES.delete(key); return json({result:true}); }
      return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
    }
    if (request.method !== 'POST') return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
    const {method,args} = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,2*1024*1024)));
    if (!methods.has(method) || !Array.isArray(args) || args.length > 8) return json({error:{code:'METHOD_NOT_ALLOWED'}},400);
    if (method === 'listRunnableDataJobs' && (args.length !== 1 || args[0] !== 1)) return json({error:{code:'JOB_LIMIT'}},400);
    const store = createResearchStore(env.RESEARCH_DB);
    if (method === 'listPendingDataFiles') {
      await env.RESEARCH_DB.prepare("UPDATE research_project_files SET parse_status='failed',parse_note='文件解析已中断，请重试。' WHERE file_type IN ('csv','sav','xlsx') AND parse_status='processing' AND updated_at<?").bind(new Date(Date.now()-180000).toISOString()).run();
      const row = await env.RESEARCH_DB.prepare("SELECT * FROM research_project_files WHERE file_type IN ('csv','sav','xlsx') AND parse_status='pending' ORDER BY created_at LIMIT 1").first();
      return json({result:row ? [row] : []});
    }
    return json({result:await store[method](...args)});
  } catch(error) { return json({error:{code:error.code || 'DATA_STORAGE_ERROR',message:'数据存储操作失败'}},400); }
}
