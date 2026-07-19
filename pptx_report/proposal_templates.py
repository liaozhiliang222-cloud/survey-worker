"""Template registry and selector for research proposal decks.

The AI layer should describe slide semantics.  This module owns the deterministic
mapping from those semantics to reusable page-family template variants.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any


THEME = {
    "fonts": {"cn": "Microsoft YaHei", "en": "Aptos"},
    "colors": {
        "navy": "16324F",
        "blue": "2474D2",
        "cyan": "29A8B8",
        "orange": "F28C28",
        "text": "1B2533",
        "muted": "667085",
        "bg": "F7F9FC",
        "line": "D9E1EA",
    },
    "spacing": {"page_margin": 0.55, "section_gap": 0.25, "block_gap": 0.20},
}


COMMON_PLACEHOLDERS = [
    "SK_TITLE",
    "SK_SUBTITLE",
    "SK_KICKER",
    "SK_FOOTNOTE",
    "SK_PAGE_NO",
    "SK_BRAND",
    "SK_KEEP",
    "SK_IMAGE_01",
    "SK_IMAGE_02",
]

TEXT_PLACEHOLDERS = ["SK_BODY_01", "SK_BODY_02", "SK_BODY_03", "SK_NOTE_01", "SK_NOTE_02"]

NODE_PLACEHOLDERS = [
    f"SK_NODE_{index:02d}_{field}"
    for index in range(1, 6)
    for field in ("TITLE", "BODY")
]

STAGE_PLACEHOLDERS = [
    f"SK_STAGE_{index:02d}_{field}"
    for index in range(1, 5)
    for field in ("TITLE", "ACTION", "OUTPUT")
]

CHART_PLACEHOLDERS = [
    "SK_CHART_01",
    "SK_CHART_02",
    "SK_CHART_TITLE_01",
    "SK_CHART_TITLE_02",
    "SK_INSIGHT_01",
    "SK_INSIGHT_02",
    "SK_INSIGHT_03",
    "SK_EXAMPLE_TAG",
    "SK_DISCLAIMER",
]

GANTT_PLACEHOLDERS = [
    "SK_TIMELINE",
    *[f"SK_TASK_{index:02d}" for index in range(1, 6)],
    "SK_DELIVERABLE_01",
    "SK_DELIVERABLE_02",
    "SK_RISK_01",
    "SK_RISK_02",
]

SAMPLE_PLACEHOLDERS = [
    "SK_TOTAL_SAMPLE",
    "SK_BRANCH_01_TITLE",
    "SK_BRANCH_01_BODY",
    "SK_BRANCH_02_TITLE",
    "SK_BRANCH_02_BODY",
    "SK_BRANCH_03_TITLE",
    "SK_BRANCH_03_BODY",
    "SK_ADDON_TITLE",
    "SK_ADDON_BODY",
]


@dataclass(frozen=True)
class TemplateVariant:
    template_id: str
    family: str
    slide_types: tuple[str, ...]
    variant: str
    primary_structure: str
    relation_types: tuple[str, ...] = ()
    density: tuple[str, ...] = ("low", "medium", "high", "compact", "standard", "professional")
    node_range: tuple[int, int] = (0, 99)
    required_placeholders: tuple[str, ...] = ("SK_TITLE",)
    editable_level: str = "high"
    renderer: str = "generic"
    template_file: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def matches(self, slide: dict) -> bool:
        slide_type = _alias_slide_type(slide.get("slide_type") or slide.get("visual_type"))
        relation_type = _alias_relation_type(slide.get("relation_type"))
        density = _alias_density(slide.get("content_density"))
        node_count = _node_count(slide)
        return (
            slide_type in self.slide_types
            and (not self.relation_types or relation_type in self.relation_types)
            and density in self.density
            and self.node_range[0] <= node_count <= self.node_range[1]
        )


def _alias_slide_type(value: Any) -> str:
    raw = str(value or "").strip()
    aliases = {
        "context_tension_map": "project_background",
        "project_context": "project_background",
        "opportunity_context": "project_background",
        "business_decisions": "key_business_decisions",
        "decision_tree": "key_business_decisions",
        "decision_framework": "key_business_decisions",
        "dual_track_research_flow": "research_path",
        "methodology_flow": "research_path",
        "quantitative_sample_architecture": "sample_design",
        "qualitative_design_canvas": "execution_design",
        "qualitative_design": "execution_design",
        "quantitative_design": "sample_design",
        "concept_funnel_maxdiff_example": "report_example",
        "pricing_segment_example": "report_example",
        "concept_result_example": "report_example",
        "pricing_result_example": "report_example",
        "timeline_gantt_risk": "gantt",
        "timeline": "gantt",
        "delivery_plan": "gantt",
    }
    return aliases.get(raw, raw)


def _alias_relation_type(value: Any) -> str:
    raw = str(value or "").strip()
    aliases = {
        "causal": "causal_chain",
        "sequence": "sequential",
        "time": "timeline",
        "data": "chart",
        "hero": "causal_chain",
        "comparison": "contrast",
    }
    return aliases.get(raw, raw or "sequential")


def _alias_density(value: Any) -> str:
    raw = str(value or "").strip()
    aliases = {"compact": "low", "standard": "medium", "professional": "medium"}
    return aliases.get(raw, raw or "medium")


def _node_count(slide: dict) -> int:
    if isinstance(slide.get("node_count"), int):
        return int(slide["node_count"])
    content = slide.get("content")
    if isinstance(content, list):
        return len(content)
    content_obj = slide.get("content")
    if isinstance(content_obj, dict):
        nodes = content_obj.get("nodes") or content_obj.get("items")
        if isinstance(nodes, list):
            return len(nodes)
    return 0


def _chart_count(slide: dict) -> int:
    charts = slide.get("charts")
    return len(charts) if isinstance(charts, list) else 0


REGISTRY: list[TemplateVariant] = [
    TemplateVariant(
        "background_chain_v1",
        "project_background",
        ("project_background",),
        "A",
        "causal_chain",
        ("causal_chain", "sequential"),
        node_range=(3, 5),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + NODE_PLACEHOLDERS[:8]),
        renderer="render_project_background",
        template_file="background_chain_v1.pptx",
    ),
    TemplateVariant(
        "background_contrast_v1",
        "project_background",
        ("project_background",),
        "B",
        "contrast",
        ("contrast",),
        node_range=(2, 6),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + TEXT_PLACEHOLDERS[:3]),
        renderer="render_project_background",
        template_file="background_contrast_v1.pptx",
    ),
    TemplateVariant(
        "decision_3up_v1",
        "key_business_decisions",
        ("key_business_decisions",),
        "A",
        "three_decisions",
        node_range=(1, 3),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + NODE_PLACEHOLDERS[:6]),
        renderer="render_key_decisions",
        template_file="decision_3up_v1.pptx",
    ),
    TemplateVariant(
        "decision_radial_v1",
        "key_business_decisions",
        ("key_business_decisions",),
        "B",
        "radial_decisions",
        node_range=(4, 6),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + NODE_PLACEHOLDERS),
        renderer="render_key_decisions",
        template_file="decision_radial_v1.pptx",
    ),
    TemplateVariant(
        "research_path_linear_v1",
        "research_path",
        ("research_path",),
        "A",
        "linear_stages",
        ("sequential",),
        node_range=(3, 5),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + STAGE_PLACEHOLDERS),
        renderer="render_research_path",
        template_file="research_path_linear_v1.pptx",
    ),
    TemplateVariant(
        "research_path_dualtrack_v1",
        "research_path",
        ("research_path",),
        "B",
        "dual_track",
        node_range=(3, 6),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + STAGE_PLACEHOLDERS),
        renderer="render_research_path",
        template_file="research_path_dualtrack_v1.pptx",
        metadata={"requires_parallel_tracks": True},
    ),
    TemplateVariant(
        "sample_tree_v1",
        "sample_design",
        ("sample_design",),
        "A",
        "sample_tree",
        node_range=(3, 8),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + SAMPLE_PLACEHOLDERS),
        renderer="render_sample_design",
        template_file="sample_tree_v1.pptx",
    ),
    TemplateVariant(
        "execution_canvas_v1",
        "sample_design",
        ("execution_design", "sample_design"),
        "B",
        "execution_canvas",
        node_range=(2, 6),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + TEXT_PLACEHOLDERS + NODE_PLACEHOLDERS[:8]),
        renderer="render_sample_design",
        template_file="execution_canvas_v1.pptx",
    ),
    TemplateVariant(
        "chart_insight_v1",
        "report_example",
        ("report_example",),
        "A",
        "single_chart_with_insights",
        node_range=(0, 4),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + CHART_PLACEHOLDERS),
        renderer="render_report_example",
        template_file="chart_insight_v1.pptx",
    ),
    TemplateVariant(
        "dual_chart_v1",
        "report_example",
        ("report_example",),
        "B",
        "dual_chart",
        node_range=(0, 4),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + CHART_PLACEHOLDERS),
        renderer="render_report_example",
        template_file="dual_chart_v1.pptx",
    ),
    TemplateVariant(
        "gantt_standard_v1",
        "gantt",
        ("gantt",),
        "A",
        "standard_gantt",
        density=("low", "medium", "compact", "standard", "professional"),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + GANTT_PLACEHOLDERS),
        renderer="render_gantt",
        template_file="gantt_standard_v1.pptx",
    ),
    TemplateVariant(
        "gantt_risk_v1",
        "gantt",
        ("gantt",),
        "B",
        "gantt_with_risks",
        density=("high", "professional"),
        required_placeholders=tuple(COMMON_PLACEHOLDERS[:6] + GANTT_PLACEHOLDERS),
        renderer="render_gantt",
        template_file="gantt_risk_v1.pptx",
    ),
]

REGISTRY_BY_ID = {variant.template_id: variant for variant in REGISTRY}


def registry_as_dict() -> list[dict[str, Any]]:
    return [
        {
            "template_id": variant.template_id,
            "family": variant.family,
            "slide_type": list(variant.slide_types),
            "variant": variant.variant,
            "primary_structure": variant.primary_structure,
            "relation_type": list(variant.relation_types),
            "content_density": list(variant.density),
            "node_range": list(variant.node_range),
            "editable_level": variant.editable_level,
            "renderer": variant.renderer,
            "template_file": variant.template_file,
            "required_placeholders": list(variant.required_placeholders),
            "metadata": variant.metadata,
        }
        for variant in REGISTRY
    ]


def select_template(slide: dict, previous_template_id: str | None = None,
                    usage: Counter | None = None) -> tuple[TemplateVariant, list[dict]]:
    """Choose a template variant from semantic slide fields.

    Manual override is intentionally allowed for debugging and template QA, but
    normal AI output should not fill it.
    """
    issues: list[dict] = []
    usage = usage or Counter()
    manual_id = slide.get("template_id") or slide.get("template_override")
    if manual_id:
        if manual_id in REGISTRY_BY_ID:
            variant = REGISTRY_BY_ID[manual_id]
            issues.append({"level": "warning", "code": "manual_template_override", "template_id": manual_id})
            return variant, issues
        issues.append({"level": "error", "code": "unknown_template_override", "template_id": manual_id})

    slide_type = _alias_slide_type(slide.get("slide_type") or slide.get("visual_type"))
    candidates = [variant for variant in REGISTRY if variant.matches({**slide, "slide_type": slide_type})]

    if slide_type == "research_path" and slide.get("has_parallel_tracks"):
        candidates = [REGISTRY_BY_ID["research_path_dualtrack_v1"]]
    elif slide_type == "report_example":
        candidates = [REGISTRY_BY_ID["dual_chart_v1" if _chart_count(slide) >= 2 else "chart_insight_v1"]]
    elif slide_type == "gantt" and _alias_density(slide.get("content_density")) == "high":
        candidates = [REGISTRY_BY_ID["gantt_risk_v1"]]
    elif slide_type == "key_business_decisions":
        candidates = [REGISTRY_BY_ID["decision_radial_v1" if _node_count(slide) >= 4 else "decision_3up_v1"]]

    if not candidates:
        fallback_by_type = {
            "project_background": "background_chain_v1",
            "key_business_decisions": "decision_3up_v1",
            "research_path": "research_path_linear_v1",
            "sample_design": "sample_tree_v1",
            "execution_design": "execution_canvas_v1",
            "report_example": "chart_insight_v1",
            "gantt": "gantt_standard_v1",
        }
        fallback_id = fallback_by_type.get(slide_type, "background_chain_v1")
        issues.append({"level": "warning", "code": "template_fallback", "slide_type": slide_type, "template_id": fallback_id})
        return REGISTRY_BY_ID[fallback_id], issues

    def score(variant: TemplateVariant) -> tuple[int, int, str]:
        repeat_penalty = 2 if variant.template_id == previous_template_id else 0
        overuse_penalty = max(0, usage[variant.template_id] - 1)
        relation_bonus = 1 if _alias_relation_type(slide.get("relation_type")) in variant.relation_types else 0
        return (relation_bonus - repeat_penalty - overuse_penalty, -usage[variant.template_id], variant.template_id)

    selected = sorted(candidates, key=score, reverse=True)[0]
    if selected.template_id == previous_template_id and len(candidates) > 1:
        issues.append({"level": "warning", "code": "consecutive_template_allowed", "template_id": selected.template_id})
    if usage[selected.template_id] >= 2:
        issues.append({"level": "warning", "code": "template_overused", "template_id": selected.template_id})
    return selected, issues


def plan_deck_templates(slides: list[dict]) -> tuple[list[dict], list[dict]]:
    usage: Counter = Counter()
    previous: str | None = None
    issues: list[dict] = []
    planned: list[dict] = []
    for index, slide in enumerate(slides, 1):
        if slide.get("visual_type") == "cover_product_hero" or _alias_slide_type(slide.get("slide_type")) == "cover":
            planned.append({
                **slide,
                "template_id": "cover_product_hero",
                "page_family": "cover",
                "template_variant": "hero",
                "primary_structure": "cover",
                "renderer": "render_cover",
                "required_placeholders": ["SK_TITLE", "SK_SUBTITLE", "SK_BRAND"],
            })
            continue
        variant, template_issues = select_template(slide, previous, usage)
        usage[variant.template_id] += 1
        previous = variant.template_id
        issues.extend({**issue, "slide": index} for issue in template_issues)
        planned.append({
            **slide,
            "template_id": variant.template_id,
            "page_family": variant.family,
            "template_variant": variant.variant,
            "primary_structure": variant.primary_structure,
            "renderer": variant.renderer,
            "required_placeholders": list(variant.required_placeholders),
        })
    return planned, issues

