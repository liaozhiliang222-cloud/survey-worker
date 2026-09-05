"""Layout catalog and deterministic variant routing for qualitative reports.

The PPT Script owns the semantic choice.  The renderer only resolves a valid
variant and falls back to a page-type default; it never asks a model or changes
research content.
"""
from __future__ import annotations

from collections import Counter
from functools import lru_cache
import json
from pathlib import Path
from typing import Any


TEMPLATE_ID = "qualitative_tech_blue_v2"
TEMPLATE_CATALOG_PATH = (
    Path(__file__).resolve().parent
    / "templates"
    / "qualitative-tech-blue-v2"
    / "layout_catalog.json"
)

LAYOUT_VARIANTS: dict[str, tuple[str, ...]] = {
    "navigation": ("cover_orbit",),
    "section_intro": ("chapter_field",),
    "executive_summary": ("north_star_stack", "editorial_overview"),
    "qualitative_summary": ("north_star_stack", "editorial_overview"),
    "theme_summary": ("north_star_stack", "editorial_overview"),
    "research_framework": ("method_rail",),
    "framework": ("method_rail",),
    "segmentation_map": ("hierarchy_tree", "positioning_map"),
    "persona": ("profile_evidence",),
    "journey": ("stage_rail", "journey_curve"),
    "comparison": ("contrast_columns",),
    "segment_comparison": ("contrast_columns",),
    "competitor_comparison": ("contrast_columns",),
    "evidence_diagnostic": ("hypothesis_balance",),
    "concept_definition": ("nested_definition",),
    "needs_pyramid": ("evidence_pyramid",),
    "priority_matrix": ("impact_frequency",),
    "quote_evidence": ("voice_wall",),
    "case_study": ("case_chain",),
    "matrix": ("decision_grid",),
    "problem_reason": ("three_step", "fishbone"),
    "recommendation": ("three_lane", "action_roadmap"),
    "qualitative_insight": ("insight_evidence",),
}

V2_DEFAULTS = {
    "executive_summary": "editorial_overview",
    "qualitative_summary": "editorial_overview",
    "theme_summary": "editorial_overview",
    "journey": "journey_curve",
    "problem_reason": "fishbone",
    "recommendation": "action_roadmap",
}

LAYOUT_LABELS = {
    "cover_orbit": "封面轨道",
    "chapter_field": "章节场",
    "north_star_stack": "北极星结论",
    "editorial_overview": "核心结论总览",
    "method_rail": "研究方法轨道",
    "hierarchy_tree": "分层树",
    "positioning_map": "定位地图",
    "profile_evidence": "用户画像",
    "stage_rail": "阶段旅程",
    "journey_curve": "决策旅程",
    "contrast_columns": "对比栏",
    "hypothesis_balance": "证据天平",
    "nested_definition": "嵌套定义",
    "evidence_pyramid": "需求金字塔",
    "impact_frequency": "痛点优先级",
    "voice_wall": "用户原声墙",
    "case_chain": "案例链路",
    "decision_grid": "决策矩阵",
    "three_step": "三步诊断",
    "fishbone": "根因鱼骨",
    "three_lane": "三轨行动",
    "action_roadmap": "行动路线图",
    "insight_evidence": "洞察与证据",
}

VARIANT_COLLECTION_LIMITS: dict[str, dict[str, int]] = {
    "editorial_overview": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "journey_curve": {"content_structure": 5, "supporting_findings": 5, "supporting_points": 5},
    "fishbone": {"content_structure": 6, "supporting_findings": 6, "supporting_points": 6},
    "action_roadmap": {"content_structure": 5, "supporting_findings": 5, "supporting_points": 5},
}

LEGACY_DEFAULTS = {
    page_type: variants[0]
    for page_type, variants in LAYOUT_VARIANTS.items()
}


def _text(value: Any, limit: int = 120) -> str:
    return str(value or "").strip()[:limit]


def resolve_layout_variant(page: dict, template_id: str = "") -> str:
    """Return a supported variant without mutating the page."""
    page_type = _text(page.get("page_type"), 80)
    layout_spec = page.get("layout_spec") if isinstance(page.get("layout_spec"), dict) else {}
    requested = _text(
        page.get("layout_variant")
        or page.get("variant")
        or layout_spec.get("variant"),
        80,
    )
    allowed = LAYOUT_VARIANTS.get(page_type, ("insight_evidence",))
    if requested in allowed:
        return requested
    if template_id == TEMPLATE_ID and page_type in V2_DEFAULTS:
        return V2_DEFAULTS[page_type]
    return LEGACY_DEFAULTS.get(page_type, allowed[0])


def variant_usage(pages: list[dict], template_id: str = "") -> dict[str, int]:
    return dict(Counter(resolve_layout_variant(page, template_id) for page in pages))


def layout_candidates(page_type: str, selected: str = "") -> list[dict]:
    """Return the renderer-supported choices for one semantic page type."""
    allowed = LAYOUT_VARIANTS.get(_text(page_type, 80), ("insight_evidence",))
    catalog = qualitative_template_catalog()
    catalog_by_id = {
        item.get("id"): item
        for item in catalog.get("layouts", [])
        if isinstance(item, dict) and item.get("id")
    }
    return [
        {
            **catalog_by_id.get(layout_id, {"id": layout_id, "page_types": [page_type]}),
            "label": LAYOUT_LABELS.get(layout_id, layout_id),
            "selected": layout_id == selected,
        }
        for layout_id in allowed
    ]


@lru_cache(maxsize=1)
def qualitative_template_catalog() -> dict:
    """Return the client-facing, machine-readable qualitative template catalog."""
    catalog = json.loads(TEMPLATE_CATALOG_PATH.read_text(encoding="utf-8"))
    return {
        **catalog,
        "name": "Tech Blue V2",
        "description": "企业级定性研究报告：科技蓝、原生可编辑、无左侧贯穿竖条。",
        "preview_layout_ids": [
            "editorial_overview",
            "profile_evidence",
            "journey_curve",
            "impact_frequency",
            "fishbone",
            "action_roadmap",
        ],
    }
