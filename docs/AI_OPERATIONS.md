# AI service operations

## Routing policy

- \`fast\`: low-latency models first.
- \`storyline\`: Flash models with a shorter request budget.
- \`structured\`: Flash first, then JSON-capable fallbacks.
- \`quality\`: Pro and quality models remain ahead of Flash.
- Providers serving the same model are rotated deterministically per request.
- A failed provider is skipped immediately when an equivalent provider is available.

Set \`AI_ROTATION_MODE=off\` to disable provider rotation. The default is \`deterministic\`.

## Diagnostics

Every AI response exposes:

- \`X-AI-Request-ID\`
- \`X-AI-Duration-Ms\`
- \`X-AI-Source\`
- \`X-Actual-Model\`
- \`X-AI-Attempt-Sources\`
- \`X-AI-Rotation\`
- \`X-AI-Fallback-Used\`
- \`X-AI-Error-Type\`

The proxy also writes one structured \`ai_proxy_request\` JSON log per completed request. Prompts, API keys, and response bodies are never logged.

## Health and canary

\`GET /api/ai\` reports configured sources and rotation mode without calling a model.

Run an active canary with:

\`\`\`powershell
npm run probe:ai
npm run probe:ai -- --base-url=https://surveykit.cc --tiers=fast,storyline,quality
\`\`\`

The command exits non-zero if configuration health or any model request fails.

## Durable AI jobs

Long structured report operations use the PPTX backend as a durable job coordinator:

- `POST /pptx-api/ai-jobs` creates a job and returns immediately.
- `GET /pptx-api/ai-jobs/{job_id}` returns progress, attempts, diagnostics, and the final result.
- `POST /pptx-api/ai-jobs/{job_id}/cancel` requests cancellation.
- Requests and results survive browser refreshes and backend process restarts for up to two hours.
- Storyline and SlideBrief batches reuse completed jobs after a refresh. The browser may require the source file to be selected again before applying results.
- User-supplied API keys never enter durable jobs and continue through the synchronous proxy path.

The backend retries transient `408`, `425`, `429`, `500`, `502`, `503`, `504`, and `524` failures with a new rotation key. Configure it with:

- `AI_PROXY_URL` (default: `https://surveykit.cc/api/ai`)
- `AI_JOB_TIMEOUT_SECONDS` (default: `90`)
- `AI_JOB_MAX_ATTEMPTS` (default: `3`, maximum: `5`)
- `AI_MAX_CONCURRENT_JOBS` (default: `4`)

`GET /pptx-api/healthz` exposes `capabilities.ai_jobs` and the effective timeout/retry settings.
