import { ToolInputError } from './tools/errors.mjs';
import { createDataToolExecutor } from './data-engine.mjs';
import { createJobStage } from './data-job-stage.mjs';

export const leaseMs = 120_000;
export const maxRunMs = 600_000;
export function publicDataJob(job) {
  if (!job) return null;
  const { user_id, input, lease_token, request_hash, ...safe } = job;
  return { ...safe, result: JSON.parse(job.result || '{}'), retryable: job.status === 'failed', cancellable: ['pending', 'running'].includes(job.status) };
}
function canonical(value) { return JSON.stringify(value, function (key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]])) : item; }); }
export async function enqueueDataJob(store, userId, projectId, toolId, input, suppliedKey, { agentCallId } = {}) {
  const args = { ...input }; delete args.async; delete args.idempotency_key; delete args.__agent_call_id;
  if (agentCallId) args.__agent_call_id = agentCallId;
  const dataset = await store.getDataset(projectId, args.dataset_id);
  if (!dataset) throw new ToolInputError('数据集不存在。', 'DATASET_NOT_FOUND');
  if (dataset.type === 'weighted' && ['data_clean', 'data_weight'].includes(toolId)) throw new ToolInputError('请返回原始或清洗版本修改，再重新加权。', 'DATASET_WEIGHTED_MUTATION_FORBIDDEN');
  const key = suppliedKey || crypto.randomUUID();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new ToolInputError('幂等键须为 8–128 位字母、数字或 . _ : -。', 'DATA_JOB_KEY_INVALID');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ toolId, args })));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const job = await store.createDataJob(userId, projectId, { dataset_id: args.dataset_id, tool_id: toolId, input: args, idempotency_key: key, request_hash: hash });
  if (job.request_hash !== hash) throw new ToolInputError('该幂等键已用于不同参数，请使用新的请求键。', 'DATA_JOB_KEY_CONFLICT');
  return publicDataJob(job);
}

export async function executeDataJob({ store, fileStorage, job, leaseDuration = leaseMs, timeout = maxRunMs, runTool = ({ store, fileStorage, request }) => createDataToolExecutor({ store, fileStorage })(request) }) {
  const token = crypto.randomUUID();
  const claimed = await store.claimDataJob(job.project_id, job.id, token, leaseDuration, timeout);
  if (!claimed) return false;
  const stage = createJobStage(store, job.project_id, job.user_id);
  const keys = new Set();
  let committed = false;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error('DATA_JOB_TIMEOUT')), timeout); deadline.unref?.();
  const heartbeat = setInterval(() => { store.heartbeatDataJob(job.project_id, job.id, token, leaseDuration).then((live) => { if (!live) controller.abort(new Error('DATA_JOB_LEASE_LOST')); }).catch(() => {}); }, Math.max(10, Math.min(1000, leaseDuration / 3)));
  heartbeat.unref?.();
  try {
    const guardedStorage = {
      key: (...args) => fileStorage.key(...args), get: (...args) => fileStorage.get(...args),
      async put(key, bytes) {
        if (!await store.heartbeatDataJob(job.project_id, job.id, token, leaseDuration)) throw new Error('DATA_JOB_LEASE_LOST');
        keys.add(key); await fileStorage.put(key, bytes);
        const persisted = await fileStorage.get(key);
        const a = new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
        const b = new Uint8Array(persisted.buffer || persisted, persisted.byteOffset || 0, persisted.byteLength);
        if (a.length !== b.length || a.some((v, i) => v !== b[i])) throw new Error('DATA_JOB_STORAGE_INCOMPLETE');
      },
      async delete(key) { if (keys.has(key)) await fileStorage.delete(key); },
    };
    const executed = await runTool({ store: stage.store, fileStorage: guardedStorage, signal: controller.signal, request: { agentToolId: job.tool_id, args: JSON.parse(job.input), scope: { project: { id: job.project_id }, user_id: job.user_id } } });
    const saved = await stage.store.createToolResult(job.user_id, job.project_id, executed.gatewayId, executed.input, executed.compact, { agent_call_id: JSON.parse(job.input).__agent_call_id });
    const result = { tool_result: { ...saved, user_id: undefined, input: JSON.parse(saved.input), result: JSON.parse(saved.result) }, data: executed.compact };
    committed = await store.publishDataJob(job.project_id, job.id, token, stage.records, result);
    return committed;
  } catch (error) {
    // A response can be lost after a successful commit. Never delete its files.
    const current = await store.getDataJob(job.project_id, job.id).catch(() => null);
    if (current?.status === 'completed') committed = true;
    else await store.failDataJob(job.project_id, job.id, token, String(error?.code || error?.message || 'DATA_JOB_FAILED').slice(0, 2000));
    return committed;
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    // Ambiguous publication is retained for the read-only orphan audit; cleanup
    // of staged objects is deliberately not performed on an uncertain commit.
  }
}

export async function sweepDataJobs({ store, fileStorage, limit = 4, ...options }) {
  await store.expireDataJobs();
  const jobs = await store.listRunnableDataJobs(limit);
  for (const job of jobs) await executeDataJob({ store, fileStorage, job, ...options });
  return jobs.length;
}
