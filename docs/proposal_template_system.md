# Research Proposal PPT Template System

This document records the first implementation of the proposal PPT template-family system.

## Architecture

- Content layer: Deck JSON carries semantic fields such as `slide_type`, `relation_type`, `content_density`, `node_count`, `has_stage_output`, and `has_parallel_tracks`.
- Template layer: `templates/scheme_proposal` contains one PPTX skeleton per variant plus `template_registry.json`.
- Selection layer: `pptx_report.proposal_templates` maps slide semantics to a template variant. AI output should not hard-code `template_id`.
- Render layer: `pptx_report.proposal_deck` routes selected variants into dedicated renderers while continuing to use python-pptx.
- QA layer: `pptx_report.template_validator` validates template files, placeholder names, duplicate placeholders, required placeholders, and page size.

## Page Families

Implemented first-batch families and variants:

- `project_background`: `background_chain_v1`, `background_contrast_v1`
- `key_business_decisions`: `decision_3up_v1`, `decision_radial_v1`
- `research_path`: `research_path_linear_v1`, `research_path_dualtrack_v1`
- `sample_design`: `sample_tree_v1`, `execution_canvas_v1`
- `report_example`: `chart_insight_v1`, `dual_chart_v1`
- `gantt`: `gantt_standard_v1`, `gantt_risk_v1`

## Placeholder Contract

Designers should name shapes in PowerPoint's selection pane with `SK_*` placeholders. The first version supports:

- Common: `SK_TITLE`, `SK_SUBTITLE`, `SK_KICKER`, `SK_FOOTNOTE`, `SK_PAGE_NO`, `SK_BRAND`, `SK_KEEP`, `SK_IMAGE_01`, `SK_IMAGE_02`
- Text: `SK_BODY_01`, `SK_BODY_02`, `SK_BODY_03`, `SK_NOTE_01`, `SK_NOTE_02`
- Nodes: `SK_NODE_01_TITLE` through `SK_NODE_05_BODY`
- Stages: `SK_STAGE_01_TITLE/ACTION/OUTPUT` through `SK_STAGE_04_TITLE/ACTION/OUTPUT`
- Charts: `SK_CHART_01`, `SK_CHART_02`, `SK_CHART_TITLE_01`, `SK_CHART_TITLE_02`, `SK_INSIGHT_01`, `SK_INSIGHT_02`, `SK_INSIGHT_03`, `SK_EXAMPLE_TAG`, `SK_DISCLAIMER`
- Gantt: `SK_TIMELINE`, `SK_TASK_01` through `SK_TASK_05`, `SK_DELIVERABLE_01`, `SK_DELIVERABLE_02`, `SK_RISK_01`, `SK_RISK_02`
- Sample: `SK_TOTAL_SAMPLE`, `SK_BRANCH_01_TITLE/BODY` through `SK_BRANCH_03_TITLE/BODY`, `SK_ADDON_TITLE`, `SK_ADDON_BODY`

## Selector Rules

The selector is configurable through the registry data in `pptx_report.proposal_templates`.

Current deterministic rules include:

- `project_background` + `causal_chain` -> `background_chain_v1`
- `project_background` + `contrast` -> `background_contrast_v1`
- `key_business_decisions` with `node_count <= 3` -> `decision_3up_v1`
- `key_business_decisions` with `node_count >= 4` -> `decision_radial_v1`
- `research_path` with `has_parallel_tracks = false` -> `research_path_linear_v1`
- `research_path` with `has_parallel_tracks = true` -> `research_path_dualtrack_v1`
- `report_example` with one chart -> `chart_insight_v1`
- `report_example` with two or more charts -> `dual_chart_v1`
- `gantt` with high density -> `gantt_risk_v1`
- `gantt` with lower density -> `gantt_standard_v1`

The selector keeps manual override support through `template_id` or `template_override`, but this is intended for QA and template debugging rather than normal AI output.

## Renderers

The first version exposes dedicated renderer entry points:

- `render_project_background()`
- `render_key_decisions()`
- `render_research_path()`
- `render_sample_design()`
- `render_report_example()`
- `render_gantt()`

These currently wrap the existing high-quality python-pptx drawing functions. This keeps output stable while establishing the right boundary for future placeholder replacement from designed PPTX masters.

## Commands

Generate the built-in template skeleton library:

```bash
python -m pptx_report.template_scaffold templates/scheme_proposal
```

Validate the generated template library:

```bash
python tests/proposal_templates_smoke.py
```

Generate the demo proposal PPT:

```bash
python -m pptx_report.demo_proposal_templates
```

Demo output:

```text
tests/output/proposal-template-family-demo.pptx
```

## Future Expansion

- Qualitative report templates can reuse the same registry fields and add families for journey maps, persona pages, quote walls, and synthesis matrices.
- Quantitative report templates can add dashboard, matrix comparison, single-question deep dive, segmentation, NPS, and appendix families.
- Uploaded-template adaptation should parse shape names and geometry, map them to page families, then persist a new registry entry with required placeholders and capacity metadata.

