import { boundedBytes } from './data-executor-transport.mjs';
export function remoteDataStorage({base,secret}) {
  const endpoint = new URL('/api/internal/data',base).href;
  async function request(suffix,options={}) {
    const response = await fetch(endpoint+suffix,{...options,redirect:'error',headers:{...options.headers,Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Object.assign(new Error(`DATA_STORAGE_HTTP_${response.status}`),{code:'DATA_STORAGE_UNAVAILABLE'});
    return response;
  }
  const call = async (method,args) => {
    const response = await request('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});
    const body=JSON.parse(new TextDecoder().decode(await boundedBytes(response.body,4*1024*1024)));
    if(body.error)throw Object.assign(new Error(body.error.message),{code:body.error.code});return body.result;
  };
  const store = new Proxy({}, {get:(_,method)=>method==='then'?undefined:(...args)=>call(method,args)});
  const fileStorage = {
    key:(pid,id,ext)=>`datasets/${encodeURIComponent(pid)}/${id}.${ext}`,
    get:async key=>boundedBytes((await request('?key='+encodeURIComponent(key))).body,64*1024*1024),
    put:async(key,bytes)=>{const response=await request('?key='+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.byteLength)},body:bytes});await response.arrayBuffer();},
    delete:async key=>{const response=await request('?key='+encodeURIComponent(key),{method:'DELETE'});await response.arrayBuffer();},
  };
  return {store,fileStorage};
}
