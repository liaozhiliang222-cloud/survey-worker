// Server-to-server credential; never forwarded from browser input.
export function authorizedDataExecutor(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  const expected = `Bearer ${secret}`;
  let difference = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return difference === 0;
}
export async function boundedBytes(stream, maximum) {
  const reader = stream?.getReader(); if (!reader) return new Uint8Array();
  const parts = []; let length = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > maximum) { await reader.cancel(); throw Object.assign(new Error('请求内容过大'), {code:'DATA_EXECUTOR_BODY_LIMIT'}); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(length); let offset = 0; for (const part of parts) { out.set(part,offset); offset += part.length; } return out;
}
export async function requestDataExecutor(env, payload) {
  const url = new URL(env.DATA_EXECUTOR_URL);
  if (url.protocol !== 'https:' || !env.DATA_EXECUTOR_SECRET) throw new Error('DATA_EXECUTOR_NOT_CONFIGURED');
  const response = await fetch(url, { method:'POST', redirect:'error', headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.DATA_EXECUTOR_SECRET}`}, body:JSON.stringify(payload), signal:AbortSignal.timeout(110000) });
  const body = JSON.parse(new TextDecoder().decode(await boundedBytes(response.body, 4*1024*1024)));
  if (!response.ok || body.error) throw Object.assign(new Error(body.error?.message || '数据执行服务暂不可用'), {code:body.error?.code || 'DATA_EXECUTOR_UNAVAILABLE'});
  return body.result;
}
