"""图表空间检查。

针对 ChartSpec 检查：
  1. 类目数量过多（横向柱状图 > 20 个 category）
  2. Legend 过长（系列名称过长）
  3. 图表尺寸不足（宽度 < 最小图表宽度）
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pptx.util import Inches

from .models import QAIssue, IssueType, RenderAction, Severity

# ─── 阈值常量 ───────────────────────────────────────────────
MAX_VERTICAL_CATEGORIES = 12    # 纵向柱状图最大类目数
MAX_HORIZONTAL_CATEGORIES = 20  # 横向条形图最大类目数
MAX_LEGEND_NAME_LENGTH = 20     # 图例名称最大字符数
MIN_CHART_WIDTH = Inches(3.5)   # 最小图表宽度
MIN_CHART_HEIGHT = Inches(2.0)  # 最小图表高度
MAX_SERIES_FOR_LEGEND = 6       # 超过此数量建议改用数据标签


@dataclass
class ChartGeometry:
    """图表几何与数据信息。"""

    element_id: str
    chart_type: str  # bar, column, line, pie, doughnut, stacked_bar, etc.
    categories: list[str]
    series_names: list[str]
    width_emu: int
    height_emu: int


def check_chart_space(
    slide_id: str,
    charts: list[ChartGeometry],
) -> tuple[list[QAIssue], list[RenderAction]]:
    """检查一页中所有图表的空间问题。

    Returns:
        (issues, actions)
    """
    issues: list[QAIssue] = []
    actions: list[RenderAction] = []

    for chart in charts:
        # ─── 1. 类目数量检查 ────────────────────────────────
        cat_count = len(chart.categories)
        is_horizontal = chart.chart_type in ("bar", "stacked_bar")
        max_cats = MAX_HORIZONTAL_CATEGORIES if is_horizontal else MAX_VERTICAL_CATEGORIES

        if cat_count > max_cats:
            severity = Severity.HIGH if cat_count > max_cats * 1.5 else Severity.MEDIUM
            suggestion = "switch_to_horizontal_bar" if not is_horizontal else "reduce_categories_or_split"
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.CHART_DENSITY_HIGH,
                severity=severity,
                message=f"图表类目过多（{cat_count} 个，建议 ≤ {max_cats}）",
                element_id=chart.element_id,
                details={
                    "category_count": cat_count,
                    "max_recommended": max_cats,
                    "suggestion": suggestion,
                },
            ))
            if not is_horizontal:
                actions.append(RenderAction(
                    slide_id=slide_id,
                    issue_type=IssueType.CHART_DENSITY_HIGH.value,
                    severity=severity.value,
                    action="switch_to_horizontal_bar",
                    before=chart.chart_type,
                    after="bar",
                    reason=f"类目数 {cat_count} 超过纵向图建议上限 {max_cats}，切换为横向条形图",
                ))

        # ─── 2. Legend 过长检查 ─────────────────────────────
        long_names = [n for n in chart.series_names if len(n) > MAX_LEGEND_NAME_LENGTH]
        if long_names:
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.LEGEND_TOO_LONG,
                severity=Severity.LOW,
                message=f"图例名称过长：{long_names[0][:30]}…（{len(long_names)} 个系列）",
                element_id=chart.element_id,
                details={
                    "long_names": long_names[:5],
                    "max_length": MAX_LEGEND_NAME_LENGTH,
                },
            ))
            actions.append(RenderAction(
                slide_id=slide_id,
                issue_type=IssueType.LEGEND_TOO_LONG.value,
                severity=Severity.LOW.value,
                action="truncate_legend_or_use_data_labels",
                before=f"legend_names={len(long_names)} too long",
                after="shortened_legend",
                reason="图例名称过长，缩短显示或改用数据标签",
            ))

        # 系列过多时建议改用数据标签
        if len(chart.series_names) > MAX_SERIES_FOR_LEGEND:
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.LEGEND_TOO_LONG,
                severity=Severity.MEDIUM,
                message=f"系列过多（{len(chart.series_names)} 个），图例占用空间过大",
                element_id=chart.element_id,
                details={"series_count": len(chart.series_names)},
            ))

        # ─── 3. 图表尺寸不足检查 ────────────────────────────
        if chart.width_emu < int(MIN_CHART_WIDTH):
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.CHART_TOO_SMALL,
                severity=Severity.MEDIUM,
                message=f"图表宽度过小（{chart.width_emu} EMU < {int(MIN_CHART_WIDTH)} EMU）",
                element_id=chart.element_id,
                details={
                    "width_emu": chart.width_emu,
                    "min_width_emu": int(MIN_CHART_WIDTH),
                },
            ))
            actions.append(RenderAction(
                slide_id=slide_id,
                issue_type=IssueType.CHART_TOO_SMALL.value,
                severity=Severity.MEDIUM.value,
                action="enlarge_chart",
                before=f"width={chart.width_emu}",
                after=f"width={int(MIN_CHART_WIDTH)}",
                reason="图表宽度不足，增大图表区域",
            ))

        if chart.height_emu < int(MIN_CHART_HEIGHT):
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.CHART_TOO_SMALL,
                severity=Severity.LOW,
                message=f"图表高度过小（{chart.height_emu} EMU < {int(MIN_CHART_HEIGHT)} EMU）",
                element_id=chart.element_id,
                details={
                    "height_emu": chart.height_emu,
                    "min_height_emu": int(MIN_CHART_HEIGHT),
                },
            ))

    return issues, actions
