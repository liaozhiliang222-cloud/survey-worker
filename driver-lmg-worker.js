importScripts('./driver-core.js?v=20261017-all11-1', './driver-lmg.js?v=20261017-all11-1');
self.onmessage = event => {
  const { id, table, jobs, extraMissing } = event.data;
  try {
    const dataset = DriverCore.normalizeTable(table);
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const result = DriverLMG.runJob(dataset, job, extraMissing, { progress: progress => self.postMessage({ id, type: 'progress', job: job.id, index: i, count: jobs.length, label: job.label, ...progress }) });
      self.postMessage({ id, type: 'result', result, index: i, count: jobs.length });
    }
    self.postMessage({ id, type: 'complete' });
  } catch (error) { self.postMessage({ id, type: 'error', message: error.message }); }
};
