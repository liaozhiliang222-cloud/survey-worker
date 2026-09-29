# Unified import parser contract

`src/shared/file-parser.js` exposes `inspectResearchWorkbook(arrayBuffer, options)` and
returns `surveykit_import_inspection_v1`.

The result contains:

- `format`: `standard_crosstab`, `flat_crosstab`, `raw_survey`, `kano`, `data_code`, or `unknown`.
- `status`: `ready`, `warning`, or `error`.
- `sheets`: Sheet name, detected role, size, header row, headers, and a compact preview.
- `metrics`: question/field count, dimension count, rows, columns, and dimension names.
- `diagnostics`: stable code, severity, user-facing reason, actionable correction, and Sheet name.

Consumers may pass `{ target: "pptx_crosstab" }` to add target-specific validation. The
PPT report page uses this before the backend parse request and blocks unsupported or
unrecognized structures. Backend zero-question/zero-segment results are converted to an
explicit error instead of being displayed as a successful `0题、0维度` parse.

Legacy import surfaces access the same parser through `window.SurveyKitFileParser` while
their remaining conversion-specific code is migrated incrementally.

## Document imports

Requirement inputs (`aiInput`, `aiPlanInput`) read every nonempty worksheet cell,
including multiline text and zero values. They do not use the questionnaire-column
detector or synchronize their contents into the workspace questionnaire.
Questionnaire imports retain structured question-column conversion, with a plain
worksheet-text fallback for free-layout questionnaires. Questionnaire templates and
crosstab question mapping require recognizable question numbers before accepting a file.

Document inputs accept DOCX, XLSX, PPTX, Markdown, TXT and CSV. Unsupported legacy
DOC/XLS files receive a conversion instruction rather than being decoded as text.
Empty files, read errors and incomplete XLSX archives surface an error at the input
and preserve existing text. The shared workbook reader propagates decompression
errors and missing worksheets instead of silently importing a partial workbook.

Browser regression coverage: `tests/e2e/document-import.spec.js`. Set
`IMPORT_REGRESSION_FILE` to a private local XLSX path to additionally verify both
requirement buttons against every nonempty cell; private workbooks are not committed.
