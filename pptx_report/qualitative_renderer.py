"""Deterministic, zero-LLM renderer for SurveyKit qualitative PPT scripts.

The renderer intentionally uses only native PowerPoint objects. It does not fetch
images, call a model, paraphrase quotes, or infer evidence. Content decisions stay
in the persisted ``ppt_script`` artifact; this module only lays them out.
"""

from __future__ import annotations

from copy import deepcopy
from io import BytesIO
import re
from typing import Any, Iterable

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt

from .theme import Theme
from .utils import set_slide_background, style_font
from .qualitative_layouts import TEMPLATE_ID, VARIANT_COLLECTION_LIMITS, resolve_layout_variant, variant_usage


LEGACY_PAGE_TYPES = {
    "qualitative_summary", "qualitative_insight", "quote_evidence", "theme_summary",
    "segment_comparison", "competitor_comparison", "case_study", "journey",
    "framework", "matrix", "problem_reason", "recommendation", "executive_summary",
    "section_intro",
}
ENTERPRISE_PAGE_TYPES = {
    "navigation", "research_framework", "segmentation_map", "persona", "comparison",
    "evidence_diagnostic", "concept_definition", "needs_pyramid", "priority_matrix",
}
PAGE_TYPES = LEGACY_PAGE_TYPES | ENTERPRISE_PAGE_TYPES
NO_EVIDENCE_TYPES = {"section_intro", "navigation"}
W, H = 13.333, 7.5
NAVY, BLUE, CYAN = "0A2A66", "176BFF", "37BFF3"
MID_BLUE, PALE_BLUE, LIGHT = BLUE, "EAF3FF", "F7FAFF"
TEXT, MUTED, BORDER = "18263D", "6F7D93", "D7E3F2"
WHITE, ORANGE, GREEN, RED = "FFFFFF", "176BFF", "22A699", "E35D6A"
BLUE_SCALE = [NAVY, BLUE, "4A8BFF", CYAN]


def _text(value: Any, limit: int = 10_000) -> str:
    return str(value or "").strip()[:limit]


def _items(value: Any) -> list:
    return value if isinstance(value, list) else []


def _hex(value: str) -> RGBColor:
    return RGBColor.from_string(value.lstrip("#"))


def _theme(script: dict) -> Theme:
    preferred = _text((script.get("style_profile") or {}).get("preferred_font"), 100)
    return Theme(name="qualitative_enterprise", font_name=preferred or "微软雅黑", palette=[NAVY, BLUE, CYAN, TEXT])


def _set_cell_border(cell, color: str = BORDER, width: str = "12700") -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    for edge in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        line = tc_pr.find(edge, tc_pr.nsmap)
        if line is None:
            line = tc_pr.makeelement(edge, {"w": width})
            tc_pr.append(line)
        fill = line.makeelement("a:solidFill", {})
        fill.append(fill.makeelement("a:srgbClr", {"val": color}))
        line.append(fill)


def _shape(slide, kind, x, y, w, h, *, fill=WHITE, line=BORDER, radius=False, name=""):
    shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else kind
    shape = slide.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid(); shape.fill.fore_color.rgb = _hex(fill)
    shape.line.color.rgb = _hex(line); shape.line.width = Pt(0.8)
    if name:
        shape.name = name
    return shape


def _textbox(slide, x, y, w, h, value="", *, size=16, color=TEXT, bold=False,
             italic=False, align=PP_ALIGN.LEFT, valign=MSO_ANCHOR.TOP, theme=None, margin=0.08,
             name="editable_text"):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    box.name = name
    tf = box.text_frame
    tf.clear(); tf.word_wrap = True; tf.vertical_anchor = valign
    tf.margin_left = tf.margin_right = Inches(margin)
    tf.margin_top = tf.margin_bottom = Inches(margin)
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run(); run.text = _text(value)
    style_font(run.font, theme, size=size, bold=bold, color=color)
    run.font.italic = italic
    return box


def _rich_text(slide, x, y, w, h, lines: Iterable[str], *, theme, size=14,
               color=TEXT, bullet=True, gap=7, name="editable_body"):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    box.name = name
    tf = box.text_frame; tf.clear(); tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.08)
    tf.margin_top = tf.margin_bottom = Inches(0.05)
    clean = [_text(line, 800) for line in lines if _text(line)]
    for index, line in enumerate(clean or ["待补充"]):
        p = tf.paragraphs[0] if index == 0 else tf.add_paragraph()
        p.text = f"• {line}" if bullet else line
        p.space_after = Pt(gap); p.level = 0
        for run in p.runs:
            style_font(run.font, theme, size=size, color=color)
    return box


def _connector(slide, x1, y1, x2, y2, *, color=MID_BLUE, arrow=True, dashed=False):
    line = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    line.name = "editable_connector"
    line.line.color.rgb = _hex(color); line.line.width = Pt(1.6)
    if arrow:
        # python-pptx exposes no arrowhead API.  Setting an arbitrary
        # ``end_arrowhead`` attribute does not serialize, so write the small
        # DrawingML element explicitly and let PowerPoint keep it editable.
        ln = line.line._get_or_add_ln()
        tail = OxmlElement("a:tailEnd")
        tail.set("type", "triangle")
        tail.set("w", "med")
        tail.set("len", "med")
        ln.append(tail)
    if dashed:
        line.line.dash_style = MSO_LINE_DASH_STYLE.DASH
    return line


def _balanced_title(value: Any) -> str:
    title = _text(value)
    if len(title) <= 27 or "\n" in title:
        return title
    candidates = [
        index + 1
        for index, char in enumerate(title)
        if char in "，：；、" and len(title) * 0.32 <= index <= len(title) * 0.68
    ]
    if not candidates:
        return title
    split_at = min(candidates, key=lambda index: abs(index - len(title) / 2))
    return f"{title[:split_at]}\n{title[split_at:]}"


def _title(slide, page: dict, theme: Theme) -> None:
    labels = {
        "executive_summary": "EXECUTIVE SUMMARY", "qualitative_summary": "SUMMARY",
        "qualitative_insight": "KEY INSIGHT", "quote_evidence": "VOICE OF CUSTOMER",
        "theme_summary": "THEME SYNTHESIS", "segment_comparison": "SEGMENT COMPARISON",
        "competitor_comparison": "COMPETITIVE VIEW", "case_study": "CASE STUDY",
        "journey": "JOURNEY", "framework": "FRAMEWORK", "research_framework": "RESEARCH DESIGN",
        "matrix": "MATRIX", "priority_matrix": "PRIORITY MATRIX", "problem_reason": "DIAGNOSIS",
        "recommendation": "ACTION", "segmentation_map": "SEGMENTATION",
        "persona": "PERSONA", "comparison": "COMPARISON", "evidence_diagnostic": "EVIDENCE",
        "concept_definition": "DEFINITION", "needs_pyramid": "NEEDS",
    }
    label = labels.get(_text(page.get("page_type")), "RESEARCH INSIGHT")
    chip_w = max(1.35, min(2.35, 0.085 * len(label) + 0.58))
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 0.28, chip_w, 0.30,
           fill=PALE_BLUE, line=PALE_BLUE, radius=True, name="semantic_tag")
    _textbox(slide, 0.75, 0.34, chip_w - 0.26, 0.16, label, size=8.5, color=BLUE,
             bold=True, theme=theme, name="semantic_tag_text")
    raw_title = _text(page.get("title"))
    title = _balanced_title(raw_title)
    title_size = 20 if len(raw_title) > 62 else 22 if len(raw_title) > 48 else 25 if len(raw_title) > 34 else 27 if len(raw_title) > 26 else 29
    _textbox(slide, 0.62, 0.66, 12.05, 0.78, title, size=title_size, color=NAVY,
             bold=True, theme=theme, margin=0, name="slide_title")
    # The page-type tag already supplies orientation. Repeating an optional
    # subtitle between the title and content compresses the content grid and
    # creates collisions on dense insight pages, so keep it in notes only.


def _human_source(page: dict) -> str:
    note = _text(page.get("source_notes"), 300)
    labels = []
    for quote in _items(page.get("quotes")):
        label = _text(quote.get("source_label") or quote.get("respondent_label"), 80)
        if label and label not in labels:
            labels.append(label)
    source = note or ("；".join(labels) if labels else "项目访谈与定性分析")
    for marker in ("evidence_", "segment_", "insight_", "artifact_"):
        if marker in source.lower():
            source = "项目访谈与定性分析"
            break
    return f"来源：{source}"


def _footer(slide, page: dict, theme: Theme) -> None:
    _textbox(slide, 0.62, 7.10, 9.7, 0.20, _human_source(page), size=8.5, color=MUTED,
             theme=theme, margin=0, name="visible_source")
    evidence_label = _text(page.get("evidence_label"), 40)
    if evidence_label:
        chip_w = min(1.75, max(0.86, 0.12 * len(evidence_label) + 0.34))
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 10.55, 7.03, chip_w, 0.28,
               fill=PALE_BLUE, line=PALE_BLUE, radius=True, name="evidence_chip")
        _textbox(slide, 10.66, 7.09, chip_w - 0.22, 0.14, evidence_label, size=8,
                 color=BLUE, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0,
                 name="evidence_chip_text")
    _shape(slide, MSO_SHAPE.OVAL, 12.33, 6.96, 0.38, 0.38, fill=NAVY, line=NAVY,
           name="page_number_badge")
    _textbox(slide, 12.33, 7.045, 0.38, 0.14, str(page.get("page_number") or ""),
             size=8.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme,
             margin=0, name="page_number")


def _add_speaker_notes(slide, page: dict) -> None:
    evidence_ids = [_text(value, 120) for value in _items(page.get("evidence_ids")) if _text(value)]
    segment_ids = []
    for quote in _items(page.get("quotes")):
        if not isinstance(quote, dict):
            continue
        segment_id = _text(quote.get("segment_id"), 120)
        if segment_id and segment_id not in segment_ids:
            segment_ids.append(segment_id)
    lines = [
        f"Purpose: {_text(page.get('purpose'), 1000)}",
        f"Key message: {_text(page.get('key_message'), 1000)}",
        f"Evidence IDs: {', '.join(evidence_ids) or 'none'}",
        f"Transcript segment IDs: {', '.join(segment_ids) or 'none'}",
        f"Transition: {_text(page.get('transition'), 1000)}",
    ]
    presenter = _text(page.get("speaker_notes"), 2000)
    if presenter:
        lines.append(f"Presenter note: {presenter}")
    try:
        slide.notes_slide.notes_text_frame.text = "\n".join(lines)
    except (AttributeError, NotImplementedError):
        # Older python-pptx builds may expose notes as read-only. Rendering must
        # remain deterministic; the visible evidence footer still survives.
        pass


def _card(slide, x, y, w, h, title, body_lines, *, theme, accent=MID_BLUE, index=None, body_size=13):
    card = _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=WHITE, line=BORDER, radius=True, name="editable_card")
    _shape(slide, MSO_SHAPE.RECTANGLE, x + 0.18, y + 0.15, 0.34, 0.055,
           fill=accent, line=accent, name="card_top_marker")
    if index is not None:
        _shape(slide, MSO_SHAPE.OVAL, x + 0.2, y + 0.24, 0.38, 0.38, fill=accent, line=accent, name="card_badge")
        _textbox(slide, x + 0.2, y + 0.315, 0.38, 0.16, str(index), size=9.5,
                 color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0,
                 name="card_index")
        tx = x + 0.68
    else:
        tx = x + 0.22
    _textbox(slide, tx, y + 0.28, w - (tx - x) - 0.18, 0.38, title, size=15,
             color=NAVY, bold=True, theme=theme, name="card_title")
    _rich_text(slide, x + 0.2, y + 0.76, w - 0.4, h - 0.91, body_lines, theme=theme,
               size=body_size, bullet=len(list(body_lines)) > 1, gap=5)
    return card


def _findings(page: dict) -> list[str]:
    findings = [_text(item.get("text") if isinstance(item, dict) else item, 700) for item in _items(page.get("supporting_findings"))]
    if not any(findings):
        findings = [_text(item, 700) for item in _items(page.get("supporting_points"))]
    return [item for item in findings if item]


def _blocks(page: dict) -> list[dict]:
    return [item for item in _items(page.get("content_structure")) if isinstance(item, dict)]


def _body_lines(block: dict, fallback: str = "") -> list[str]:
    values = [_text(block.get("body"), 700), *[_text(item, 500) for item in _items(block.get("items"))]]
    result = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result or ([_text(fallback)] if _text(fallback) else ["待补充"])


def _quote_card(slide, quote: dict, x, y, w, h, *, theme, index=1):
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=PALE_BLUE, line="C7DDEA", radius=True, name="editable_quote_card")
    _textbox(slide, x + 0.18, y + 0.12, 0.4, 0.4, "“", size=28, color=MID_BLUE, bold=True, theme=theme, name="quote_mark")
    _textbox(slide, x + 0.55, y + 0.24, w - 0.75, h - 0.76, _text(quote.get("text") or quote.get("quote"), 1_000), size=14.5, color=TEXT, theme=theme, name="verbatim_quote")
    label = _text(quote.get("respondent_label") or quote.get("source_label") or f"受访者 {index}", 100)
    label = re.sub(r"^受访者\s*[A-Za-z]?\d+\s*[｜|/]\s*", "", label).strip() or "匿名受访者"
    metadata = quote.get("metadata") if isinstance(quote.get("metadata"), dict) else {}
    suffix_values = [_text(metadata.get(key), 40) for key in ("segment", "city", "role") if _text(metadata.get(key))]
    suffix = " / ".join(value for value in suffix_values if value not in label)
    _textbox(slide, x + 0.55, y + h - 0.40, w - 0.75, 0.22, f"— {label}{'｜' + suffix if suffix else ''}", size=9.5, color=MUTED, theme=theme, name="quote_attribution")


def _render_insight(slide, page, theme):
    findings = _findings(page)[:4]
    quotes = _items(page.get("quotes"))[:3]
    left_w = 7.3 if quotes else 12.0
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.58, 1.48, left_w, 0.78, fill=BLUE, line=BLUE, radius=True, name="key_message")
    _textbox(slide, 0.82, 1.66, left_w - 0.48, 0.36, _text(page.get("key_message") or page.get("title")), size=17, color=WHITE, bold=True, theme=theme, name="key_message_text")
    card_y = 2.5
    card_h = min(0.95, 3.95 / max(1, len(findings)))
    for index, finding in enumerate(findings or ["待补充支撑发现"]):
        _card(slide, 0.58, card_y + index * (card_h + 0.16), left_w, card_h, f"支撑发现 {index + 1}", [finding], theme=theme, accent=BLUE_SCALE[index % 4], body_size=12.3)
    if quotes:
        qh = 4.72 / len(quotes) - 0.14
        for index, quote in enumerate(quotes):
            _quote_card(slide, quote, 8.15, 1.48 + index * (qh + 0.14), 4.55, qh, theme=theme, index=index + 1)


def _render_quote_evidence(slide, page, theme):
    findings = _findings(page)[:4]
    _textbox(slide, 0.62, 1.56, 4.1, 0.36, "研究解读", size=15, color=MID_BLUE, bold=True, theme=theme)
    _rich_text(slide, 0.62, 2.03, 4.1, 4.65, findings or [_text(page.get("key_message"))], theme=theme, size=15, gap=12)
    quotes = _items(page.get("quotes"))[:3]
    qh = 4.95 / max(1, len(quotes)) - 0.16
    for index, quote in enumerate(quotes):
        _quote_card(slide, quote, 5.0, 1.55 + index * (qh + 0.16), 7.68, qh, theme=theme, index=index + 1)


def _render_summary(slide, page, theme):
    blocks = _blocks(page)
    findings = _findings(page)
    content = blocks if len(blocks) >= 2 else [{"title": f"核心发现 {i + 1}", "items": [value]} for i, value in enumerate(findings[:4])]
    content = content[:4]
    cols = 2; cw, ch = 5.86, 2.25
    for index, block in enumerate(content):
        x = 0.62 + (index % cols) * 6.08; y = 1.55 + (index // cols) * 2.52
        lines = _body_lines(block)
        _card(slide, x, y, cw, ch, _text(block.get("title")) or f"核心发现 {index + 1}", lines, theme=theme, accent=BLUE_SCALE[index], index=index + 1, body_size=13.5)


def _render_comparison(slide, page, theme, competitor=False):
    blocks = _blocks(page)[:4]
    if not blocks:
        blocks = [{"title": f"对象 {i + 1}", "items": [value]} for i, value in enumerate(_findings(page)[:4])]
    count = max(2, min(4, len(blocks)))
    gap = 0.16; cw = (12.08 - gap * (count - 1)) / count
    _textbox(slide, 0.62, 1.48, 12.0, 0.34, "比较维度：认知 / 使用体验 / 差异价值 / 选择理由" if competitor else "比较维度：行为 / 需求 / 痛点 / 机会", size=11, color=MUTED, theme=theme)
    for index, block in enumerate(blocks[:count]):
        x = 0.62 + index * (cw + gap)
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, 1.98, cw, 4.25, fill=WHITE, line=BORDER, radius=True, name="comparison_column")
        _shape(slide, MSO_SHAPE.RECTANGLE, x, 1.98, cw, 0.62, fill=BLUE_SCALE[index], line=BLUE_SCALE[index], name="comparison_header")
        _textbox(slide, x + 0.12, 2.12, cw - 0.24, 0.30, _text(block.get("title")) or f"对象 {index + 1}", size=14, color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme)
        lines = _body_lines(block)
        _rich_text(slide, x + 0.17, 2.82, cw - 0.34, 3.05, lines[:5], theme=theme, size=12.3, gap=8)
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 6.40, 12.08, 0.47, fill=PALE_BLUE, line="C7DDEA", radius=True, name="comparison_implication")
    _textbox(slide, 0.83, 6.50, 11.65, 0.24, f"启示：{_text(page.get('key_message') or page.get('purpose'))}", size=11, color=NAVY, bold=True, theme=theme)


def _render_case(slide, page, theme):
    blocks = _blocks(page)
    labels = ["做法", "运行机制", "创造价值", "差异与启示"]
    defaults = _findings(page)
    for index, label in enumerate(labels):
        x = 0.62 + index * 3.07
        body = blocks[index] if index < len(blocks) else {"body": defaults[index] if index < len(defaults) else "待补充"}
        _card(slide, x, 1.65, 2.84, 3.95, _text(body.get("title")) or label, _body_lines(body), theme=theme, accent=BLUE_SCALE[index], index=index + 1, body_size=12.5)
        if index < 3:
            _connector(slide, x + 2.84, 3.62, x + 3.07, 3.62, color=MUTED)
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 5.86, 12.08, 0.82, fill=PALE_BLUE, line="C7DDEA", radius=True, name="case_implication")
    _textbox(slide, 0.86, 6.07, 11.6, 0.36, f"案例启示：{_text(page.get('key_message'))}", size=14, color=NAVY, bold=True, theme=theme)


def _render_journey(slide, page, theme):
    stages = _blocks(page)[:5]
    if not stages:
        stages = [{"title": f"阶段 {i + 1}", "items": [value]} for i, value in enumerate(_findings(page)[:5])]
    focus_stages = {
        int(value) for value in _items(page.get("focus_stages"))
        if str(value).strip().isdigit()
    }
    count = max(2, len(stages)); gap = 0.16; cw = (12.08 - gap * (count - 1)) / count
    _connector(slide, 0.8, 2.155, 12.45, 2.155, color=BORDER)
    for index, stage in enumerate(stages):
        x = 0.62 + index * (cw + gap)
        focused = index + 1 in focus_stages
        badge_color = RED if focused else BLUE_SCALE[index % 4]
        _shape(slide, MSO_SHAPE.OVAL, x + cw / 2 - 0.22, 1.86, 0.44, 0.44,
               fill=badge_color, line=WHITE, name="journey_stage")
        _textbox(slide, x, 2.44, cw, 0.34, _text(stage.get("title")) or f"阶段 {index + 1}", size=13, color=NAVY, bold=True, align=PP_ALIGN.CENTER, theme=theme)
        card_fill = "FFF4F6" if focused else WHITE
        card_line = "F3BEC6" if focused else BORDER
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, 2.93, cw, 3.37,
               fill=card_fill, line=card_line, radius=True, name="journey_card")
        lines = _body_lines(stage)
        body_y, body_h = 3.12, 2.94
        if focused:
            _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x + 0.14, 3.10, 0.86, 0.27,
                   fill=RED, line=RED, radius=True, name="journey_focus_chip")
            _textbox(slide, x + 0.22, 3.17, 0.70, 0.13, "关键摩擦", size=8,
                     color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme,
                     margin=0, name="journey_focus_text")
            body_y, body_h = 3.49, 2.56
        _rich_text(slide, x + 0.13, body_y, cw - 0.26, body_h, lines[:5],
                   theme=theme, size=11.8, gap=7)


def _render_framework(slide, page, theme):
    blocks = _blocks(page)[:5]
    if not blocks:
        blocks = [{"title": f"要素 {i + 1}", "body": value} for i, value in enumerate(_findings(page)[:4])]
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 4.42, 2.75, 4.50, 1.05,
           fill=BLUE, line=BLUE, radius=True, name="framework_core")
    _textbox(slide, 4.68, 2.97, 3.98, 0.58,
             _text(page.get("key_message") or page.get("title")), size=15.5,
             color=WHITE, bold=True, align=PP_ALIGN.CENTER,
             valign=MSO_ANCHOR.MIDDLE, theme=theme, margin=0)
    positions = [(0.7, 1.55), (9.1, 1.55), (0.7, 4.55), (9.1, 4.55)]
    anchors = [(4.42, 3.1), (8.92, 3.1), (4.42, 3.45), (8.92, 3.45)]
    for index, block in enumerate(blocks[:4]):
        x, y = positions[index]
        _card(slide, x, y, 3.52, 1.72, _text(block.get("title")) or f"要素 {index + 1}", _body_lines(block), theme=theme, accent=BLUE_SCALE[index], body_size=11.8)
        endpoint_x = x + 3.52 if x < 4 else x
        endpoint_y = y + 0.86
        _connector(slide, endpoint_x, endpoint_y, anchors[index][0], anchors[index][1], color=BORDER, arrow=False)


def _render_segmentation_map(slide, page, theme):
    segments = [item for item in _items(page.get("segments")) if isinstance(item, dict)]
    if not segments:
        segments = _blocks(page)[:4]
    variant = _text(page.get("variant") or (page.get("layout_spec") or {}).get("variant"))
    if variant == "positioning_map":
        x0, y0, w, h = 0.95, 1.86, 7.55, 4.70
        quadrant_fills = ["F4F8FF", "EDF5FF", "EAF3FF", "F7FAFF"]
        for index, (qx, qy) in enumerate(((x0, y0), (x0 + w / 2, y0), (x0, y0 + h / 2), (x0 + w / 2, y0 + h / 2))):
            _shape(slide, MSO_SHAPE.RECTANGLE, qx, qy, w / 2, h / 2,
                   fill=quadrant_fills[index], line=WHITE, name="positioning_quadrant")
        _connector(slide, x0, y0 + h, x0, y0, color=MUTED, arrow=True)
        _connector(slide, x0, y0 + h, x0 + w, y0 + h, color=MUTED, arrow=True)
        _connector(slide, x0 + w / 2, y0 + 0.12, x0 + w / 2, y0 + h, color=BORDER, arrow=False, dashed=True)
        _connector(slide, x0, y0 + h / 2, x0 + w - 0.12, y0 + h / 2, color=BORDER, arrow=False, dashed=True)
        axes = page.get("axes") if isinstance(page.get("axes"), dict) else {}
        x_low, x_high = _text(axes.get("x_low") or "记录导向"), _text(axes.get("x_high") or "分享导向")
        y_low, y_high = _text(axes.get("y_low") or "轻量操作"), _text(axes.get("y_high") or "专业控制")
        _textbox(slide, x0, y0 + h + 0.15, 1.7, 0.24, x_low, size=10,
                 color=MUTED, theme=theme, margin=0)
        _textbox(slide, x0 + w - 1.7, y0 + h + 0.15, 1.7, 0.24, x_high, size=10,
                 color=MUTED, align=PP_ALIGN.RIGHT, theme=theme, margin=0)
        _textbox(slide, x0 + 0.12, y0 + h - 0.32, 1.5, 0.24, y_low, size=10,
                 color=MUTED, theme=theme, margin=0)
        _textbox(slide, x0 + 0.12, y0 + 0.08, 1.5, 0.24, y_high, size=10,
                 color=MUTED, theme=theme, margin=0)
        quadrant_labels = _items(page.get("quadrant_labels"))
        quadrant_defaults = ["专业记录", "专业分享", "轻量记录", "轻量分享"]
        quadrant_positions = [
            (x0 + 0.20, y0 + 0.42), (x0 + w / 2 + 0.20, y0 + 0.42),
            (x0 + 0.20, y0 + h / 2 + 0.22), (x0 + w / 2 + 0.20, y0 + h / 2 + 0.22),
        ]
        for index, (qx, qy) in enumerate(quadrant_positions):
            label = _text(quadrant_labels[index]) if index < len(quadrant_labels) else quadrant_defaults[index]
            _textbox(slide, qx, qy, 1.25, 0.22, label, size=9,
                     color="8799B3", theme=theme, margin=0, name="positioning_quadrant_label")
        for index, segment in enumerate(segments[:6]):
            sx = max(0, min(100, float(segment.get("x", 50))))
            sy = max(0, min(100, float(segment.get("y", 50))))
            px = x0 + 0.35 + (w - 0.70) * sx / 100
            py = y0 + h - 0.42 - (h - 0.70) * sy / 100
            color = BLUE_SCALE[index % len(BLUE_SCALE)]
            diameter = 0.48 if len(segments) <= 4 else 0.40
            _shape(slide, MSO_SHAPE.OVAL, px - diameter / 2, py - diameter / 2,
                   diameter, diameter, fill=color, line=WHITE, name="segment_point")
            _textbox(slide, px + 0.26, py - 0.18, 1.45, 0.40,
                     _text(segment.get("title") or segment.get("name")), size=10.5,
                     color=NAVY, bold=True, theme=theme, margin=0, name="segment_point_label")
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 8.84, 1.86, 3.86, 4.70,
               fill=WHITE, line=BORDER, radius=True, name="segment_legend_panel")
        _textbox(slide, 9.12, 2.12, 3.25, 0.36, "四类人群的核心差异", size=15,
                 color=NAVY, bold=True, theme=theme, margin=0)
        for index, segment in enumerate(segments[:4]):
            y = 2.75 + index * 0.82
            color = BLUE_SCALE[index % len(BLUE_SCALE)]
            _shape(slide, MSO_SHAPE.OVAL, 9.12, y + 0.03, 0.22, 0.22,
                   fill=color, line=color, name="segment_legend_dot")
            _textbox(slide, 9.48, y, 2.85, 0.30,
                     _text(segment.get("title") or segment.get("name")), size=12.5,
                     color=TEXT, bold=True, theme=theme, margin=0)
            _textbox(slide, 9.48, y + 0.33, 2.82, 0.32,
                     _text(segment.get("summary") or segment.get("body"), 90), size=10,
                     color=MUTED, theme=theme, margin=0)
        return

    root_title = _text(page.get("key_message") or "核心用户人群")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 4.82, 1.72, 3.72, 0.76,
           fill=NAVY, line=NAVY, radius=True, name="segment_root")
    _textbox(slide, 5.05, 1.95, 3.26, 0.28, root_title, size=16, color=WHITE,
             bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
    parents = []
    for segment in segments:
        parent = _text(segment.get("parent") or "核心分群")
        if parent not in parents:
            parents.append(parent)
    parents = (parents or ["核心分群"])[:2]
    parent_centers = [3.68, 9.65] if len(parents) > 1 else [6.66]
    for index, parent in enumerate(parents):
        cx = parent_centers[index]
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, cx - 1.30, 3.03, 2.60, 0.64,
               fill=BLUE_SCALE[index + 1], line=BLUE_SCALE[index + 1], radius=True,
               name="segment_parent")
        _textbox(slide, cx - 1.12, 3.22, 2.24, 0.24, parent, size=14, color=WHITE,
                 bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
        _connector(slide, 6.68, 2.48, cx, 3.03, color="98B9E8", arrow=False)
    child_w = 2.72
    gap = 0.24
    count = min(4, len(segments))
    start_x = (W - (count * child_w + max(0, count - 1) * gap)) / 2
    for index, segment in enumerate(segments[:4]):
        x = start_x + index * (child_w + gap)
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, 4.45, child_w, 1.62,
               fill=WHITE, line=BORDER, radius=True, name="segment_child")
        _shape(slide, MSO_SHAPE.RECTANGLE, x, 4.45, child_w, 0.14,
               fill=BLUE_SCALE[index], line=BLUE_SCALE[index], name="segment_child_band")
        _textbox(slide, x + 0.18, 4.78, child_w - 0.36, 0.30,
                 _text(segment.get("title") or segment.get("name")), size=14,
                 color=NAVY, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
        _textbox(slide, x + 0.18, 5.22, child_w - 0.36, 0.52,
                 _text(segment.get("summary") or segment.get("body"), 100), size=10.5,
                 color=MUTED, align=PP_ALIGN.CENTER, theme=theme, margin=0)
        parent = _text(segment.get("parent") or parents[0])
        parent_index = parents.index(parent) if parent in parents else 0
        _connector(slide, parent_centers[parent_index], 3.67, x + child_w / 2, 4.45,
                   color="98B9E8", arrow=False)


def _render_persona(slide, page, theme):
    profile = page.get("profile") if isinstance(page.get("profile"), dict) else {}
    traits = [_text(item, 160) for item in _items(page.get("traits")) if _text(item)]
    behaviors = [_text(item, 160) for item in _items(page.get("behaviors")) if _text(item)]
    blocks = _blocks(page)
    if not traits and blocks:
        traits = _body_lines(blocks[0])
    if not behaviors and len(blocks) > 1:
        behaviors = _body_lines(blocks[1])
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 1.72, 3.28, 4.98,
           fill=NAVY, line=NAVY, radius=True, name="persona_profile_panel")
    _shape(slide, MSO_SHAPE.OVAL, 1.68, 2.02, 1.14, 1.14,
           fill="CFE1FF", line="CFE1FF", name="persona_avatar_back")
    _shape(slide, MSO_SHAPE.OVAL, 2.01, 2.23, 0.48, 0.48,
           fill=BLUE, line=BLUE, name="persona_head")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 1.83, 2.72, 0.84, 0.44,
           fill=BLUE, line=BLUE, radius=True, name="persona_body")
    _textbox(slide, 0.96, 3.45, 2.60, 0.38, _text(profile.get("name") or "典型用户"),
             size=20, color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
    _textbox(slide, 0.96, 3.91, 2.60, 0.30, _text(profile.get("archetype") or page.get("subtitle")),
             size=11, color="BFD5FF", align=PP_ALIGN.CENTER, theme=theme, margin=0)
    attributes = profile.get("attributes") if isinstance(profile.get("attributes"), dict) else {}
    attr_lines = [f"{key}｜{value}" for key, value in list(attributes.items())[:5]]
    _rich_text(slide, 1.02, 4.42, 2.48, 1.66, attr_lines or ["核心场景｜待补充"],
               theme=theme, size=11.5, color=WHITE, bullet=False, gap=8, name="persona_attributes")
    _textbox(slide, 1.04, 6.22, 2.42, 0.22, _text(profile.get("motto") or "以行为与需求定义人群"),
             size=9.5, color="BFD5FF", italic=True, align=PP_ALIGN.CENTER,
             theme=theme, margin=0, name="persona_motto")

    _card(slide, 4.20, 1.72, 8.50, 2.18, "生活状态与价值观", traits[:4],
          theme=theme, accent=BLUE, body_size=13.5)
    _card(slide, 4.20, 4.15, 5.32, 2.55, "关键行为特征", behaviors[:4],
          theme=theme, accent=CYAN, body_size=13)
    quote = _items(page.get("quotes"))[:1]
    if quote:
        _quote_card(slide, quote[0], 9.78, 4.15, 2.92, 2.55, theme=theme)
    else:
        _card(slide, 9.78, 4.15, 2.92, 2.55, "关键触发", _findings(page)[:3],
              theme=theme, accent="4A8BFF", body_size=12.5)


def _render_evidence_diagnostic(slide, page, theme):
    blocks = _blocks(page)
    support = blocks[0] if blocks else {"title": "支持证据", "items": _findings(page)[:3]}
    counter = blocks[1] if len(blocks) > 1 else {"title": "反例与边界", "items": _findings(page)[3:6]}
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 1.70, 12.08, 0.78,
           fill=NAVY, line=NAVY, radius=True, name="diagnostic_hypothesis")
    _textbox(slide, 0.90, 1.94, 11.52, 0.30,
             _text(page.get("hypothesis") or page.get("key_message") or page.get("title")),
             size=17, color=WHITE, bold=True, theme=theme, margin=0)
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 0.62, 2.78, 5.74, 2.78,
           fill="EFF5FF", line="BFD5FF", radius=True, name="diagnostic_support")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 6.64, 2.78, 6.06, 2.78,
           fill="FFF4F6", line="F3BEC6", radius=True, name="diagnostic_counter")
    _textbox(slide, 0.92, 3.05, 5.14, 0.34, _text(support.get("title")) or "支持证据",
             size=15.5, color=BLUE, bold=True, theme=theme, margin=0)
    _rich_text(slide, 0.90, 3.53, 5.12, 1.62, _body_lines(support), theme=theme,
               size=13, color=TEXT, gap=9)
    _textbox(slide, 6.94, 3.05, 5.46, 0.34, _text(counter.get("title")) or "反例与边界",
             size=15.5, color=RED, bold=True, theme=theme, margin=0)
    _rich_text(slide, 6.92, 3.53, 5.42, 1.62, _body_lines(counter), theme=theme,
               size=13, color=TEXT, gap=9)
    verdict = _text(page.get("verdict") or page.get("recommendation") or page.get("purpose"))
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 1.55, 5.86, 10.22, 0.72,
           fill=PALE_BLUE, line="BFD5FF", radius=True, name="diagnostic_verdict")
    _textbox(slide, 1.86, 6.08, 9.60, 0.28, f"综合判断｜{verdict}", size=14.5,
             color=NAVY, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)


def _render_concept_definition(slide, page, theme):
    layers = [item for item in _items(page.get("definition_layers")) if isinstance(item, dict)]
    if not layers:
        layers = _blocks(page)[:3]
    while len(layers) < 3:
        layers.append({"title": ["广义", "中义", "狭义"][len(layers)], "body": "待补充定义"})
    circles = [
        (0.90, 1.72, 4.82, "D9E8FF", NAVY),
        (1.50, 2.31, 3.62, "AFCBFF", NAVY),
        (2.10, 2.91, 2.42, BLUE, WHITE),
    ]
    # Draw every circle first, then labels. Text remains on top of all rings and
    # OfficeCLI can verify that no later shape hides it.
    for x, y, size, fill, _ in circles:
        _shape(slide, MSO_SHAPE.OVAL, x, y, size, size, fill=fill, line=fill,
               name="definition_layer")
    label_specs = [
        (1.10, 5.88, 4.42, 0.52, 11),
        (1.70, 5.04, 3.22, 0.56, 11.5),
        (2.30, 3.54, 2.02, 1.05, 12.5),
    ]
    for index, (_, _, _, _, color) in enumerate(circles):
        layer = layers[index]
        short = _text(layer.get("short") or layer.get("body") or layer.get("statement"), 24)
        text = f"{_text(layer.get('title') or layer.get('name'))}\n{short}"
        tx, ty, tw, th, font_size = label_specs[index]
        _textbox(slide, tx, ty, tw, th, text, size=font_size,
                 color=color, bold=True, align=PP_ALIGN.CENTER, valign=MSO_ANCHOR.MIDDLE,
                 theme=theme, margin=0, name="definition_layer_text")
    _textbox(slide, 6.10, 1.84, 6.10, 0.36, "边界判断与识别规则", size=16,
             color=NAVY, bold=True, theme=theme, margin=0)
    rules = [item for item in _items(page.get("boundary_rules")) if isinstance(item, dict)]
    if not rules:
        rules = _blocks(page)[3:6]
    for index, rule in enumerate((rules or [{"title": "判断规则", "body": "待补充"}])[:4]):
        y = 2.38 + index * 0.98
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 6.10, y, 6.28, 0.76,
               fill=WHITE, line=BORDER, radius=True, name="boundary_rule")
        _shape(slide, MSO_SHAPE.OVAL, 6.34, y + 0.20, 0.34, 0.34,
               fill=BLUE_SCALE[index % len(BLUE_SCALE)], line=BLUE_SCALE[index % len(BLUE_SCALE)],
               name="boundary_rule_index")
        _textbox(slide, 6.34, y + 0.285, 0.34, 0.14, str(index + 1), size=8.5,
                 color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
        _textbox(slide, 6.88, y + 0.15, 1.58, 0.26, _text(rule.get("title") or rule.get("name")),
                 size=12.5, color=NAVY, bold=True, theme=theme, margin=0)
        _textbox(slide, 8.55, y + 0.15, 3.50, 0.42,
                 _text(rule.get("body") or rule.get("statement"), 100), size=11.5,
                 color=TEXT, theme=theme, margin=0)


def _render_needs_pyramid(slide, page, theme):
    levels = [item for item in _items(page.get("levels")) if isinstance(item, dict)]
    if not levels:
        levels = _blocks(page)[:3]
    while len(levels) < 3:
        levels.append({"title": ["基础需求", "关系需求", "成长需求"][len(levels)], "body": "待补充"})
    specs = [
        (1.72, 4.92, 7.20, 1.18, "BFD5FF", NAVY),
        (2.30, 3.55, 6.04, 1.18, "6EA3FF", WHITE),
        (2.88, 2.18, 4.88, 1.18, BLUE, WHITE),
    ]
    for index, (x, y, w, h, fill, color) in enumerate(specs):
        _shape(slide, MSO_SHAPE.TRAPEZOID, x, y, w, h, fill=fill, line=WHITE,
               name="needs_level")
        level = levels[index]
        _textbox(slide, x + 0.45, y + 0.22, w - 0.90, 0.30,
                 _text(level.get("title") or level.get("name")), size=16, color=color,
                 bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0)
        _textbox(slide, x + 0.60, y + 0.63, w - 1.20, 0.28,
                 _text(level.get("body") or level.get("statement"), 90), size=10.5,
                 color=color, align=PP_ALIGN.CENTER, theme=theme, margin=0)
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 9.55, 2.18, 3.15, 3.92,
           fill=WHITE, line=BORDER, radius=True, name="needs_mapping_panel")
    _textbox(slide, 9.85, 2.46, 2.55, 0.34, "人群需求映射", size=15,
             color=NAVY, bold=True, theme=theme, margin=0)
    mapping = [item for item in _items(page.get("segment_mapping")) if isinstance(item, dict)]
    for index, item in enumerate(mapping[:4]):
        y = 3.05 + index * 0.68
        _shape(slide, MSO_SHAPE.OVAL, 9.86, y + 0.04, 0.24, 0.24,
               fill=BLUE_SCALE[index % len(BLUE_SCALE)], line=BLUE_SCALE[index % len(BLUE_SCALE)],
               name="needs_mapping_dot")
        _textbox(slide, 10.24, y, 1.05, 0.26, _text(item.get("segment")), size=11.5,
                 color=TEXT, bold=True, theme=theme, margin=0)
        _textbox(slide, 11.16, y, 1.10, 0.26, _text(item.get("level")), size=10.5,
                 color=BLUE, align=PP_ALIGN.RIGHT, theme=theme, margin=0)


def _render_priority_matrix(slide, page, theme):
    axes = page.get("axes") if isinstance(page.get("axes"), dict) else {}
    items = [item for item in _items(page.get("items")) if isinstance(item, dict)]
    x0, y0, w, h = 1.18, 1.92, 8.45, 4.62
    quadrant_fills = ["F4F8FF", "EAF3FF", "F8FBFF", "EEF5FF"]
    for index, (qx, qy) in enumerate(((x0, y0), (x0 + w / 2, y0), (x0, y0 + h / 2), (x0 + w / 2, y0 + h / 2))):
        _shape(slide, MSO_SHAPE.RECTANGLE, qx, qy, w / 2, h / 2,
               fill=quadrant_fills[index], line=WHITE, name="priority_quadrant")
    _connector(slide, x0, y0 + h, x0, y0, color=MUTED, arrow=True)
    _connector(slide, x0, y0 + h, x0 + w, y0 + h, color=MUTED, arrow=True)
    _connector(slide, x0 + w / 2, y0, x0 + w / 2, y0 + h, color="AFC3DC", arrow=False, dashed=True)
    _connector(slide, x0, y0 + h / 2, x0 + w, y0 + h / 2, color="AFC3DC", arrow=False, dashed=True)
    labels = _items(page.get("quadrant_labels"))
    defaults = ["重点投入", "战略培育", "持续保持", "低优先级"]
    q_positions = [(x0 + 0.18, y0 + 0.15), (x0 + w / 2 + 0.18, y0 + 0.15),
                   (x0 + 0.18, y0 + h / 2 + 0.15), (x0 + w / 2 + 0.18, y0 + h / 2 + 0.15)]
    for index, (x, y) in enumerate(q_positions):
        _textbox(slide, x, y, 1.55, 0.26, _text(labels[index]) if index < len(labels) else defaults[index],
                 size=10.5, color=BLUE if index == 0 else MUTED, bold=index == 0,
                 theme=theme, margin=0, name="quadrant_label")
    _textbox(slide, x0 - 0.36, y0 - 0.30, 2.6, 0.24,
             _text(axes.get("y") or "影响程度 ↑"), size=10, color=MUTED,
             theme=theme, margin=0)
    _textbox(slide, x0 + w - 2.7, y0 + h + 0.15, 2.7, 0.24,
             _text(axes.get("x") or "发生频率 →"), size=10, color=MUTED,
             align=PP_ALIGN.RIGHT, theme=theme, margin=0)
    for index, item in enumerate(items[:10]):
        sx = max(0, min(100, float(item.get("x", 50))))
        sy = max(0, min(100, float(item.get("y", 50))))
        px = x0 + 0.30 + (w - 0.60) * sx / 100
        py = y0 + h - 0.34 - (h - 0.68) * sy / 100
        priority = _text(item.get("priority")).lower()
        color = RED if priority in {"high", "高", "p0", "p1"} else BLUE_SCALE[index % len(BLUE_SCALE)]
        diameter = 0.34 + min(0.16, float(item.get("weight", 0) or 0) / 500)
        _shape(slide, MSO_SHAPE.OVAL, px - diameter / 2, py - diameter / 2,
               diameter, diameter, fill=color, line=WHITE, name="priority_item")
        _textbox(slide, px + 0.22, py - 0.16, 1.55, 0.34,
                 _text(item.get("label") or item.get("title"), 24), size=9.8,
                 color=TEXT, bold=priority in {"high", "高", "p0", "p1"},
                 theme=theme, margin=0, name="priority_item_label")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 9.95, 1.92, 2.75, 4.62,
           fill=NAVY, line=NAVY, radius=True, name="priority_summary")
    _textbox(slide, 10.25, 2.24, 2.15, 0.38, "优先决策", size=16, color=WHITE,
             bold=True, theme=theme, margin=0)
    summary_lines = _findings(page)[:4]
    _rich_text(slide, 10.22, 2.88, 2.20, 2.54, summary_lines or ["优先处理高频、高影响事项"],
               theme=theme, size=12.5, color=WHITE, gap=12)
    _textbox(slide, 10.25, 5.82, 2.10, 0.34,
             _text(page.get("recommendation") or "矩阵位置仅来自显式输入"), size=9.5,
             color="BFD5FF", theme=theme, margin=0)


def _render_matrix(slide, page, theme):
    blocks = _blocks(page)[:4]
    labels = ["高价值 / 高可行", "高价值 / 低可行", "低价值 / 高可行", "低价值 / 低可行"]
    _connector(slide, 1.8, 6.35, 1.8, 1.72, color=MUTED)
    _connector(slide, 1.8, 6.35, 12.1, 6.35, color=MUTED)
    _textbox(slide, 0.65, 1.55, 1.0, 0.3, "价值 ↑", size=11, color=MUTED, theme=theme)
    _textbox(slide, 11.25, 6.48, 1.0, 0.3, "可行性 →", size=11, color=MUTED, theme=theme)
    positions = [(2.0, 1.75), (7.12, 1.75), (2.0, 4.07), (7.12, 4.07)]
    fills = ["E6F4F1", "FFF5E5", "EAF2F8", "F5F7FA"]
    for index, (x, y) in enumerate(positions):
        block = blocks[index] if index < len(blocks) else {}
        _shape(slide, MSO_SHAPE.RECTANGLE, x, y, 4.92, 2.12, fill=fills[index], line=WHITE, name="matrix_quadrant")
        _textbox(slide, x + 0.18, y + 0.15, 4.5, 0.32, _text(block.get("title")) or labels[index], size=13, color=NAVY, bold=True, theme=theme)
        _rich_text(slide, x + 0.18, y + 0.62, 4.5, 1.28, _body_lines(block), theme=theme, size=11.5, gap=5)


def _render_problem_or_recommendation(slide, page, theme, recommendation=False):
    labels = ["问题", "原因", "行动" if recommendation else "影响"]
    blocks = _blocks(page)
    findings = _findings(page)
    for index, label in enumerate(labels):
        x = 0.72 + index * 4.15
        block = blocks[index] if index < len(blocks) else {"body": findings[index] if index < len(findings) else "待补充"}
        # Recommendations stay in the technology-blue brand system. Semantic
        # alert/success colors are reserved for evidence conflicts and status.
        accent = BLUE_SCALE[index]
        _shape(slide, MSO_SHAPE.HEXAGON, x, 1.82, 3.72, 1.12, fill=accent, line=accent, name="logic_step")
        _textbox(slide, x + 0.3, 2.14, 3.12, 0.36, _text(block.get("title")) or label, size=16, color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme)
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, x, 3.22, 3.72, 2.78, fill=WHITE, line=BORDER, radius=True, name="logic_detail")
        _rich_text(slide, x + 0.22, 3.48, 3.28, 2.20, _body_lines(block), theme=theme, size=13, gap=8)
        if index < 2:
            _connector(slide, x + 3.72, 2.38, x + 4.12, 2.38, color=MUTED)
    priority = _text(page.get("recommendation_priority"))
    if recommendation and priority:
        _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 10.95, 1.43, 1.45, 0.30, fill=BLUE, line=BLUE, radius=True, name="priority_badge")
        _textbox(slide, 11.05, 1.46, 1.25, 0.18, f"优先级 {priority}", size=9.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme)


def _render_section(slide, page, theme):
    set_slide_background(slide, NAVY)
    _shape(slide, MSO_SHAPE.OVAL, 9.46, 0.34, 3.42, 3.42, fill="124BA8", line="124BA8", name="section_orbit_back")
    _shape(slide, MSO_SHAPE.OVAL, 10.55, 0.72, 2.16, 2.16, fill=BLUE, line=BLUE, name="section_orbit_front")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 1.0, 1.30, 1.55, 0.34, fill=BLUE, line=BLUE, radius=True, name="section_tag")
    _textbox(slide, 1.13, 1.39, 1.29, 0.15, f"SECTION {page.get('page_number') or ''}", size=9.5,
             color=WHITE, bold=True, align=PP_ALIGN.CENTER, theme=theme, margin=0, name="section_tag_text")
    _textbox(slide, 1.0, 2.35, 10.8, 1.18, page.get("title"), size=31, color=WHITE,
             bold=True, theme=theme, margin=0, name="section_title")
    _textbox(slide, 1.03, 3.78, 9.8, 0.72,
             page.get("key_message") or page.get("subtitle") or page.get("purpose"),
             size=17, color="CFE1FF", theme=theme, margin=0, name="section_message")
    _shape(slide, MSO_SHAPE.ROUNDED_RECTANGLE, 1.0, 5.82, 3.35, 0.38,
           fill="123D86", line="123D86", radius=True, name="section_source_chip")
    _textbox(slide, 1.18, 5.92, 3.0, 0.16, "SurveyKit QUALITATIVE REPORT", size=8.5,
             color="BFD5FF", bold=True, theme=theme, margin=0, name="section_source_text")


def _render_page(slide, page: dict, theme: Theme) -> None:
    page_type = _text(page.get("page_type"))
    if page_type in {"section_intro", "navigation"}:
        _render_section(slide, page, theme); return
    set_slide_background(slide, LIGHT); _title(slide, page, theme)
    if page_type in {"qualitative_summary", "theme_summary", "executive_summary"}:
        _render_summary(slide, page, theme)
    elif page_type == "quote_evidence":
        _render_quote_evidence(slide, page, theme)
    elif page_type in {"segment_comparison", "competitor_comparison", "comparison"}:
        _render_comparison(slide, page, theme, competitor=page_type == "competitor_comparison")
    elif page_type == "case_study":
        _render_case(slide, page, theme)
    elif page_type == "journey":
        _render_journey(slide, page, theme)
    elif page_type in {"framework", "research_framework"}:
        _render_framework(slide, page, theme)
    elif page_type == "segmentation_map":
        _render_segmentation_map(slide, page, theme)
    elif page_type == "persona":
        _render_persona(slide, page, theme)
    elif page_type == "evidence_diagnostic":
        _render_evidence_diagnostic(slide, page, theme)
    elif page_type == "concept_definition":
        _render_concept_definition(slide, page, theme)
    elif page_type == "needs_pyramid":
        _render_needs_pyramid(slide, page, theme)
    elif page_type == "priority_matrix":
        _render_priority_matrix(slide, page, theme)
    elif page_type == "matrix":
        _render_matrix(slide, page, theme)
    elif page_type in {"problem_reason", "recommendation"}:
        _render_problem_or_recommendation(slide, page, theme, recommendation=page_type == "recommendation")
    else:
        _render_insight(slide, page, theme)
    _footer(slide, page, theme)


def _chunks(values: list, size: int) -> list[list]:
    return [values[index:index + size] for index in range(0, len(values), size)] or [[]]


COLLECTION_LIMITS: dict[str, dict[str, int]] = {
    "executive_summary": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "qualitative_summary": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "theme_summary": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "qualitative_insight": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4, "quotes": 1},
    "quote_evidence": {"supporting_findings": 4, "supporting_points": 4, "quotes": 3},
    "framework": {"content_structure": 5, "supporting_findings": 5, "supporting_points": 5},
    "research_framework": {"content_structure": 5, "supporting_findings": 5, "supporting_points": 5},
    "journey": {"content_structure": 5, "supporting_findings": 5, "supporting_points": 5},
    "segment_comparison": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "competitor_comparison": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "comparison": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "case_study": {"content_structure": 4, "supporting_findings": 4, "supporting_points": 4},
    "matrix": {"content_structure": 4},
    "problem_reason": {"content_structure": 3, "supporting_findings": 3, "supporting_points": 3},
    "recommendation": {"content_structure": 3, "supporting_findings": 3, "supporting_points": 3},
    "segmentation_map": {"segments": 4},
    "persona": {"traits": 4, "behaviors": 4, "quotes": 1},
    "evidence_diagnostic": {"content_structure": 2, "supporting_findings": 6, "supporting_points": 6},
    "concept_definition": {"content_structure": 6, "definition_layers": 3, "boundary_rules": 4},
    "needs_pyramid": {"content_structure": 4, "levels": 4, "segment_mapping": 4},
    "priority_matrix": {"items": 6, "supporting_findings": 4, "supporting_points": 4},
}

# These collections explain another collection and should remain visible on its
# continuation pages when they fit on one page.  Exact quotes are intentionally
# excluded so a verbatim is never duplicated merely because another region split.
REPEAT_CONTEXT_FIELDS: dict[str, set[str]] = {
    "qualitative_insight": {"supporting_findings", "supporting_points"},
    "quote_evidence": {"supporting_findings", "supporting_points"},
    "persona": {"traits", "behaviors"},
    "concept_definition": {"definition_layers"},
    "needs_pyramid": {"levels"},
    "priority_matrix": {"supporting_findings", "supporting_points"},
}

BLOCK_LINE_LIMITS = {
    "executive_summary": 4,
    "qualitative_summary": 4,
    "theme_summary": 4,
    "framework": 4,
    "research_framework": 4,
    "journey": 4,
    "segment_comparison": 4,
    "competitor_comparison": 4,
    "comparison": 4,
    "case_study": 5,
    "matrix": 4,
    "problem_reason": 6,
    "recommendation": 6,
    "evidence_diagnostic": 4,
    "concept_definition": 4,
    "needs_pyramid": 4,
    "qualitative_insight": 4,
}


def _expand_dense_blocks(page: dict, page_type: str) -> tuple[dict, bool]:
    """Split overfilled card bodies without paraphrasing or dropping a line."""
    blocks = _items(page.get("content_structure"))
    line_limit = BLOCK_LINE_LIMITS.get(page_type)
    if not line_limit or not blocks:
        return page, False
    expanded: list = []
    changed = False
    for raw in blocks:
        if not isinstance(raw, dict):
            expanded.append(raw)
            continue
        item_key = "items" if isinstance(raw.get("items"), list) else "points" if isinstance(raw.get("points"), list) else ""
        items = _items(raw.get(item_key)) if item_key else []
        if len(items) <= line_limit:
            expanded.append(raw)
            continue
        changed = True
        parts = _chunks(items, line_limit)
        for index, part in enumerate(parts, 1):
            clone = deepcopy(raw)
            clone[item_key] = part
            if index > 1:
                base_title = _text(raw.get("title") or raw.get("region"), 90)
                if base_title:
                    clone["title"] = f"{base_title}（续 {index}）"
            expanded.append(clone)
    clone = deepcopy(page)
    clone["content_structure"] = expanded
    return clone, changed


def _continuation_title(value: Any, index: int) -> str:
    suffix = f"（续 {index}）"
    title = _text(value)
    return f"{title[:max(1, 100 - len(suffix))]}{suffix}"


def prepare_pages(script: dict) -> tuple[list[dict], list[dict]]:
    """Normalize pages and split semantic regions before either renderer runs.

    The split is deliberately page-type aware.  It preserves every source item,
    keeps exact quotes intact, and avoids the renderer-specific ``[:N]`` caps from
    silently discarding overflow content.
    """
    prepared, issues = [], []
    style_profile = script.get("style_profile") if isinstance(script.get("style_profile"), dict) else {}
    template_id = _text(style_profile.get("id"))
    for original in _items(script.get("pages")):
        page = deepcopy(original) if isinstance(original, dict) else {}
        page_type = _text(page.get("page_type"))
        if page_type == "cover":
            page_type = page["page_type"] = "section_intro"
        if page.get("data_points") or page_type == "data_insight":
            raise ValueError("当前定性 PPT 渲染器不支持定量图表，请使用交叉表 Excel 导出。")
        # Split by contiguous character ranges: never summarize a verbatim quote.
        expanded_quotes = []
        for quote in _items(page.get("quotes")):
            if not isinstance(quote, dict):
                expanded_quotes.append(quote)
                continue
            raw = str(quote.get("text") or quote.get("quote") or "")
            parts = [raw[i:i + 260] for i in range(0, len(raw), 260)] or [raw]
            for part_index, part in enumerate(parts):
                fragment = deepcopy(quote)
                fragment["text"] = part
                if len(parts) > 1:
                    fragment["quote_part"] = part_index + 1
                    fragment["quote_total"] = len(parts)
                    label = quote.get("respondent_label") or quote.get("source_label") or "受访者"
                    fragment["respondent_label"] = f"{label} · 原声 {part_index + 1}/{len(parts)}"
                expanded_quotes.append(fragment)
        if "quotes" in page:
            page["quotes"] = expanded_quotes
        if page_type not in PAGE_TYPES:
            page["page_type"] = "qualitative_insight"
            issues.append({"code": "UNSUPPORTED_PAGE_TYPE", "severity": "warning", "page_id": _text(page.get("id")), "message": f"{page_type or 'empty'} 已回退为 qualitative_insight。"})
            page_type = "qualitative_insight"
        page, blocks_expanded = _expand_dense_blocks(page, page_type)
        variant = resolve_layout_variant(page, template_id)
        limits = {**COLLECTION_LIMITS.get(page_type, {}), **VARIANT_COLLECTION_LIMITS.get(variant, {})}
        chunks_by_field: dict[str, list[list]] = {}
        for field, limit in limits.items():
            if field not in page or not isinstance(page.get(field), list):
                continue
            values = _items(page.get(field))
            if field == "quotes" and any(
                len(_text(item.get("text") if isinstance(item, dict) else item)) > 140
                for item in values
            ):
                limit = 1
            chunks_by_field[field] = _chunks(values, max(1, limit))
        chunk_count = max((len(value) for value in chunks_by_field.values()), default=1)
        if chunk_count > 1 or blocks_expanded:
            dimensions = [field for field, chunks in chunks_by_field.items() if len(chunks) > 1]
            issues.append({
                "code": "PAGE_TOO_DENSE",
                "severity": "fixed",
                "page_id": _text(page.get("id")),
                "message": f"页面已按 {', '.join(dimensions) or '卡片内容'} 拆分为 {chunk_count} 页，未改写原文。",
            })
        repeat_fields = REPEAT_CONTEXT_FIELDS.get(page_type, set())
        for index in range(chunk_count):
            clone = deepcopy(page)
            for field, chunks in chunks_by_field.items():
                if len(chunks) == 1 and field in repeat_fields:
                    clone[field] = chunks[0]
                else:
                    clone[field] = chunks[index] if index < len(chunks) else []
            if index:
                clone["id"] = f"{_text(page.get('id')) or 'page'}__part_{index + 1}"
                clone["title"] = _continuation_title(page.get("title"), index + 1)
                clone["split_from_page_id"] = _text(page.get("id"))
            if chunk_count > 1:
                clone["split_part"] = index + 1
                clone["split_total"] = chunk_count
            prepared.append(clone)
    for index, page in enumerate(prepared, 1):
        page["page_number"] = index
    return prepared, issues


def layout_adaptations(script: dict, pages: list[dict], issues: list[dict]) -> dict:
    style_profile = script.get("style_profile") if isinstance(script.get("style_profile"), dict) else {}
    template_id = _text(style_profile.get("id"))
    split_sources = {
        _text(page.get("split_from_page_id") or page.get("id"))
        for page in pages
        if page.get("split_total")
    }
    result = {
        "profile": "qualitative_tech_blue_v2" if template_id == TEMPLATE_ID else "qualitative_enterprise_v1_1",
        "input_page_count": len(_items(script.get("pages"))),
        "output_page_count": len(pages),
        "continuation_page_count": sum(bool(page.get("split_from_page_id")) for page in pages),
        "adapted_source_page_count": len(split_sources),
        "fixed_issue_count": sum(item.get("severity") == "fixed" for item in issues),
        "verbatim_quotes_preserved": True,
    }
    if template_id == TEMPLATE_ID:
        result["template_id"] = template_id
        result["variant_usage"] = variant_usage(pages, template_id)
    return result


def validate_script(script: dict, pages: list[dict], split_issues: list[dict]) -> dict:
    issues = list(split_issues)
    for index, page in enumerate(pages, 1):
        page_id = _text(page.get("id")) or f"page_{index}"
        title = _text(page.get("title"))
        findings, quotes, blocks = _findings(page), _items(page.get("quotes")), _blocks(page)
        char_count = len(title) + len(_text(page.get("key_message"))) + sum(map(len, findings)) + sum(len(_text(q.get("text"))) for q in quotes) + sum(len(_text(b.get("body"))) + sum(len(_text(i)) for i in _items(b.get("items"))) for b in blocks)
        if len(title) > 34:
            issues.append({"code": "TITLE_TOO_LONG", "severity": "warning", "page_id": page_id, "message": f"标题 {len(title)} 字，建议不超过 34 字。"})
        if char_count > 850:
            issues.append({"code": "PAGE_TOO_DENSE", "severity": "warning", "page_id": page_id, "message": f"页面约 {char_count} 字，建议继续拆分 Content Structure。"})
        if len(quotes) > 3:
            issues.append({"code": "TOO_MANY_QUOTES", "severity": "error", "page_id": page_id, "message": "单页原声超过 3 条。"})
        for quote in quotes:
            if len(_text(quote.get("text"))) > 260:
                issues.append({"code": "QUOTE_TOO_LONG", "severity": "warning", "page_id": page_id, "message": "原声超过 260 字，建议在 Script 层拆页但不可改写。"})
            if not (_text(quote.get("evidence_id")) and _text(quote.get("segment_id"))):
                issues.append({"code": "QUOTE_SOURCE_MISSING", "severity": "error", "page_id": page_id, "message": "原声缺少 evidence_id 或 segment_id。"})
        module_count = len(findings) + len(quotes) + len(blocks)
        if module_count > 8:
            issues.append({"code": "TOO_MANY_MODULES", "severity": "warning", "page_id": page_id, "message": f"页面包含 {module_count} 个内容模块。"})
        if page.get("page_type") not in NO_EVIDENCE_TYPES and not _items(page.get("evidence_ids")):
            issues.append({"code": "EVIDENCE_MISSING", "severity": "error", "page_id": page_id, "message": "页面未绑定 Evidence。"})
        if page.get("page_type") not in NO_EVIDENCE_TYPES and not _text(page.get("source_notes")) and not quotes:
            issues.append({"code": "SOURCE_NOTE_MISSING", "severity": "warning", "page_id": page_id, "message": "页面缺少面向读者的来源说明。"})
    errors = [item for item in issues if item["severity"] == "error"]
    return {"passed": not errors, "issue_count": len(issues), "error_count": len(errors), "issues": issues, "checks": ["title_length", "text_density", "quote_length", "quote_count", "module_count", "evidence_binding", "source_note", "native_editability"]}


def _object_counts(prs: Presentation) -> dict:
    counts = {"slides": len(prs.slides), "shapes": 0, "text_shapes": 0, "tables": 0, "pictures": 0, "connectors": 0, "full_slide_images": 0}
    for slide in prs.slides:
        for shape in slide.shapes:
            counts["shapes"] += 1
            if getattr(shape, "has_text_frame", False): counts["text_shapes"] += 1
            if getattr(shape, "has_table", False): counts["tables"] += 1
            if shape.shape_type == 13:
                counts["pictures"] += 1
                if shape.left <= Inches(0.05) and shape.top <= Inches(0.05) and shape.width >= Inches(W - 0.1) and shape.height >= Inches(H - 0.1): counts["full_slide_images"] += 1
            if "connector" in (shape.name or "").lower(): counts["connectors"] += 1
    counts["editable_native"] = counts["full_slide_images"] == 0 and counts["text_shapes"] > 0
    return counts


def _validate_rendered_geometry(prs: Presentation, pages: list[dict]) -> list[dict]:
    issues = []
    slide_w, slide_h = prs.slide_width, prs.slide_height
    container_names = {"editable_card", "editable_quote_card", "comparison_column", "journey_card", "matrix_quadrant", "logic_detail", "case_implication"}
    for slide_index, slide in enumerate(prs.slides):
        page_id = _text(pages[slide_index].get("id")) or f"page_{slide_index + 1}"
        containers = []
        for shape in slide.shapes:
            if shape.left < 0 or shape.top < 0 or shape.left + shape.width > slide_w or shape.top + shape.height > slide_h:
                issues.append({"code": "OBJECT_OVERFLOW", "severity": "error", "page_id": page_id, "message": f"对象 {shape.name} 超出画布边界。"})
            if shape.name in container_names:
                containers.append(shape)
            if getattr(shape, "has_text_frame", False) and _text(shape.text):
                area_inches = max(0.1, shape.width / Inches(1)) * max(0.1, shape.height / Inches(1))
                if len(_text(shape.text)) > area_inches * 46 + 28:
                    issues.append({"code": "TEXT_OVERFLOW_RISK", "severity": "warning", "page_id": page_id, "message": f"文本框 {shape.name} 的内容接近可用容量。"})
        for left_index, left in enumerate(containers):
            for right in containers[left_index + 1:]:
                overlap_w = min(left.left + left.width, right.left + right.width) - max(left.left, right.left)
                overlap_h = min(left.top + left.height, right.top + right.height) - max(left.top, right.top)
                if overlap_w > Inches(0.03) and overlap_h > Inches(0.03):
                    issues.append({"code": "CONTAINER_OVERLAP", "severity": "error", "page_id": page_id, "message": f"内容容器 {left.name} 与 {right.name} 发生重叠。"})
    return issues


def render_qualitative_report(script: dict) -> dict:
    if not isinstance(script, dict):
        raise ValueError("qualitative PPT script 必须是 JSON 对象")
    pages, split_issues = prepare_pages(script)
    if not pages:
        raise ValueError("qualitative PPT script 至少需要一页")
    validation = validate_script(script, pages, split_issues)
    prs = Presentation(); prs.slide_width = Inches(W); prs.slide_height = Inches(H)
    # The bundled master carries sample date/slide-number placeholders. The
    # report draws its own footer; inherited placeholders collide in previews.
    for owner in [*prs.slide_masters, *prs.slide_layouts]:
        for shape in list(owner.shapes):
            if shape.is_placeholder and shape.placeholder_format.type in {13, 15, 16}:
                shape._element.getparent().remove(shape._element)
    blank = prs.slide_layouts[6]; theme = _theme(script)
    for page in pages:
        slide = prs.slides.add_slide(blank)
        _render_page(slide, page, theme)
        _add_speaker_notes(slide, page)
    validation["issues"].extend(_validate_rendered_geometry(prs, pages))
    validation["issue_count"] = len(validation["issues"])
    validation["error_count"] = sum(item["severity"] == "error" for item in validation["issues"])
    validation["passed"] = validation["error_count"] == 0
    validation["checks"].extend(["rendered_bounds", "container_overlap", "text_overflow_risk"])
    stream = BytesIO(); prs.save(stream)
    return {"content": stream.getvalue(), "slide_count": len(pages), "validation": validation, "object_counts": _object_counts(prs), "render_llm_tokens": 0, "prepared_pages": pages, "layout_adaptations": layout_adaptations(script, pages, split_issues)}
