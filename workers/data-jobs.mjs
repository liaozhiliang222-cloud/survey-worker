import { createResearchStore, dataStorage } from '../functions/api/research/[[path]].js';
import { sweepDataJobs } from '../lib/data-jobs.mjs';

export default {
  async scheduled(controller, env, ctx) {
    // D1 is the queue: creating a job and enqueueing are the same durable write.
    // Concurrent cron invocations use atomic claims and fenced publication.
    const count = await sweepDataJobs({ store: createResearchStore(env.RESEARCH_DB), fileStorage: dataStorage(env), limit: 1 });
    console.log(JSON.stringify({ event: 'data_job_sweep', scheduled_at: controller.scheduledTime, selected: count }));
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};
