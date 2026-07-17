"""PPTX 模板分析与主题提取。"""

from __future__ import annotations

import colorsys
import re
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.shapes import PP_PLACEHOLDER

from .theme import Theme


DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _norm_rect(shape, width: int, height: int) -> dict:
    return {
        "x": round(max(0, int(shape.left)) / max(1, width), 4),
        "y": round(max(0, int(shape.top)) / max(1, height), 4),
        "w": round(max(0, int(shape.width)) / max(1, width), 4),
        "h": round(max(0, int(shape.height)) / max(1, height), 4),
    }


def _shape_text(shape) -> str:
    try:
        return str(shape.text or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def _is_title_shape(shape, height: int) -> bool:
    try:
        if shape.is_placeholder and shape.placeholder_format.type in {
            PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE,
        }:
            return True
    except Exception:  # noqa: BLE001
        pass
    text = _shape_text(shape)
    return bool(text and shape.top < height * 0.22 and shape.height < height * 0.24)


def _union_rect(shapes, width: int, height: int) -> dict | None:
    shapes = list(shapes)
    if not shapes:
        return None
    left = min(int(shape.left) for shape in shapes)
    top = min(int(shape.top) for shape in shapes)
    right = max(int(shape.left + shape.width) for shape in shapes)
    bottom = max(int(shape.top + shape.height) for shape in shapes)
    class Rect:
        pass
    rect = Rect()
    rect.left, rect.top, rect.width, rect.height = left, top, right - left, bottom - top
    return _norm_rect(rect, width, height)


def _classify_slide(slide, index: int) -> tuple[str, float]:
    texts = " ".join(_shape_text(shape) for shape in slide.shapes if _shape_text(shape)).lower()
    charts = sum(1 for shape in slide.shapes if getattr(shape, "has_chart", False))
    tables = sum(1 for shape in slide.shapes if getattr(shape, "has_table", False))
    pictures = sum(1 for shape in slide.shapes if shape.shape_type == MSO_SHAPE_TYPE.PICTURE)
    if re.search(r"目录|contents?", texts):
        return "toc", 0.98
    if re.search(r"执行摘要|核心摘要|executive\s+summary", texts):
        return "summary", 0.98
    if re.search(r"附录|appendix", texts):
        return "appendix", 0.96
    if tables or charts >= 4:
        return "matrix", 0.9
    if charts:
        return "chart", 0.92
    if index == 0 and len(texts) < 260:
        return "cover", 0.86
    if re.search(r"chapter|part\s*\d|章节|篇章", texts) and len(texts) < 180:
        return "section", 0.82
    if pictures and len(texts) < 120:
        return "section", 0.72
    return "content", 0.62


def build_template_mapping(prs: Presentation) -> dict:
    """识别示例页角色和版面区域，供渲染器按语义选版式与落位。"""
    width, height = int(prs.slide_width), int(prs.slide_height)
    candidates: dict[str, list[dict]] = {}
    layout_indexes = {id(layout): idx for idx, layout in enumerate(prs.slide_layouts)}
    for index, slide in enumerate(prs.slides):
        role, confidence = _classify_slide(slide, index)
        title_shapes = [shape for shape in slide.shapes if _is_title_shape(shape, height)]
        footer_shapes = [
            shape for shape in slide.shapes
            if shape.top > height * 0.88 and (_shape_text(shape) or getattr(shape, "is_placeholder", False))
        ]
        content_shapes = [
            shape for shape in slide.shapes
            if shape not in title_shapes and shape not in footer_shapes
            and (
                bool(_shape_text(shape))
                or getattr(shape, "has_chart", False)
                or getattr(shape, "has_table", False)
                or shape.shape_type == MSO_SHAPE_TYPE.PICTURE
                or getattr(shape, "is_placeholder", False)
            )
            and shape.top + shape.height > height * 0.18
            and shape.top < height * 0.9
        ]
        layout_index = layout_indexes.get(id(slide.slide_layout), 0)
        candidate = {
            "role": role,
            "slide_index": index,
            "layout_index": layout_index,
            "layout_name": slide.slide_layout.name or "未命名版式",
            "confidence": round(confidence, 2),
            "zones": {
                "title": _union_rect(title_shapes, width, height),
                "content": _union_rect(content_shapes, width, height),
                "footer": _union_rect(footer_shapes, width, height),
            },
        }
        candidates.setdefault(role, []).append(candidate)
    roles = {}
    for role, items in candidates.items():
        items.sort(key=lambda item: (item["confidence"], bool(item["zones"]["content"])), reverse=True)
        roles[role] = items[0]
    # 通用正文映射可由图表页或普通内容页回退，确保所有报告页面都有可用落位。
    fallback = roles.get("chart") or roles.get("content") or next(iter(roles.values()), None)
    for role in ("cover", "toc", "summary", "chart", "matrix", "appendix"):
        if role not in roles and fallback:
            roles[role] = {**fallback, "role": role, "fallback": True,
                           "confidence": round(max(0.35, fallback["confidence"] - 0.2), 2)}
    confidences = [item["confidence"] for item in roles.values()]
    return {
        "version": 2,
        "mode": "semantic-layout-zones",
        "roles": roles,
        "coverage": round(min(1.0, len(candidates) / 6), 2),
        "confidence": round(sum(confidences) / max(1, len(confidences)), 2),
    }


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
    mapping = build_template_mapping(prs)
    if not (1.70 <= ratio <= 1.82):
        warnings.append("模板不是常见的 16:9 宽屏比例，生成内容会按模板原始比例缩放布局。")
    if not any((layout.name or "").lower() in {"blank", "空白"} for layout in prs.slide_layouts):
        warnings.append("未识别到明确的空白版式，将使用最接近的可用版式并清除占位符。")
    if len(prs.slides) > 50:
        warnings.append("模板示例页较多；生成时会移除示例页，仅保留母版、版式和主题资源。")
    if mapping["confidence"] < 0.65:
        warnings.append("模板中的示例页语义不够明确，部分页面将回退到最接近的正文版式。")
    missing_roles = [role for role, item in mapping["roles"].items() if item.get("fallback")]
    if missing_roles:
        warnings.append("未找到全部页面类型，已为缺失类型配置安全回退版式。")
    return {
        "file_name": filename,
        "slide_count": len(prs.slides),
        "layout_count": len(prs.slide_layouts),
        "aspect_ratio": round(ratio, 3),
        "is_widescreen": 1.70 <= ratio <= 1.82,
        "theme_colors": colors[:8],
        "fonts": fonts[:6],
        "layouts": layouts[:20],
        "mapping": mapping,
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
