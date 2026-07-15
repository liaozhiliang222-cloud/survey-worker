"""布局排版模块。

把「若干图表」映射到幻灯片上的矩形区域，支持四种布局：
  SINGLE(单图大版面) / DUAL(双图对比) / DASHBOARD(网格) / MIXED(图文混排)。
产出 :class:`PageLayout`，其中 ``slots`` 的顺序即阅读顺序，且**首个为左上角最重要图表**。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from pptx.util import Inches

from .model import ChartPageContent, LayoutType

# ------------------------- 几何常量（英寸） -------------------------
PAGE_MARGIN = 0.5
TITLE_TOP = 0.2
TITLE_HEIGHT = 0.75
CONTENT_TOP = 1.35
BOTTOM_MARGIN = 0.5
CAPTION_H = 0.32      # 每个图表底部留给一句话结论的高度
GRID_GAP = 0.35       # 网格布局单元间距
DUAL_GAP = 0.45
MIXED_GAP = 0.4


@dataclass
class Rect:
    """矩形区域（EMU）。"""

    x: Emu
    y: Emu
    cx: Emu
    cy: Emu


@dataclass
class PageLayout:
    """一页图表分析页的排版结果。"""

    title_rect: Rect
    slots: List[Rect]               # 每个图表一个「单元格」（图表 + 其结论同处其中）
    conclusion_rect: Optional[Rect] = None
    sidebar_rect: Optional[Rect] = None  # 图文混排的右侧洞察栏


def resolve_layout(page: ChartPageContent, slide_w: Emu, slide_h: Emu) -> PageLayout:
    """根据 page.layout（AUTO 时按规则）计算页面排版。"""
    layout = page.layout
    n = len(page.charts)

    if layout == LayoutType.AUTO:
        if page.side_insights:
            layout = LayoutType.MIXED
        elif n == 1:
            layout = LayoutType.SINGLE
        elif n == 2:
            layout = LayoutType.DUAL
        else:
            layout = LayoutType.DASHBOARD

    if layout == LayoutType.MIXED:
        return _mixed(page, slide_w, slide_h, n)
    if layout == LayoutType.SINGLE:
        return _single(slide_w, slide_h)
    if layout == LayoutType.DUAL:
        return _dual(slide_w, slide_h)
    return _dashboard(slide_w, slide_h, n)


# ------------------------- 各布局实现 -------------------------
def _content_area(slide_w, slide_h):
    x0 = PAGE_MARGIN
    y0 = CONTENT_TOP
    total_w = float(slide_w) / 914400.0 - 2 * PAGE_MARGIN
    total_h = float(slide_h) / 914400.0 - CONTENT_TOP - BOTTOM_MARGIN
    return x0, y0, total_w, total_h


def _single(slide_w, slide_h) -> PageLayout:
    x0, y0, w, h = _content_area(slide_w, slide_h)
    slot = Rect(Inches(x0), Inches(y0), Inches(w), Inches(h))
    return PageLayout(title_rect=Rect(Inches(PAGE_MARGIN), Inches(TITLE_TOP),
                                     slide_w - Inches(2 * PAGE_MARGIN), Inches(TITLE_HEIGHT)),
                     slots=[slot])


def _dual(slide_w, slide_h) -> PageLayout:
    x0, y0, w, h = _content_area(slide_w, slide_h)
    col_w = (w - DUAL_GAP) / 2
    slots = [
        Rect(Inches(x0), Inches(y0), Inches(col_w), Inches(h)),
        Rect(Inches(x0 + col_w + DUAL_GAP), Inches(y0), Inches(col_w), Inches(h)),
    ]
    return PageLayout(title_rect=Rect(Inches(PAGE_MARGIN), Inches(TITLE_TOP),
                                     slide_w - Inches(2 * PAGE_MARGIN), Inches(TITLE_HEIGHT)),
                     slots=slots)


def _dashboard(slide_w, slide_h, n: int) -> PageLayout:
    x0, y0, w, h = _content_area(slide_w, slide_h)
    if n <= 3:
        cols, rows = (n, 1) if n <= 2 else (3, 1)
    elif n == 4:
        cols, rows = 2, 2
    else:
        cols, rows = 3, 2  # 5~6 个图：3x2 网格
    cell_w = (w - GRID_GAP * (cols - 1)) / cols
    cell_h = (h - GRID_GAP * (rows - 1)) / rows
    slots: List[Rect] = []
    for idx in range(n):
        r = idx // cols
        c = idx % cols
        cx = x0 + c * (cell_w + GRID_GAP)
        cy = y0 + r * (cell_h + GRID_GAP)
        slots.append(Rect(Inches(cx), Inches(cy), Inches(cell_w), Inches(cell_h)))
    return PageLayout(title_rect=Rect(Inches(PAGE_MARGIN), Inches(TITLE_TOP),
                                     slide_w - Inches(2 * PAGE_MARGIN), Inches(TITLE_HEIGHT)),
                     slots=slots)


def _mixed(page: ChartPageContent, slide_w, slide_h, n: int) -> PageLayout:
    x0, y0, w, h = _content_area(slide_w, slide_h)
    left_w = w * 0.58
    right_w = w - left_w - MIXED_GAP
    # 左侧图表纵向堆叠（最多几个都放得下）
    gap = 0.3
    cell_h = (h - gap * (n - 1)) / n if n > 0 else h
    slots = [
        Rect(Inches(x0), Inches(y0 + i * (cell_h + gap)), Inches(left_w), Inches(cell_h))
        for i in range(n)
    ]
    sidebar = Rect(Inches(x0 + left_w + MIXED_GAP), Inches(y0), Inches(right_w), Inches(h))
    return PageLayout(title_rect=Rect(Inches(PAGE_MARGIN), Inches(TITLE_TOP),
                                     slide_w - Inches(2 * PAGE_MARGIN), Inches(TITLE_HEIGHT)),
                     slots=slots, sidebar_rect=sidebar)
