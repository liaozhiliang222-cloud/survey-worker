# SurveyKit Research Tools for DeepSeek Harness

The production Harness is DSH/Cordis. Install `dsh-surveykit-tools/` as a profile-local package, link it from the profile `package.json`, and install `surveykit-research/` as a dedicated user Agent preset. SurveyKit must use `HARNESS_AGENT_PRESET=surveykit-research`.

Configure these server-only environment variables on the Harness host:

```dotenv
SURVEYKIT_AGENT_TOOL_URL=https://surveykit.cc/api/tools/agent
SURVEYKIT_TOOL_API_KEY=<same secret configured on SurveyKit>
```

The dedicated preset exposes only `sample_size`, `quota_design`, `questionnaire_check`, `data_profile`, `data_clean`, `data_weight`, `crosstab`, `transcript_search`, and `transcript_read`: its composition contains no shell, file, web, interactive, or other model-facing tool rows. SurveyKit does not send unsupported fields in `session.prompt`. Do not add this plugin to a broader preset; its registrations are intentionally isolated in `surveykit-research`.

Data tools receive only a project-scoped `dataset_id`. SurveyKit derives project ownership from the stored Harness Session, verifies the dataset belongs to that project, and loads XLSX, CSV, or SPSS SAV rows inside the Data Layer. `data_profile` exposes a bounded complete field-name index and accepts `field_query` to search every SAV variable name, question label and value label; raw rows and storage paths are never returned to Harness. Data calls use one longer attempt instead of automatic transport retries so persisted analysis results and Excel files cannot be duplicated. `data_clean` creates a new immutable lineage node and requires explicit confirmation for non-mechanical or high-impact rules. `data_weight` accepts only explicit, complete target distributions, always previews diagnostics before confirmation, and creates a new Weighted Dataset instead of mutating its parent.

Qualitative Excel summaries also run through this preset, but are not a fourth deterministic plugin tool. SurveyKit supplies a strict JSON-only prompt containing the authorized question framework and interview excerpts, disables all tools for that turn, validates the response, and performs the binary Excel fill itself. This keeps workbook I/O, old-answer clearing, pagination, and download authorization outside the model runtime.

The plugin never receives a browser cookie, a frontend token, `project_id`, or `user_id`; it sends only the Harness Session ID, stable Tool Call ID, and validated model arguments. SurveyKit derives project ownership from the stored Harness Session mapping.

Recommended server layout:

```text
~/.dsh/profiles/web/plugins/dsh-surveykit-tools/
~/.dsh/.agent-presets/surveykit-research/
/etc/surveykit/dsh-tools.env
```

Add `"dsh-surveykit-tools": "link:plugins/dsh-surveykit-tools"` to the profile dependencies and run `pnpm install --offline` from the profile directory. Keep the environment file mode `0600`, reference it from a systemd drop-in, then restart `dsh-web.service`.
