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
