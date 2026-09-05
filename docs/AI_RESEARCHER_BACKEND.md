# AI Researcher backend

AI Researcher is a same-origin API. The browser calls `/api/research`; only the backend calls the configured model provider. The default route is Volcengine Ark Agent Plan with GLM 5.3 Flash. Provider credentials and internal session IDs are never returned to clients.

## Local Node development

Set `RESEARCH_DEV_USER_ID` to a stable local developer identity. Data is written to `RESEARCH_DATA_FILE` (default `.data/research.json`), which is gitignored.

```dotenv
RESEARCH_DEV_USER_ID=local-developer
RESEARCH_DATA_FILE=.data/research.json
RESEARCH_FILES_DIR=.data/research-files
HARNESS_API_STYLE=openai-chat
HARNESS_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
HARNESS_API_KEY=<server-only Agent Plan API key>
HARNESS_MODEL_PROVIDER=volcengine-agent-plan
HARNESS_MODEL=glm-5.3-flash
HARNESS_REASONING_EFFORT=low
HARNESS_MAX_OUTPUT_TOKENS=16384
HARNESS_TIMEOUT=300000
HARNESS_LONG_TASK_TIMEOUT=300000
HARNESS_MAX_CONTINUATIONS=3
HARNESS_MAX_TOOL_CALLS=5
HARNESS_MAX_DATA_TOOL_CALLS=8
HARNESS_MAX_QUALITATIVE_TOOL_CALLS=10
RESEARCH_DATA_ASYNC_CELL_THRESHOLD=2000000
SURVEYKIT_TOOL_API_KEY=<server-only shared secret>
SURVEYKIT_AGENT_TOOL_URL=https://surveykit.cc/api/tools/agent
```

`openai-chat` uses the Agent Plan OpenAI-compatible Chat Completions endpoint. When a formal workflow requests a SurveyKit research tool, the adapter executes the same allow-listed deterministic Tool Gateway and returns the compact result to GLM before the model continues. `dsh-rpc` and `opencode` remain supported compatibility modes.

## Cloudflare Pages production

1. Create a D1 database and apply migrations `0001` through `0019` in order. `0005_tool_results.sql` adds Project Tool Results; `0006_agent_tool_results.sql` adds Agent source/call idempotency metadata; `0007_qualitative_summary_artifacts.sql` adds the qualitative-summary Artifact type without changing existing rows or version links; `0008_research_plan_workflows.sql` adds project constraints and the persistent Research Plan Workflow record; `0009_data_analysis_workflow.sql` adds Dataset lineage, Cleaning Log, Analysis Result, Evidence, the Analysis Artifact type and the Data Analysis Workflow type; `0010_data_weight_and_exports.sql` enables audited weighting results and the seventh Tool Result type; `0011_data_jobs.sql` persists asynchronous data jobs; `0012_dataset_csv_files.sql` permits CSV project files; `0013_dataset_sav_files.sql` permits SPSS SAV project files in the D1 file metadata contract; `0014_qualitative_analysis_workflow.sql` adds immutable Transcript/Segment evidence, qualitative codes/themes/insights, the `qualitative_analysis` Artifact/Workflow types, and Transcript Tool Result types; `0015` caches deep transcript summaries; `0016` persists transcript corrections; `0017` adds the Report Storyline evidence, insight, conflict, gap, Artifact and Workflow contracts; `0018` adds the versioned `ppt_script` Artifact and Workflow contract; `0019` adds the versioned `qualitative_ppt` Artifact while keeping the PPTX itself in project-scoped file storage. If an existing environment's D1 ledger and actual schema disagree, follow [D1 migration reconciliation](./D1_MIGRATION_RECONCILIATION.md) before applying anything.
2. Bind that database to the Pages project as `RESEARCH_DB`.
3. Create a private R2 bucket and bind it as `RESEARCH_FILES`. Original uploads are stored only in R2; D1 stores metadata, bounded parsed text, summaries, structured workbook metadata and rebuildable text chunks.
4. For a deployment without login, use `RESEARCH_AUTH_MODE=anonymous` (the default). Optionally set `RESEARCH_ANONYMOUS_USER_ID`; it is a server-side workspace key, never a request parameter.
5. Configure `HARNESS_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3`, `HARNESS_API_STYLE=openai-chat`, `HARNESS_MODEL=glm-5.3-flash`, `HARNESS_TIMEOUT`, `HARNESS_LONG_TASK_TIMEOUT`, `HARNESS_MAX_CONTINUATIONS`, `HARNESS_MAX_TOOL_CALLS`, `HARNESS_MAX_DATA_TOOL_CALLS`, and `HARNESS_MAX_QUALITATIVE_TOOL_CALLS` as server-side variables. Store the Agent Plan key as `HARNESS_API_KEY` or `VOLCENGINE_AGENT_PLAN_API_KEY`. Single-interview deep summaries and transcript correction inherit the main route unless their `HARNESS_TRANSCRIPT_*` overrides are set. Keep model keys and `SURVEYKIT_TOOL_API_KEY` in the Cloudflare secret store.

Transcript processing stores two cache layers. `summary` is the deterministic structural navigation summary, while `deep_summary` is a model-generated single-interview summary with persisted `pending/processing/ready/failed` status, model, source fingerprint, generation time, and sanitized error. The UI generates missing deep summaries with at most two concurrent requests. A cached deep summary improves cross-interview orientation and recall, but it is never accepted as final evidence: the agent must still use `transcript_search` and `transcript_read`, and direct quotes are validated against the original Segment before an artifact is saved. Apply `migrations/0015_transcript_deep_summaries.sql` before enabling this feature in production.
6. Install `deploy/harness/dsh-surveykit-tools/` as a DSH/Cordis profile package, install the dedicated `deploy/harness/surveykit-research/` Agent preset, configure the same `SURVEYKIT_TOOL_API_KEY` plus `SURVEYKIT_AGENT_TOOL_URL`, and restart Harness. See `deploy/harness/README.md`.

The production Pages project uses the Standard usage model with `limits.cpu_ms=300000`. Large SAV parsing and long Harness SSE turns can exceed Cloudflare's default 30-second CPU ceiling even when their wall-clock timeout is longer; keep the CPU limit and `HARNESS_*_TIMEOUT` values aligned. Wide SAV profiles reuse the complete dictionary stored during Dataset registration (or a prior full Analysis Result) instead of reparsing all rows.

Anonymous mode is intentionally a deployment-wide shared workspace: every visitor can see and change the same projects. It avoids a login dependency, but it is appropriate only for a trusted/internal deployment or non-sensitive research content. Request headers and bodies cannot select another workspace or a Harness session.

To add login and per-user isolation later, protect the site with Cloudflare Access and set `RESEARCH_AUTH_MODE=access`, `CLOUDFLARE_ACCESS_TEAM_DOMAIN`, and `CLOUDFLARE_ACCESS_AUD` (the Access application audience). In Access mode, production identity is derived from a verified `Cf-Access-Jwt-Assertion`. SurveyKit validates the JWT signature against the Access JWKS endpoint, plus issuer, expiry and application audience; an email header alone is never trusted.

The legacy DeepSeek Harness compatibility mode uses its RPC envelope over `POST /api/session.*`, protected by nginx Basic Auth. When `HARNESS_API_STYLE=dsh-rpc`, SurveyKit creates a session with `session.create`, selects the dedicated `surveykit-research` preset and configured model through `session.selectModel`, renames the session, and submits only the fields supported by DSH `session.prompt`. The preset composition mounts only the Cordis plugin that exposes `sample_size`, `quota_design`, `questionnaire_check`, `data_profile`, `data_clean`, `data_weight`, `crosstab`, `transcript_search`, and `transcript_read`; it contains no shell, file, web, interactive, or other model-facing tool rows. SurveyKit still observes calls defensively and cancels any disallowed call. General professional calls are capped by `HARNESS_MAX_TOOL_CALLS` (default 5); formal data-analysis turns use `HARNESS_MAX_DATA_TOOL_CALLS` (default 8); formal qualitative-analysis turns use `HARNESS_MAX_QUALITATIVE_TOOL_CALLS` (default 10).

The Harness plugin calls the internal `POST /api/tools/agent/:toolId` endpoint. It sends only business arguments, Harness Session ID, and DSH Tool Call ID. SurveyKit authenticates the server-to-server call, derives the Project/user scope from its stored Harness session, executes the existing deterministic Tool Gateway service, and automatically saves the full result with `source=agent`. The plugin receives only a compact structured result; questionnaire issues and quota combinations are bounded. Reusing the same call id returns the existing Project Tool Result.

In `dsh-rpc` mode, browser streaming requests subscribe server-side to `/api/events.mux`, forward matching assistant chunks as SSE, and translate tool events into non-technical `tool_status` SSE events. Tool execution does not disable assistant streaming. All adapters support continuation when the provider ends a turn at its token limit; SurveyKit concatenates up to `HARNESS_MAX_CONTINUATIONS` follow-up turns. A missing or expired DSH session is recreated once and receives the authoritative project context again. The earlier OpenCode REST mode remains available through `HARNESS_API_STYLE=opencode` for compatibility.

The Harness plugin retries short, read-only professional calls once with the same call id. Data calls use one longer attempt (`data_profile` 45 seconds; clean/weight/crosstab 90 seconds) because they can persist results or files and must not be duplicated by a transport retry. A failure returns a structured `do_not_estimate` result so the model must explain that no deterministic answer is available. For a selected Questionnaire Artifact, an explicit “check and modify” task that actually calls `questionnaire_check` automatically saves the final reply as a child Artifact version; the original is never overwritten.

## Project files and parsing

The upload endpoint is `POST /api/research/projects/:projectId/files`. It accepts the raw file body with `X-Research-File-Name` (URL-encoded) and optional `X-Research-File-Category`. Upload returns a `pending` record immediately. Pages Functions uses `waitUntil()` and local Node uses a deferred task to parse once and update the status.

- DOCX: paragraphs and table text in reading order.
- PDF: text-layer operators only; scanned PDFs are marked as requiring OCR.
- TXT/MD: UTF-8 text.
- XLSX/CSV/SAV: ordinary file context stores a bounded structure summary. SAV parsing supports `$FL2` uncompressed/RLE and `$FL3` ZSAV, declared encodings, numeric/string/very-long-string variables, system/user missing values, dates, variable labels and value labels. After registration as a Dataset, raw rows remain server-side only and are excluded from chunks, retrieval and Harness context.
- PPTX: slide number, text, tables represented by their text runs, and notes when present.

File names, extensions, MIME types and sizes are validated. Storage keys are generated by SurveyKit and are never accepted from request data or returned to the browser.
Compressed Office/PDF streams are decompressed with a 32MB per-entry safety ceiling to limit decompression-bomb risk.

## V0.3 project memory and selective context

`lib/project-context.mjs` is the authoritative Context Builder. Each AI request always includes bounded project metadata, explicitly selected files and the current Artifact. When `auto_retrieve` is enabled, `lib/project-memory.mjs` deterministically ranks a small number of text chunks against `context_query` or the current message and adds only the best matches from files that were not explicitly selected. This is lexical project memory, not an embedding/vector service; the index can be rebuilt from parsed text.

Recent messages are excluded during a healthy Harness session and only the latest bounded window is added when a Session must be created or recovered. The final prompt is capped by `RESEARCH_MAX_CONTEXT_CHARS`. The response manifest reports `selected_files` and `retrieved_chunks` separately.

Supported chat fields are `selected_file_ids`, `artifact_id`, `page_id`, `dataset_id`, `auto_retrieve`, optional `context_query`, optional `report_constraints`, and `task_type` (`research_plan`, `data_analysis`, `qualitative_analysis`, `report_storyline`, `ppt_script`, `find_quotes`, `questionnaire`, `interview_guide`, `qualitative_summary`, `qualitative_excel_summary`, `artifact_revision`, or `free_chat`). `qualitative_analysis` sends only Transcript metadata and structural cache summaries to Harness, authorizes only `transcript_search`/`transcript_read`, validates every Direct Quote against its immutable Segment, and persists a versioned Artifact plus Evidence, Code, Theme and Insight records. `find_quotes` provides the same exact-quote validation without creating a report Artifact. `qualitative_summary` remains the legacy expanded-context path and disables professional tools. `qualitative_excel_summary` requires one recognized Excel summary template plus at least one parsed interview, asks Harness for strict question-level JSON with evidence boundaries, then lets SurveyKit clear the old respondent answers and fill a style-preserving `.xlsx`. A template's respondent-column capacity defines pagination; overflow respondents are written to cloned worksheets. The generated workbook is stored as a project file and can be downloaded from `GET /projects/:id/files/:fileId/download`. `GET /projects/:id/memory/search?q=...` previews ranked matches. The API returns only an `applied_context` manifest, not storage keys or Harness sessions.

## XLSX structured context

XLSX parsing stores a bounded JSON summary containing Sheet names, dimensions, field names and up to six preview rows per Sheet. It is available in file detail and at `GET /projects/:id/files/:fileId/structure`. Full raw workbooks remain in R2/local file storage and are not copied into the structure payload.

## Artifact versions

Artifacts can include `parent_artifact_id`. New versions remain immutable records and preserve their parent link; an older version can be viewed or selected as the base for the next AI revision.

## Research Plan Workflow

`task_type=research_plan` and revisions of a selected `research_plan` Artifact create a persistent `research_workflows` record. The record survives Harness restarts and stores `pending/running/waiting_input/completed/failed`, stage state, bounded tool-call metadata, referenced Tool Result IDs, quality-gate output, parent/final Artifact IDs, duration and a sanitized error. `GET /projects/:id/workflows` restores the latest state in the AI Researcher UI.

The workflow uses one Harness agent loop. SurveyKit injects Project Base Context, explicitly selected Brief/history files, the current Artifact for revisions, project constraints and a compact set of relevant Tool Results. It does not inject the full conversation or every project file on each revision. The Harness performs method judgment and a self-check; SurveyKit then runs a deterministic structural quality gate before saving a successful response automatically as `research_plan`.

Sample-size and quota results are reused when the selected plan is revised without changing their relevant parameters. A change to confidence, margin of error, population, response rate or target sample re-enables `sample_size`; changes to age/city/region/brand/quota structure re-enable `quota_design`. Revisions such as changing interview count or project timing keep those tools disabled and reference the prior persisted results. If a critical deterministic tool remains unavailable after the Harness plugin's bounded retry, SurveyKit saves the workflow as `waiting_input`, keeps the partial explanation in chat and does not fabricate or save a final plan Artifact.

`GET /projects/:id/artifacts/:artifactId/compare` compares a version to its parent (or to `?with=:artifactId`) with a bounded line diff. “基于此版本派生” selects that immutable version as the parent of the next saved result.

## V0.8 Evidence → Insight → Storyline → Report Outline

`task_type=report_storyline` creates a persistent seven-stage Workflow: goal → evidence index → candidate insights → validation → core insights → storyline → outline. It reads only the current Project's non-excluded `research_evidence`, persisted Insight metadata and bounded Artifact summaries. Selected files, project-memory retrieval, raw Dataset rows, full transcripts and professional tools are disabled for this workflow. `RESEARCH_REPORT_MAX_EVIDENCE`, `RESEARCH_REPORT_EVIDENCE_CONTEXT_CHARS` and `RESEARCH_REPORT_MAX_CONTEXT_CHARS` bound the prompt.

Evidence records carry normalized type, strength, theme and exclusion state. Insights remain separate conclusions with interpretation, business implication, confidence, level, status, pin state and explicit Evidence links. Server-side normalization rejects cross-project or nonexistent Evidence IDs, deduplicates close Insights, preserves segmented counterexamples, records unresolved conflicts and creates Evidence Gaps instead of inventing support. The saved `report_outline` JSON contains 3–7 Core Insights, coverage summaries, Storyline sections, chapters and conclusion-style Page Topics. Revisions use only the selected Outline plus the refreshed Evidence Index and create immutable V2/V3 child Artifacts.

Apply `migrations/0017_report_storyline_workflow.sql` after the earlier migrations before enabling V0.8. The AI Researcher exposes Evidence search/detail/exclusion, Insight pinning, conflict/gap warnings and a “报告大纲” quick task. This release stops at the structured Report Outline and does not generate PowerPoint.

## PPT Script workflow (V0.9)

`task_type=ppt_script` converts a selected `report_outline` Artifact into a structured, versioned `ppt_script` Artifact. Each page stores its chapter and type, conclusion title, subtitle, purpose, key message, content regions, supported data points or exact quotes, visual and layout specs, Evidence IDs, source notes, density status, and transitions. The default `research_consulting` style uses 16:9, white background, blue emphasis, dark-gray body copy and restrained decoration.

The server sends Harness only the selected Report Outline, relevant Core Insights and the Evidence IDs already referenced by that outline (or only the target page during `page_id` revision). It disables file selection, project-memory retrieval and professional tools, and records zero raw transcript characters and zero raw Dataset rows in the applied-context manifest. Deterministic post-processing removes fabricated chart values, rejects mismatched data sources and non-verbatim quotes, creates Evidence Gaps, flags overloaded pages, merges near-duplicate pages and checks Storyline continuity. Manual saves also reject cross-project/excluded Evidence and report-outline sources.

The Artifact UI exposes “生成 PPT 脚本” from a Report Outline, structured page cards, Evidence drill-down, title/Purpose/Key Message/Evidence/Visual/Layout editing, reorder/delete/add actions and target-page AI revision. Every change creates a child Artifact version while preserving the source Report Outline relationship; it does not create `.pptx`, images, HTML, Word reports or speaker notes. Apply `migrations/0018_ppt_script_workflow.sql` before enabling V0.9.

V0.10 adds “生成定性报告 PPT” from a qualitative-analysis result or PPT Script. The browser calls the deterministic renderer, uploads the returned editable `.pptx` to the current project's file storage, and creates a `qualitative_ppt` Artifact whose metadata binds the source qualitative-analysis Artifact(s), Report Outline, PPT Script, file, validation result and native-object counts. Rendering calls no LLM and never changes evidence or quote text. Apply `migrations/0019_qualitative_ppt_artifact.sql` before enabling this capability.

The V0.10 renderer uses a stable engine boundary. OfficeCLI is now the primary enterprise renderer for every qualitative page type and writes editable native Text, Shape and Connector objects from the persisted PPT Script; `python-pptx` remains the compatibility fallback. Both engines consume the same page-type-aware adaptive layout output: dense cards, quotes, segments, persona attributes, journey stages, needs mappings and priority-matrix items are deterministically continued onto new slides before rendering, so renderer-side item caps cannot silently discard content. OfficeCLI also runs the output gate (`validate`, `view issues`, and `view stats`) before export. The API and Artifact metadata return both `renderer` and `quality_gate`, including explicit fallback reasons, so a compatibility export is never presented as an OfficeCLI build. Configure `QUALITATIVE_PPT_RENDER_ENGINE=auto` (default), `officecli`, or `python-pptx`; configure `QUALITATIVE_PPT_OFFICECLI_QA=prefer` (default), `required`, or `off`; set `OFFICECLI_PATH=/usr/local/bin/officecli` on Linux. `auto` prefers OfficeCLI and falls back only when it is unavailable or fails under `prefer`; `officecli` and `required` block export instead of silently falling back. The model never emits OfficeCLI commands and the renderer never changes Evidence or verbatim Quotes.

## V0.6 Dataset and Data Analysis Workflow

Data correctness constraints (2026-09-05): numeric missing values (`null`, empty/whitespace strings, absent values) are excluded before conversion; genuine zero remains valid. Weighted categorical percentages use valid answer/banner pairs and positive weights, matching the unweighted valid-base convention when weights are equal. RIM trim bounds apply to final mean-one weights; the bounds must contain 1, and convergence/residuals are recomputed after bounded normalization. `diagnostics.convergence_note` explicitly reports nonconvergence. A Weighted Dataset cannot be cleaned directly: use its Raw/Clean source and then reweight. Each uploaded file currently permits one Raw Dataset/Sheet; re-registering the same Sheet is idempotent, while requesting another Sheet fails with `DATASET_SHEET_CONFLICT` and asks for a separate upload. This preserves the existing D1 unique-file contract without requiring a migration. Local project deletion now resolves both `storage_key` and `storage_path` and keeps metadata for retry if any file deletion fails.

`POST /projects/:id/datasets` registers an uploaded XLSX/CSV/SAV file as an immutable Raw Dataset. For SAV, analysis rows use SPSS value labels when present and declared user-missing values are treated as missing. `data_profile` reads the server-side table, persists the full profile as an Analysis Result, returns a bounded complete field-name index, and supports `field_query` across every variable name, question label and value label; raw rows never enter Harness context. Returned metadata is still bounded by `field_limit`. `data_clean` accepts structured rules and first returns the estimated affected rows; any non-low-risk or material deletion requires `confirmed=true`. Execution writes a new Clean Dataset with `parent_dataset_id`, records a Cleaning Log and never mutates Raw bytes. `data_weight` requires explicit target margins, always previews before `confirmed=true`, runs bounded RIM weighting, records convergence/design-effect/effective-base diagnostics and creates an immutable Weighted Dataset with an `__weight` field. `crosstab` accepts at most three banner fields and twelve analysis fields, calculates base/percent/NPS/mean, uses SAV question labels to recognize Q-coded NPS variables, persists full structured JSON and a downloadable multi-sheet Excel project file, and returns bounded key findings plus `result_id`/`excel_file_id`.

`task_type=data_analysis` runs the persistent stages understanding → profile → optional cleaning/weighting → analysis plan → crosstab → interpretation → Analysis Artifact. Harness receives only public Dataset metadata, a bounded field index and compact Tool Results. It is instructed to distinguish data fact, interpretation and hypothesis, and every fact in the final Artifact must cite `Evidence: <result_id>`. Deterministic key findings are persisted in `research_evidence` with their source Analysis Result. Weighted crosstabs report weighted bases, but deliberately disable ordinary independent-sample significance flags because no complex-sample design correction is implemented.

Direct profile/clean/weight/crosstab endpoints accept `async=true`. They also queue automatically when `row_count × column_count` reaches `RESEARCH_DATA_ASYNC_CELL_THRESHOLD` (default 2,000,000). The API returns `202` with a persistent job; `GET /projects/:id/data-jobs/:jobId` returns bounded progress and the final compact result. Local Node schedules jobs in-process and Pages Functions uses `waitUntil`; this is durable result storage, not a guaranteed-delivery queue. A future high-volume deployment should move execution to Cloudflare Queues or Workflows.

Raw Dataset source files cannot be recategorized or deleted independently. Deleting a project removes both uploaded source files and derived Clean Dataset objects. The Dataset UI shows version lineage, sample/field counts and direct Profile/Analysis actions without exposing raw rows to the model.

## Optional OCR

OCR is deliberately provider-neutral and disabled until `RESEARCH_OCR_ENDPOINT` is configured. `POST /projects/:id/files/:fileId/ocr` currently accepts PDF files and enqueues a server-side request containing the original PDF bytes. The OCR endpoint receives `Content-Type`, `X-Research-File-Name` and an optional bearer token from `RESEARCH_OCR_API_KEY`, then returns JSON with `text` and optional `provider`. OCR status and errors are visible on the file; successful text replaces the unavailable text layer and rebuilds the project-memory chunks. Secrets never reach the browser.

## Limits

File, parsing, context, data-job and request budgets are configured with the `RESEARCH_MAX_*`, `RESEARCH_DATA_ASYNC_CELL_THRESHOLD` and `RESEARCH_AI_REQUESTS_*` variables documented in `.env.example`. Edge usage counters are stored in D1; local development uses an in-process counter. These are safety budgets, not billing-grade metering. The new weighting core is checked independently with `npm run typecheck`; legacy browser modules remain JavaScript and are not yet covered by strict TypeScript checking.
