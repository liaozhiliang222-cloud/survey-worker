"""内容数据模型（数据与渲染分离的核心）。

调用方只需用「数据」描述一份报告要呈现什么（纯 Python 字典或 dataclass 实例），
渲染器负责把数据变成 .pptx。两者解耦，便于：
  - 从接口 / 数据库 / Excel 动态拼装内容；
  - 同一份数据用不同主题 / 模板渲染；
  - 单元测试只校验数据，不依赖 PowerPoint。

支持两种入口：
  - 直接用 dataclass 构造（配合 :meth:`ChartSpec.bar` 等便捷工厂）；
  - 用 :meth:`ReportSpec.from_dict` 从嵌套字典解析（最适合接口 / 配置驱动）。
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from enum import Enum
from typing import Any, Dict, List, Optional

from .common.slide_brief import SlideBrief
from .exceptions import ReportDataError, UnsupportedChartTypeError


class ChartType(str, Enum):
    """支持的图表类型。值为字符串，可直接与字典里的 "bar" 等比较。"""

    BAR = "bar"                # 条形图（横向）
    COLUMN = "column"          # 柱状图（纵向）
    LINE = "line"              # 折线图
    PIE = "pie"                # 饼图
    DOUGHNUT = "doughnut"     # 环形图
    STACKED_BAR = "stacked_bar"       # 堆积条形图（横向）
    STACKED_COLUMN = "stacked_column" # 堆积柱状图（纵向）
    SCATTER = "scatter"        # 散点图
    RADAR = "radar"            # 雷达图
    COMBO = "combo"            # 组合图（柱状 + 折线，双轴）


class LayoutType(str, Enum):
    """图表页的排版布局。"""

    AUTO = "auto"              # 按图表数量 / 是否含洞察自动选择
    SINGLE = "single"          # 单图大版面（图占 ~70%，底部留结论）
    DUAL = "dual"              # 对比式双图（左右各一图）
    DASHBOARD = "dashboard"    # 仪表盘网格（2x2 / 3x2，最多 6 图）
    MIXED = "mixed"            # 图文混排（图 60% + 侧栏 40% 洞察）
    HERO_CHART = "hero_chart"
    CHART_WITH_INSIGHT = "chart_with_insight"
    MAIN_CHART_SUB_CHARTS = "main_chart_sub_charts"
    COMPARISON_40_60 = "comparison_40_60"
    FUNNEL_WITH_DRIVERS = "funnel_with_drivers"
    SEGMENT_PROFILE = "segment_profile"
    MATRIX_WITH_PRIORITY = "matrix_with_priority"
    CHART_TABLE_HYBRID = "chart_table_hybrid"
    KEY_FINDING_WITH_EVIDENCE = "key_finding_with_evidence"


class PageType(str, Enum):
    CHART = "chart"
    RESEARCH_OVERVIEW = "research_overview"
    SECTION_DIVIDER = "section_divider"
    FINDINGS_OVERVIEW = "findings_overview"
    KEY_FINDING = "key_finding"
    SEGMENT_COMPARISON = "segment_comparison"
    FUNNEL_ANALYSIS = "funnel_analysis"
    DRIVER_ANALYSIS = "driver_analysis"
    PROBLEM_CAUSE_IMPACT = "problem_cause_impact"
    OPPORTUNITY_MATRIX = "opportunity_matrix"
    RECOMMENDATION = "recommendation"
    ROADMAP = "roadmap"
    METHODOLOGY = "methodology"


class DataKind(str, Enum):
    PERCENTAGE = "percentage"
    COUNT = "count"
    MEAN = "mean"
    SCORE = "score"
    INDEX = "index"
    CURRENCY = "currency"
    FREQUENCY = "frequency"
    NPS = "nps"


@dataclass
class DataFact:
    """A verified quantitative fact that can be cited by AI-written claims."""

    fact_id: str
    fact_type: str
    question_id: str
    metric_name: str
    segment: Optional[str] = None
    category: Optional[str] = None
    value: Optional[float] = None
    benchmark_value: Optional[float] = None
    gap_pp: Optional[float] = None
    rank: Optional[int] = None
    base: Optional[int] = None
    significant: Optional[bool] = None
    source_reference: str = ""
    confidence: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "fact_id": self.fact_id,
            "fact_type": self.fact_type,
            "question_id": self.question_id,
            "metric_name": self.metric_name,
            "segment": self.segment,
            "category": self.category,
            "value": self.value,
            "benchmark_value": self.benchmark_value,
            "gap_pp": self.gap_pp,
            "rank": self.rank,
            "base": self.base,
            "significant": self.significant,
            "source_reference": self.source_reference,
            "confidence": self.confidence,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DataFact":
        values = {name: data.get(name) for name in cls.__dataclass_fields__}
        values["fact_id"] = str(values.get("fact_id") or "")
        values["fact_type"] = str(values.get("fact_type") or "")
        values["question_id"] = str(values.get("question_id") or "")
        values["metric_name"] = str(values.get("metric_name") or "")
        values["source_reference"] = str(values.get("source_reference") or "")
        values["confidence"] = float(values.get("confidence") if values.get("confidence") is not None else 1.0)
        return cls(**values)

# ------------------------- 原子结构 -------------------------
@dataclass
class Series:
    """一组系列数据。

    Attributes:
        name: 系列名称（图例显示）。
        values: 数值序列，长度需与 categories 一致（散点图除外）。
        axis: 主轴 ``'primary'`` 或副轴 ``'secondary'``（仅组合图使用）。
        chart_type: 覆盖该系列的图表类型（组合图可将某系列设为 ``'line'``）。
    """

    name: str
    values: List[float] = field(default_factory=list)
    axis: str = "primary"
    chart_type: Optional[str] = None
    value_format: Optional[str] = None  # 数据标签数字格式覆盖（如 '#,##0' / '0.0'）

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "values": list(self.values),
            "axis": self.axis,
            "chart_type": self.chart_type,
            "value_format": self.value_format,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Series":
        return cls(
            name=str(data["name"]),
            values=[float(v) for v in data.get("values", [])],
            axis=data.get("axis", "primary"),
            chart_type=data.get("chart_type"),
            value_format=data.get("value_format"),
        )


@dataclass
class ChartSpec:
    """单个图表的规格描述（纯数据，不含任何渲染逻辑）。"""

    title: str
    type: Any
    categories: List[str] = field(default_factory=list)
    series: List[Series] = field(default_factory=list)
    x_values: List[float] = field(default_factory=list)
    y_values: List[float] = field(default_factory=list)
    insight: str = ""                       # 图表下方一句话结论
    secondary_axis_title: Optional[str] = None  # 组合图副轴标题
    data_kind: Any = DataKind.PERCENTAGE
    unit: str = "%"
    axis_policy: str = "zero_based"
    sort_policy: str = "auto"
    highlight_series: Optional[str] = None
    highlight_categories: List[str] = field(default_factory=list)
    benchmark_value: Optional[float] = None
    benchmark_label: str = ""
    show_base: bool = False
    base_values: Dict[str, int] = field(default_factory=dict)
    significance_markers: List[Dict[str, Any]] = field(default_factory=list)
    evidence_question_ids: List[str] = field(default_factory=list)
    evidence_fact_ids: List[str] = field(default_factory=list)
    source_references: List[str] = field(default_factory=list)

    # ----------------- 便捷工厂（兼作使用示例） -----------------
    @classmethod
    def bar(cls, title, categories, series_dict, insight="", stacked=False):
        """分类比较柱状图。series_dict: ``{系列名: [值, ...]}``。"""
        series = [Series(name=n, values=v) for n, v in series_dict.items()]
        ctype = ChartType.STACKED_BAR if stacked else ChartType.BAR
        return cls(title=title, type=ctype, categories=categories,
                   series=series, insight=insight)

    @classmethod
    def line(cls, title, categories, series_dict, insight=""):
        """趋势折线图。"""
        series = [Series(name=n, values=v) for n, v in series_dict.items()]
        return cls(title=title, type=ChartType.LINE, categories=categories,
                   series=series, insight=insight)

    @classmethod
    def pie(cls, title, categories, values, name="占比", insight=""):
        """构成占比饼图。"""
        return cls(title=title, type=ChartType.PIE, categories=categories,
                   series=[Series(name=name, values=values)], insight=insight)

    @classmethod
    def doughnut(cls, title, categories, values, name="占比", insight=""):
        """构成占比环形图。"""
        return cls(title=title, type=ChartType.DOUGHNUT, categories=categories,
                   series=[Series(name=name, values=values)], insight=insight)

    @classmethod
    def radar(cls, title, categories, series_dict, insight=""):
        """多维度评估雷达图。"""
        series = [Series(name=n, values=v) for n, v in series_dict.items()]
        return cls(title=title, type=ChartType.RADAR, categories=categories,
                   series=series, insight=insight)

    @classmethod
    def scatter(cls, title, x_values, y_values, name="散点", insight=""):
        """相关性散点图（横纵均为数值）。"""
        return cls(title=title, type=ChartType.SCATTER,
                   x_values=list(x_values), y_values=list(y_values),
                   series=[Series(name=name, values=list(y_values))],
                   insight=insight)

    @classmethod
    def combo(cls, title, categories, bars, line, line_name="增长率",
              secondary_axis_title="增长率", insight=""):
        """组合图：柱状(主轴) + 折线(副轴)。

        Args:
            bars: ``{系列名: [值, ...]}`` 作为柱状。
            line: 折线系列的数值列表（绘制在副轴）。
        """
        series = [Series(name=n, values=v, axis="primary", value_format="#,##0")
                  for n, v in bars.items()]
        series.append(Series(name=line_name, values=line, axis="secondary",
                            chart_type="line", value_format="0.0"))
        return cls(title=title, type=ChartType.COMBO, categories=categories,
                   series=series, secondary_axis_title=secondary_axis_title,
                   insight=insight)

    # ----------------- 字典互转 -----------------
    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "type": self.type.value if isinstance(self.type, ChartType) else self.type,
            "categories": list(self.categories),
            "series": [s.to_dict() for s in self.series],
            "x_values": list(self.x_values),
            "y_values": list(self.y_values),
            "insight": self.insight,
            "secondary_axis_title": self.secondary_axis_title,
            "data_kind": self.data_kind.value if isinstance(self.data_kind, DataKind) else self.data_kind,
            "unit": self.unit,
            "axis_policy": self.axis_policy,
            "sort_policy": self.sort_policy,
            "highlight_series": self.highlight_series,
            "highlight_categories": list(self.highlight_categories),
            "benchmark_value": self.benchmark_value,
            "benchmark_label": self.benchmark_label,
            "show_base": self.show_base,
            "base_values": dict(self.base_values),
            "significance_markers": list(self.significance_markers),
            "evidence_question_ids": list(self.evidence_question_ids),
            "evidence_fact_ids": list(self.evidence_fact_ids),
            "source_references": list(self.source_references),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChartSpec":
        raw = data["type"]
        try:
            ctype = ChartType(raw)
        except ValueError:
            raise UnsupportedChartTypeError(str(raw))
        return cls(
            title=str(data["title"]),
            type=ctype,
            categories=[str(c) for c in data.get("categories", [])],
            series=[Series.from_dict(s) for s in data.get("series", [])],
            x_values=[float(v) for v in data.get("x_values", [])],
            y_values=[float(v) for v in data.get("y_values", [])],
            insight=str(data.get("insight", "")),
            secondary_axis_title=data.get("secondary_axis_title"),
            data_kind=DataKind(data.get("data_kind", "percentage")),
            unit=str(data.get("unit", "%")),
            axis_policy=str(data.get("axis_policy", "zero_based")),
            sort_policy=str(data.get("sort_policy", "auto")),
            highlight_series=data.get("highlight_series"),
            highlight_categories=[str(value) for value in data.get("highlight_categories", [])],
            benchmark_value=data.get("benchmark_value"),
            benchmark_label=str(data.get("benchmark_label", "")),
            show_base=bool(data.get("show_base", False)),
            base_values={str(key): int(value) for key, value in data.get("base_values", {}).items()},
            significance_markers=list(data.get("significance_markers", [])),
            evidence_question_ids=[str(value) for value in data.get("evidence_question_ids", [])],
            evidence_fact_ids=[str(value) for value in data.get("evidence_fact_ids", [])],
            source_references=[str(value) for value in data.get("source_references", [])],
        )


# ------------------------- 页面内容 -------------------------
@dataclass
class ExecutiveFinding:
    title: str
    description: str = ""
    evidence_fact_ids: List[str] = field(default_factory=list)
    action_implication: str = ""
    importance: str = "medium"
    evidence_question_ids: List[str] = field(default_factory=list)
    source_references: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "description": self.description,
            "evidence_fact_ids": list(self.evidence_fact_ids),
            "action_implication": self.action_implication,
            "importance": self.importance,
            "evidence_question_ids": list(self.evidence_question_ids),
            "source_references": list(self.source_references),
        }

@dataclass
class KPI:
    """执行摘要里的一个核心指标。"""

    label: str
    value: str                  # 允许 "78%" / "1,234" 等形式
    delta: Optional[str] = None # 如 "+12% 同比"


@dataclass
class CoverContent:
    """封面页内容。"""

    title: str
    client: str
    date: str
    subtitle: Optional[str] = None
    logo_path: Optional[str] = None  # 预留 Logo 位置，文件存在才绘制


@dataclass
class TocContent:
    """目录页内容。sections 为空时由渲染器自动提取章节标题。"""

    sections: List[str] = field(default_factory=list)


@dataclass
class ExecutiveSummaryContent:
    """执行摘要页内容。"""

    kpis: List[KPI] = field(default_factory=list)
    conclusion: str = ""
    findings: List[ExecutiveFinding] = field(default_factory=list)


@dataclass
class ChartPageContent:
    """图表分析页内容（报告核心）。"""

    title: str
    charts: List[ChartSpec] = field(default_factory=list)
    subtitle: Optional[str] = None
    layout: Any = LayoutType.AUTO
    side_insights: List[str] = field(default_factory=list)  # 仅图文混排使用
    insights: List[str] = field(default_factory=list)  # 标题下方的圆点洞察正文
    data_source: str = ""  # 数据来源标注（页面底部，对齐调研公司规范）
    slide_id: str = ""
    slide_type: Any = PageType.CHART
    chapter: str = ""
    brief: Optional[SlideBrief] = None
    template_id: str = ""
    layout_family: str = ""
    density: str = "medium"


@dataclass
class MultiGroupBarPageContent:
    """多组多列条形图页（表格 + 图表叠加布局，参考 crosstab-to-ppt skill 规范）。

    布局结构：
      - 底层 PPT 表格：列=[组 | 选项 | 人群1 | 人群2 | ...]
      - 上层图表：每人群列一个 BAR_CLUSTERED 横向条形图（隐藏坐标轴）
      - 组标题合并单元格、组间分隔线、数据标签百分比

    Attributes:
        title: 页面标题。
        groups_data: 各题数据列表，每项 ``{"title": 题名, "data": DataFrame(选项+各人群列)}``。
        segments: 人群名称列表（如 ['Total', '都市中产', ...]），决定列顺序和颜色。
        insights: 洞察文本列表。
        data_source: 页面底部数据来源标注。
    """

    title: str
    groups_data: list = field(default_factory=list)   # list[dict]
    segments: list = field(default_factory=list)       # list[str]
    insights: list = field(default_factory=list)       # list[str]
    data_source: str = ""
    slide_id: str = ""
    slide_type: Any = PageType.SEGMENT_COMPARISON
    chapter: str = ""
    brief: Optional[SlideBrief] = None
    template_id: str = ""
    layout_family: str = "matrix_with_priority"
    density: str = "high"


@dataclass
class ResearchOverviewContent:
    title: str = "研究概览"
    sample_size: Optional[int] = None
    question_count: int = 0
    segment_count: int = 0
    methodology: str = "定量交叉表分析"
    source_references: List[str] = field(default_factory=list)
    slide_id: str = "research_overview"
    slide_type: Any = PageType.RESEARCH_OVERVIEW
    chapter: str = "项目概述"
    brief: Optional[SlideBrief] = None
    template_id: str = ""


@dataclass
class SectionDividerContent:
    title: str
    chapter: str
    subtitle: str = ""
    key_message: str = ""
    slide_id: str = ""
    slide_type: Any = PageType.SECTION_DIVIDER
    brief: Optional[SlideBrief] = None
    template_id: str = "section_divider_v1"


@dataclass
class FindingsOverviewContent:
    title: str = "核心发现总览"
    findings: List[ExecutiveFinding] = field(default_factory=list)
    slide_id: str = "findings_overview"
    slide_type: Any = PageType.FINDINGS_OVERVIEW
    chapter: str = "主要研究发现"
    brief: Optional[SlideBrief] = None
    template_id: str = "findings_overview_v1"


@dataclass
class KeyFindingContent:
    title: str
    finding: ExecutiveFinding
    charts: List[ChartSpec] = field(default_factory=list)
    data_source: str = ""
    slide_id: str = ""
    slide_type: Any = PageType.KEY_FINDING
    chapter: str = ""
    brief: Optional[SlideBrief] = None
    template_id: str = "key_finding_evidence_v1"
    layout_family: str = "key_finding_with_evidence"


@dataclass
class FunnelStage:
    label: str
    value: float
    fact_id: str = ""
    question_id: str = ""


@dataclass
class FunnelAnalysisContent:
    title: str
    stages: List[FunnelStage] = field(default_factory=list)
    drivers: List[str] = field(default_factory=list)
    data_source: str = ""
    slide_id: str = ""
    slide_type: Any = PageType.FUNNEL_ANALYSIS
    chapter: str = ""
    brief: Optional[SlideBrief] = None
    template_id: str = "funnel_drivers_v1"


@dataclass
class OpportunityItem:
    label: str
    importance: float
    performance: float
    implication: str = ""
    fact_ids: List[str] = field(default_factory=list)


@dataclass
class OpportunityMatrixContent:
    title: str
    opportunities: List[OpportunityItem] = field(default_factory=list)
    data_source: str = ""
    slide_id: str = ""
    slide_type: Any = PageType.OPPORTUNITY_MATRIX
    chapter: str = ""
    brief: Optional[SlideBrief] = None
    template_id: str = "matrix_priority_v1"


@dataclass
class RecommendationItem:
    action: str
    rationale: str = ""
    priority: str = "medium"
    evidence_fact_ids: List[str] = field(default_factory=list)
    owner: str = ""
    timing: str = ""


@dataclass
class RecommendationContent:
    title: str = "行动建议"
    recommendations: List[RecommendationItem] = field(default_factory=list)
    slide_id: str = "recommendation"
    slide_type: Any = PageType.RECOMMENDATION
    chapter: str = "结论与建议"
    brief: Optional[SlideBrief] = None
    template_id: str = "recommendation_v1"

@dataclass
class TableData:
    """附录表格数据。"""

    headers: List[str] = field(default_factory=list)
    rows: List[List[Any]] = field(default_factory=list)


@dataclass
class AppendixContent:
    """数据附录页内容。"""

    title: str = "数据附录"
    table: TableData = field(default_factory=TableData)
    source: str = ""


def _serialize_value(value):
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, SlideBrief):
        return value.to_dict()
    if isinstance(value, DataFact):
        return value.to_dict()
    if isinstance(value, ChartSpec):
        return value.to_dict()
    if isinstance(value, ExecutiveFinding):
        return value.to_dict()
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, tuple):
        return [_serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _serialize_value(item) for key, item in value.items()}
    if hasattr(value, "to_dict") and value.__class__.__module__.startswith("pandas"):
        return value.to_dict(orient="records")
    if is_dataclass(value):
        return {
            item.name: _serialize_value(getattr(value, item.name))
            for item in fields(value)
        }
    return value

# ------------------------- 顶层报告 -------------------------
@dataclass
class ReportSpec:
    """整份报告的「内容」描述（数据与渲染分离的总入口）。"""

    cover: CoverContent
    toc: TocContent
    executive_summary: ExecutiveSummaryContent
    chart_pages: List[Any] = field(default_factory=list)
    facts: List[DataFact] = field(default_factory=list)
    slide_briefs: List[SlideBrief] = field(default_factory=list)
    render_audit: Dict[str, Any] = field(default_factory=dict)
    appendix: Optional[AppendixContent] = None
    template_path: Optional[str] = None  # 可选 .pptx 模板作为设计底

    def auto_toc(self) -> List[str]:
        """根据报告结构自动提取章节标题（封面 / 摘要 / 各图表页 / 附录）。"""
        sections = ["执行摘要"]
        for page in self.chart_pages:
            sections.append(page.title)
        if self.appendix is not None:
            sections.append(self.appendix.title)
        return sections

    def validate(self) -> None:
        """校验必要字段，缺失或非法时抛出 :class:`ReportDataError`。"""
        if not self.cover.title:
            raise ReportDataError("封面标题(cover.title)不能为空")
        if not self.cover.client:
            raise ReportDataError("客户名称(cover.client)不能为空")
        if not self.executive_summary.kpis and not self.executive_summary.findings:
            raise ReportDataError("执行摘要至少包含 1 个 KPI")
        if not self.chart_pages:
            raise ReportDataError("至少需要 1 个图表页(chart_pages)")
        for i, page in enumerate(self.chart_pages):
            if isinstance(page, MultiGroupBarPageContent):
                if not page.groups_data:
                    raise ReportDataError(f"第 {i + 1} 个多组条形图页没有配置任何题目数据")
                continue
            if isinstance(page, FindingsOverviewContent) and not page.findings:
                raise ReportDataError(f"第 {i + 1} 个发现总览页没有发现内容")
            if isinstance(page, KeyFindingContent) and not page.charts:
                raise ReportDataError(f"第 {i + 1} 个图表页没有配置任何图表")
            if isinstance(page, FunnelAnalysisContent) and len(page.stages) < 2:
                raise ReportDataError(f"第 {i + 1} 个漏斗页至少需要两个阶段")
            if isinstance(page, OpportunityMatrixContent) and not page.opportunities:
                raise ReportDataError(f"第 {i + 1} 个机会矩阵页没有机会项")
            if isinstance(page, RecommendationContent) and not page.recommendations:
                raise ReportDataError(f"第 {i + 1} 个建议页没有建议内容")
            if isinstance(page, ChartPageContent) and not page.charts:
                raise ReportDataError(f"第 {i + 1} 个图表页没有配置任何图表")
        for page in self.chart_pages:
            for ch in getattr(page, "charts", []):
                if isinstance(ch.type, str):
                    try:
                        ChartType(ch.type)
                    except ValueError:
                        raise UnsupportedChartTypeError(ch.type)
    def to_dict(self) -> Dict[str, Any]:
        """Serialize the report without losing new optional semantic fields."""
        return {
            "cover": _serialize_value(self.cover),
            "toc": _serialize_value(self.toc),
            "executive_summary": _serialize_value(self.executive_summary),
            "chart_pages": [_serialize_value(page) for page in self.chart_pages],
            "facts": [fact.to_dict() for fact in self.facts],
            "slide_briefs": [brief.to_dict() for brief in self.slide_briefs],
            "render_audit": _serialize_value(self.render_audit),
            "appendix": _serialize_value(self.appendix) if self.appendix else None,
            "template_path": self.template_path,
        }
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReportSpec":
        """从嵌套字典解析出 ReportSpec（数据与渲染分离的关键入口）。

        字典结构示例见 README。对缺失 / 类型错误会抛出
        :class:`ReportDataError` 或 :class:`UnsupportedChartTypeError`。
        """
        try:
            cover_d = data["cover"]
            toc_d = data["toc"]
            es_d = data["executive_summary"]
        except KeyError as e:
            raise ReportDataError(f"缺少必要区块: {e}")

        cover = CoverContent(
            title=str(cover_d["title"]),
            client=str(cover_d["client"]),
            date=str(cover_d["date"]),
            subtitle=cover_d.get("subtitle"),
            logo_path=cover_d.get("logo_path"),
        )
        toc = TocContent(sections=[str(s) for s in toc_d.get("sections", [])])

        es = ExecutiveSummaryContent(
            kpis=[KPI(label=str(k["label"]), value=str(k["value"]),
                      delta=k.get("delta"))
                  for k in es_d.get("kpis", [])],
            conclusion=es_d.get("conclusion", ""),
            findings=[
                ExecutiveFinding(
                    title=str(item.get("title", "")),
                    description=str(item.get("description", "")),
                    evidence_fact_ids=[str(value) for value in item.get("evidence_fact_ids", [])],
                    action_implication=str(item.get("action_implication", "")),
                    importance=str(item.get("importance", "medium")),
                    evidence_question_ids=[str(value) for value in item.get("evidence_question_ids", [])],
                    source_references=[str(value) for value in item.get("source_references", [])],
                )
                for item in es_d.get("findings", [])
            ],
        )

        chart_pages: List[Any] = []
        for cp in data.get("chart_pages", []):
            raw_type = str(cp.get("slide_type") or cp.get("page_type") or "chart")
            brief = SlideBrief.from_dict(cp["brief"]) if isinstance(cp.get("brief"), dict) else None
            common = {
                "slide_id": str(cp.get("slide_id", "")),
                "chapter": str(cp.get("chapter", "")),
                "brief": brief,
                "template_id": str(cp.get("template_id", "")),
            }
            if raw_type == PageType.RESEARCH_OVERVIEW.value:
                chart_pages.append(ResearchOverviewContent(
                    title=str(cp.get("title", "研究概览")),
                    sample_size=cp.get("sample_size"),
                    question_count=int(cp.get("question_count", 0)),
                    segment_count=int(cp.get("segment_count", 0)),
                    methodology=str(cp.get("methodology", "定量交叉表分析")),
                    source_references=[str(value) for value in cp.get("source_references", [])],
                    **common,
                ))
                continue
            if raw_type == PageType.SECTION_DIVIDER.value:
                chart_pages.append(SectionDividerContent(
                    title=str(cp.get("title", "")),
                    subtitle=str(cp.get("subtitle", "")),
                    key_message=str(cp.get("key_message", "")),
                    **common,
                ))
                continue
            if raw_type == PageType.FINDINGS_OVERVIEW.value:
                chart_pages.append(FindingsOverviewContent(
                    title=str(cp.get("title", "核心发现总览")),
                    findings=[ExecutiveFinding(**item) for item in cp.get("findings", [])],
                    **common,
                ))
                continue
            if raw_type == PageType.KEY_FINDING.value:
                finding = ExecutiveFinding(**(cp.get("finding") or {"title": cp.get("title", "")}))
                chart_pages.append(KeyFindingContent(
                    title=str(cp.get("title", finding.title)),
                    finding=finding,
                    charts=[ChartSpec.from_dict(item) for item in cp.get("charts", [])],
                    data_source=str(cp.get("data_source", "")),
                    layout_family=str(cp.get("layout_family", "key_finding_with_evidence")),
                    **common,
                ))
                continue
            if raw_type == PageType.FUNNEL_ANALYSIS.value:
                chart_pages.append(FunnelAnalysisContent(
                    title=str(cp.get("title", "漏斗分析")),
                    stages=[FunnelStage(**item) for item in cp.get("stages", [])],
                    drivers=[str(value) for value in cp.get("drivers", [])],
                    data_source=str(cp.get("data_source", "")),
                    **common,
                ))
                continue
            if raw_type == PageType.OPPORTUNITY_MATRIX.value:
                chart_pages.append(OpportunityMatrixContent(
                    title=str(cp.get("title", "机会矩阵")),
                    opportunities=[OpportunityItem(**item) for item in cp.get("opportunities", [])],
                    data_source=str(cp.get("data_source", "")),
                    **common,
                ))
                continue
            if raw_type == PageType.RECOMMENDATION.value:
                chart_pages.append(RecommendationContent(
                    title=str(cp.get("title", "行动建议")),
                    recommendations=[RecommendationItem(**item) for item in cp.get("recommendations", [])],
                    **common,
                ))
                continue
            charts = [ChartSpec.from_dict(c) for c in cp.get("charts", [])]
            layout_raw = cp.get("layout", "auto")
            try:
                layout = LayoutType(layout_raw)
            except ValueError:
                raise ReportDataError(f"非法的 layout: {layout_raw!r}")
            chart_pages.append(ChartPageContent(
                title=str(cp["title"]),
                charts=charts,
                subtitle=cp.get("subtitle"),
                layout=layout,
                side_insights=[str(s) for s in cp.get("side_insights", [])],
                insights=[str(s) for s in cp.get("insights", [])],
                data_source=str(cp.get("data_source", "")),
                layout_family=str(cp.get("layout_family", "")),
                density=str(cp.get("density", "medium")),
                **common,
            ))
        appendix = None
        ap = data.get("appendix")
        if ap:
            tbl = ap.get("table", {})
            appendix = AppendixContent(
                title=ap.get("title", "数据附录"),
                table=TableData(
                    headers=[str(h) for h in tbl.get("headers", [])],
                    rows=[[str(c) for c in r] for r in tbl.get("rows", [])],
                ),
                source=ap.get("source", ""),
            )

        return cls(
            cover=cover,
            toc=toc,
            executive_summary=es,
            chart_pages=chart_pages,
            facts=[DataFact.from_dict(item) for item in data.get("facts", [])],
            slide_briefs=[SlideBrief.from_dict(item) for item in data.get("slide_briefs", [])],
            render_audit=dict(data.get("render_audit") or {}),
            appendix=appendix,
            template_path=data.get("template_path"),
        )
