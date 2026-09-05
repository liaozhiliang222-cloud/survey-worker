import { Worker } from 'node:worker_threads';
import { sweepDataJobs } from './data-jobs.mjs';

export function runDataToolThread({ store, fileStorage, request, signal }) {
  return new Promise((resolve, reject) => {
    const extension = request.agentToolId === 'crosstab' ? 'xlsx' : 'json';
    const keys = [fileStorage.key(request.scope.project.id, crypto.randomUUID(), extension)];
    const worker = new Worker(new URL('./data-job-thread.mjs', import.meta.url), { workerData: { request, keys } });
    let finished = false;
    const finish = (error, result) => { if (finished) return; finished = true; signal.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => finish(signal.reason || new Error('DATA_JOB_ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => { if (!finished) finish(new Error(`DATA_JOB_WORKER_EXIT:${code}`)); });
    worker.on('message', async (message) => {
      if (message.done) { finish(message.error ? Object.assign(new Error(message.error.message), { code: message.error.code }) : null, message.result); return; }
      try {
        if (finished) return;
        const target = message.target === 'store' ? store : fileStorage;
        const result = await target[message.method](...message.args);
        if (!finished) worker.postMessage({ id: message.id, result });
      } catch (error) { if (!finished) worker.postMessage({ id: message.id, error: { message: error.message, code: error.code } }); }
    });
  });
}
export function sweepLocalDataJobs(options) { return sweepDataJobs({ ...options, runTool: runDataToolThread }); }
