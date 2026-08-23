# AI Report Quality Gate

Sprint 2 adds a local quality gate to the research-report workflow:

`DataFact -> Report Narrative -> Page Blueprint -> SlideBrief -> PPT Renderer`

The gate does not call an additional model and does not change the PPT renderer.

## Checks

- Report Narrative: page coverage, duplicate assignment, empty or generic chapters, source-structure copying, and research-theme mismatch.
- Page Blueprint: question coverage, duplicate questions, maximum six questions per page, and avoidable one-question pages.
- SlideBrief: percentages in narrative copy, data-readout phrasing, missing copy, and duplicate slide claims.

Hard coverage errors block the affected stage. Semantic warnings remain visible for researcher review.

## Recovery

The chapter framework and each successful page assignment are stored as a short-lived browser snapshot in addition to the existing durable AI jobs. A retry reuses completed assignments and requests only missing pages. Explicit regeneration clears both caches.

## Gold Cases

`tests/fixtures/ai-report-quality-cases.json` covers concept-test audience profiles, U&A usage behavior, NPS diagnosis, complex-model isolation, and data-narration copy checks.
