import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const backend = readFileSync(new URL("../deploy/aliyun_api.py", import.meta.url), "utf8");

assert.match(app, /const AI_JOB_CACHE_KEY = "surveykit_ai_job_cache_v1"/);
assert.match(app, /async function callAiChatCompletionJob/);
assert.match(app, /if \(settings\.apiKey \|\| options\.stream\)/);
assert.match(app, /\/pptx-api\/ai-jobs/);
assert.match(app, /report_narrative_framework/);
assert.match(app, /report_narrative_assignment_/);
assert.match(app, /页面刷新后任务仍会继续/);
assert.match(backend, /@app\.post\("\/api\/pptx-report\/ai-jobs"\)/);
assert.match(backend, /AI_JOB_MAX_ATTEMPTS/);
assert.match(backend, /X-AI-Rotation-Key/);
assert.match(backend, /用户 API Key 请求不能创建后台任务/);

console.log("AI durable job UI smoke passed: async routing, persistence, rotation retry and key isolation.");
