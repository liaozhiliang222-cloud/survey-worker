import { parentPort, workerData } from 'node:worker_threads';
import { createDataToolExecutor } from './data-engine.mjs';

let sequence = 0;
const pending = new Map();
parentPort.on('message', ({ id, result, error }) => {
  const call = pending.get(id); if (!call) return; pending.delete(id);
  if (error) call.reject(Object.assign(new Error(error.message), { code: error.code })); else call.resolve(result);
});
const proxy = (target) => new Proxy({}, { get: (_, method) => (...args) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); parentPort.postMessage({ id, target, method, args });
}) });
const storage = proxy('storage');
// key() is intentionally synchronous in the engine. The host supplies unique
// reserved output paths; neither source files nor previous attempts are reused.
const localStorage = { get: storage.get, put: storage.put, delete: storage.delete, key: () => workerData.keys.shift() };
try {
  const result = await createDataToolExecutor({ store: proxy('store'), fileStorage: localStorage })(workerData.request);
  parentPort.postMessage({ done: true, result });
} catch (error) { parentPort.postMessage({ done: true, error: { message: error.message, code: error.code } }); }
