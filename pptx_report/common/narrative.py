"""Deterministic narrative and Slide Brief planning for quantitative reports."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from .slide_brief import SlideBrief


CHAPTER_STORY = {
    "用户画像": ("用户是谁", "segment_profile", "segment_comparison"),
    "消费行为": ("当前行为如何", "behavior", "chart_with_insight"),
    "品牌与满意度": ("最主要的问题是什么", "problem", "key_finding_with_evidence"),
    "专项研究": ("问题背后的原因与机会是什么", "opportunity", "matrix_with_priority"),
    "其他研究": ("还需要关注什么", "evidence", "chart_with_insight"),
}

RELATIONS = {
    "用户画像": "defines_audience",
    "消费行为": "describes_behavior",
    "品牌与满意度": "diagnoses_problem",
    "专项研究": "identifies_opportunity",
    "其他研究": "supports_conclusion",
}


def _claim_from_fact(fact: dict) -> str:
    category = str(fact.get("category") or "核心指标")
    segment = str(fact.get("segment") or "总体")
    value = fact.get("value")
    fact_type = fact.get("fact_type")
    if value is None:
        return f"{category}是本页需要验证的核心事实"
    suffix = "%" if fact.get("metric_name") == "percentage" else ""
    if fact_type == "segment_gap":
        direction = "高于" if (fact.get("gap_pp") or 0) > 0 else "低于"
        return (
            f"{segment}在「{category}」上{direction}总体"
            f"{abs(float(fact.get('gap_pp') or 0)):.1f}个百分点"
        )
    if fact_type == "low_base_warning":
        return f"{segment}样本量偏低，相关结论仅作方向性参考"
    subject = "总体" if segment.lower() in {"total", "总体"} else segment
    return f"{subject}在「{category}」上的当前结果为{float(value):.1f}{suffix}"


def _narrative_payload(value: Any) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        payload = value.to_dict()
        return payload if isinstance(payload, dict) else {}
    return {}


def _chapter_for_page(
    page: dict,
    chapters: list[dict],
    page_chapter_order: list[str],
) -> tuple[dict, int]:
    page_chapter = str(page.get("chapter") or "")
    page_chapter_id = str(page.get("chapter_id") or "")
    for index, chapter in enumerate(chapters):
        if page_chapter_id and page_chapter_id == str(chapter.get("chapter_id") or ""):
            return chapter, index
        if page_chapter and page_chapter == str(chapter.get("title") or ""):
            return chapter, index
    try:
        fallback_index = page_chapter_order.index(page_chapter)
    except ValueError:
        fallback_index = 0
    if chapters:
        fallback_index = min(fallback_index, len(chapters) - 1)
        return chapters[fallback_index], fallback_index
    return {}, -1


def _chapter_context(chapter: dict) -> str:
    purpose = str(chapter.get("purpose") or "").strip()
    key_question = str(chapter.get("key_question") or "").strip()
    if purpose and key_question:
        return f"本章目的：{purpose}；核心问题：{key_question}"
    return purpose or key_question


def build_slide_briefs(
    pages: Iterable[dict],
    facts: Iterable[dict],
    report_narrative: Any = None,
) -> list[SlideBrief]:
    fact_list = list(facts)
    by_question: dict[str, list[dict]] = defaultdict(list)
    for fact in fact_list:
        by_question[str(fact.get("question_id") or "")].append(fact)

    briefs: list[SlideBrief] = []
    used_claims: set[str] = set()
    values = list(pages)
    narrative = _narrative_payload(report_narrative)
    central_thesis = str(narrative.get("central_thesis") or "").strip()
    theme_classification = narrative.get("research_theme_classification") if isinstance(narrative.get("research_theme_classification"), dict) else {
        "themes": narrative.get("research_themes", []),
        "chapter_rules": narrative.get("chapter_rules", []),
        "assignments": narrative.get("research_theme_assignments", []),
    }
    theme_by_question: dict[str, dict] = {}
    for assignment in theme_classification.get("assignments", []):
        if not isinstance(assignment, dict) or assignment.get("unit_type") != "page":
            continue
        for question_id in assignment.get("question_ids", []):
            theme_by_question.setdefault(str(question_id), assignment)
    narrative_chapters = [
        chapter for chapter in narrative.get("chapters", [])
        if isinstance(chapter, dict)
    ]
    page_chapter_order = list(dict.fromkeys(
        str(page.get("chapter") or "其他研究") for page in values
    ))
    for index, page in enumerate(values):
        question_ids = [
            str(item.get("code") or "")
            for item in page.get("questions") or []
            if item.get("code")
        ]
        candidates = [
            fact
            for question_id in question_ids
            for fact in by_question.get(question_id, [])
            if fact.get("fact_type")
            in {
                "segment_gap",
                "top_rank",
                "bottom_rank",
                "top2box",
                "bottom2box",
                "mean_difference",
                "low_base_warning",
            }
        ]
        candidates.sort(
            key=lambda fact: (
                fact.get("fact_type") == "low_base_warning",
                -abs(float(fact.get("gap_pp") or fact.get("value") or 0)),
            )
        )
        primary = candidates[0] if candidates else {}
        claim = _claim_from_fact(primary) if primary else str(page.get("title") or "")
        if claim in used_claims:
            claim = f"{claim}，并在本页补充不同题目的证据"
        used_claims.add(claim)

        chapter = str(page.get("chapter") or "其他研究")
        narrative_chapter, narrative_chapter_index = _chapter_for_page(
            page, narrative_chapters, page_chapter_order
        )
        theme_assignment = next((
            theme_by_question.get(str(question_id))
            for question_id in question_ids
            if str(question_id) in theme_by_question
        ), None)
        previous_chapter = (
            str(narrative_chapters[narrative_chapter_index - 1].get("title") or "")
            if narrative_chapter_index > 0 else ""
        )
        next_chapter = (
            str(narrative_chapters[narrative_chapter_index + 1].get("title") or "")
            if 0 <= narrative_chapter_index < len(narrative_chapters) - 1 else ""
        )
        question_answered, visual_intent, default_layout = CHAPTER_STORY.get(
            chapter, CHAPTER_STORY["其他研究"]
        )
        slide_id = str(page.get("slide_id") or f"slide_{index + 1:03d}")
        source_references = list(
            dict.fromkeys(
                str(fact.get("source_reference"))
                for fact in candidates
                if fact.get("source_reference")
            )
        )
        brief = SlideBrief(
            slide_id=slide_id,
            slide_type=str(page.get("slide_type") or page.get("type") or "key_finding"),
            chapter=chapter,
            title=str(page.get("title") or claim),
            question_answered=question_answered,
            claim=claim,
            business_implication=(
                "将该事实用于识别优先人群、问题或机会，并在后续建议页转化为行动。"
            ),
            chapter_id=str(
                narrative_chapter.get("chapter_id")
                or page.get("chapter_id")
                or f"chapter_{page_chapter_order.index(chapter) + 1:02d}"
            ),
            evidence_question_ids=question_ids,
            evidence_fact_ids=[
                str(fact.get("fact_id"))
                for fact in candidates[:6]
                if fact.get("fact_id")
            ],
            source_references=source_references,
            visual_intent=visual_intent,
            layout_family=str(page.get("layout_family") or default_layout),
            relation_type=RELATIONS.get(chapter, "sequential"),
            density=str(page.get("density") or "medium"),
            central_thesis=central_thesis,
            chapter_context=_chapter_context(narrative_chapter),
            research_theme=str(page.get("research_theme") or (theme_assignment or {}).get("research_theme") or ""),
            decision_area=str(page.get("decision_area") or (theme_assignment or {}).get("decision_area") or ""),
            chapter_reason=str(page.get("chapter_reason") or (theme_assignment or {}).get("chapter_reason") or ""),
            previous_chapter=previous_chapter,
            next_chapter=next_chapter,
            user_modified=bool(page.get("user_modified")),
            locked=bool(page.get("locked")),
        )
        briefs.append(brief)

    for index, brief in enumerate(briefs):
        if index:
            brief.relationship_to_previous = (
                f"承接上一页“{briefs[index - 1].question_answered}”，"
                f"继续回答“{brief.question_answered}”。"
            )
        if index + 1 < len(briefs):
            brief.relationship_to_next = (
                f"为下一页“{briefs[index + 1].question_answered}”提供证据基础。"
            )
    return briefs
