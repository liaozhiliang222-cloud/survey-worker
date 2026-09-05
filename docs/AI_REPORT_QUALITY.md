# AI Report Quality Gate

Sprint 2 adds local quality audits to the research-report workflow. Sprint 3
turns the audit result into a delivery gate and targeted repair loop:

`DataFact -> Report Narrative -> Page Blueprint -> SlideBrief -> PPT Renderer`

The gate does not call an additional model and does not change the PPT renderer.

## Checks

- Report Narrative: page coverage, duplicate assignment, empty or generic chapters, source-structure copying, and research-theme mismatch.
- Page Blueprint: question coverage, duplicate questions, maximum six questions per page, and avoidable one-question pages.
- SlideBrief: percentages in narrative copy, data-readout phrasing, missing copy, and duplicate slide claims.

Hard coverage and copy errors block PPT generation. Semantic warnings remain
visible and require one explicit confirmation before generation. A changed
blueprint gets a new quality signature and must be confirmed again.

## Targeted repair

Each issue carries its affected `page_idxs`, repair scope, and whether it can be
repaired automatically. The editor marks those pages and offers **仅修复问题页**.

The repair request:

- sends only the affected pages, using stable `slide_id` values;
- preserves chapters, question grouping, dimensions, and page order;
- excludes locked and user-modified pages;
- updates the plan through the normal SlideBrief merge path;
- is added to the existing undo history.

Locked or user-modified problem pages remain visible for manual review. A hard
error on a protected page continues to block delivery until the researcher
edits or unlocks it.

## Delivery gate

`buildReportQualityGate()` combines the Narrative and SlideBrief audits into a
single `ai_report_quality_gate_v1` result:

- `blocked`: one or more hard errors; PPT generation stops before file upload;
- `review`: warnings only; generation can continue after confirmation;
- `pass`: generation proceeds directly.

The quick-report and legacy flows remain unchanged when no Report Narrative is
present. The PPT renderer and backend API contract are unchanged.

## Recovery

The chapter framework and each successful page assignment are stored as a short-lived browser snapshot in addition to the existing durable AI jobs. A retry reuses completed assignments and requests only missing pages. Explicit regeneration clears both caches.

## Gold Cases

`tests/fixtures/ai-report-quality-cases.json` covers concept-test audience profiles, U&A usage behavior, NPS diagnosis, complex-model isolation, and data-narration copy checks.

`tests/ai-report-quality-loop-smoke.mjs` verifies targeted repair, protected-page
isolation, pre-upload blocking, and warning confirmation.
