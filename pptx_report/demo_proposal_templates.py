"""Generate a small demo deck for the proposal template-family system."""

from __future__ import annotations

import json
from pathlib import Path

from pptx_report.proposal_deck import render_proposal_deck


def _items(*pairs):
    return [{"headline": headline, "description": description} for headline, description in pairs]


def build_demo_deck() -> dict:
    dataset = {
        "dataset_id": "proposal_template_demo",
        "project_type": "concept_test",
        "data_status": "illustrative",
        "usable_for_decision": False,
        "metrics": {
            "concept_understanding": 82,
            "concept_relevance": 68,
            "concept_uniqueness": 61,
            "concept_credibility": 55,
            "purchase_intention_t2b": 39,
        },
        "selling_point_scores": {"Health value": 31, "Easy clean": 26, "Quiet mode": 21, "Smart alert": 13, "Design": 9},
        "segment_purchase_intention": {"Premium owners": 58, "Smart device fans": 51, "Current users": 37, "Basic users": 24},
        "pricing": {
            "acceptable_low": 299,
            "optimal_price": 399,
            "acceptable_high": 499,
            "purchase_curve": [
                {"price": 299, "intention": 57},
                {"price": 399, "intention": 39},
                {"price": 499, "intention": 25},
                {"price": 599, "intention": 14},
            ],
        },
    }
    return {
        "deck_id": "template_family_demo",
        "project_id": "proposal_template_system",
        "title": "Proposal Template Family Demo",
        "theme": "modern_insight_v2",
        "aspect_ratio": "16:9",
        "purpose": "client_proposal",
        "example_output_mode": "illustrative",
        "illustrative_dataset": dataset,
        "page_size": 7,
        "slides": [
            {"slide_id": "slide_01", "slide_type": "cover", "title": "Research Proposal Template System", "subtitle": "Page families, placeholders and deterministic rendering", "relation_type": "hero", "content_density": "medium", "content": [], "charts": [], "data_status": "framework_only"},
            {"slide_id": "slide_02", "slide_type": "project_background", "title": "Market tension makes early research valuable", "key_message": "The proposal starts from business risk, not from decorative layout.", "relation_type": "causal_chain", "content_density": "medium", "node_count": 4, "content": _items(("Market shift", "Usage expectations are rising."), ("User tension", "Maintenance and trust remain barriers."), ("Product opportunity", "Evidence can sharpen launch choices."), ("Decision risk", "Unvalidated assumptions increase cost.")), "charts": [], "data_status": "framework_only"},
            {"slide_id": "slide_03", "slide_type": "key_business_decisions", "title": "The study supports five launch decisions", "key_message": "Node count drives the radial decision template.", "relation_type": "hierarchy", "content_density": "medium", "node_count": 5, "content": _items(("Go or refine", "Validate concept strength."), ("Message priority", "Rank selling points."), ("Target segment", "Find high-potential buyers."), ("Price window", "Test willingness to pay."), ("Experience fixes", "Prioritize barriers.")), "charts": [], "data_status": "framework_only"},
            {"slide_id": "slide_04", "slide_type": "research_path", "title": "Qual and quant tracks reduce decision risk together", "key_message": "Parallel tracks select the dual-track research path template.", "relation_type": "sequential", "content_density": "medium", "node_count": 4, "has_parallel_tracks": True, "content": _items(("Input", "Align business hypotheses."), ("Qual exploration", "Extract language and friction."), ("Quant validation", "Size demand and differences."), ("Strategy output", "Translate evidence into actions.")), "charts": [], "data_status": "framework_only"},
            {"slide_id": "slide_05", "slide_type": "sample_design", "title": "Sample architecture balances total and subgroup reads", "key_message": "Sample design gets a dedicated renderer rather than generic cards.", "relation_type": "hierarchy", "content_density": "medium", "node_count": 5, "content": _items(("Total N=700", "Main buyers in target cities."), ("Concept A", "Balanced exposure cell."), ("Concept B", "Comparable exposure cell."), ("Boost sample", "High-value owners."), ("Analysis guardrail", "Minimum subgroup size.")), "charts": [], "data_status": "framework_only"},
            {"slide_id": "slide_06", "slide_type": "report_example", "title": "Report example uses native editable charts", "key_message": "Example pages show charts and disclaimer instead of raw JSON tables.", "relation_type": "chart", "content_density": "medium", "node_count": 1, "content": _items(("Illustrative read", "Demo data only; not final research evidence.")), "charts": [{"id": "concept"}, {"id": "selling_points"}], "data_status": "illustrative", "example_output": True},
            {"slide_id": "slide_07", "slide_type": "gantt", "title": "Two-week delivery plan highlights tasks and risks", "key_message": "High-density timing selects the gantt risk template.", "relation_type": "timeline", "content_density": "high", "node_count": 3, "content": _items(("Delivery", "Proposal, qual summary, data tables and final report."), ("Dependency", "Stimulus and recruitment criteria confirmed on time."), ("Risk", "Delays in materials or approval need active management.")), "charts": [], "timeline_tasks": [{"task": "Design", "start_day": 1, "end_day": 2, "deliverable": "Plan"}, {"task": "Recruit", "start_day": 1, "end_day": 3, "deliverable": "List"}, {"task": "Qual", "start_day": 3, "end_day": 5, "deliverable": "Findings"}, {"task": "Survey", "start_day": 4, "end_day": 8, "deliverable": "Data"}, {"task": "Analysis", "start_day": 8, "end_day": 11, "deliverable": "Tables"}, {"task": "Report", "start_day": 11, "end_day": 14, "deliverable": "Deck"}], "data_status": "framework_only"},
        ],
    }


def main(output_path: str = "tests/output/proposal-template-family-demo.pptx") -> dict:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    audit = render_proposal_deck(build_demo_deck(), str(output))
    return {
        "output": str(output),
        "ok": audit["ok"],
        "slides": len(audit["deck"]["slides"]),
        "templates": [slide.get("template_id") for slide in audit["deck"]["slides"]],
    }


if __name__ == "__main__":
    print(json.dumps(main(), ensure_ascii=False))

