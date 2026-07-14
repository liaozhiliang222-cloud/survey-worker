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

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from .exceptions import ReportDataError, UnsupportedChartTypeError


class ChartType(str, Enum):
    """支持的图表类型。值为字符串，可直接与字典里的 "bar" 等比较。"""

    BAR = "bar"                # 条形图（横向）
    LINE = "line"              # 折线图
    PIE = "pie"                # 饼图
    DOUGHNUT = "doughnut"     # 环形图
    STACKED_BAR = "stacked_bar"   # 堆积柱状图
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
        )


# ------------------------- 页面内容 -------------------------
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


@dataclass
class ChartPageContent:
    """图表分析页内容（报告核心）。"""

    title: str
    charts: List[ChartSpec] = field(default_factory=list)
    subtitle: Optional[str] = None
    layout: Any = LayoutType.AUTO
    side_insights: List[str] = field(default_factory=list)  # 仅图文混排使用
    data_source: str = ""  # 数据来源标注（页面底部，对齐调研公司规范）


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


# ------------------------- 顶层报告 -------------------------
@dataclass
class ReportSpec:
    """整份报告的「内容」描述（数据与渲染分离的总入口）。"""

    cover: CoverContent
    toc: TocContent
    executive_summary: ExecutiveSummaryContent
    chart_pages: List[ChartPageContent] = field(default_factory=list)
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
        if not self.executive_summary.kpis:
            raise ReportDataError("执行摘要至少包含 1 个 KPI")
        if not self.chart_pages:
            raise ReportDataError("至少需要 1 个图表页(chart_pages)")
        for i, page in enumerate(self.chart_pages):
            # MultiGroupBarPageContent 无 charts 字段，跳过图表校验
            if isinstance(page, MultiGroupBarPageContent):
                if not page.groups_data:
                    raise ReportDataError(f"第 {i + 1} 个多组条形图页没有配置任何题目数据")
                continue
            if not page.charts:
                raise ReportDataError(f"第 {i + 1} 个图表页没有配置任何图表")
        # 校验图表类型合法性（仅对 ChartPageContent）
        for page in self.chart_pages:
            if isinstance(page, MultiGroupBarPageContent):
                continue
            for ch in page.charts:
                if isinstance(ch.type, str):
                    try:
                        ChartType(ch.type)
                    except ValueError:
                        raise UnsupportedChartTypeError(ch.type)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为嵌套字典（可存 JSON / 走接口）。"""
        return {
            "cover": {
                "title": self.cover.title,
                "client": self.cover.client,
                "date": self.cover.date,
                "subtitle": self.cover.subtitle,
                "logo_path": self.cover.logo_path,
            },
            "toc": {"sections": list(self.toc.sections)},
            "executive_summary": {
                "kpis": [{"label": k.label, "value": k.value, "delta": k.delta}
                          for k in self.executive_summary.kpis],
                "conclusion": self.executive_summary.conclusion,
            },
            "chart_pages": [
                {
                    "title": p.title,
                    "subtitle": p.subtitle,
                    "layout": p.layout.value if isinstance(p.layout, LayoutType) else p.layout,
                    "side_insights": list(p.side_insights),
                    "data_source": p.data_source,
                    "charts": [c.to_dict() for c in p.charts],
                }
                for p in self.chart_pages
            ],
            "appendix": (
                None if self.appendix is None else {
                    "title": self.appendix.title,
                    "table": {
                        "headers": list(self.appendix.table.headers),
                        "rows": [list(r) for r in self.appendix.table.rows],
                    },
                    "source": self.appendix.source,
                }
            ),
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
        )

        chart_pages: List[ChartPageContent] = []
        for cp in data.get("chart_pages", []):
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
                data_source=str(cp.get("data_source", "")),
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
            appendix=appendix,
            template_path=data.get("template_path"),
        )
