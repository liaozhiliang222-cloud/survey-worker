"""Template registry and selector for quantitative research report pages."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class ReportTemplateVariant:
    template_id: str
    slide_types: tuple[str, ...]
    layout_family: str
    chart_count_range: tuple[int, int] = (0, 6)
    category_count_range: tuple[int, int] = (0, 99)
    segment_count_range: tuple[int, int] = (0, 99)
    density: tuple[str, ...] = ("low", "medium", "high")
    supports_table: bool = False
    supports_insight_sidebar: bool = False
    supports_highlight: bool = True
    renderer: str = "build_chart_page"

    def matches(self, request: dict) -> bool:
        return (
            str(request.get("slide_type") or "key_finding") in self.slide_types
            and self.chart_count_range[0]
            <= int(request.get("chart_count") or 0)
            <= self.chart_count_range[1]
            and self.category_count_range[0]
            <= int(request.get("category_count") or 0)
            <= self.category_count_range[1]
            and self.segment_count_range[0]
            <= int(request.get("segment_count") or 0)
            <= self.segment_count_range[1]
            and str(request.get("density") or "medium") in self.density
            and (not request.get("needs_table") or self.supports_table)
            and (
                not request.get("needs_insight_sidebar")
                or self.supports_insight_sidebar
            )
        )


REPORT_TEMPLATE_REGISTRY = [
    ReportTemplateVariant(
        "research_overview_v1",
        ("research_overview", "methodology"),
        "research_overview",
        chart_count_range=(0, 0),
        renderer="build_research_overview",
    ),    ReportTemplateVariant(
        "section_divider_v1",
        ("section_divider",),
        "section_divider",
        chart_count_range=(0, 0),
        renderer="build_section_divider",
    ),
    ReportTemplateVariant(
        "findings_overview_v1",
        ("findings_overview",),
        "findings_overview",
        chart_count_range=(0, 0),
        supports_highlight=True,
        renderer="build_findings_overview",
    ),
    ReportTemplateVariant(
        "key_finding_evidence_v1",
        ("key_finding", "chart"),
        "key_finding_with_evidence",
        chart_count_range=(1, 1),
        supports_insight_sidebar=True,
    ),
    ReportTemplateVariant(
        "hero_chart_v1",
        ("key_finding", "chart"),
        "hero_chart",
        chart_count_range=(1, 1),
        category_count_range=(2, 12),
    ),
    ReportTemplateVariant(
        "main_subcharts_v1",
        ("key_finding", "chart"),
        "main_chart_sub_charts",
        chart_count_range=(2, 4),
    ),
    ReportTemplateVariant(
        "comparison_40_60_v1",
        ("segment_comparison", "chart"),
        "comparison_40_60",
        chart_count_range=(1, 2),
        segment_count_range=(2, 8),
        supports_insight_sidebar=True,
    ),
    ReportTemplateVariant(
        "segment_profile_v1",
        ("segment_comparison",),
        "segment_profile",
        chart_count_range=(1, 3),
        segment_count_range=(2, 8),
    ),
    ReportTemplateVariant(
        "funnel_drivers_v1",
        ("funnel_analysis",),
        "funnel_with_drivers",
        chart_count_range=(0, 1),
        renderer="build_funnel_analysis",
    ),
    ReportTemplateVariant(
        "matrix_priority_v1",
        ("opportunity_matrix",),
        "matrix_with_priority",
        chart_count_range=(0, 1),
        supports_table=True,
        renderer="build_opportunity_matrix",
    ),
    ReportTemplateVariant(
        "chart_table_hybrid_v1",
        ("chart", "key_finding"),
        "chart_table_hybrid",
        chart_count_range=(1, 3),
        supports_table=True,
    ),
    ReportTemplateVariant(
        "recommendation_v1",
        ("recommendation",),
        "recommendation",
        chart_count_range=(0, 0),
        renderer="build_recommendation",
    ),
]

REPORT_TEMPLATE_BY_ID = {
    template.template_id: template for template in REPORT_TEMPLATE_REGISTRY
}


def select_report_template(
    request: dict,
    *,
    previous_template_id: str | None = None,
    usage: Counter | None = None,
) -> tuple[ReportTemplateVariant, list[dict]]:
    usage = usage or Counter()
    issues: list[dict] = []
    manual = str(request.get("template_id") or "")
    if manual:
        if manual in REPORT_TEMPLATE_BY_ID:
            return REPORT_TEMPLATE_BY_ID[manual], [
                {"level": "warning", "code": "manual_template_override"}
            ]
        issues.append(
            {
                "level": "error",
                "code": "unknown_report_template",
                "template_id": manual,
            }
        )
    candidates = [
        template
        for template in REPORT_TEMPLATE_REGISTRY
        if template.matches(request)
    ]
    if not candidates:
        fallback = REPORT_TEMPLATE_BY_ID[
            "key_finding_evidence_v1"
            if int(request.get("chart_count") or 0)
            else "findings_overview_v1"
        ]
        issues.append(
            {
                "level": "warning",
                "code": "report_template_fallback",
                "template_id": fallback.template_id,
            }
        )
        return fallback, issues

    def score(template: ReportTemplateVariant) -> tuple[int, int, str]:
        repeat_penalty = 3 if template.template_id == previous_template_id else 0
        overuse_penalty = max(0, usage[template.template_id] - 1)
        sidebar_bonus = int(
            bool(request.get("needs_insight_sidebar"))
            and template.supports_insight_sidebar
        )
        importance_bonus = int(
            request.get("importance") == "high"
            and template.layout_family
            in {"hero_chart", "key_finding_with_evidence"}
        )
        return (
            sidebar_bonus
            + importance_bonus
            - repeat_penalty
            - overuse_penalty,
            -usage[template.template_id],
            template.template_id,
        )

    return sorted(candidates, key=score, reverse=True)[0], issues
