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
