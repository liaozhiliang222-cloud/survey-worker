import { remoteDataStorage } from '../lib/data-executor-client.mjs';
import { executeDataJob, sweepDataJobs } from '../lib/data-jobs.mjs';
import { runDataToolThread } from '../lib/data-jobs-local.mjs';
import { registerRawDataset,exportCrosstabResults,createDataToolExecutor } from '../lib/data-engine.mjs';
import { parseProjectFile } from '../lib/project-file-parser.mjs';
import { chunkProjectText } from '../lib/project-memory.mjs';
const {store,fileStorage}=remoteDataStorage({base:process.env.DATA_STORAGE_BASE,secret:process.env.DATA_EXECUTOR_SECRET});
async function parseFile(file) {
 if(!file || !['csv','sav','xlsx'].includes(file.file_type))throw Error('FILE_SCOPE_INVALID');
 if(file.parse_status==='completed')return {completed:true};
 await store.updateFile(file.project_id,file.id,{parse_status:'processing',parse_note:'正在解析文件'});
 try {
  const bytes=await fileStorage.get(file.storage_key);
  const parsed=await parseProjectFile(bytes.buffer,{extension:file.file_type,fileName:file.file_name,maxParsedChars:250000,summaryChars:2000});
  const data=file.category==='data';
  const structure=data&&parsed.structuredData?.kind==='xlsx_workbook'?{...parsed.structuredData,sheets:(parsed.structuredData.sheets||[]).map(({preview_rows,...sheet})=>sheet)}:parsed.structuredData;
  const text=data?`数据集结构摘要。${(structure?.sheets||[]).map(sheet=>`${sheet.name}: ${sheet.row_count} 行 × ${sheet.column_count} 列；字段：${(sheet.fields||[]).join('、')}`).join('\n')}`:parsed.parsedText;
  await store.replaceFileChunks(file.project_id,file.id,data?[]:chunkProjectText(text,{targetChars:1800,overlapChars:180,maxChunks:48}));
  await store.updateFile(file.project_id,file.id,{parse_status:parsed.status,parsed_text:text,summary:data?text.slice(0,2000):parsed.summary,structured_data:JSON.stringify(structure||{}),parse_note:data?'原始数据行仅保留在 Data Layer，不进入 AI 上下文。':parsed.parseNote,ocr_status:'not_requested',ocr_note:''});
  return {completed:true};
 } catch(error) {await store.updateFile(file.project_id,file.id,{parse_status:'failed',parse_note:'文件解析失败，可重试。',parsed_text:'',summary:''});throw error;}
}
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2*1024*1024)throw Error('BODY_LIMIT');}
const input=JSON.parse(raw),started=Date.now();
try {
 let result;
 if(input.operation==='sweep') {result=await sweepDataJobs({store,fileStorage,limit:1,heartbeatInterval:15000,runTool:runDataToolThread});if(!result){const files=await store.listPendingDataFiles();if(files[0])await parseFile(files[0]);}}
 else {
  const project=await store.getProject(input.userId,input.projectId);if(!project)throw Error('PROJECT_SCOPE_INVALID');
  const scope={store,fileStorage,userId:input.userId,projectId:project.id};
  if(input.operation==='register') {const file=await store.getFile(project.id,input.fileId);result=await registerRawDataset({...scope,file,name:input.name,sheetName:input.sheetName});}
  else if(input.operation==='export') {const dataset=await store.getDataset(project.id,input.datasetId);result=await exportCrosstabResults({...scope,dataset});}
  else if(input.operation==='parse') {const file=await store.getFile(project.id,input.fileId);result=await parseFile(file);}
  else if(input.operation==='job') {const job=await store.getDataJob(project.id,input.jobId);if(!job||job.user_id!==input.userId)throw Error('JOB_SCOPE_INVALID');result=await executeDataJob({store,fileStorage,job,heartbeatInterval:15000,runTool:runDataToolThread});}
  else if(input.operation==='tool') {result=await createDataToolExecutor({store,fileStorage})({agentToolId:input.toolId,args:input.args,scope:{project,user_id:input.userId}});}
  else throw Error('OPERATION_INVALID');
 }
 process.stdout.write(JSON.stringify({result}));
} catch(error) { process.stdout.write(JSON.stringify({error:{code:error.code||'DATA_EXECUTION_FAILED',message:String(error.message).slice(0,500)}}));process.exitCode=1; }
finally {process.stderr.write(JSON.stringify({event:'data_execution',operation:input.operation,duration_ms:Date.now()-started,max_rss_kib:process.resourceUsage().maxRSS})+'\n');}
