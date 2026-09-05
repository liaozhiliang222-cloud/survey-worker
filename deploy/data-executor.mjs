import http from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { authorizedDataExecutor,boundedBytes } from '../lib/data-executor-transport.mjs';
const secret=process.env.DATA_EXECUTOR_SECRET;
if(!secret || secret.length<32 || !/^https:\/\//.test(process.env.DATA_STORAGE_BASE||''))throw Error('DATA_EXECUTOR_NOT_CONFIGURED');
const lock=process.env.SURVEYKIT_HEAVY_LOCK || '/tmp/surveykit-heavy.lock';
let active=0,sweeping=false;
function run(payload,sweep=false) {
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/flock',['--no-fork',...(sweep?['-n','-E','75']:['-w','85','-E','75']),lock,process.execPath,'--max-old-space-size=320',new URL('./data-executor-child.mjs',import.meta.url).pathname],{stdio:['pipe','pipe','pipe']});
  // Durable jobs outlive their HTTP caller; only the job deadline terminates execution.
  let output='',errorLog='';const timer=setTimeout(()=>child.kill('SIGKILL'),(sweep||payload.operation==='job')?650000:105000);
  child.stdout.on('data',data=>{output+=data;if(output.length>4*1024*1024)child.kill('SIGKILL');});
  child.stderr.on('data',data=>{errorLog=(errorLog+data).slice(-4000);});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',(code)=>{clearTimeout(timer);if(errorLog)console.error(errorLog.trim());if(code===75)return resolve({error:{code:'DATA_EXECUTOR_BUSY',message:'其他报告或数据任务正在执行，请稍后重试。'}});try{resolve(JSON.parse(output));}catch{reject(Error('DATA_EXECUTOR_PROCESS_FAILED'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
 });
}
const server=http.createServer(async(req,res)=>{
 const respond=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 const request={headers:new Headers(req.headers)};
 if(!authorizedDataExecutor(request,secret))return respond(401,{error:{code:'UNAUTHORIZED'}});
 if(req.method==='GET'&&req.url==='/healthz')return respond(200,{ok:true,service:'surveykit-data-executor',active,revision:process.env.SURVEYKIT_COMMIT});
 if(req.method!=='POST'||req.url!=='/execute')return respond(404,{error:{code:'NOT_FOUND'}});
 if(active>=2)return respond(503,{error:{code:'DATA_EXECUTOR_BUSY',message:'数据任务繁忙，请稍后重试。'}});
 active++;
 try {const payload=JSON.parse(new TextDecoder().decode(await boundedBytes(Readable.toWeb(req),2*1024*1024)));if(!['register','export','parse','tool','job'].includes(payload.operation))return respond(400,{error:{code:'OPERATION_INVALID'}});const result=await run(payload);respond(result.error?422:200,result);}
 catch{respond(503,{error:{code:'DATA_EXECUTOR_UNAVAILABLE',message:'数据任务执行中断，可稍后重试。'}});}finally{active--;}
});
server.listen(Number(process.env.DATA_EXECUTOR_PORT||8010),'127.0.0.1');
async function sweep(){if(sweeping||active)return;sweeping=true;try{const result=await run({operation:'sweep'},true);if(result.error&&result.error.code!=='DATA_EXECUTOR_BUSY')console.error(JSON.stringify({event:'data_sweep_error',code:result.error.code}));}catch(error){console.error(JSON.stringify({event:'data_sweep_error',code:error.message}));}finally{sweeping=false;}}
setInterval(sweep,30000);void sweep();
