"""通用工具：字体（中英文）、填充、幻灯片背景等。

集中处理 python-pptx 里最容易踩坑的两件事：
1. 中文必须同时设置「拉丁字形 (a:latin)」与「东亚字形 (a:ea)」，否则在
   某些 PowerPoint 版本下中文会回退到默认字体。
2. 形状 / 文本框 / 图表字体对象的访问方式略有差异，这里统一封装。
"""

from __future__ import annotations

from typing import Optional, Union

from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
from pptx.util import Pt

from .theme import Theme


def _set_typeface(rPr, tag: str, name: str) -> None:
    """在 rPr 元素下设置 Latin 或 EA 字形的 typeface 属性。

    Args:
        rPr: 形如 ``<a:rPr>`` 的 XML 元素。
        tag: 仅支持 ``"a:latin"`` 或 ``"a:ea"``。
        name: 字体名称，例如 "微软雅黑"。
    """
    if rPr is None:
        return
    el = rPr.find(qn(tag))
    if el is None:
        el = rPr.makeelement(qn(tag), {})
        rPr.append(el)
    el.set("typeface", name)


def _to_rgb(color, theme: Optional[Theme] = None) -> RGBColor:
    """将多种颜色表示统一转为 RGBColor。"""
    if isinstance(color, RGBColor):
        return color
    if isinstance(color, int):
        return RGBColor(color)
    if isinstance(color, str):
        return RGBColor.from_string(color.lstrip("#"))
    raise ValueError(f"无法解析颜色: {color!r}")


def style_font(font, theme: Theme, size: Optional[float] = None,
               bold: Optional[bool] = None,
               color: Optional[Union[str, RGBColor, int]] = None) -> None:
    """为 python-pptx 的 ``Font`` 对象设置中英文字体、字号、粗体、颜色。

    适用于：文本 run 的 ``run.font``、图例 ``chart.legend.font``、
    全局 ``chart.font``、坐标轴 ``axis.tick_labels.font``、数据标签
    ``plot.data_labels.font`` 等所有 Font 对象。

    Note:
        只设置 ``font.name`` 只会写入 ``<a:latin>``；这里额外补写
        ``<a:ea>``，保证中文字形正确。
    """
    try:
        font.name = theme.font_name  # 写入 latin 字形
    except Exception:
        pass
    # 注意：lxml 会对「无子元素的元素」做布尔判定为 False，
    # 因此不能用 `a or b` 这种写法取 rPr，必须显式判断 None。
    rPr = getattr(font, "_element", None)
    if rPr is None:
        rPr = getattr(font, "element", None)
    _set_typeface(rPr, "a:latin", theme.font_name)
    _set_typeface(rPr, "a:ea", theme.font_name)
    if size is not None:
        font.size = Pt(size)
    if bold is not None:
        font.bold = bold
    if color is not None:
        try:
            font.color.rgb = _to_rgb(color, theme)
        except Exception:
            pass


def style_textframe(tf, theme: Theme, size: float = 14, bold: bool = False,
                    color: Optional[Union[str, RGBColor, int]] = None) -> None:
    """为文本框内所有段落的 run 统一设置字体。"""
    for para in tf.paragraphs:
        for run in para.runs:
            style_font(run.font, theme, size=size, bold=bold, color=color)


def set_shape_fill(shape, color) -> None:
    """为形状设置纯色填充。"""
    rgb = _to_rgb(color)
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb


def remove_shape_outline(shape) -> None:
    """去掉形状的描边（用于色带、卡片等装饰元素）。"""
    try:
        shape.line.fill.background()
    except Exception:
        pass


def set_slide_background(slide, hex_color: str) -> None:
    """设置幻灯片背景色。"""
    rgb = RGBColor.from_string(hex_color.lstrip("#"))
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = rgb
