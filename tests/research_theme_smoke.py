"""Smoke coverage for project-defined Research Theme contracts."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.common.research_theme import (  # noqa: E402
    ResearchTheme,
    find_theme_chapter_warnings,
)


from pptx_report.common.narrative import build_slide_briefs  # noqa: E402
from pptx_report.model import ReportNarrative  # noqa: E402

def main() -> None:
    concept = ResearchTheme(
        theme_id="concept_product",
        name="概念价值与产品匹配",
        description="判断功能与设计是否支持概念价值。",
        decision_area="D1 概念验证",
        allowed_chapters=["概念表现与转化潜力"],
        keywords=["功能需求", "设计偏好"],
        priority=1,
    )
    restored = ResearchTheme.from_dict(concept.to_dict())
    assert restored == concept
    assert concept.validate() == []

    chapters = [
        {
            "title": "决策行为与驱动机制",
            "allowed_themes": ["purchase_driver"],
            "page_idxs": [1],
        }
    ]
    assignments = [{"page_idx": 1, "research_theme": "concept_product"}]
    warnings = find_theme_chapter_warnings(chapters, assignments, [concept])
    assert warnings[0]["code"] == "research_theme_chapter_mismatch"
    narrative = ReportNarrative(
        report_title="概念测试",
        central_thesis="产品概念具备转化潜力。",
        storyline_type="problem_solution",
        chapters=[{
            "chapter_id": "chapter_01",
            "title": "概念表现与转化潜力",
            "purpose": "验证概念价值。",
            "key_question": "概念是否具备转化潜力？",
            "page_idxs": [1],
        }],
        key_questions=["概念是否具备转化潜力？"],
        ending_message="明确产品方向。",
        research_theme_assignments=[{
            "unit_type": "page",
            "question_ids": ["Q1"],
            "research_theme": "concept_product",
            "decision_area": "D1 概念验证",
            "chapter_reason": "用于验证产品功能价值。",
        }],
    )
    briefs = build_slide_briefs(
        [{
            "page_idx": 1,
            "chapter": "概念表现与转化潜力",
            "chapter_id": "chapter_01",
            "title": "功能需求分层",
            "questions": [{"code": "Q1"}],
        }],
        [],
        narrative,
    )
    assert briefs[0].research_theme == "concept_product"
    assert briefs[0].decision_area == "D1 概念验证"
    print("research theme smoke: ok")


if __name__ == "__main__":
    main()
