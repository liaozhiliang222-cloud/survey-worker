import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.proposal_templates import plan_deck_templates, registry_as_dict
from pptx_report.template_scaffold import create_template_library
from pptx_report.template_validator import validate_template_directory


def main():
    slides = [
        {"slide_type": "project_background", "relation_type": "causal_chain", "content_density": "medium", "node_count": 4, "content": [1, 2, 3, 4], "charts": []},
        {"slide_type": "key_business_decisions", "relation_type": "hierarchy", "content_density": "medium", "node_count": 3, "content": [1, 2, 3], "charts": []},
        {"slide_type": "key_business_decisions", "relation_type": "hierarchy", "content_density": "medium", "node_count": 5, "content": [1, 2, 3, 4, 5], "charts": []},
        {"slide_type": "research_path", "relation_type": "sequential", "content_density": "medium", "node_count": 4, "has_parallel_tracks": False, "content": [1, 2, 3, 4], "charts": []},
        {"slide_type": "research_path", "relation_type": "sequential", "content_density": "medium", "node_count": 4, "has_parallel_tracks": True, "content": [1, 2, 3, 4], "charts": []},
        {"slide_type": "report_example", "relation_type": "chart", "content_density": "medium", "node_count": 1, "content": [], "charts": [{"id": 1}]},
        {"slide_type": "report_example", "relation_type": "chart", "content_density": "medium", "node_count": 1, "content": [], "charts": [{"id": 1}, {"id": 2}]},
        {"slide_type": "gantt", "relation_type": "timeline", "content_density": "high", "node_count": 3, "content": [1, 2, 3], "charts": []},
    ]
    planned, issues = plan_deck_templates(slides)
    template_ids = [slide["template_id"] for slide in planned]
    assert template_ids == [
        "background_chain_v1",
        "decision_3up_v1",
        "decision_radial_v1",
        "research_path_linear_v1",
        "research_path_dualtrack_v1",
        "chart_insight_v1",
        "dual_chart_v1",
        "gantt_risk_v1",
    ]
    assert not [issue for issue in issues if issue["level"] == "error"]
    assert len(registry_as_dict()) == 12

    with tempfile.TemporaryDirectory() as tmp:
        result = create_template_library(Path(tmp) / "scheme_proposal")
        assert result["template_count"] == 12
        report = validate_template_directory(result["output_dir"])
        assert report["ok"] is True
        assert report["issue_count"] == 0

    print(json.dumps({"templates": len(registry_as_dict()), "planned": template_ids}, ensure_ascii=False))


if __name__ == "__main__":
    main()

