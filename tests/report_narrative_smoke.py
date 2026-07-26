from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.common.narrative import build_slide_briefs
from pptx_report.model import ReportNarrative


def check_schema():
    narrative = ReportNarrative(
        report_title="年轻用户手机购买体验研究",
        central_thesis="年轻用户的购买阻碍主要来自价值感知与决策确定性不足，而非价格本身。",
        storyline_type="diagnosis",
        chapters=[
            {"chapter_id": "chapter_01", "title": "用户画像", "purpose": "界定核心用户", "key_question": "谁是核心用户？"},
            {"chapter_id": "chapter_02", "title": "决策障碍", "purpose": "诊断未购买原因", "key_question": "为什么没有购买？"},
            {"chapter_id": "chapter_03", "title": "优化机会", "purpose": "形成转化动作", "key_question": "如何提升转化？"},
        ],
        key_questions=["谁是核心用户？", "为什么没有购买？", "如何提升转化？"],
        ending_message="提升决策确定性比单纯降价更能推动年轻用户转化。",
        confidence=0.88,
    )
    assert narrative.validate() == []
    restored = ReportNarrative.from_dict(narrative.to_dict())
    assert restored == narrative

    invalid = ReportNarrative("", "", "unknown", [], [], "")
    issue_codes = {issue["code"] for issue in invalid.validate()}
    assert "report_narrative_required" in issue_codes
    assert "invalid_storyline_type" in issue_codes
    assert "invalid_chapter_count" in issue_codes
    return narrative


def check_slide_brief_context(narrative):
    pages = [
        {"slide_id": "s1", "title": "核心用户更年轻", "chapter": "用户画像", "questions": [{"code": "Q1"}]},
        {"slide_id": "s2", "title": "决策信息不足", "chapter": "决策障碍", "questions": [{"code": "Q2"}]},
        {"slide_id": "s3", "title": "强化价值证明", "chapter": "优化机会", "questions": [{"code": "Q3"}]},
    ]
    facts = [
        {"fact_id": "F1", "fact_type": "top_rank", "question_id": "Q1", "metric_name": "percentage", "category": "18-25岁", "value": 45},
        {"fact_id": "F2", "fact_type": "top_rank", "question_id": "Q2", "metric_name": "percentage", "category": "信息不足", "value": 52},
        {"fact_id": "F3", "fact_type": "top_rank", "question_id": "Q3", "metric_name": "percentage", "category": "价值证明", "value": 61},
    ]
    briefs = build_slide_briefs(pages, facts, narrative)
    assert all(brief.central_thesis == narrative.central_thesis for brief in briefs)
    assert "界定核心用户" in briefs[0].chapter_context
    assert briefs[0].next_chapter == "决策障碍"
    assert briefs[1].previous_chapter == "用户画像"
    assert briefs[1].next_chapter == "优化机会"

    legacy_briefs = build_slide_briefs(pages, facts)
    assert all(not brief.central_thesis and not brief.chapter_context for brief in legacy_briefs)


def main():
    narrative = check_schema()
    check_slide_brief_context(narrative)
    print("report narrative smoke: ok")


if __name__ == "__main__":
    main()