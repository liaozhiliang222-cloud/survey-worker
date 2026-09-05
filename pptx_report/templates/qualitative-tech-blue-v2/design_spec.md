# SurveyKit Qualitative Tech Blue V2

## Template brief

- Application: recurring qualitative-research reports for research teams, business leaders and clients.
- Delivery: presentation plus close-reading; all visible content must remain editable.
- Canvas: 16:9 (`33.87 × 19.05 cm`) with a 12-column grid and `1.35 cm` minimum side margin.
- Identity: technology blue, restrained enterprise styling, mixed light content pages and dark cover/chapter pages.
- Runtime: deterministic OfficeCLI native shapes, text and connectors. The template never calls a model.
- Prohibitions: no left vertical rail, no title underline, no full-slide bitmap, no copied third-party template assets.

## Visual grammar

The system uses a navy field for narrative anchors, electric blue for primary evidence, cyan for progression and pale blue for supporting context. Coral is reserved for friction, contradiction and P0/P1 priority. Whitespace and hierarchy take precedence over decorative effects.

Every content slide follows four semantic zones: page-type tag, conclusion title, evidence structure and a reader-facing source footer. Internal Evidence IDs and transcript segment IDs stay in speaker notes.

The recurring motif is a compact semantic capsule paired with one dominant analytical structure. A slide may use a matrix, rail, pyramid, fishbone or evidence wall, but must not assemble unrelated ornamental diagrams.

## Layout roster

| Variant | Research use | Structural rule |
|---|---|---|
| `cover_orbit` | cover | dark field, one conclusion, restrained orbital motif |
| `chapter_field` | chapter divider | dark field, chapter number, one transition sentence |
| `editorial_overview` | executive summary | headline band plus four evidence briefs and an action takeaway |
| `method_rail` | research framework | 3–5 sequential stages connected by a native rail |
| `positioning_map` | segmentation | explicit X/Y values only; never invent coordinates |
| `profile_evidence` | persona | identity card, attributes, behaviour, motivation and one verbatim quote |
| `journey_curve` | user journey | 3–5 moments on a curved/stepped experience path with friction emphasis |
| `contrast_columns` | audience/competitor comparison | two to four objects with a shared decision baseline |
| `hypothesis_balance` | evidence diagnosis | supporting evidence, counter-evidence and a bounded verdict |
| `nested_definition` | concept definition | three nested meanings plus four boundary tests |
| `evidence_pyramid` | needs hierarchy | three or four evidenced levels plus segment mapping |
| `impact_frequency` | pain/opportunity priority | explicit coordinates and a separated decision panel |
| `voice_wall` | verbatim evidence | one interpretation panel and one to three exact quotes |
| `fishbone` | root-cause diagnosis | one outcome spine and up to six cause groups |
| `action_roadmap` | recommendation | three to five phases, owner/action language and priority |
| `case_chain` | case comparison | approach, mechanism, operation and implication |

## Script contract

`page_type` selects the semantic family. `layout_variant` selects one supported composition. `density_hint` may be `low`, `medium` or `high`; it guides routing and QA but never authorizes dropping evidence. Page-specific structures (`profile`, `segments`, `axes`, `levels`, `items`, `definition_layers`, `boundary_rules`) are persisted in the PPT Script and passed unchanged to deterministic layout preparation.

If `layout_variant` is missing or unsupported, the renderer uses a documented page-type default. Existing scripts keep their legacy defaults; scripts whose style profile is `qualitative_tech_blue_v2` receive the V2 defaults.

## Content capacity

Slot limits are defined in `layout_catalog.json`. Overflow is handled before rendering by producing continuation slides. Verbatim quotes are never paraphrased or duplicated as filler. A missing coordinate, hierarchy or evidence relationship falls back to a simpler semantic page rather than fabricating structure.

## Provenance

The system reinterprets common editorial, consulting and engineering presentation grammar observed in the user-provided research reports, PPT Master examples and GordenPPTSkill previews. No third-party PPTX, SmartArt, icon, illustration or template asset is embedded or redistributed.

