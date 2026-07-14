"""渲染器与模板支持（统一入口）。

:class:`ReportRenderer` 接收 :class:`~pptx_report.model.ReportSpec`（数据），
输出 .pptx 文件。支持三种用法：
  1. 无模板直接绘制（默认，最灵活，支持全部图表 / 布局）；
  2. 加载现有 .pptx 作为设计底（继承母版背景与配色）；
  3. 在模板的预设占位符上按名称填充文本（见 :meth:`fill_named_placeholders`）。
"""

from __future__ import annotations

import os
from typing import Optional

from pptx import Presentation
from pptx.util import Inches

from .exceptions import RenderingError, TemplateNotFoundError
from .model import ReportSpec, MultiGroupBarPageContent
from .pages import (
    build_appendix,
    build_chart_page,
    build_cover,
    build_exec_summary,
    build_multi_group_bar_page,
    build_toc,
)
from .theme import Theme
from .utils import set_slide_background


class ReportRenderer:
    """把 ReportSpec 渲染为 PowerPoint 文件。"""

    def __init__(self, theme: Optional[Theme] = None,
                 template_path: Optional[str] = None):
        """
        Args:
            theme: 视觉主题；为空则用 :class:`~pptx_report.theme.Theme` 默认主题。
            template_path: 可选 .pptx 模板路径，作为设计底（继承母版 / 背景）。
        """
        self.theme = theme or Theme()
        self.template_path = template_path
        self._prs = None
        self._slide_w = None
        self._slide_h = None

    def render(self, spec: ReportSpec, output_path: str) -> str:
        """渲染并保存到 output_path，返回该路径。"""
        # 目录为空时自动提取章节标题
        if not spec.toc.sections:
            spec.toc.sections = spec.auto_toc()
        spec.validate()

        self._prs = self._build_presentation()
        dims = (self._slide_w, self._slide_h)
        try:
            self._add_cover(spec.cover, dims)
            self._add_toc(spec.toc, dims)
            self._add_exec_summary(spec.executive_summary, dims)
            for page in spec.chart_pages:
                self._add_chart_page(page, dims)
            if spec.appendix is not None:
                self._add_appendix(spec.appendix, dims)
            self._prs.save(output_path)
        except RenderingError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise RenderingError(f"渲染失败: {exc}") from exc
        return output_path

    # ------------------------- 内部 -------------------------
    def _build_presentation(self) -> Presentation:
        if self.template_path:
            if not os.path.exists(self.template_path):
                raise TemplateNotFoundError(self.template_path)
            prs = Presentation(self.template_path)
            self._slide_w = prs.slide_width
            self._slide_h = prs.slide_height
        else:
            prs = Presentation()
            # 默认 4:3，改为 16:9 宽屏
            prs.slide_width = Inches(13.333)
            prs.slide_height = Inches(7.5)
            self._slide_w = prs.slide_width
            self._slide_h = prs.slide_height
        return prs

    def _blank_slide(self):
        prs = self._prs
        layout = None
        # 优先选择名为 Blank / 空白 的版式
        for name in ("Blank", "空白", "Office 主题"):  # noqa: S105
            for lay in prs.slide_layouts:
                if lay.name == name:
                    layout = lay
                    break
            if layout is not None:
                break
        if layout is None:
            try:
                layout = prs.slide_layouts[6]  # 多数模板的「空白」版式
            except IndexError:
                layout = prs.slide_layouts[0]
        slide = prs.slides.add_slide(layout)
        # 仅无模板时强制背景色，避免覆盖模板设计
        if not self.template_path:
            set_slide_background(slide, self.theme.background)
        return slide

    def _add_cover(self, cover, dims):
        self._blank_slide()
        build_cover(self._prs.slides[-1], cover, self.theme, dims)

    def _add_toc(self, toc, dims):
        self._blank_slide()
        build_toc(self._prs.slides[-1], toc, self.theme, dims)

    def _add_exec_summary(self, es, dims):
        self._blank_slide()
        build_exec_summary(self._prs.slides[-1], es, self.theme, dims)

    def _add_chart_page(self, page, dims):
        self._blank_slide()
        if isinstance(page, MultiGroupBarPageContent):
            build_multi_group_bar_page(self._prs.slides[-1], page, self.theme, dims)
        else:
            build_chart_page(self._prs.slides[-1], page, self.theme, dims)

    def _add_appendix(self, ap, dims):
        self._blank_slide()
        build_appendix(self._prs.slides[-1], ap, self.theme, dims)

    # ------------------------- 模板占位符填充 -------------------------
    def fill_named_placeholders(self, slide, mapping: dict) -> None:
        """在 slide 上按占位符名称填充文本（模板预设占位符用法）。

        适用场景：模板里已放置名为 "title" / "client" / "date" 等占位符，
        你可以用它把内容填进去，而非用本包自绘形状。

        Args:
            slide: 目标幻灯片（通常是基于模板版式添加的）。
            mapping: ``{"占位符名称": "文本内容", ...}``。
        """
        for placeholder in slide.placeholders:
            name = getattr(placeholder, "name", "")
            if name in mapping:
                placeholder.text = str(mapping[name])
