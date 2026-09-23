"""Versioned, source-traceable layout contract for the business-blue report pack."""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path

BUSINESS_BLUE_ID = "research_business_blue_v1"
BUSINESS_BLUE_VERSION = "1.0.0"
CATALOG_PATH = Path(__file__).parent / "templates" / "research-business-blue-v1" / "layout_catalog.json"


@lru_cache(maxsize=1)
def _catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def business_blue_catalog() -> dict:
    return deepcopy(_catalog())


def business_blue_layout(layout_id: str) -> dict:
    for item in _catalog()["layouts"]:
        if item["id"] == layout_id:
            return item
    raise ValueError(f"未注册的蓝色商务版式：{layout_id}")


DEFAULTS = {
    "cover": "bb_cover", "navigation": "bb_contents", "section_intro": "bb_section",
    "executive_summary": "bb_summary", "qualitative_summary": "bb_summary",
    "theme_summary": "bb_findings", "qualitative_insight": "bb_findings",
    "quote_evidence": "bb_quotes", "persona": "bb_persona_pair",
    "journey": "bb_journey", "problem_reason": "bb_fishbone",
    "matrix": "bb_matrix", "concept_definition": "bb_value_canvas",
    "comparison": "bb_comparison", "segment_comparison": "bb_persona_pair",
    "competitor_comparison": "bb_feature_compare", "segmentation_map": "bb_positioning",
    "priority_matrix": "bb_priority", "recommendation": "bb_actions",
    "research_framework": "bb_glossary", "framework": "bb_strategy_house",
    "summary": "bb_closing", "appendix": "bb_sources",
    "case_study": "bb_gap", "evidence_diagnostic": "bb_comparison",
    "needs_pyramid": "bb_strategy_house",
}


def resolve_business_blue(page: dict) -> str:
    requested = str(page.get("layout_variant") or page.get("variant") or
                    (page.get("layout_spec") or {}).get("variant") or "").strip()
    page_type = str(page.get("page_type") or "qualitative_insight")
    # Legacy variant names are ignored on an explicit template switch. Unknown
    # names in this pack are errors, so typos cannot silently change the design.
    if requested.startswith("bb_"):
        layout = business_blue_layout(requested)
        if page_type not in layout["page_types"]:
            raise ValueError(f"版式 {layout['label']} 不适用于页面类型 {page_type}")
        return requested
    if page_type not in DEFAULTS:
        raise ValueError(f"蓝色商务第一期不支持页面类型：{page_type}")
    # Older scripts use navigation for the cover. Keep their explicit convention.
    if page_type == "navigation" and (page.get("page_number") == 1 or page.get("navigation_role") == "cover"):
        return "bb_cover"
    if page_type == "segmentation_map":
        axes = page.get("axes") or {}
        positioned = any(isinstance(item, dict) and all(isinstance(item.get(k), (int, float)) for k in ("x", "y"))
                         for item in page.get("segments", []))
        if not axes.get("x") or not axes.get("y") or not positioned:
            return "bb_persona_pair"
    return DEFAULTS[page_type]


def business_blue_candidates(page_type: str, selected: str = "") -> list[dict]:
    return [{**deepcopy(item), "selected": item["id"] == selected}
            for item in _catalog()["layouts"] if page_type in item["page_types"]]
