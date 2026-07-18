"""Editable research proposal deck renderer driven by validated Deck JSON.

The AI layer supplies semantics only.  All geometry, typography and colors are
owned by this deterministic renderer so the HTML preview and PPTX export can
share one content contract without accepting model-generated coordinates.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from pptx import Presentation
from pptx.chart.data import ChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_MARKER_STYLE, XL_TICK_MARK
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt
from pptx_report.illustrative_dataset import DISCLAIMER, EXAMPLE_LABEL, audit_illustrative_dataset, normalize_illustrative_dataset


VISUAL_TYPES = {
    "cover_product_hero",
    "context_tension_map",
    "decision_tree",
    "evidence_threshold_matrix",
    "dual_track_research_flow",
    "qualitative_design_canvas",
    "quantitative_sample_architecture",
    "questionnaire_decision_journey",
    "concept_funnel_maxdiff_example",
    "pricing_segment_example",
    "decision_output_map",
    "timeline_gantt_risk",
    "deliverable_map",
    "risk_matrix",
    "plan_comparison",
    "pricing_table",
}

VISUAL_FALLBACKS = {
    "flow": "dual_track_research_flow",
    "timeline": "timeline_gantt_risk",
    "matrix": "evidence_threshold_matrix",
    "tree": "decision_tree",
    "map": "decision_output_map",
    "sample": "quantitative_sample_architecture",
    "funnel": "concept_funnel_maxdiff_example",
    "cards": "deliverable_map",
}

TITLE_LIMIT = 38
KEY_MESSAGE_LIMIT = 65
ITEM_LABEL_LIMIT = 12
ITEM_DESCRIPTION_LIMIT = 110
MAX_ITEMS = 7

NAVY = "17324D"
BLUE = "1E5AA8"
CYAN = "23A6B5"
ORANGE = "E88735"
INK = "1B2733"
MUTED = "607080"
LINE = "D8E2EA"
PAPER = "F6F8FA"
WHITE = "FFFFFF"
LIGHT_BLUE = "EAF2FA"
LIGHT_CYAN = "E8F7F8"
LIGHT_ORANGE = "FFF2E7"


class DeckValidationError(ValueError):
    """Raised when Deck JSON cannot be repaired safely."""


def _text(value: Any, limit: int = 0) -> str:
    result = re.sub(r"\s+", " ", str(value or "")).strip()
    return result[:limit] if limit else result


def _items(slide: dict) -> list[dict]:
    raw = slide.get("content")
    if not isinstance(raw, list):
        return []
    normalized = []
    for index, item in enumerate(raw[:MAX_ITEMS]):
        if isinstance(item, str):
            item = {"headline": item}
        if not isinstance(item, dict):
            continue
        normalized.append({
            "id": _text(item.get("id")) or f"item_{index + 1:02d}",
            "label": _text(item.get("label"), ITEM_LABEL_LIMIT),
            "headline": _text(item.get("headline") or item.get("title"), 32),
            "description": _text(item.get("description"), ITEM_DESCRIPTION_LIMIT),
            "priority": int(item.get("priority") or index + 1),
            "source_type": _text(item.get("source_type")) or "project_brief",
        })
    return normalized


def _fallback_visual(value: str) -> str:
    value = _text(value).lower()
    if value in VISUAL_TYPES:
        return value
    for token, fallback in VISUAL_FALLBACKS.items():
        if token in value:
            return fallback
    return "decision_output_map"


def normalize_deck(deck: dict) -> tuple[dict, list[dict]]:
    """Repair safe schema defects and return (normalized_deck, issues)."""
    if not isinstance(deck, dict):
        raise DeckValidationError("Deck JSON 必须是对象。")
    result = copy.deepcopy(deck)
    issues: list[dict] = []
    slides = result.get("slides")
    if not isinstance(slides, list) or not slides:
        raise DeckValidationError("Deck JSON 缺少 slides。")
    normalized_slides = []
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    for index, raw in enumerate(slides[:20]):
        if not isinstance(raw, dict):
            issues.append({"level": "error", "code": "invalid_slide", "slide": index + 1})
            continue
        slide_id = _text(raw.get("id")) or f"slide_{index + 1:02d}"
        if slide_id in seen_ids:
            slide_id = f"slide_{index + 1:02d}"
            issues.append({"level": "warning", "code": "duplicate_id_repaired", "slide": index + 1})
        seen_ids.add(slide_id)
        title = _text(raw.get("title"), TITLE_LIMIT)
        if not title:
            title = "待完善页面"
            issues.append({"level": "error", "code": "empty_title", "slide": index + 1})
        if title in seen_titles:
            issues.append({"level": "warning", "code": "duplicate_title", "slide": index + 1})
        seen_titles.add(title)
        visual = _fallback_visual(raw.get("visual_type"))
        if visual != raw.get("visual_type"):
            issues.append({"level": "warning", "code": "visual_type_repaired", "slide": index + 1, "value": visual})
        content = _items(raw)
        if index and not content:
            issues.append({"level": "error", "code": "empty_content", "slide": index + 1})
        refs = raw.get("source_references") if isinstance(raw.get("source_references"), list) else []
        key_message = _text(raw.get("key_message"), KEY_MESSAGE_LIMIT)
        numeric_claim = bool(re.search(r"(?<!slide_)\b\d+(?:\.\d+)?%?\b", " ".join(
            [title, key_message] + [f"{item['headline']} {item['description']}" for item in content]
        )))
        if numeric_claim and not refs and index != 0:
            issues.append({"level": "warning", "code": "unreferenced_number", "slide": index + 1})
        normalized_slides.append({
            "id": slide_id,
            "order": index + 1,
            "slide_type": _text(raw.get("slide_type")) or ("cover" if index == 0 else visual),
            "title": title,
            "subtitle": _text(raw.get("subtitle"), 80),
            "key_message": key_message,
            "slide_question": _text(raw.get("slide_question") or raw.get("question"), 100),
            "unique_purpose": _text(raw.get("unique_purpose"), 140),
            "previous_slide_relation": _text(raw.get("previous_slide_relation"), 140),
            "next_slide_relation": _text(raw.get("next_slide_relation"), 140),
            "visual_type": "cover_product_hero" if index == 0 else visual,
            "layout_variant": _text(raw.get("layout_variant")) or "default",
            "relation_type": _text(raw.get("relation_type")) or "sequence",
            "content_density": _text(raw.get("content_density")) or "professional",
            "target_canvas_occupancy": min(.85, max(.5, float(raw.get("target_canvas_occupancy") or .72))),
            "content": content,
            "charts": raw.get("charts") if isinstance(raw.get("charts"), list) else [],
            "source_references": refs,
            "data_status": raw.get("data_status") if raw.get("data_status") in {"verified", "illustrative", "framework_only"} else "framework_only",
            "example_output": bool(raw.get("example_output")),
            "timeline_tasks": raw.get("timeline_tasks") if isinstance(raw.get("timeline_tasks"), list) else [],
            "notes": _text(raw.get("notes"), 240),
            "locked": bool(raw.get("locked")),
        })
    if not normalized_slides:
        raise DeckValidationError("Deck JSON 没有可用页面。")
    page_size = int(result.get("page_size") or len(normalized_slides))
    if page_size != len(normalized_slides):
        issues.append({"level": "warning", "code": "page_size_repaired", "value": len(normalized_slides)})
    normalized = {
        "deck_id": _text(result.get("deck_id")) or "deck_local",
        "project_id": _text(result.get("project_id")) or "project_local",
        "title": _text(result.get("title"), 80) or normalized_slides[0]["title"],
        "subtitle": _text(result.get("subtitle"), 120),
        "language": "zh-CN",
        "aspect_ratio": "16:9",
        "theme": "modern_insight_v2",
        "purpose": _text(result.get("purpose")) or "client_proposal",
        "example_output_mode": _text(result.get("example_output_mode")) or "illustrative",
        "illustrative_dataset_id": _text(result.get("illustrative_dataset_id")),
        "illustrative_dataset": normalize_illustrative_dataset(result.get("illustrative_dataset")),
        "content_density": _text(result.get("content_density")) or "professional",
        "target_canvas_occupancy": min(.82, max(.5, float(result.get("target_canvas_occupancy") or .72))),
        "min_body_characters": int(result.get("min_body_characters") or 160),
        "max_body_characters": int(result.get("max_body_characters") or 300),
        "page_size": len(normalized_slides),
        "source_summary": result.get("source_summary") if isinstance(result.get("source_summary"), dict) else {},
        "slides": normalized_slides,
    }
    return normalized, issues


def audit_deck(deck: dict) -> dict:
    normalized, issues = normalize_deck(deck)
    required = {"cover", "project_context", "business_decisions", "decision_evidence", "research_path", "sample_design", "questionnaire_design", "decision_outputs", "timeline"}
    present = {slide["slide_type"] for slide in normalized["slides"]}
    for slide_type in sorted(required - present):
        issues.append({"level": "warning", "code": "missing_structure", "value": slide_type})
    scores = []
    for slide in normalized["slides"]:
        score = 10
        if not slide["key_message"] and slide["visual_type"] != "cover_product_hero":
            score -= 1
        if not slide["content"] and slide["visual_type"] != "cover_product_hero":
            score -= 2
        if len(slide["content"]) > 5:
            score -= 1
        if len(slide["title"]) > 32:
            score -= 1
        body_chars = sum(len(item["headline"] + item["description"]) for item in slide["content"])
        if slide["visual_type"] != "cover_product_hero" and not slide["example_output"] and body_chars < 80:
            score -= 2; issues.append({"level": "warning", "code": "low_content_density", "slide": slide["order"]})
        components = {
            "content_professionalism": 9 if body_chars >= 120 or slide["example_output"] else 7,
            "title_body_alignment": 9 if slide["key_message"] and slide["content"] else 7,
            "information_density": 9 if body_chars >= 100 or slide["example_output"] else 6,
            "visual_completion": 9,
            "layout_fit": 9 if slide["target_canvas_occupancy"] >= .6 else 6,
            "project_specificity": 9 if any(token in (slide["title"] + " ".join(i["description"] for i in slide["content"])) for token in ["宠物", "饮水", "养宠", "概念", "样本"]) else 7,
            "data_status": 10 if slide["data_status"] in {"verified", "illustrative", "framework_only"} else 4,
            "proposal_value": 9 if slide["slide_question"] else 6,
            "narrative_link": 9 if slide["previous_slide_relation"] or slide["order"] == 1 else 6,
            "editability": 10,
        }
        if min(components.values()) < 7:
            issues.append({"level": "warning", "code": "slide_score_below_threshold", "slide": slide["order"]})
        scores.append({"slide_id": slide["id"], "score": round(sum(components.values()) / len(components), 1), "components": components, "body_characters": body_chars})
    for index in range(1, len(normalized["slides"])):
        if normalized["slides"][index]["visual_type"] == normalized["slides"][index - 1]["visual_type"]:
            issues.append({"level": "warning", "code": "consecutive_layout", "slide": index + 1})
    for left in range(len(normalized["slides"])):
        left_text = set(re.findall(r"[\u4e00-\u9fff]{2}", normalized["slides"][left]["slide_question"] + normalized["slides"][left]["title"]))
        for right in range(left + 1, len(normalized["slides"])):
            right_text = set(re.findall(r"[\u4e00-\u9fff]{2}", normalized["slides"][right]["slide_question"] + normalized["slides"][right]["title"]))
            union = left_text | right_text
            similarity = len(left_text & right_text) / len(union) if union else 0
            if similarity > .7:
                issues.append({"level": "warning", "code": "story_similarity", "slides": [left + 1, right + 1], "value": round(similarity, 2)})
    example_slides = [slide for slide in normalized["slides"] if slide["example_output"]]
    if normalized["example_output_mode"] == "illustrative" and example_slides:
        issues.extend(audit_illustrative_dataset(normalized["illustrative_dataset"]))
        for slide in example_slides:
            if slide["data_status"] != "illustrative" or not slide["charts"]:
                issues.append({"level": "error", "code": "invalid_example_slide", "slide": slide["order"]})
    for slide in normalized["slides"]:
        match = re.search(r"([一二三四五六七八九十]|\d+)(?:个?模块|项)", slide["title"])
        if match:
            values = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
            expected = int(match.group(1)) if match.group(1).isdigit() else values[match.group(1)]
            if expected != len(slide["content"]):
                issues.append({"level": "error", "code": "module_count_mismatch", "slide": slide["order"]})
    timeline = next((slide for slide in normalized["slides"] if slide["visual_type"] == "timeline_gantt_risk"), None)
    if timeline and timeline["timeline_tasks"] and len({task.get("start_day") for task in timeline["timeline_tasks"]}) == 1:
        issues.append({"level": "error", "code": "gantt_same_start"})
    return {"deck": normalized, "issues": issues, "slide_scores": scores, "ok": not any(i["level"] == "error" for i in issues)}


@dataclass(frozen=True)
class Theme:
    font_cn: str = "Microsoft YaHei"
    font_en: str = "Arial"


def _rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def _set_text(shape, text: str, size: float, color: str = INK, bold: bool = False,
              align=PP_ALIGN.LEFT, valign=MSO_ANCHOR.TOP, margin: float = 0.05) -> None:
    frame = shape.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.margin_left = Inches(margin)
    frame.margin_right = Inches(margin)
    frame.margin_top = Inches(margin)
    frame.margin_bottom = Inches(margin)
    frame.vertical_anchor = valign
    paragraph = frame.paragraphs[0]
    paragraph.alignment = align
    run = paragraph.add_run()
    run.text = text
    run.font.name = Theme.font_cn
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = _rgb(color)


def _textbox(slide, text, x, y, w, h, size=14, color=INK, bold=False,
             align=PP_ALIGN.LEFT, valign=MSO_ANCHOR.TOP, margin=0.04):
    shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    _set_text(shape, text, size, color, bold, align, valign, margin)
    return shape


def _rect(slide, x, y, w, h, fill=WHITE, line=LINE, radius=False):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid(); shape.fill.fore_color.rgb = _rgb(fill)
    shape.line.color.rgb = _rgb(line)
    shape.line.width = Pt(0.8)
    return shape


def _line(slide, x, y, w, h, color=BLUE, width=1.6, end_arrow=False):
    shape = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x), Inches(y), Inches(x + w), Inches(y + h))
    shape.line.color.rgb = _rgb(color); shape.line.width = Pt(width)
    if end_arrow:
        shape.line.end_arrowhead = True
    return shape


def _base_slide(prs, slide_data, page_no: int, project_short: str):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill; bg.solid(); bg.fore_color.rgb = _rgb(PAPER)
    if slide_data["visual_type"] != "cover_product_hero":
        _textbox(slide, slide_data["title"], .62, .36, 11.85, .55, 25, NAVY, True)
        if slide_data["key_message"]:
            _textbox(slide, slide_data["key_message"], .64, .94, 11.7, .42, 12.5, MUTED)
        _textbox(slide, project_short, .62, 7.12, 4.8, .2, 8, MUTED)
        _textbox(slide, str(page_no), 12.05, 7.08, .55, .25, 8, MUTED, align=PP_ALIGN.RIGHT)
    return slide


def _node_text(slide, item, x, y, w, h, fill=WHITE, accent=BLUE):
    shape = _rect(slide, x, y, w, h, fill, accent, True)
    headline = item.get("headline") or item.get("label") or "待完善"
    description = item.get("description") or ""
    _textbox(slide, headline, x + .16, y + .14, w - .32, .38, 14, NAVY, True)
    if description:
        _textbox(slide, description, x + .16, y + .56, w - .32, h - .68, 10.5, MUTED)
    return shape


def _render_cover(slide, deck, data):
    slide.background.fill.solid(); slide.background.fill.fore_color.rgb = _rgb(NAVY)
    _rect(slide, .78, .76, .17, 5.7, CYAN, CYAN)
    _textbox(slide, data["title"], 1.28, 1.55, 10.7, 1.25, 31, WHITE, True)
    _textbox(slide, data.get("subtitle") or deck.get("subtitle") or "研究方案", 1.32, 3.0, 9.9, .72, 17, "C9DAEA")
    _textbox(slide, date.today().isoformat(), 1.32, 5.95, 2.8, .32, 10.5, "B7CADB")
    _textbox(slide, "SurveyKit · AI 研究方案", 9.05, 5.95, 3.1, .32, 10.5, WHITE, True, PP_ALIGN.RIGHT)


def _render_horizontal(slide, items, y=2.55):
    items = items[:5] or [{"headline": "待完善"}]
    gap = .28; total_w = 12.0; w = (total_w - gap * (len(items) - 1)) / len(items); x = .66
    for index, item in enumerate(items):
        _node_text(slide, item, x, y, w, 2.15, LIGHT_BLUE if index % 2 == 0 else WHITE, BLUE if index % 2 == 0 else CYAN)
        if index < len(items) - 1:
            _line(slide, x + w + .04, y + 1.06, gap - .08, 0, CYAN, 1.8, True)
        x += w + gap


def _render_challenge_chain(slide, items):
    items = items[:4] or [{"headline": "待完善"}]
    widths = [4.1, 5.35, 6.6, 7.85]
    fills = [LIGHT_BLUE, LIGHT_CYAN, WHITE, LIGHT_ORANGE]
    for index, item in enumerate(items):
        w = widths[index]
        x = (13.333 - w) / 2
        y = 1.62 + index * 1.28
        _node_text(slide, item, x, y, w, .96, fills[index], [BLUE, CYAN, NAVY, ORANGE][index])
        if index < len(items) - 1:
            _line(slide, 6.66, y + .96, 0, .28, CYAN, 1.5, True)


def _render_decision_tree(slide, items):
    items = items[:5] or [{"headline": "待完善"}]
    center_y = 3.0 if len(items) == 5 else 2.35
    center = _rect(slide, 5.1, center_y, 3.1, 1.05, NAVY, NAVY, True)
    _set_text(center, "核心业务决策", 16, WHITE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    if len(items) == 5:
        positions = [(.65, 1.55), (.65, 4.55), (5.18, 5.05), (9.72, 1.55), (9.72, 4.55)]
    elif len(items) == 3:
        positions = [(.75, 1.75), (9.65, 1.75), (5.18, 4.72)]
    else:
        positions = [(.75, 1.75), (9.65, 1.75), (.75, 4.45), (9.65, 4.45)]
    for item, (x, y) in zip(items, positions):
        _node_text(slide, item, x, y, 2.95, 1.35 if len(items) == 5 else 1.55, WHITE, CYAN)
        start_x = 5.1 if x < 5 else (8.2 if x > 8.2 else 6.65)
        start_y = center_y + .53 if x < 5 or x > 8.2 else center_y + 1.05
        target_x = x + 2.95 if x < 5 else (x if x > 8.2 else x + 1.48)
        target_y = y + .68 if x < 5 or x > 8.2 else y
        _line(slide, start_x, start_y, target_x - start_x, target_y - start_y, LINE, 1.3)


def _render_matrix(slide, items):
    headers = ["业务决策", "研究问题", "关键指标", "决策输出"]
    rows = []
    for item in (items[:5] or [{"headline": "待完善"}]):
        headline = item.get("headline") or "待完善"
        rows.append([item.get("label") or headline, headline, item.get("description"), f"{headline}阶段结论"])
    table_shape = slide.shapes.add_table(len(rows) + 1, 4, Inches(.68), Inches(1.65), Inches(12.0), Inches(4.85))
    table = table_shape.table
    for col in range(4): table.columns[col].width = Inches(3.0)
    for col, header in enumerate(headers):
        cell = table.cell(0, col); cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(NAVY)
        _set_text(cell, header, 11, WHITE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, .08)
    for row_index, row in enumerate(rows, 1):
        for col, value in enumerate(row):
            cell = table.cell(row_index, col); cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(WHITE if row_index % 2 else LIGHT_BLUE)
            _set_text(cell, _text(value, 42), 9.5, INK, col == 0, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, .08)


def _render_relationship(slide, items):
    titles = ["研究问题", "研究方法", "计划产出"]
    x_values = [.7, 4.75, 8.8]
    for col, (x, title) in enumerate(zip(x_values, titles)):
        _textbox(slide, title, x, 1.55, 3.3, .35, 13, [BLUE, CYAN, NAVY][col], True, PP_ALIGN.CENTER)
    values = items[:3] or [{"headline": "待完善", "description": "待补充研究信息"}]
    for row, item in enumerate(values):
        y = 2.05 + row * 1.35
        headline = item.get("headline") or item.get("label") or "待完善"
        description = item.get("description") or "待补充研究方法"
        cells = [
            {"headline": headline, "description": "需要验证的关键场景与障碍"},
            {"headline": "组合验证", "description": description},
            {"headline": "决策输入", "description": f"形成{headline}的优先行动"},
        ]
        for col, (x, cell) in enumerate(zip(x_values, cells)):
            _node_text(slide, cell, x, y, 3.3, 1.02, WHITE, [BLUE, CYAN, NAVY][col])
        _line(slide, 4.05, y + .51, .62, 0, LINE, 1.4, True)
        _line(slide, 8.1, y + .51, .62, 0, LINE, 1.4, True)


def _render_hierarchy(slide, items):
    items = items[:4] or [{"headline": "待完善"}]
    widths = [11.4, 9.4, 7.4, 5.4]
    fills = [LIGHT_BLUE, LIGHT_CYAN, WHITE, LIGHT_ORANGE]
    for index, item in enumerate(items):
        w = widths[index]; x = (13.333 - w) / 2; y = 1.62 + index * 1.2
        shape = _rect(slide, x, y, w, .92, fills[index], [BLUE, CYAN, LINE, ORANGE][index], True)
        _set_text(shape, f"{item.get('headline') or item.get('label') or '待完善'}  {item.get('description') or ''}", 12, NAVY, index == 0, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, .08)


def _render_blueprint(slide, items):
    _line(slide, 1.35, 5.95, 10.7, 0, MUTED, 1.2, True)
    _line(slide, 1.35, 5.95, 0, -3.85, MUTED, 1.2, True)
    _textbox(slide, "执行优先级  低 → 高", 8.7, 6.08, 3.35, .3, 10, MUTED, True, PP_ALIGN.RIGHT)
    _textbox(slide, "证据强度\n高\n↑\n低", .55, 2.35, .65, 2.45, 9.5, MUTED, True, PP_ALIGN.CENTER)
    _line(slide, 6.7, 2.1, 0, 3.85, LINE, .75)
    _line(slide, 1.35, 4.03, 10.7, 0, LINE, .75)
    _textbox(slide, "优先验证", 1.65, 2.35, 1.3, .3, 9.5, MUTED, True)
    _textbox(slide, "优先落地", 10.15, 2.35, 1.3, .3, 9.5, CYAN, True)
    _textbox(slide, "计划输出 · 不代表真实数据", 8.8, 1.6, 3.4, .35, 10.5, ORANGE, True, PP_ALIGN.RIGHT)
    positions = [(2.1, 4.7), (4.2, 3.8), (6.3, 4.35), (8.4, 2.65), (10.3, 3.25)]
    for item, (x, y) in zip(items[:5] or [{"headline": "待完善"}], positions):
        shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(y), Inches(.72), Inches(.72))
        shape.fill.solid(); shape.fill.fore_color.rgb = _rgb(LIGHT_CYAN); shape.line.color.rgb = _rgb(CYAN)
        _textbox(slide, item.get("headline") or item.get("label") or "待完善", x - .48, y + .78, 1.7, .48, 9.5, INK, True, PP_ALIGN.CENTER)


def _render_timeline(slide, items):
    items = items[:6] or [{"headline": "待完善"}]
    start_y = 1.62; row_h = .78
    _textbox(slide, "阶段", .72, 1.36, 2.4, .25, 10.5, MUTED, True)
    _textbox(slide, "项目推进节奏", 3.35, 1.36, 8.75, .25, 10.5, MUTED, True)
    for index, item in enumerate(items):
        y = start_y + index * row_h
        _textbox(slide, item.get("headline") or item.get("label") or f"阶段{index + 1}", .72, y + .12, 2.35, .36, 10.5, NAVY, True)
        _rect(slide, 3.3, y + .18, 8.85, .34, "E6EBF0", "E6EBF0", True)
        bar_w = min(8.4, 1.4 + index * 1.25)
        _rect(slide, 3.34, y + .21, bar_w, .28, CYAN if index % 2 else BLUE, CYAN if index % 2 else BLUE, True)
        if item.get("description"):
            _textbox(slide, item["description"], 3.5 + min(bar_w, 6.7), y + .06, 1.85, .42, 8.5, MUTED)


def _render_deliverables(slide, items):
    center = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(5.2), Inches(2.35), Inches(2.95), Inches(2.0))
    center.fill.solid(); center.fill.fore_color.rgb = _rgb(NAVY); center.line.color.rgb = _rgb(NAVY)
    _set_text(center, "研究决策\n输出", 17, WHITE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    positions = [(.75, 1.7), (9.7, 1.7), (.75, 4.55), (9.7, 4.55)]
    for item, (x, y) in zip(items[:4] or [{"headline": "待完善"}], positions):
        _node_text(slide, item, x, y, 2.9, 1.35, WHITE, ORANGE if y > 4 else CYAN)
        _line(slide, 6.68, 3.34, x + 1.45 - 6.68, y + .68 - 3.34, LINE, 1.2)


def _render_risk(slide, items):
    _rect(slide, 1.25, 1.65, 10.8, 4.95, WHITE, LINE)
    _line(slide, 6.65, 1.65, 0, 4.95, LINE, 1.0); _line(slide, 1.25, 4.12, 10.8, 0, LINE, 1.0)
    labels = ["高影响 / 低概率", "高影响 / 高概率", "低影响 / 低概率", "低影响 / 高概率"]
    positions = [(1.55, 1.9), (6.95, 1.9), (1.55, 4.35), (6.95, 4.35)]
    for index, ((x, y), label) in enumerate(zip(positions, labels)):
        _textbox(slide, label, x, y, 2.2, .3, 10, ORANGE if index == 1 else MUTED, True)
        if index < len(items): _node_text(slide, items[index], x, y + .48, 4.5, 1.25, LIGHT_ORANGE if index == 1 else PAPER, ORANGE if index == 1 else CYAN)


def _render_product_cover(slide, deck, data):
    _render_cover(slide, deck, data)
    # Editable product silhouette: intentionally generic and labelled as an illustration.
    body = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.35), Inches(1.18), Inches(2.25), Inches(3.95))
    body.fill.solid(); body.fill.fore_color.rgb = _rgb("214661"); body.line.color.rgb = _rgb(CYAN); body.line.width = Pt(1.2)
    bowl = slide.shapes.add_shape(MSO_SHAPE.ARC, Inches(8.92), Inches(4.36), Inches(3.1), Inches(1.15))
    bowl.fill.solid(); bowl.fill.fore_color.rgb = _rgb("1C3B55"); bowl.line.color.rgb = _rgb(CYAN)
    _line(slide, 10.47, 1.55, 0, 2.7, "6BC4CF", 1.0)
    for y in [2.0, 2.42, 2.84]: _line(slide, 9.8, y, 1.35, 0, "4A7089", .8)
    _textbox(slide, "产品示意", 9.35, 5.56, 2.25, .25, 9.5, "B7CADB", False, PP_ALIGN.CENTER)


def _render_context(slide, items):
    items = items[:4]
    x_values = [.62, 3.72, 6.82, 9.92]
    fills = [LIGHT_BLUE, "F1F4F6", LIGHT_CYAN, LIGHT_ORANGE]
    labels = ["MARKET SIGNAL", "USER TENSION", "PRODUCT OPPORTUNITY", "DECISION RISK"]
    accents = [BLUE, MUTED, CYAN, ORANGE]
    for index, (item, x) in enumerate(zip(items, x_values)):
        card = _rect(slide, x, 1.5, 2.82, 4.55, fills[index], "D8E2EA", True)
        card.line.width = Pt(.8)
        _rect(slide, x, 1.5, .08, 4.55, accents[index], accents[index])
        _textbox(slide, labels[index], x + .2, 1.76, 2.35, .25, 9.5, accents[index], True)
        _textbox(slide, item["headline"], x + .2, 2.15, 2.35, .72, 15.5, NAVY, True)
        parts = [part.strip() for part in item["description"].split("｜")]
        section_labels = ["观察信号", "业务含义", "研究响应"]
        for row, value in enumerate(parts[:3]):
            y = 3.05 + row * .88
            _textbox(slide, section_labels[row], x + .2, y, .72, .25, 9.5, accents[index], True)
            _textbox(slide, value.split("：", 1)[-1], x + .92, y - .02, 1.65, .62, 10.5, MUTED)
        if index < 3: _textbox(slide, "→", x + 2.83, 3.55, .26, .35, 16, MUTED, True, PP_ALIGN.CENTER)
    _textbox(slide, "研究判断", .72, 6.34, .85, .28, 10, CYAN, True)
    _textbox(slide, "验证真实需求 × 持续体验 × 商业边界，形成推进、优化或停止的证据。", 1.62, 6.3, 10.65, .34, 12.5, NAVY, True)


def _render_evidence_matrix(slide, items):
    headers = ["业务决策", "核心证据", "判断方式", "对应行动"]
    rows = []
    for item in items[:5]:
        parts = item["description"].split("｜", 1)
        rows.append([item.get("label") or item["headline"], item["headline"], parts[0], parts[1] if len(parts) > 1 else "形成对应行动"])
    shape = slide.shapes.add_table(len(rows) + 1, 4, Inches(.64), Inches(1.58), Inches(12.05), Inches(4.55))
    table = shape.table
    widths = [2.15, 3.2, 3.45, 3.25]
    for col, width in enumerate(widths): table.columns[col].width = Inches(width)
    for col, header in enumerate(headers):
        cell = table.cell(0, col); cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(NAVY)
        _set_text(cell, header, 11, WHITE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE, .08)
    for row_index, row in enumerate(rows, 1):
        for col, value in enumerate(row):
            cell = table.cell(row_index, col); cell.fill.solid(); cell.fill.fore_color.rgb = _rgb(WHITE if row_index % 2 else LIGHT_BLUE)
            _set_text(cell, value, 10, NAVY if col == 0 else INK, col == 0, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, .08)
    # Keep the matrix compact and use the lower band for the decision rule, rather
    # than stretching sparse rows to fill the slide.
    _rect(slide, .64, 6.28, 12.05, .5, LIGHT_CYAN, "B7E4E8", True)
    _textbox(slide, "判断原则", .83, 6.39, .78, .24, 9.5, CYAN, True)
    _textbox(slide, "优先使用相对比较；有历史基准时校准阈值；无统一通过线时由客户内部标准完成最终裁决。", 1.65, 6.35, 10.75, .3, 10.5, NAVY, True)


def _render_dual_flow(slide, items):
    items = items[:5]; gap = .18; w = 2.25
    for index, item in enumerate(items):
        x = .65 + index * (w + gap)
        _textbox(slide, f"0{index + 1}", x, 1.55, .48, .4, 18, CYAN, True)
        _textbox(slide, item["headline"], x, 2.05, w, .52, 15, NAVY, True)
        _textbox(slide, item["description"], x, 2.72, w, 1.25, 10.5, MUTED)
        _rect(slide, x, 4.2, w, .62, LIGHT_BLUE if index % 2 == 0 else LIGHT_CYAN, LINE)
        _textbox(slide, "阶段输出", x + .12, 4.32, .7, .25, 9, MUTED, True)
        _textbox(slide, item["description"].split("，")[-1], x + .84, 4.29, 1.28, .3, 9.5, NAVY, True)
        if index < len(items) - 1: _line(slide, x + w, 2.32, gap, 0, CYAN, 1.6, True)
    _textbox(slide, "业务假设", .65, 5.5, 1.5, .3, 11, MUTED, True)
    _line(slide, 1.75, 5.66, 9.95, 0, LINE, 1.0, True)
    _textbox(slide, "上市行动", 11.25, 5.5, 1.3, .3, 11, CYAN, True, PP_ALIGN.RIGHT)


def _render_qualitative(slide, items):
    groups = [("访问谁", items[:2], .68, BLUE), ("讨论什么", items[2:4], 4.72, CYAN), ("输出什么", items[4:6], 8.76, ORANGE)]
    for title, values, x, accent in groups:
        _textbox(slide, title, x, 1.55, 3.35, .36, 15, accent, True)
        _line(slide, x, 2.0, 3.35, 0, accent, 1.6)
        for row, item in enumerate(values or [{"headline": "待完善", "description": ""}]):
            y = 2.25 + row * 1.62
            card = _rect(slide, x, y, 3.35, 1.38, WHITE, "D8E2EA", True)
            card.line.width = Pt(.8)
            _rect(slide, x, y, .07, 1.38, accent, accent)
            _textbox(slide, item["headline"], x + .18, y + .16, 2.98, .38, 13.5, NAVY, True)
            _textbox(slide, item["description"], x + .18, y + .62, 2.98, .58, 10.2, MUTED)
    _textbox(slide, "→", 4.13, 3.25, .5, .35, 16, MUTED, True, PP_ALIGN.CENTER)
    _textbox(slide, "→", 8.17, 3.25, .5, .35, 16, MUTED, True, PP_ALIGN.CENTER)
    _rect(slide, .68, 5.65, 11.43, .86, LIGHT_BLUE, "C9D9EA", True)
    _textbox(slide, "设计守则", .9, 5.84, .82, .28, 10, BLUE, True)
    rules = [("场景真实", "在真实补水与清洁任务中观察行为"), ("刺激可比", "概念、功能与价格材料保持同等信息量"), ("输出可测", "每条发现都转译为问卷选项或待验证假设")]
    for index, (label, value) in enumerate(rules):
        x = 1.82 + index * 3.46
        _textbox(slide, label, x, 5.79, .78, .28, 10, NAVY, True)
        _textbox(slide, value, x + .8, 5.75, 2.45, .42, 9.5, MUTED)


def _render_sample_architecture(slide, items):
    if not items: return
    _rect(slide, 4.45, 1.52, 4.45, .72, NAVY, NAVY, True); _textbox(slide, f"{items[0]['headline']}  {items[0]['description'].split('；')[0]}", 4.65, 1.72, 4.05, .3, 13, WHITE, True, PP_ALIGN.CENTER)
    branches = items[1:3]
    for index, item in enumerate(branches):
        x = 1.0 + index * 6.35
        _line(slide, 6.67, 2.24, x + 2.4 - 6.67, .55, LINE, 1.3)
        _rect(slide, x, 2.78, 4.8, 1.1, LIGHT_BLUE if index == 0 else LIGHT_CYAN, BLUE if index == 0 else CYAN)
        _textbox(slide, item["headline"], x + .2, 2.98, 1.25, .35, 14, NAVY, True)
        _textbox(slide, item["description"], x + 1.45, 2.92, 3.1, .7, 10.5, MUTED)
    for index, item in enumerate(items[3:6]):
        x = .8 + index * 4.15
        _textbox(slide, item["headline"], x, 4.45, 3.7, .38, 13, [BLUE, CYAN, ORANGE][index], True)
        _textbox(slide, item["description"], x, 4.95, 3.7, 1.05, 10.5, MUTED)
    _textbox(slide, "样本量来自用户输入或方案计算；概念分配与配额为建议方案，正式执行前待客户确认。", .8, 6.2, 11.7, .3, 9.5, ORANGE, True)


def _render_questionnaire_journey(slide, items):
    items = items[:7]
    positions = [(.62, 1.52), (3.72, 1.52), (6.82, 1.52), (9.92, 1.52), (2.17, 4.12), (5.27, 4.12), (8.37, 4.12)]
    for index, (item, (x, y)) in enumerate(zip(items, positions)):
        fill = LIGHT_BLUE if index % 3 == 0 else (LIGHT_CYAN if index % 3 == 1 else WHITE)
        card = _rect(slide, x, y, 2.82, 2.2, fill, "D8E2EA", True); card.line.width = Pt(.8)
        _textbox(slide, str(index + 1).zfill(2), x + .16, y + .16, .42, .28, 10, CYAN, True)
        _textbox(slide, item["headline"], x + .62, y + .14, 1.96, .38, 13, NAVY, True)
        parts = [part.strip() for part in item["description"].split("｜")]
        for row, part in enumerate(parts[:4]):
            label, _, value = part.partition("：")
            _textbox(slide, label or ["指标", "决策", "方法", "输出"][row], x + .16, y + .62 + row * .36, .44, .24, 8.5, [BLUE, CYAN, MUTED, ORANGE][row], True)
            _textbox(slide, value or part, x + .64, y + .59 + row * .36, 1.98, .3, 10, MUTED)
        if index < 3: _textbox(slide, "→", x + 2.83, y + .9, .26, .3, 14, MUTED, True, PP_ALIGN.CENTER)
    _textbox(slide, "定量问卷从行为基线出发，经概念与卖点验证，最终落到价格、人群和触达策略。", .72, 6.62, 11.8, .3, 11, NAVY, True, PP_ALIGN.CENTER)


def _example_header(slide):
    _textbox(slide, EXAMPLE_LABEL, 9.25, 1.46, 3.45, .28, 10, ORANGE, True, PP_ALIGN.RIGHT)
    _textbox(slide, DISCLAIMER, .65, 6.78, 12.0, .25, 8.5, MUTED)


def _native_bar_chart(slide, categories, values, x, y, w, h, colors, maximum=None, value_suffix=""):
    """Add a PowerPoint-native bar chart with an embedded editable workbook."""
    data = ChartData()
    # PowerPoint renders the first horizontal-bar category at the bottom. Reverse
    # the data so the semantic order supplied by the planner remains top-down.
    render_categories = list(reversed(categories))
    render_values = list(reversed(values))
    render_colors = list(reversed(colors))
    data.categories = render_categories
    data.add_series("示例值", render_values)
    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.BAR_CLUSTERED, Inches(x), Inches(y), Inches(w), Inches(h), data
    ).chart
    chart.has_title = False
    chart.has_legend = False
    chart.chart_style = 10
    chart.font.name = "微软雅黑"
    chart.font.size = Pt(9.5)
    series = chart.series[0]
    series.format.fill.solid()
    series.format.fill.fore_color.rgb = _rgb(CYAN)
    try:
        series.gap_width = 65
    except Exception:
        pass
    for point, color in zip(series.points, render_colors):
        point.format.fill.solid()
        point.format.fill.fore_color.rgb = _rgb(color)
        point.format.line.fill.background()
    series.has_data_labels = True
    labels = series.data_labels
    labels.show_value = True
    labels.position = XL_LABEL_POSITION.OUTSIDE_END
    labels.number_format = f'0"{value_suffix}"' if value_suffix else "0"
    labels.number_format_is_linked = False
    labels.font.name = "微软雅黑"
    labels.font.size = Pt(9.5)
    labels.font.bold = True
    labels.font.color.rgb = _rgb(MUTED)
    cat_axis = chart.category_axis
    cat_axis.visible = True
    cat_axis.major_tick_mark = XL_TICK_MARK.NONE
    cat_axis.minor_tick_mark = XL_TICK_MARK.NONE
    cat_axis.tick_labels.font.name = "微软雅黑"
    cat_axis.tick_labels.font.size = Pt(10)
    cat_axis.tick_labels.font.color.rgb = _rgb(NAVY)
    cat_axis.format.line.fill.background()
    val_axis = chart.value_axis
    val_axis.minimum_scale = 0
    if maximum is not None:
        val_axis.maximum_scale = maximum
    val_axis.visible = False
    val_axis.has_major_gridlines = False
    val_axis.format.line.fill.background()
    return chart


def _native_line_chart(slide, categories, values, x, y, w, h, maximum=100):
    """Add a PowerPoint-native line chart with editable categories and values."""
    data = ChartData()
    data.categories = categories
    data.add_series("购买意愿", values)
    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.LINE_MARKERS, Inches(x), Inches(y), Inches(w), Inches(h), data
    ).chart
    chart.has_title = False
    chart.has_legend = False
    chart.chart_style = 10
    chart.font.name = "微软雅黑"
    chart.font.size = Pt(9)
    series = chart.series[0]
    series.format.line.color.rgb = _rgb(CYAN)
    series.format.line.width = Pt(2)
    series.marker.style = XL_MARKER_STYLE.CIRCLE
    series.marker.size = 7
    series.marker.format.fill.solid()
    series.marker.format.fill.fore_color.rgb = _rgb(CYAN)
    series.marker.format.line.color.rgb = _rgb(CYAN)
    series.has_data_labels = True
    labels = series.data_labels
    labels.show_value = True
    labels.position = XL_LABEL_POSITION.ABOVE
    labels.number_format = '0"%"'
    labels.number_format_is_linked = False
    labels.font.name = "微软雅黑"
    labels.font.size = Pt(8.5)
    labels.font.bold = True
    labels.font.color.rgb = _rgb(NAVY)
    cat_axis = chart.category_axis
    cat_axis.visible = True
    cat_axis.major_tick_mark = XL_TICK_MARK.NONE
    cat_axis.minor_tick_mark = XL_TICK_MARK.NONE
    cat_axis.tick_labels.font.name = "微软雅黑"
    cat_axis.tick_labels.font.size = Pt(8.5)
    cat_axis.tick_labels.font.color.rgb = _rgb(MUTED)
    cat_axis.format.line.color.rgb = _rgb(LINE)
    val_axis = chart.value_axis
    val_axis.minimum_scale = 0
    val_axis.maximum_scale = maximum
    val_axis.visible = False
    val_axis.has_major_gridlines = False
    val_axis.format.line.fill.background()
    return chart


def _render_concept_example(slide, dataset, framework_only=False):
    _example_header(slide)
    _textbox(slide, "概念表现漏斗", .7, 1.55, 5.7, .35, 15, NAVY, True)
    _textbox(slide, "卖点优先级（MaxDiff示例）", 7.05, 1.55, 5.5, .35, 15, NAVY, True)
    if framework_only or not dataset:
        _textbox(slide, "正确理解 → 相关性 → 独特性 → 可信度 → 购买意愿", .8, 2.35, 5.3, 2.6, 16, MUTED, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        _textbox(slide, "未来将展示卖点相对重要性及优先级", 7.15, 2.35, 5.0, 2.6, 15, MUTED, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
        return
    metric_labels = ["正确理解", "相关性", "独特性", "技术可信度", "购买意愿"]
    metric_values = list(dataset["metrics"].values())
    _native_bar_chart(slide, metric_labels, metric_values, .72, 1.95, 5.65, 4.35,
                      [CYAN, CYAN, CYAN, CYAN, ORANGE], 100, "%")
    selling_labels = list(dataset["selling_point_scores"].keys())
    selling_values = list(dataset["selling_point_scores"].values())
    _native_bar_chart(slide, selling_labels, selling_values, 7.02, 1.95, 5.2, 4.35,
                      [CYAN, CYAN, BLUE, BLUE, BLUE], max(selling_values) * 1.2)


def _render_pricing_example(slide, dataset, framework_only=False):
    _example_header(slide)
    _textbox(slide, "价格—购买意愿曲线", .7, 1.55, 5.8, .35, 15, NAVY, True)
    _textbox(slide, "机会人群购买意愿", 7.15, 1.55, 5.2, .35, 15, NAVY, True)
    if framework_only or not dataset:
        _textbox(slide, "未来将展示不同价格点的购买概率", 1.35, 3.25, 4.7, .6, 14, MUTED, True, PP_ALIGN.CENTER)
        _textbox(slide, "未来将比较机会人群的购买意愿", 7.4, 3.25, 4.7, .6, 14, MUTED, True, PP_ALIGN.CENTER)
        return
    curve = dataset["pricing"]["purchase_curve"]
    _native_line_chart(slide, [f"¥{point['price']}" for point in curve],
                       [point["intention"] for point in curve], 1.0, 1.95, 5.45, 3.85, 70)
    segments = dataset["segment_purchase_intention"]
    segment_labels = list(segments.keys())
    segment_values = list(segments.values())
    _native_bar_chart(slide, segment_labels, segment_values, 7.08, 1.95, 5.2, 3.85,
                      [CYAN, CYAN, BLUE, BLUE], 100, "%")
    pricing = dataset["pricing"]
    _textbox(slide, f"测试价位覆盖 ¥{curve[0]['price']}—¥{curve[-1]['price']}｜示例可接受区间 ¥{pricing['acceptable_low']}—¥{pricing['acceptable_high']}｜最优价位 ¥{pricing['optimal_price']}", 1.0, 6.02, 5.7, .42, 9.5, ORANGE, True)


def _render_decision_output(slide, items):
    stages = [("研究指标", "需求、概念、卖点、价格、人群"), ("分析模型", "漏斗、MaxDiff、PSM、驱动、细分"), ("关键发现", "总体规律、差异与关键障碍"), ("业务行动", "产品、价格、人群与营销动作")]
    for index, (label, description) in enumerate(stages):
        x = .65 + index * 3.0
        _textbox(slide, f"0{index + 1}  {label}", x, 1.55, 2.65, .38, 14, [BLUE, CYAN, NAVY, ORANGE][index], True)
        _textbox(slide, description, x, 2.06, 2.65, .7, 10.5, MUTED)
        if index < 3: _textbox(slide, "→", x + 2.62, 1.72, .35, .3, 14, MUTED, True, PP_ALIGN.CENTER)
    _textbox(slide, "最终形成七类上市结论", .65, 3.02, 3.2, .35, 13, NAVY, True)
    for index, item in enumerate(items[:7]):
        x = .65 + index * 1.73
        _textbox(slide, str(index + 1).zfill(2), x, 3.62, .35, .28, 10, CYAN, True)
        _textbox(slide, item["headline"], x, 4.02, 1.5, .62, 12.5, NAVY, True)
        _textbox(slide, item["description"], x, 4.78, 1.5, 1.25, 9.5, MUTED)


def _render_real_gantt(slide, tasks, items):
    tasks = tasks[:8]; x0, day_w = 3.02, .54; y0, row_h = 1.92, .49
    _textbox(slide, "阶段", .62, 1.56, 2.15, .28, 10, MUTED, True)
    for day in range(1, 15): _textbox(slide, f"D{day}", x0 + (day - 1) * day_w, 1.56, day_w, .28, 8.5, MUTED, True, PP_ALIGN.CENTER)
    for index, task in enumerate(tasks):
        y = y0 + index * row_h
        _textbox(slide, task.get("task"), .62, y + .05, 2.15, .25, 9.5, NAVY, True)
        for day in range(1, 15): _rect(slide, x0 + (day - 1) * day_w, y, day_w, .36, "F0F3F6", "E2E8ED")
        start, end = int(task.get("start_day") or 1), int(task.get("end_day") or 1)
        _rect(slide, x0 + (start - 1) * day_w + .03, y + .04, (end - start + 1) * day_w - .06, .28, CYAN if index % 2 else BLUE, CYAN if index % 2 else BLUE, True)
        if task.get("deliverable"): _textbox(slide, task["deliverable"], 10.9, y + .04, 1.55, .25, 8, MUTED)
    _textbox(slide, "关键交付", 10.9, 1.56, 1.55, .28, 9, MUTED, True)
    if items:
        _textbox(slide, "客户确认节点", .65, 6.03, 1.25, .26, 9.5, ORANGE, True)
        _textbox(slide, "D2 方案｜D5 工具｜D10 阶段数据", 1.95, 6.03, 3.2, .26, 9.5, NAVY, True)
        _textbox(slide, "风险与依赖", 6.2, 6.03, 1.05, .26, 9.5, ORANGE, True)
        _textbox(slide, items[-1]["description"], 7.35, 6.03, 5.0, .3, 9, MUTED)


def render_proposal_deck(deck: dict, output_path: str) -> dict:
    audit = audit_deck(deck)
    normalized = audit["deck"]
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    prs.core_properties.title = normalized["title"]
    prs.core_properties.subject = "SurveyKit AI 调研方案 PPT"
    prs.core_properties.author = "SurveyKit"
    project_short = normalized["title"][:18]
    for page_no, data in enumerate(normalized["slides"], 1):
        slide = _base_slide(prs, data, page_no, project_short)
        visual = data["visual_type"]
        items = data["content"]
        if visual == "cover_product_hero": _render_product_cover(slide, normalized, data)
        elif visual == "context_tension_map": _render_context(slide, items)
        elif visual == "decision_tree": _render_decision_tree(slide, items)
        elif visual == "evidence_threshold_matrix": _render_evidence_matrix(slide, items)
        elif visual == "dual_track_research_flow": _render_dual_flow(slide, items)
        elif visual == "qualitative_design_canvas": _render_qualitative(slide, items)
        elif visual == "quantitative_sample_architecture": _render_sample_architecture(slide, items)
        elif visual == "questionnaire_decision_journey": _render_questionnaire_journey(slide, items)
        elif visual == "concept_funnel_maxdiff_example": _render_concept_example(slide, normalized.get("illustrative_dataset"), data["data_status"] != "illustrative")
        elif visual == "pricing_segment_example": _render_pricing_example(slide, normalized.get("illustrative_dataset"), data["data_status"] != "illustrative")
        elif visual == "decision_output_map": _render_decision_output(slide, items)
        elif visual == "timeline_gantt_risk": _render_real_gantt(slide, data.get("timeline_tasks") or [], items)
        elif visual in {"plan_comparison", "pricing_table"}: _render_matrix(slide, items)
        elif visual == "risk_matrix": _render_risk(slide, items)
        else: _render_deliverables(slide, items)
    prs.save(output_path)
    return audit
