"""Smoke coverage for editable SlideBrief blueprints."""

from pathlib import Path
from tempfile import TemporaryDirectory
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.blueprints import (
    BlueprintConflictError,
    ReportBlueprintStore,
    apply_single_slide_regeneration,
    apply_slide_brief_patch,
    reorder_slides,
)
from pptx_report.common.slide_brief import SlideBrief
from pptx_report.model import ChartPageContent, ChartSpec, ChartType, Series
from pptx_report.wizard import _enhance_report_pages


def make_slide(slide_id: str, title: str) -> dict:
    return {
        "page_idx": int(slide_id.rsplit("_", 1)[-1]),
        "title": title,
        "insight_override": title,
        "chapter": "用户洞察",
        "slide_brief": {
            "slide_id": slide_id,
            "chapter_id": "chapter_01",
            "chapter": "用户洞察",
            "title": title,
            "claim": title,
            "slide_type": "key_finding",
            "layout_family": "chart_with_insight",
            "locked": False,
            "user_modified": False,
        },
    }


def check_schema() -> None:
    brief = SlideBrief(
        slide_id="slide_01",
        chapter_id="chapter_01",
        slide_type="key_finding",
        chapter="用户洞察",
        title="年轻用户是增长核心",
        question_answered="谁是核心用户？",
        claim="年轻用户购买意愿更高。",
        business_implication="优先经营年轻用户。",
        user_modified=True,
    )
    restored = SlideBrief.from_dict(brief.to_dict())
    assert restored.chapter_id == "chapter_01"
    assert restored.user_modified is True
    assert restored.locked is False


def check_edit_and_lock_rules() -> None:
    slide = make_slide("slide_01", "AI 标题")
    edited = apply_slide_brief_patch(
        slide,
        {
            "title": "研究员确认标题",
            "claim": "决策障碍来自价值感知不足。",
            "layout_family": "hero_chart",
        },
    )
    assert edited["title"] == "研究员确认标题"
    assert edited["slide_brief"]["claim"] == "决策障碍来自价值感知不足。"
    assert edited["slide_brief"]["layout_family"] == "hero_chart"
    assert edited["slide_brief"]["user_modified"] is True

    locked = apply_slide_brief_patch(edited, {"locked": True})
    try:
        apply_slide_brief_patch(locked, {"title": "AI 不得覆盖"})
    except BlueprintConflictError:
        pass
    else:
        raise AssertionError("locked slide accepted a protected-field edit")


def check_renderer_input_prefers_user_edit() -> None:
    chart = ChartSpec(
        "购买意愿",
        ChartType.BAR,
        ["高", "低"],
        [Series("Total", [68, 32])],
        evidence_question_ids=["Q1"],
    )
    page = ChartPageContent("AI 原始标题", charts=[chart], chapter="用户洞察")
    questions = [{
        "code": "Q1",
        "title": "购买意愿",
        "categories": ["高", "低"],
        "segments": ["Total"],
        "data": {"Total": [68, 32]},
        "base": {"Total": 200},
    }]
    page_config = {"pages": [{
        "slide_brief": {
            "slide_id": "slide_01",
            "chapter_id": "chapter_01",
            "title": "研究员最终标题",
            "claim": "年轻用户是优先转化人群。",
            "slide_type": "segment_comparison",
            "layout_family": "hero_chart",
            "user_modified": True,
            "locked": False,
        }
    }]}
    enhanced, briefs = _enhance_report_pages(
        [page], questions, [], [], "source.xlsx", page_config=page_config
    )
    rendered_page = next(item for item in enhanced if item is page)
    assert rendered_page.title == "研究员最终标题"
    assert rendered_page.layout_family == "hero_chart"
    assert briefs[0].title == "研究员最终标题"
    assert briefs[0].claim == "年轻用户是优先转化人群。"
    assert briefs[0].user_modified is True


def check_store_delete_and_order() -> None:
    slides = [
        make_slide("slide_01", "第一页"),
        make_slide("slide_02", "第二页"),
        make_slide("slide_03", "第三页"),
    ]
    reordered = reorder_slides(slides, ["slide_03", "slide_01", "slide_02"])
    assert [item["slide_brief"]["slide_id"] for item in reordered] == [
        "slide_03", "slide_01", "slide_02"
    ]

    with TemporaryDirectory() as temp:
        store = ReportBlueprintStore(temp)
        report_id = "report_edit_test"
        store.save(report_id, {"central_thesis": "中心观点"}, slides)
        store.patch_slide(report_id, "slide_02", {"title": "第二页人工标题"})
        stored = store.reorder(report_id, ["slide_02", "slide_03", "slide_01"])
        assert stored["slides"][0]["title"] == "第二页人工标题"
        stored = store.delete_slide(report_id, "slide_03")
        assert len(stored["slides"]) == 2
        assert stored["deleted_slide_ids"] == ["slide_03"]
        assert [item["slide_brief"]["slide_id"] for item in stored["slides"]] == [
            "slide_02", "slide_01"
        ]


def check_single_slide_regeneration() -> None:
    original = make_slide("slide_01", "AI title")
    rewritten = apply_single_slide_regeneration(
        original,
        {
            "title": "Regenerated title",
            "claim": "Regenerated claim",
            "business_implication": "Prioritize conversion certainty.",
            "bullets": ["Observation", "Evidence", "Action"],
            "evidence_fact_ids": ["F1", "F1"],
            "evidence_question_ids": ["Q1"],
        },
    )
    assert rewritten["slide_brief"]["slide_id"] == "slide_01"
    assert rewritten["slide_brief"]["chapter_id"] == "chapter_01"
    assert rewritten["slide_brief"]["claim"] == "Regenerated claim"
    assert rewritten["slide_brief"]["user_modified"] is False
    assert rewritten["slide_brief"]["regeneration_count"] == 1
    assert rewritten["insight_bullets"] == ["Observation", "Evidence", "Action"]
    assert rewritten["evidence_fact_ids"] == ["F1"]

    edited = apply_slide_brief_patch(original, {"title": "Researcher title"})
    try:
        apply_single_slide_regeneration(edited, {"title": "Overwrite"})
    except BlueprintConflictError:
        pass
    else:
        raise AssertionError("user-modified slide regenerated without confirmation")

    forced = apply_single_slide_regeneration(
        edited,
        {"title": "Confirmed overwrite", "claim": "AI owns this version"},
        force_user_modified=True,
    )
    assert forced["slide_brief"]["slide_id"] == "slide_01"
    assert forced["slide_brief"]["user_modified"] is False

    locked = apply_slide_brief_patch(original, {"locked": True})
    try:
        apply_single_slide_regeneration(
            locked,
            {"title": "Never overwrite"},
            force_user_modified=True,
        )
    except BlueprintConflictError:
        pass
    else:
        raise AssertionError("locked slide accepted regeneration")

    with TemporaryDirectory() as temp:
        store = ReportBlueprintStore(temp)
        report_id = "report_regen_test"
        slides = [original, make_slide("slide_02", "Second")]
        store.save(report_id, {"central_thesis": "Thesis"}, slides)
        stored = store.regenerate_slide(
            report_id,
            "slide_01",
            {"title": "Stored rewrite", "claim": "Stored claim"},
        )
        assert [item["slide_brief"]["slide_id"] for item in stored["slides"]] == [
            "slide_01", "slide_02"
        ]
        assert stored["slides"][0]["title"] == "Stored rewrite"


def check_api_contract() -> None:
    source = (ROOT / "deploy" / "aliyun_api.py").read_text(encoding="utf-8")
    for route in (
        '/api/report/{report_id}/slide-briefs',
        '/api/report/{report_id}/slide/{slide_id}',
        '/api/report/{report_id}/slides/reorder',
        '/api/report/{report_id}/slide/{slide_id}/regenerate',
    ):
        assert route in source
    assert 'REPORT_BLUEPRINT_STORE.get(report_id)' in source
    assert '"pages": blueprint.get("slides") or []' in source


def main() -> None:
    check_schema()
    check_edit_and_lock_rules()
    check_renderer_input_prefers_user_edit()
    check_store_delete_and_order()
    check_single_slide_regeneration()
    check_api_contract()
    print("slide brief edit smoke: ok")


if __name__ == "__main__":
    main()
