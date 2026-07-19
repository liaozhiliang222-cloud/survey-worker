"""pptx_report —— 用 python-pptx 生成专业市场调研报告 PPT 的生产级模块。

设计要点：
  - 数据与渲染分离：用 :class:`~pptx_report.model.ReportSpec`（或字典）描述内容，
    渲染器只负责把数据变成 .pptx。
  - 模块化：每类页面（封面 / 目录 / 摘要 / 图表页 / 附录）独立成函数。
  - 中文友好：统一设置拉丁 + 东亚字形，避免中文回退到默认字体。
  - 可扩展：新增图表类型 / 布局只需扩展 charts.py / layouts.py。
"""

from __future__ import annotations

from .exceptions import (
    ReportDataError,
    ReportError,
    RenderingError,
    TemplateNotFoundError,
    UnsupportedChartTypeError,
)
from .model import (
    AppendixContent,
    ChartPageContent,
    ChartSpec,
    ChartType,
    CoverContent,
    ExecutiveSummaryContent,
    KPI,
    LayoutType,
    ReportSpec,
    Series,
    TableData,
    TocContent,
)
from .theme import Theme

try:
    from .renderer import ReportRenderer
except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
    if exc.name != "pandas":
        raise
    ReportRenderer = None

# 子模块亦可单独导入
try:
    from . import charts, layouts, loaders, pages, utils
except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
    if exc.name != "pandas":
        raise
    charts = layouts = loaders = pages = utils = None

__version__ = "0.1.0"

__all__ = [
    "ReportSpec", "ReportRenderer", "Theme",
    "CoverContent", "TocContent", "ExecutiveSummaryContent",
    "ChartPageContent", "AppendixContent", "ChartSpec", "ChartType",
    "LayoutType", "Series", "KPI", "TableData",
    "ReportError", "ReportDataError", "RenderingError",
    "TemplateNotFoundError", "UnsupportedChartTypeError",
    "charts", "layouts", "loaders", "pages", "utils",
]
