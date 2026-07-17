"""PPTX 模板分析与主题提取。"""

from __future__ import annotations

import colorsys
import re
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

from pptx import Presentation

from .theme import Theme


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _theme_xml(path: str) -> bytes | None:
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 5000 or sum(item.file_size for item in members) > 200 * 1024 * 1024:
            raise ValueError("模板解压后体积过大或内部文件过多")
        names = [name for name in archive.namelist() if re.fullmatch(r"ppt/theme/theme\d+\.xml", name)]
        return archive.read(names[0]) if names else None


def _extract_theme_tokens(path: str) -> tuple[list[str], list[str]]:
    raw = _theme_xml(path)
    if not raw:
        return [], []
    root = ET.fromstring(raw)
    ns = {"a": DRAWING_NS}
    colors = []
    scheme = root.find(".//a:themeElements/a:clrScheme", ns)
    if scheme is not None:
        for child in list(scheme):
            color = child.find("a:srgbClr", ns)
            if color is not None and color.get("val"):
                value = color.get("val").upper()
                if value not in {"FFFFFF", "000000"} and value not in colors:
                    colors.append(value)
    fonts = []
    for path_expr in (
        ".//a:themeElements/a:fontScheme/a:majorFont/a:ea",
        ".//a:themeElements/a:fontScheme/a:minorFont/a:ea",
        ".//a:themeElements/a:fontScheme/a:majorFont/a:latin",
        ".//a:themeElements/a:fontScheme/a:minorFont/a:latin",
    ):
        node = root.find(path_expr, ns)
        value = (node.get("typeface") if node is not None else "") or ""
        if value and value not in fonts:
            fonts.append(value)
    return colors, fonts


def analyze_template(path: str, filename: str = "template.pptx") -> dict:
    """读取模板基础信息，供前端确认和生成器换肤。"""
    prs = Presentation(path)
    colors, fonts = _extract_theme_tokens(path)
    width = int(prs.slide_width)
    height = int(prs.slide_height)
    ratio = width / height if height else 0
    layout_usage = Counter(slide.slide_layout.name or "未命名版式" for slide in prs.slides)
    layouts = []
    for layout in prs.slide_layouts:
        placeholders = sum(1 for shape in layout.shapes if getattr(shape, "is_placeholder", False))
        layouts.append({
            "name": layout.name or "未命名版式",
            "placeholders": placeholders,
            "used_by_slides": layout_usage.get(layout.name or "未命名版式", 0),
        })
    warnings = []
    if not (1.70 <= ratio <= 1.82):
        warnings.append("模板不是常见的 16:9 宽屏比例，生成内容会按模板原始比例缩放布局。")
    if not any((layout.name or "").lower() in {"blank", "空白"} for layout in prs.slide_layouts):
        warnings.append("未识别到明确的空白版式，将使用最接近的可用版式并清除占位符。")
    if len(prs.slides) > 50:
        warnings.append("模板示例页较多；生成时会移除示例页，仅保留母版、版式和主题资源。")
    return {
        "file_name": filename,
        "slide_count": len(prs.slides),
        "layout_count": len(prs.slide_layouts),
        "aspect_ratio": round(ratio, 3),
        "is_widescreen": 1.70 <= ratio <= 1.82,
        "theme_colors": colors[:8],
        "fonts": fonts[:6],
        "layouts": layouts[:20],
        "warnings": warnings,
    }


def theme_from_template(path: str, fallback: Theme) -> Theme:
    """在保留报告可读性规范的前提下，套用模板主色与字体。"""
    colors, fonts = _extract_theme_tokens(path)
    def usable_accent(value: str) -> bool:
        red, green, blue = (int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
        _, lightness, saturation = colorsys.rgb_to_hls(red, green, blue)
        return lightness < 0.82 and saturation > 0.10

    usable = [color for color in colors if usable_accent(color)]
    palette = usable[:4] if usable else list(fallback.palette)
    while len(palette) < 4:
        palette.append(fallback.palette[len(palette) % len(fallback.palette)])
    segment_palette = list(usable)
    segment_palette.extend(color for color in fallback.segment_palette if color not in segment_palette)
    return Theme(
        name="上传模板",
        font_name=fonts[0] if fonts else fallback.font_name,
        palette=palette[:4],
        segment_palette=segment_palette,
        background=fallback.background,
        text_dark=fallback.text_dark,
        text_light=fallback.text_light,
        data_label_color=fallback.data_label_color,
        data_label_size=fallback.data_label_size,
        pct_format=fallback.pct_format,
    )
