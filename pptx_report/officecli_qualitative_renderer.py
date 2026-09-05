"""Deterministic OfficeCLI renderer for SurveyKit qualitative PPT scripts.

The model and the PPT Script decide what to say.  This module only maps that
persisted content into a restrained, technology-blue visual system built from
editable PowerPoint text, shapes, and connectors.
"""
from __future__ import annotations

from io import BytesIO
import re
from typing import Any, Iterable

from pptx import Presentation

from .officecli_runner import OfficeCliRunner
from .qualitative_layouts import resolve_layout_variant
from .qualitative_renderer import _object_counts, layout_adaptations, prepare_pages, validate_script


SLIDE_W, SLIDE_H = 33.87, 19.05
FONT = "Microsoft YaHei"
NAVY = "081A36"
DEEP_BLUE = "0A2A66"
BLUE = "176BFF"
MID_BLUE = "4A8BFF"
CYAN = "37BFF3"
ICE = "F7FAFF"
WHITE = "FFFFFF"
TEXT = "18263D"
MUTED = "6F7D93"
BORDER = "D7E3F2"
PALE = "EAF3FF"
SOFT = "F2F7FD"
RED = "E35D6A"
GREEN = "22A699"
AMBER = "F4A62A"


def _text(value: Any, limit: int = 10_000) -> str:
    return str(value or "").strip()[:limit]


def _display_text(value: Any) -> str:
    """Remove analysis-pipeline shorthand from the client-facing slide copy."""
    text = _text(value)
    replacements = {
        "consumer interviews": "消费者访谈",
        "consumer interview": "消费者访谈",
        "interpretation": "研究解读",
        "evidence gap": "证据缺口",
    }
    for source, target in replacements.items():
        text = re.sub(re.escape(source), target, text, flags=re.IGNORECASE)
    # Python's ``\b`` treats adjacent CJK characters as word characters, so
    # labels such as “两个low置信度断点” were not localized.  Only guard
    # against Latin-letter adjacency instead.
    text = re.sub(r"(?<![A-Za-z])medium(?![A-Za-z])", "中等", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<![A-Za-z])low(?![A-Za-z])", "较低", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<![A-Za-z])weak(?![A-Za-z])", "有限", text, flags=re.IGNORECASE)
    text = re.sub(
        r"逐字原声\s*[（(]\s*transcript[_\s-]+quote\s*[）)]",
        "逐字原声",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"transcript[_\s-]+quote", "逐字原声", text, flags=re.IGNORECASE)
    text = re.sub(r"\bCh\s*(\d+)\b", lambda match: f"第{match.group(1)}章", text, flags=re.IGNORECASE)
    text = re.sub(r"'([^'\n]+)'", r"“\1”", text)
    return text


def _items(value: Any) -> list:
    return value if isinstance(value, list) else []


def _blocks(page: dict) -> list[dict]:
    return [item for item in _items(page.get("content_structure")) if isinstance(item, dict)]


def _findings(page: dict) -> list[str]:
    values = _items(page.get("supporting_findings")) or _items(page.get("supporting_points"))
    return [
        _text(item.get("text") if isinstance(item, dict) else item)
        for item in values
        if _text(item.get("text") if isinstance(item, dict) else item)
    ]


def _block_lines(block: dict) -> list[str]:
    values = _items(block.get("items")) or _items(block.get("points"))
    if values:
        return [
            _text(item.get("text") if isinstance(item, dict) else item)
            for item in values
            if _text(item.get("text") if isinstance(item, dict) else item)
        ]
    body = _text(block.get("body") or block.get("summary") or block.get("statement"), 500)
    return [item.strip() for item in re.split(r"[\n；;]", body) if item.strip()]


def _bullet_text(values: Iterable[Any], *, limit: int = 5) -> str:
    clean = [
        _display_text(item.get("text") if isinstance(item, dict) else item)
        for item in values
        if _text(item.get("text") if isinstance(item, dict) else item)
    ]
    return "\n".join(f"• {item}" for item in clean[:limit]) or "• 待补充"


def _short_heading(value: Any, index: int, *, fallback: str = "发现") -> str:
    """Extract a compact semantic label without inventing research content."""
    raw = re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩\d]+[、.．\s]*", "", _display_text(value)).strip()
    if "｜" in raw:
        raw = raw.split("｜", 1)[0].strip()
    elif re.match(r"^.{1,14}[：:]", raw):
        raw = re.split(r"[：:]", raw, maxsplit=1)[0].strip()
    else:
        clauses = [item.strip() for item in re.split(r"[，。；;]", raw) if item.strip()]
        raw = clauses[0] if clauses else raw
    return _text(raw, 18) or f"{fallback} {index + 1}"


def _finding_blocks(page: dict, *, fallback: str) -> list[dict]:
    blocks = []
    for index, finding in enumerate(_findings(page)):
        displayed = _display_text(finding)
        title = _short_heading(displayed, index, fallback=fallback)
        match = re.match(r"^.{1,14}[：:]\s*(.+)$", displayed)
        body = match.group(1).strip() if match else displayed
        # These are synthesized findings, not verbatim quote cards. Removing a
        # decorative quote pair before an em dash prevents an orphan closing
        # quote on narrow diagnostic branches without altering the wording.
        body = re.sub(r"^[“\"](.+?)[”\"](?=——)", r"\1", body)
        blocks.append({"title": title, "items": [body]})
    return blocks


def _journey_blocks(page: dict, *, limit: int = 5) -> list[dict]:
    """Prefer real stage definitions over legacy blocks that describe a visual."""
    blocks = _blocks(page)[:limit]
    if len(blocks) < 3:
        for candidate in blocks:
            parsed: list[dict] = []
            for stage in re.split(r"[；;]", _text(candidate.get("body"))):
                match = re.match(r"\s*阶段[一二三四五六七八九十\d]+[：:]\s*([^—–-]+)[—–-](.+)\s*", stage)
                if match:
                    parsed.append({"title": match.group(1).strip(), "items": [match.group(2).strip()]})
            if len(parsed) >= 3:
                return parsed[:limit]
    if not blocks:
        return _finding_blocks(page, fallback="阶段")[:limit]
    return blocks


def _balanced_bullet_text(values: Iterable[Any], *, limit: int = 5) -> str:
    """Wrap long Chinese bullets at punctuation instead of inside a key term."""
    balanced = []
    for raw in values:
        value = _text(raw.get("text") if isinstance(raw, dict) else raw)
        if len(value) > 16:
            candidates = [index + 1 for index, char in enumerate(value) if char in "，；"]
            if candidates:
                split_at = min(candidates, key=lambda index: abs(index - len(value) / 2))
                value = f"{value[:split_at]}\n  {value[split_at:]}"
        if value:
            balanced.append(value)
    return _bullet_text(balanced, limit=limit)


def _human_source(page: dict) -> str:
    source = _text(page.get("source_notes"), 260)
    if not source:
        labels = []
        for quote in _items(page.get("quotes")):
            if not isinstance(quote, dict):
                continue
            label = _text(quote.get("source_label") or quote.get("respondent_label"), 80)
            if label and label not in labels:
                labels.append(label)
        source = "；".join(labels) or "项目访谈与定性分析"
    if any(marker in source.lower() for marker in ("evidence_", "segment_", "artifact_", "insight_")):
        source = "项目访谈与定性分析"
    return f"来源：{_display_text(source)}"


def _speaker_notes(page: dict) -> str:
    evidence = "、".join(_text(item, 100) for item in _items(page.get("evidence_ids"))) or "无"
    segment_ids = []
    for quote in _items(page.get("quotes")):
        if isinstance(quote, dict) and _text(quote.get("segment_id")):
            segment_ids.append(_text(quote.get("segment_id"), 100))
    segments = "、".join(dict.fromkeys(segment_ids)) or "无"
    quote_texts = [
        _text(quote.get("text"))
        for quote in _items(page.get("quotes"))
        if isinstance(quote, dict) and _text(quote.get("text"))
    ]
    return "\n".join(
        [
            f"Purpose: {_text(page.get('purpose')) or '未填写'}",
            f"Key message: {_text(page.get('key_message')) or _text(page.get('title'))}",
            f"Evidence IDs: {evidence}",
            f"Transcript segment IDs: {segments}",
            f"Full quotes: {' | '.join(quote_texts) or '无'}",
            f"Layout variant: {_text(page.get('_resolved_layout_variant') or page.get('layout_variant') or page.get('variant')) or 'default'}",
            f"Transition: {_text(page.get('transition')) or '无'}",
        ]
    )


def _balanced_title(value: Any, min_length: int = 27) -> str:
    """Prefer a deliberate two-line title over a one-character orphan line."""
    title = _text(value)
    if len(title) <= min_length or "\n" in title:
        return title
    midpoint = len(title) / 2
    candidates = [
        index + 1
        for index, char in enumerate(title)
        if char in "，：；、" and len(title) * 0.32 <= index <= len(title) * 0.68
    ]
    if not candidates:
        return title
    split_at = min(candidates, key=lambda index: abs(index - midpoint))
    return f"{title[:split_at]}\n{title[split_at:]}"


def _density_font(
    value: Any,
    base: float,
    *,
    medium_at: int,
    long_at: int,
    medium: float,
    long: float,
) -> float:
    """Choose a readable starting size before OfficeCLI applies its safety fit."""
    length = len(_text(value).replace("\n", ""))
    if length > long_at:
        return long
    if length > medium_at:
        return medium
    return base


class OfficeCliDeckBuilder:
    """Small command builder; all values remain auditable JSON operations."""

    def __init__(self) -> None:
        self.commands: list[dict[str, Any]] = []
        self.slide_index = 0
        self._shape_index = 0

    @property
    def parent(self) -> str:
        return f"/slide[{self.slide_index}]"

    @staticmethod
    def _cm(value: float) -> str:
        return f"{value:.3f}cm"

    def slide(self, name: str, background: str = ICE) -> None:
        self.slide_index += 1
        self._shape_index = 0
        self.commands.append(
            {
                "command": "add",
                "parent": "/",
                "type": "slide",
                "props": {"layout": "blank", "name": name, "background": background},
            }
        )

    def shape(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        *,
        name: str | None = None,
        preset: str | None = None,
        fill: str | None = "none",
        line: str | None = "none",
        gradient: str | None = None,
        opacity: float | None = None,
        line_opacity: float | None = None,
        shadow: str | None = None,
        text: Any = None,
        size: float = 18,
        color: str = TEXT,
        bold: bool = False,
        italic: bool = False,
        align: str = "left",
        valign: str = "top",
        margin: float = 0.12,
        radius_adj: str | None = None,
        spacing: float | None = None,
        line_spacing: str | None = None,
        auto_fit: str | None = "shrink",
    ) -> None:
        self._shape_index += 1
        props: dict[str, Any] = {
            "name": name or f"native_shape_{self._shape_index}",
            "x": self._cm(x),
            "y": self._cm(y),
            "width": self._cm(width),
            "height": self._cm(height),
        }
        if preset:
            props["preset"] = preset
        if fill is not None:
            props["fill"] = fill
        if line is not None:
            props["line"] = line
        if gradient:
            props["gradient"] = gradient
            props.pop("fill", None)
        if opacity is not None:
            props["opacity"] = str(opacity)
        if line_opacity is not None:
            props["lineOpacity"] = str(line_opacity)
        if shadow:
            props["shadow"] = shadow
        if radius_adj:
            props["adj"] = radius_adj
        if text is not None:
            props.update(
                {
                    "text": _display_text(text),
                    "font": FONT,
                    "font.ea": FONT,
                    "size": f"{size:g}pt",
                    "color": color,
                    "bold": str(bool(bold)).lower(),
                    "italic": str(bool(italic)).lower(),
                    "align": align,
                    "valign": valign,
                    "margin": self._cm(margin),
                }
            )
            if spacing is not None:
                props["spacing"] = str(spacing)
            if line_spacing:
                props["lineSpacing"] = line_spacing
            if auto_fit:
                props["autoFit"] = auto_fit
        self.commands.append({"command": "add", "parent": self.parent, "type": "shape", "props": props})

    def connector(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        *,
        color: str = MID_BLUE,
        line_width: float = 1.5,
        arrow: str = "tailEnd",
        dashed: bool = False,
    ) -> None:
        self._shape_index += 1
        reversed_direction = False
        if width < 0:
            x += width
            width = abs(width)
            reversed_direction = True
        if height < 0:
            y += height
            height = abs(height)
            reversed_direction = True
        if reversed_direction and arrow == "tailEnd":
            arrow = "headEnd"
        props: dict[str, Any] = {
            "name": f"editable_connector_{self._shape_index}",
            "x": self._cm(x),
            "y": self._cm(y),
            "width": self._cm(width),
            "height": self._cm(height),
            "shape": "straight",
            "color": color,
            "lineWidth": f"{line_width:g}pt",
        }
        if arrow:
            props[arrow] = "triangle"
        if dashed:
            props["dash"] = "dash"
        self.commands.append({"command": "add", "parent": self.parent, "type": "connector", "props": props})

    def notes(self, value: str) -> None:
        self.commands.append({"command": "add", "parent": self.parent, "type": "notes", "props": {"text": value}})


def _page_label(page_type: str) -> str:
    labels = {
        "navigation": "QUALITATIVE RESEARCH",
        "section_intro": "SECTION",
        "executive_summary": "EXECUTIVE SUMMARY",
        "qualitative_summary": "SUMMARY",
        "qualitative_insight": "KEY INSIGHT",
        "quote_evidence": "VOICE OF CUSTOMER",
        "theme_summary": "THEME SYNTHESIS",
        "segment_comparison": "SEGMENT COMPARISON",
        "competitor_comparison": "COMPETITIVE VIEW",
        "comparison": "COMPARISON",
        "case_study": "CASE STUDY",
        "journey": "USER JOURNEY",
        "framework": "FRAMEWORK",
        "research_framework": "RESEARCH DESIGN",
        "segmentation_map": "SEGMENTATION",
        "persona": "PERSONA",
        "evidence_diagnostic": "EVIDENCE DIAGNOSTIC",
        "concept_definition": "CONCEPT DEFINITION",
        "needs_pyramid": "NEEDS PYRAMID",
        "priority_matrix": "PRIORITY MATRIX",
        "matrix": "DECISION MATRIX",
        "problem_reason": "DIAGNOSIS",
        "recommendation": "ACTION PLAN",
    }
    return labels.get(page_type, "RESEARCH INSIGHT")


def _title(builder: OfficeCliDeckBuilder, page: dict) -> None:
    page_type = _text(page.get("page_type"))
    label = _page_label(page_type)
    builder.shape(1.35, 0.72, max(3.5, min(8.0, 0.32 * len(label) + 1.3)), 0.78,
                  name="semantic_tag", preset="roundRect", fill=PALE, line="none",
                  text=label, size=11.5, color=BLUE, bold=True, align="center", valign="middle", margin=0)
    raw_title = _display_text(page.get("title"))
    title = _balanced_title(raw_title)
    size = 21.5 if len(raw_title) > 62 else 22 if len(raw_title) > 48 else 24.5 if len(raw_title) > 36 else 27 if len(raw_title) > 28 else 31
    builder.shape(1.35, 1.45, 29.6, 3.05, name="slide_title", text=title,
                  size=size, color=NAVY, bold=True, valign="middle", margin=0)
    builder.shape(31.0, 0.72, 1.55, 0.68, text=f"{int(page.get('page_number') or 0):02d}",
                  size=13, color=MUTED, bold=True, align="right", margin=0)


def _footer(builder: OfficeCliDeckBuilder, page: dict) -> None:
    builder.shape(1.35, 18.03, 22.0, 0.56, name="visible_source", text=_human_source(page),
                  size=10.5, color=MUTED, margin=0)
    label = _text(page.get("evidence_label"), 40)
    if label:
        builder.shape(24.0, 18.00, 8.5, 0.80, name="evidence_chip", preset="roundRect",
                      fill=PALE, line="none", text=label, size=10.5, color=BLUE,
                      bold=True, align="center", valign="middle", margin=0)


def _card(
    builder: OfficeCliDeckBuilder,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    lines: Iterable[Any],
    *,
    index: int = 1,
    fill: str = WHITE,
    title_color: str = NAVY,
    accent: str = BLUE,
    body_size: float = 17,
    shadow: bool = True,
) -> None:
    builder.shape(x, y, width, height, name=f"content_card_{index}", preset="roundRect", fill=fill,
                  line=f"{BORDER}:1", shadow="0A2A66-4-45-2-10" if shadow else None,
                  radius_adj="adj:val 8000")
    builder.shape(x + 0.45, y + 0.42, 1.05, 0.58, preset="roundRect", fill=accent, line="none",
                  text=f"{index:02d}", size=12, color=WHITE, bold=True, align="center", valign="middle", margin=0)
    builder.shape(x + 1.75, y + 0.33, width - 2.15, 0.86, text=_text(title, 80),
                  size=19, color=title_color, bold=True, valign="middle", margin=0)
    builder.shape(x + 0.55, y + 1.35, width - 1.1, height - 1.72,
                  text=_bullet_text(lines), size=body_size, color=TEXT, line_spacing="1.18x", margin=0.05)


def _render_cover(builder: OfficeCliDeckBuilder, page: dict, report_title: str) -> None:
    builder.slide("Cover", f"{NAVY}-0B4CCB-15")
    builder.shape(23.9, -2.7, 13.8, 13.8, preset="ellipse", fill=CYAN, opacity=0.08, line="none")
    builder.shape(21.4, 2.0, 11.8, 11.8, preset="ellipse", fill="none", line=f"{CYAN}:1.2", line_opacity=0.28)
    builder.shape(23.05, 3.65, 8.5, 8.5, preset="ellipse", fill="none", line="8FD8FF:1", line_opacity=0.38)
    builder.shape(25.2, 5.8, 4.2, 4.2, preset="ellipse", gradient=f"{BLUE}-{CYAN}-45",
                  line=f"{WHITE}:1", line_opacity=0.45, shadow="000000-8-45-4-28",
                  text="INSIGHT", size=18, color=WHITE, bold=True, align="center", valign="middle", margin=0)
    builder.shape(22.5, 6.2, 0.42, 0.42, preset="ellipse", fill=CYAN, line="none", shadow="37BFF3-5-0-0-40")
    builder.shape(30.7, 9.6, 0.3, 0.3, preset="ellipse", fill="8FD8FF", line="none")
    builder.shape(1.6, 1.35, 8.4, 0.9, name="cover_tag", preset="roundRect", fill=WHITE,
                  opacity=0.18, line=f"{WHITE}:1", line_opacity=0.25,
                  text="SURVEYKIT · QUALITATIVE RESEARCH", size=11, color="D8F3FF",
                  bold=True, align="center", valign="middle", margin=0, spacing=0.6)
    cover_title = _text(page.get("title") or report_title)
    builder.shape(1.6, 4.1, 19.4, 4.4, name="cover_title", text=cover_title,
                  size=42 if len(cover_title) <= 18 else 36, color=WHITE, bold=True,
                  valign="middle", margin=0, line_spacing="1.0x")
    subtitle = _text(page.get("subtitle") or page.get("key_message") or report_title)
    builder.shape(1.62, 9.25, 18.5, 2.25, text=subtitle, size=20, color="BDEBFF", margin=0)
    builder.shape(1.62, 15.7, 18.0, 1.0, text="OFFICECLI NATIVE BUILD · EDITABLE ENTERPRISE DECK",
                  size=11, color="91B8E8", margin=0, spacing=0.35)
    builder.shape(0, 18.8, SLIDE_W, 0.25, gradient=f"{BLUE}-{CYAN}-0", line="none")


def _render_section(builder: OfficeCliDeckBuilder, page: dict) -> None:
    builder.slide("Section", f"{NAVY}-0B4CCB-12")
    builder.shape(24.2, 1.2, 11.5, 11.5, preset="ellipse", fill=BLUE, opacity=0.16, line="none")
    builder.shape(27.0, 4.0, 5.8, 5.8, preset="ellipse", fill=CYAN, opacity=0.16, line="none")
    builder.shape(1.6, 2.0, 3.4, 0.8, preset="roundRect", fill=BLUE, line="none",
                  text=f"SECTION {int(page.get('page_number') or 0):02d}", size=12, color=WHITE,
                  bold=True, align="center", valign="middle", margin=0)
    builder.shape(1.6, 5.0, 23.5, 3.6, text=_text(page.get("title")), size=40,
                  color=WHITE, bold=True, valign="middle", margin=0)
    builder.shape(1.62, 10.0, 22.5, 2.3, text=_text(page.get("key_message") or page.get("purpose")),
                  size=21, color="CFE1FF", margin=0)
    builder.shape(1.62, 16.0, 16.0, 0.7, text="SURVEYKIT · QUALITATIVE REPORT",
                  size=11, color="91B8E8", margin=0, spacing=0.4)


def _render_summary(builder: OfficeCliDeckBuilder, page: dict) -> None:
    key_raw = _text(page.get("key_message") or page.get("title"))
    key = _balanced_title(key_raw, 18)
    key_size = _density_font(
        key_raw, 25, medium_at=22, long_at=62, medium=21.5, long=17.5
    )
    builder.shape(1.35, 4.55, 11.8, 12.2, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                  line="none", shadow="0A2A66-8-45-4-18", radius_adj="adj:val 8500")
    builder.shape(2.0, 5.2, 3.2, 0.8, preset="roundRect", fill=WHITE, opacity=0.13,
                  line=f"{WHITE}:1", line_opacity=0.22, text="核心判断", size=12,
                  color="BDEBFF", bold=True, align="center", valign="middle", margin=0)
    builder.shape(2.05, 6.55, 9.8, 6.2, text=key, size=key_size, color=WHITE, bold=True,
                  valign="middle", margin=0, line_spacing="1.16x")
    builder.shape(2.05, 14.65, 5.2, 0.78, preset="roundRect", fill=CYAN, line="none",
                  text="KEY TAKEAWAY", size=11, color=NAVY, bold=True,
                  align="center", valign="middle", margin=0)
    blocks = _blocks(page)
    findings = _findings(page)
    if _text(page.get("page_type")) == "executive_summary" and findings:
        blocks = [{"title": f"关键发现 {index + 1}", "items": [item]} for index, item in enumerate(findings)]
    elif len(blocks) < 2 and len(findings) >= 2:
        blocks = [{"title": f"关键发现 {index + 1}", "items": [item]} for index, item in enumerate(findings)]
    elif not blocks:
        blocks = [{"title": f"关键发现 {index + 1}", "items": [item]} for index, item in enumerate(_findings(page))]
    blocks = blocks[:4]
    gap = 0.38
    card_h = (12.2 - gap * (max(1, len(blocks)) - 1)) / max(1, len(blocks))
    start_y = 4.55
    for index, block in enumerate(blocks):
        y = start_y + index * (card_h + gap)
        builder.shape(14.15, y, 18.35, card_h, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", shadow="0A2A66-4-45-2-10", radius_adj="adj:val 8000")
        builder.shape(14.65, y + 0.47, 1.0, 0.58, preset="roundRect", fill=BLUE if index < 2 else MID_BLUE,
                      line="none", text=f"{index + 1:02d}", size=12, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        block_title = _text(block.get("title") or f"发现 {index + 1}")
        block_title_size = _density_font(
            block_title, 18.5, medium_at=10, long_at=18, medium=16, long=13.5
        )
        if len(blocks) == 1:
            builder.shape(16.05, y + 0.65, 15.5, 1.4, text=block_title,
                          size=21, color=NAVY, bold=True, valign="middle", margin=0)
            builder.shape(16.05, y + 2.55, 15.5, card_h - 3.45,
                          text=_bullet_text(_block_lines(block), limit=4), size=20,
                          color=TEXT, bold=True, valign="middle", margin=0.08, line_spacing="1.15x")
        else:
            builder.shape(16.05, y + 0.3, 6.2, 0.84, text=block_title,
                          size=block_title_size, color=NAVY, bold=True, valign="middle", margin=0)
            body_size = 10.5 if len(blocks) == 3 else 13 if len(blocks) >= 4 else 15
            builder.shape(22.1, y + 0.3, 9.55, card_h - 0.58, text=_bullet_text(_block_lines(block), limit=4),
                          size=body_size, color=TEXT, valign="middle", margin=0.05,
                          line_spacing="1.0x" if len(blocks) == 3 else "1.08x")


def _render_editorial_overview(builder: OfficeCliDeckBuilder, page: dict) -> None:
    """Data-journalism overview: one headline band plus compact evidence briefs."""
    blocks = _blocks(page)
    findings = _findings(page)
    # Older scripts often store a layout-description block while the actual
    # conclusions live in supporting_findings. Turn those conclusions into
    # cards and use any compact block items only as labels.
    if findings and (len(blocks) <= 2 or all(_text(item.get("region")).lower() == "top" for item in blocks)):
        labels = [line for block in blocks for line in _block_lines(block)]
        blocks = [
            {
                "title": _short_heading(labels[index] if index < len(labels) else finding, index),
                "items": [finding],
            }
            for index, finding in enumerate(findings)
        ]
    elif not blocks:
        blocks = _finding_blocks(page, fallback="发现")
    blocks = blocks[:4]
    count = max(1, len(blocks))

    builder.shape(1.35, 4.55, 31.15, 3.05, name="layout_variant_editorial_overview",
                  preset="roundRect", gradient=f"{NAVY}-{BLUE}-0", line="none",
                  shadow="0A2A66-6-45-3-14", radius_adj="adj:val 7500")
    builder.shape(2.0, 4.82, 4.1, 0.62, preset="roundRect", fill=CYAN, line="none",
                  text="NORTH STAR", size=11.5, color=NAVY, bold=True,
                  align="center", valign="middle", margin=0, spacing=0.4)
    headline = _display_text(page.get("key_message") or page.get("title"))
    headline_size = _density_font(headline, 20, medium_at=34, long_at=60, medium=17, long=14.5)
    builder.shape(2.0, 5.65, 22.0, 1.65, text=headline, size=headline_size,
                  color=WHITE, bold=True, valign="middle", margin=0, line_spacing="1.0x")
    builder.shape(25.1, 5.05, 2.4, 1.7, text=f"{count:02d}", size=30,
                  color=WHITE, bold=True, align="right", valign="middle", margin=0)
    builder.shape(27.8, 5.32, 3.7, 1.15, text="关键发现\n形成决策框架", size=11.5,
                  color="BDEBFF", bold=True, valign="middle", margin=0)

    gap = 0.42
    total_w = {1: 27.5, 2: 23.5, 3: 28.0}.get(count, 31.15)
    x0 = (SLIDE_W - total_w) / 2
    card_w = (total_w - gap * (count - 1)) / count
    for index, block in enumerate(blocks):
        x = x0 + index * (card_w + gap)
        builder.shape(x, 8.15, card_w, 6.75, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", shadow="0A2A66-3-45-1-7", radius_adj="adj:val 6500")
        builder.shape(x + 0.42, 8.62, 0.9, 0.9, preset="ellipse",
                      fill=[DEEP_BLUE, BLUE, MID_BLUE, CYAN][index], line="none",
                      text=str(index + 1), size=11, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        block_title = _text(block.get("title") or f"关键发现 {index + 1}")
        if count == 1:
            featured = _display_text(" ".join(_block_lines(block)))
            block_title = _text(re.split(r"[（(]", featured, maxsplit=1)[0], 34) or block_title
        title_size = _density_font(block_title, 17.5, medium_at=11, long_at=19, medium=15, long=13)
        builder.shape(x + 1.55, 8.48, card_w - 1.95, 1.25, text=block_title,
                      size=title_size, color=NAVY, bold=True, valign="middle", margin=0)
        body = _bullet_text(_block_lines(block), limit=3)
        body_size = _density_font(
            body,
            14.5,
            medium_at=44 if count == 3 else 52,
            long_at=76 if count == 3 else 90,
            medium=12.5 if count == 3 else 13,
            long=10.5 if count == 3 else 11.5,
        )
        builder.shape(x + 0.5, 9.95, card_w - 1.0, 4.3, text=body,
                      size=body_size, color=TEXT, margin=0.02, line_spacing="1.18x")
        builder.shape(x + 0.5, 14.42, card_w - 1.0, 0.3, preset="roundRect",
                      fill=[DEEP_BLUE, BLUE, MID_BLUE, CYAN][index], line="none")

    takeaway = _text(page.get("recommendation") or page.get("purpose"))
    builder.shape(3.2, 15.35, 27.5, 1.55, preset="roundRect", fill=PALE,
                  line="none", text=f"行动含义｜{takeaway}", size=15.5,
                  color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0.12)


def _render_framework(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)
    if not blocks:
        blocks = [{"title": f"阶段 {i + 1}", "items": [item]} for i, item in enumerate(_findings(page))]
    blocks = blocks[:5]
    count = max(1, len(blocks))
    x0, total_w, gap = 1.35, 31.15, 0.45
    card_w = (total_w - gap * (count - 1)) / count
    axis_y = 8.05
    builder.connector(2.1, axis_y, 28.8, 0, color="8CB8FF", line_width=2)
    for index, block in enumerate(blocks):
        x = x0 + index * (card_w + gap)
        builder.shape(x + card_w / 2 - 0.36, axis_y - 0.36, 0.72, 0.72,
                      preset="ellipse", fill=CYAN if index in {0, count - 1} else BLUE,
                      line=f"{WHITE}:1", shadow="176BFF-4-0-1-18")
        builder.shape(x, 5.1, card_w, 2.15, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(x + 0.35, 5.42, 0.78, 0.58, preset="roundRect", fill=BLUE, line="none",
                      text=f"{index + 1:02d}", size=11, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        builder.shape(x + 1.35, 5.28, card_w - 1.65, 0.85, text=_text(block.get("title") or f"阶段 {index + 1}"),
                      size=18, color=NAVY, bold=True, valign="middle", margin=0)
        builder.shape(x, 9.0, card_w, 5.65, preset="roundRect", fill=SOFT,
                      line=f"{BORDER}:1", radius_adj="adj:val 8000")
        builder.shape(x + 0.42, 9.55, card_w - 0.84, 4.55,
                      text=_bullet_text(_block_lines(block), limit=4), size=16.5,
                      color=TEXT, margin=0.04, line_spacing="1.18x")
    builder.shape(2.35, 15.2, 28.7, 1.9, preset="roundRect", fill=PALE, line="none",
                  text=f"研究原则｜{_text(page.get('key_message') or page.get('purpose'))}",
                  size=15.5, color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0.18)


def _render_segmentation(builder: OfficeCliDeckBuilder, page: dict) -> None:
    segments = [item for item in _items(page.get("segments")) if isinstance(item, dict)][:6]
    if _text(page.get("variant")) == "positioning_map":
        axes = page.get("axes") if isinstance(page.get("axes"), dict) else {}
        x0, y0, width, height = 1.8, 5.0, 22.6, 10.9
        fills = ["F3F7FF", "EAF3FF", "F8FBFF", "EEF5FF"]
        for index, (qx, qy) in enumerate(((x0, y0), (x0 + width / 2, y0), (x0, y0 + height / 2), (x0 + width / 2, y0 + height / 2))):
            builder.shape(qx, qy, width / 2, height / 2, preset="rect", fill=fills[index], line=f"{WHITE}:1")
        builder.connector(x0, y0 + height, width, 0, color=MUTED, arrow="tailEnd")
        builder.connector(x0, y0 + height, 0, -height, color=MUTED, arrow="tailEnd")
        builder.shape(x0, 4.35, 6.2, 0.58, text=_text(axes.get("y_high") or "专业控制"), size=11.5, color=MUTED, margin=0)
        builder.shape(x0, 16.13, 6.2, 0.58, text=_text(axes.get("x_low") or "记录导向"), size=11.5, color=MUTED, margin=0)
        builder.shape(x0 + width - 6.2, 16.13, 6.2, 0.58, text=_text(axes.get("x_high") or "分享导向"),
                      size=11.5, color=MUTED, align="right", margin=0)
        for index, item in enumerate(segments):
            px = x0 + 0.8 + (width - 1.6) * max(0, min(100, float(item.get("x", 50)))) / 100
            py = y0 + height - 0.8 - (height - 1.6) * max(0, min(100, float(item.get("y", 50)))) / 100
            label_x = px + 0.55 if px + 5.55 <= 24.9 else px - 5.55
            builder.shape(px - 0.45, py - 0.45, 0.9, 0.9, preset="ellipse",
                          gradient=f"{BLUE}-{CYAN}-45", line=f"{WHITE}:1", shadow="176BFF-4-0-1-18")
            builder.shape(label_x, py - 1.02, 5.0, 2.05, preset="roundRect", fill=WHITE,
                           line=f"{BORDER}:1", text=f"{_text(item.get('title'))}\n{_text(item.get('summary'), 50)}",
                           size=12.5, color=NAVY, bold=True, valign="middle", margin=0.14)
        builder.shape(25.35, 5.0, 7.15, 10.9, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                      line="none", shadow="0A2A66-6-45-3-14")
        builder.shape(26.0, 5.68, 5.7, 0.82, text="分群判断", size=16, color="BDEBFF", bold=True, margin=0)
        builder.shape(26.0, 7.05, 5.65, 5.75, text=_text(page.get("key_message")), size=22,
                      color=WHITE, bold=True, valign="middle", margin=0, line_spacing="1.18x")
        builder.shape(26.0, 13.7, 5.6, 1.25, preset="roundRect", fill=CYAN, line="none",
                      text="控制权 × 分享目的", size=13, color=NAVY, bold=True,
                      align="center", valign="middle", margin=0)
        return

    parents: dict[str, list[dict]] = {}
    for item in segments:
        parents.setdefault(_text(item.get("parent")) or "核心人群", []).append(item)
    builder.shape(12.05, 4.7, 9.8, 1.35, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-0",
                  line="none", shadow="0A2A66-5-45-2-14", text=_text(page.get("key_message") or "影像用户分群"),
                  size=21, color=WHITE, bold=True, align="center", valign="middle", margin=0.15)
    parent_items = list(parents.items())[:3]
    group_gap = 0.65
    group_w = (31.15 - group_gap * (len(parent_items) - 1)) / max(1, len(parent_items))
    parent_centers = [
        1.35 + index * (group_w + group_gap) + group_w / 2
        for index in range(len(parent_items))
    ]
    if parent_centers:
        builder.connector(16.95, 6.05, 0, 0.65, color="8CB8FF", arrow="")
        builder.connector(min(parent_centers), 6.7, max(parent_centers) - min(parent_centers), 0,
                          color="8CB8FF", arrow="")
    for p_index, (parent, children) in enumerate(parent_items):
        x = 1.35 + p_index * (group_w + group_gap)
        center = x + group_w / 2
        builder.connector(center, 6.7, 0, 0.55, color="8CB8FF", arrow="")
        builder.shape(x, 7.25, group_w, 1.05, preset="roundRect", fill=PALE, line=f"{MID_BLUE}:1",
                      text=parent, size=17, color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0)
        child_gap = 0.38
        child_w = (group_w - child_gap * (len(children) - 1)) / max(1, len(children))
        child_centers = [x + index * (child_w + child_gap) + child_w / 2 for index in range(len(children))]
        if child_centers:
            builder.connector(center, 8.3, 0, 0.45, color="AFC3DC", arrow="")
            builder.connector(min(child_centers), 8.75, max(child_centers) - min(child_centers), 0,
                              color="AFC3DC", arrow="")
        for c_index, child in enumerate(children):
            cx = x + c_index * (child_w + child_gap)
            builder.connector(cx + child_w / 2, 8.75, 0, 0.55, color="AFC3DC", arrow="")
            builder.shape(cx, 9.3, child_w, 6.2, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                          shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
            builder.shape(cx + 0.45, 9.78, child_w - 0.9, 0.92, text=_text(child.get("title")),
                          size=19, color=NAVY, bold=True, align="center", valign="middle", margin=0)
            builder.shape(cx + 0.55, 11.25, child_w - 1.1, 3.55, text=_text(child.get("summary")),
                          size=16, color=TEXT, align="center", valign="middle", margin=0.1, line_spacing="1.16x")


def _render_persona(builder: OfficeCliDeckBuilder, page: dict) -> None:
    profile = page.get("profile") if isinstance(page.get("profile"), dict) else {}
    attrs = profile.get("attributes") if isinstance(profile.get("attributes"), dict) else {}
    builder.shape(1.35, 4.5, 9.6, 12.2, preset="roundRect", gradient=f"{NAVY}-{BLUE}-35",
                  line="none", shadow="0A2A66-8-45-4-18", radius_adj="adj:val 8500")
    # Use the archetype badge in the avatar so a two-character Chinese name is
    # not repeated immediately above the actual name label.
    initials = _text(profile.get("archetype"), 2) or _text(profile.get("name"), 1) or "TA"
    builder.shape(4.55, 5.2, 3.2, 3.2, preset="ellipse", gradient=f"{BLUE}-{CYAN}-45",
                  line=f"{WHITE}:1", line_opacity=0.45, shadow="000000-6-45-2-22",
                  text=initials, size=24, color=WHITE, bold=True, align="center", valign="middle", margin=0)
    builder.shape(2.2, 8.55, 7.9, 1.15, text=_text(profile.get("name") or "典型用户"),
                  size=24, color=WHITE, bold=True, align="center", margin=0)
    builder.shape(2.2, 9.65, 7.9, 0.72, text=_text(profile.get("archetype")),
                  size=14, color="BDEBFF", bold=True, align="center", margin=0)
    attr_text = "\n".join(f"{key}  ·  {_text(value, 35)}" for key, value in list(attrs.items())[:5])
    builder.shape(2.15, 10.3, 8.0, 4.55, preset="roundRect", fill=WHITE, opacity=0.11,
                  line=f"{WHITE}:1", line_opacity=0.18, text=attr_text, size=15.5,
                  color=WHITE, valign="middle", margin=0.08, line_spacing="1.12x")
    builder.shape(1.75, 15.0, 8.8, 1.6, text=f"画像主张｜{_text(profile.get('motto'), 120)}",
                  size=13, color="D8F3FF", bold=True, align="center", valign="middle", margin=0.05)

    traits = _items(page.get("traits"))
    behaviors = _items(page.get("behaviors"))
    _card(builder, 11.75, 4.5, 10.0, 5.55, "价值观与期待", traits, index=1, body_size=16.5)
    _card(builder, 22.5, 4.5, 10.0, 5.55, "关键行为特征", behaviors, index=2, body_size=16.5)
    quotes = [item for item in _items(page.get("quotes")) if isinstance(item, dict)]
    quote = quotes[0] if quotes else {}
    builder.shape(11.75, 10.75, 20.75, 5.95, preset="roundRect", fill=PALE, line=f"BFD5FF:1",
                  shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
    builder.shape(12.25, 11.15, 1.6, 1.6, preset="ellipse", fill=BLUE, line="none",
                  text="“", size=24, color=WHITE, bold=True, align="center", valign="middle", margin=0)
    builder.shape(14.15, 11.25, 17.45, 3.05, text=_text(quote.get("text") or page.get("key_message")),
                  size=20, color=NAVY, bold=True, valign="middle", margin=0, line_spacing="1.18x")
    builder.shape(14.15, 14.65, 17.45, 0.6, text=_text(quote.get("respondent_label") or quote.get("source_label")),
                  size=12.5, color=MUTED, align="right", margin=0)


def _render_journey(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _journey_blocks(page, limit=6)
    count = max(1, len(blocks))
    focus = {int(value) for value in _items(page.get("focus_stages")) if str(value).isdigit()}
    x0, width, gap = 1.35, 31.15, 0.42
    card_w = (width - gap * (count - 1)) / count
    axis_y = 8.2
    builder.connector(2.0, axis_y, 29.0, 0, color="8CB8FF", line_width=2)
    for index, block in enumerate(blocks, 1):
        x = x0 + (index - 1) * (card_w + gap)
        active = index in focus
        accent = RED if active else BLUE
        builder.shape(x + card_w / 2 - 0.42, axis_y - 0.42, 0.84, 0.84, preset="ellipse",
                      fill=accent, line=f"{WHITE}:1", shadow=f"{accent}-4-0-1-18",
                      text=str(index), size=11, color=WHITE, bold=True, align="center", valign="middle", margin=0)
        builder.shape(x, 5.0, card_w, 2.25, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35" if active else None,
                      fill=PALE if not active else None, line=f"{accent}:1", radius_adj="adj:val 8000",
                      text=_text(block.get("title") or f"阶段 {index}"), size=18, color=WHITE if active else NAVY,
                      bold=True, align="center", valign="middle", margin=0.15)
        builder.shape(x, 9.25, card_w, 5.65, preset="roundRect", fill=WHITE,
                      line=f"{RED if active else BORDER}:1", shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(x + 0.42, 9.85, card_w - 0.84, 4.45, text=_bullet_text(_block_lines(block), limit=4),
                      size=16, color=TEXT, margin=0.03, line_spacing="1.18x")
        if active:
            builder.shape(x + 0.55, 14.08, card_w - 1.1, 0.55, preset="roundRect", fill="FFF0F2", line="none",
                          text="关键摩擦", size=11.5, color=RED, bold=True, align="center", valign="middle", margin=0)
    builder.shape(3.1, 15.25, 27.6, 1.8, preset="roundRect", fill=PALE, line="none",
                  text=f"旅程判断｜{_text(page.get('key_message'))}", size=15, color=DEEP_BLUE,
                  bold=True, align="center", valign="middle", margin=0.1)


def _render_journey_curve(builder: OfficeCliDeckBuilder, page: dict) -> None:
    """Experience path inspired by lifecycle curves, using only native objects."""
    blocks = _journey_blocks(page, limit=5)
    count = max(1, len(blocks))
    focus = {int(value) for value in _items(page.get("focus_stages")) if str(value).isdigit()}
    x_start, x_end = 3.0, 30.6
    step = (x_end - x_start) / max(1, count - 1)
    center = (count - 1) / 2
    points: list[tuple[float, float]] = []
    for index in range(count):
        x = x_start + index * step
        y = 6.95 + abs(index - center) * 0.62
        points.append((x, y))
    for index in range(len(points) - 1):
        x1, y1 = points[index]
        x2, y2 = points[index + 1]
        builder.connector(
            x1, y1, x2 - x1, y2 - y1,
            color="77A8FF", line_width=3,
            arrow="tailEnd" if index == len(points) - 2 else "",
        )
    builder.shape(1.35, 4.65, 2.4, 0.7, name="layout_variant_journey_curve",
                  preset="roundRect", fill=PALE, line="none", text="体验路径",
                  size=11.5, color=BLUE, bold=True, align="center", valign="middle", margin=0)
    card_gap = 0.35
    card_w = (31.15 - card_gap * (count - 1)) / count
    for index, (block, (px, py)) in enumerate(zip(blocks, points), 1):
        active = index in focus
        accent = RED if active else BLUE if index <= 2 else MID_BLUE
        builder.shape(px - 0.52, py - 0.52, 1.04, 1.04, preset="ellipse", fill=accent,
                      line=f"{WHITE}:1", shadow=f"{accent}-4-0-1-16", text=str(index),
                      size=11, color=WHITE, bold=True, align="center", valign="middle", margin=0)
        x = 1.35 + (index - 1) * (card_w + card_gap)
        builder.shape(x, 9.05, card_w, 5.55, preset="roundRect", fill=WHITE,
                      line=f"{accent if active else BORDER}:1", shadow="0A2A66-3-45-1-7",
                      radius_adj="adj:val 6500")
        builder.shape(x + 0.4, 9.5, card_w - 0.8, 0.9,
                      text=_text(block.get("title") or f"阶段 {index}"), size=17,
                      color=accent if active else NAVY, bold=True, align="center",
                      valign="middle", margin=0)
        stage_body = _bullet_text(_block_lines(block), limit=3)
        stage_size = _density_font(stage_body, 14, medium_at=46, long_at=78, medium=12.5, long=11)
        builder.shape(x + 0.42, 10.75, card_w - 0.84, 2.95, text=stage_body,
                      size=stage_size, color=TEXT, margin=0.02, line_spacing="1.16x")
        if active:
            builder.shape(x + 0.55, 13.85, card_w - 1.1, 0.48, preset="roundRect",
                          fill="FFF0F2", line="none", text="关键摩擦", size=10.5,
                          color=RED, bold=True, align="center", valign="middle", margin=0)
    builder.shape(3.2, 15.2, 27.5, 1.7, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-0",
                  line="none", text=f"旅程判断｜{_text(page.get('key_message'))}", size=15.5,
                  color=WHITE, bold=True, align="center", valign="middle", margin=0.12)


def _render_comparison(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)
    if len(blocks) == 1:
        body = _text(blocks[0].get("body"))
        pairs = re.findall(r"([^、，：:]+)[（(]\s*线下([^/）)]+)\s*/\s*线上([^）)]+)[）)]", body)
        if len(pairs) >= 2:
            offline = [f"{dimension.strip()}：{value.strip()}" for dimension, value, _ in pairs]
            online = [f"{dimension.strip()}：{value.strip()}" for dimension, _, value in pairs]
            blocks = [
                {"title": "线上触点", "items": online},
                {"title": "线下触点", "items": offline},
            ]
    if not blocks:
        blocks = [{"title": f"视角 {i + 1}", "items": [item]} for i, item in enumerate(_findings(page))]
    blocks = blocks[:4]
    count = max(1, len(blocks))
    gap = 0.5
    card_w = (31.15 - gap * (count - 1)) / count
    accents = [DEEP_BLUE, BLUE, MID_BLUE, CYAN]
    for index, block in enumerate(blocks):
        x = 1.35 + index * (card_w + gap)
        builder.shape(x, 4.65, card_w, 11.15, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", shadow="0A2A66-5-45-2-11", radius_adj="adj:val 8000")
        builder.shape(x, 4.65, card_w, 2.0, preset="roundRect", gradient=f"{accents[index]}-{BLUE if index == 0 else MID_BLUE}-0",
                      line="none", radius_adj="adj:val 8000", text=_text(block.get("title") or f"对象 {index + 1}"),
                      size=19, color=WHITE, bold=True, align="center", valign="middle", margin=0.15)
        builder.shape(x + 0.55, 7.35, card_w - 1.1, 6.65, text=_bullet_text(_block_lines(block), limit=6),
                      size=16.5 if count <= 2 else 15, color=TEXT, margin=0.04, line_spacing="1.18x")
        builder.shape(x + 0.65, 14.55, card_w - 1.3, 0.65, preset="roundRect", fill=PALE, line="none",
                      text=_display_text(block.get("title") or f"视角 {index + 1}"), size=11, color=BLUE, bold=True,
                      align="center", valign="middle", margin=0)
    builder.shape(4.0, 15.85, 25.9, 1.35, text=f"共同底线｜{_text(page.get('key_message'))}",
                  size=14.5, color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0)


def _render_evidence(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)
    support = blocks[0] if blocks else {"title": "支持证据", "items": _findings(page)[:3]}
    counter = blocks[1] if len(blocks) > 1 else {"title": "反例与边界", "items": _findings(page)[3:6]}
    builder.shape(1.35, 4.5, 31.15, 1.5, preset="roundRect", gradient=f"{NAVY}-{BLUE}-0",
                  line="none", shadow="0A2A66-5-45-2-13", text=_text(page.get("hypothesis") or page.get("key_message")),
                  size=20, color=WHITE, bold=True, align="center", valign="middle", margin=0.2)
    for index, (block, accent, pale, x) in enumerate(((support, BLUE, "EFF5FF", 1.35), (counter, RED, "FFF4F6", 17.15)), 1):
        builder.shape(x, 6.7, 15.35, 7.45, preset="roundRect", fill=pale,
                      line=f"{accent}:1", shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(x + 0.55, 7.18, 1.3, 1.3, preset="ellipse", fill=accent, line="none",
                      text="✓" if index == 1 else "!", size=18, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        builder.shape(x + 2.05, 7.2, 11.9, 1.1, text=_text(block.get("title") or ("支持证据" if index == 1 else "反例与边界")),
                      size=21, color=accent, bold=True, valign="middle", margin=0)
        builder.shape(x + 0.75, 9.0, 13.8, 4.25, text=_bullet_text(_block_lines(block), limit=5),
                      size=17, color=TEXT, margin=0.04, line_spacing="1.2x")
    verdict = _text(page.get("verdict") or page.get("recommendation") or page.get("purpose"))
    builder.shape(3.15, 14.85, 27.55, 1.55, preset="roundRect", fill=PALE, line=f"BFD5FF:1",
                  text=f"综合判断｜{verdict}", size=18, color=DEEP_BLUE, bold=True,
                  align="center", valign="middle", margin=0.18)


def _render_definition(builder: OfficeCliDeckBuilder, page: dict) -> None:
    layers = [item for item in _items(page.get("definition_layers")) if isinstance(item, dict)][:3]
    rules = [item for item in _items(page.get("boundary_rules")) if isinstance(item, dict)][:4]
    specs = [
        (1.7, 5.2, 12.0, 10.3, "D9E8FF", NAVY),
        (3.05, 6.55, 9.3, 7.6, "AFCBFF", NAVY),
        (4.4, 7.9, 6.6, 4.9, BLUE, WHITE),
    ]
    for index, (x, y, w, h, fill, color) in enumerate(specs):
        builder.shape(x, y, w, h, preset="ellipse", fill=fill, line=f"{WHITE}:1", line_opacity=0.45,
                      shadow="0A2A66-4-45-2-8" if index == 0 else None)
    label_specs = [(2.75, 13.15, 9.9, 1.65), (4.0, 11.15, 7.4, 1.6), (5.0, 9.15, 5.4, 1.85)]
    for index, layer in enumerate(layers):
        x, y, w, h = label_specs[index]
        builder.shape(x, y, w, h, text=f"{_text(layer.get('title'))}\n{_text(layer.get('short') or layer.get('body'), 55)}",
                      size=16 if index < 2 else 18, color=WHITE if index == 2 else NAVY,
                      bold=True, align="center", valign="middle", margin=0.05)
    builder.shape(15.1, 4.75, 17.4, 1.0, text="边界判断与识别规则", size=20, color=NAVY, bold=True, margin=0)
    for index, rule in enumerate(rules):
        y = 6.15 + index * 2.35
        builder.shape(15.1, y, 17.4, 1.85, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                      shadow="0A2A66-3-45-1-7", radius_adj="adj:val 8000")
        builder.shape(15.65, y + 0.42, 0.85, 0.85, preset="ellipse", fill=[DEEP_BLUE, BLUE, MID_BLUE, CYAN][index],
                      line="none", text=str(index + 1), size=11, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        builder.shape(17.0, y + 0.18, 3.0, 0.82, text=_text(rule.get("title")), size=16,
                      color=NAVY, bold=True, margin=0)
        builder.shape(20.0, y + 0.25, 11.6, 1.15, text=_text(rule.get("body") or rule.get("statement")),
                      size=15, color=TEXT, valign="middle", margin=0.05)


def _render_needs(builder: OfficeCliDeckBuilder, page: dict) -> None:
    levels = [item for item in _items(page.get("levels")) if isinstance(item, dict)][:4]
    mapping = [item for item in _items(page.get("segment_mapping")) if isinstance(item, dict)][:5]
    base_y, level_h, gap = 14.05, 2.05, 0.18
    gradients = [f"{DEEP_BLUE}-{BLUE}-0", f"{BLUE}-{MID_BLUE}-0", f"{MID_BLUE}-{CYAN}-0", f"{CYAN}-8FD8FF-0"]
    for index, level in enumerate(levels):
        w = 14.2 - index * 2.45
        x = 9.1 - w / 2
        y = base_y - (index + 1) * level_h - index * gap
        color = WHITE if index < 3 else NAVY
        builder.shape(x, y, w, level_h, name="layout_variant_evidence_pyramid" if index == 0 else None,
                      preset="trapezoid", gradient=gradients[min(index, 3)], line=f"{WHITE}:1",
                      line_opacity=0.35, shadow="0A2A66-5-90-2-10" if index == 0 else None)
        builder.shape(x + 0.6, y + 0.18, w - 1.2, 0.72, text=_text(level.get("title")), size=17,
                      color=color, bold=True, align="center", valign="middle", margin=0)
        builder.shape(x + 0.65, y + 0.88, w - 1.3, 0.92, text=_text(level.get("body") or level.get("statement")),
                      size=13.5, color=color, align="center", valign="middle", margin=0.03)
    builder.shape(19.0, 5.25, 13.5, 10.6, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                  shadow="0A2A66-5-45-2-11", radius_adj="adj:val 8000")
    builder.shape(19.75, 5.9, 11.9, 1.0, text="人群需求映射", size=20, color=NAVY, bold=True, margin=0)
    for index, item in enumerate(mapping):
        y = 7.35 + index * 1.6
        builder.shape(19.8, y + 0.16, 0.68, 0.68, preset="ellipse",
                      fill=[DEEP_BLUE, BLUE, MID_BLUE, CYAN, "8FD8FF"][index], line="none")
        builder.shape(21.0, y, 6.5, 0.9, text=_text(item.get("segment")), size=17,
                      color=TEXT, bold=True, valign="middle", margin=0)
        builder.shape(27.4, y, 3.8, 0.9, preset="roundRect", fill=PALE, line="none",
                      text=_text(item.get("level")), size=14, color=BLUE, bold=True,
                      align="center", valign="middle", margin=0)
    builder.shape(19.75, 13.85, 11.9, 1.6, text=f"底层原则｜{_text(page.get('key_message'))}",
                  size=14.5, color=DEEP_BLUE, bold=True, align="center", margin=0)


def _render_priority(builder: OfficeCliDeckBuilder, page: dict) -> None:
    axes = page.get("axes") if isinstance(page.get("axes"), dict) else {}
    items = [item for item in _items(page.get("items")) if isinstance(item, dict)][:10]
    x0, y0, width, height = 2.1, 5.0, 21.6, 10.7
    fills = ["EEF5FF", "E3EEFF", "F8FBFF", "F1F6FC"]
    for index, (qx, qy) in enumerate(((x0, y0), (x0 + width / 2, y0), (x0, y0 + height / 2), (x0 + width / 2, y0 + height / 2))):
        builder.shape(qx, qy, width / 2, height / 2, preset="rect", fill=fills[index], line=f"{WHITE}:1")
    builder.connector(x0, y0 + height, width, 0, color=MUTED, arrow="tailEnd")
    builder.connector(x0, y0 + height, 0, -height, color=MUTED, arrow="tailEnd")
    builder.connector(x0 + width / 2, y0, 0, height, color="AFC3DC", arrow="", dashed=True)
    builder.connector(x0, y0 + height / 2, width, 0, color="AFC3DC", arrow="", dashed=True)
    labels = _items(page.get("quadrant_labels")) or ["高影响低频", "重点投入", "体验维护", "低优先级"]
    label_pos = [(x0 + 0.45, y0 + 0.35), (x0 + width / 2 + 0.45, y0 + 0.35),
                 (x0 + 0.45, y0 + height / 2 + 0.35), (x0 + width / 2 + 0.45, y0 + height / 2 + 0.35)]
    for index, (lx, ly) in enumerate(label_pos):
        builder.shape(lx, ly, 4.0, 0.62, text=_text(labels[index] if index < len(labels) else ""),
                      size=12, color=BLUE if index == 1 else MUTED, bold=index == 1, margin=0)
    builder.shape(x0, 4.32, 5.2, 0.58, text=_text(axes.get("y") or "体验影响 ↑"), size=11.5, color=MUTED, margin=0)
    builder.shape(x0 + width - 6.0, 15.93, 6.0, 0.58, text=_text(axes.get("x") or "发生频率 →"),
                  size=11.5, color=MUTED, align="right", margin=0)
    point_specs = []
    for index, item in enumerate(items):
        sx = max(0, min(100, float(item.get("x", 50))))
        sy = max(0, min(100, float(item.get("y", 50))))
        px = x0 + 0.85 + (width - 1.7) * sx / 100
        py = y0 + height - 0.85 - (height - 1.7) * sy / 100
        priority = _text(item.get("priority")).lower()
        color = RED if priority in {"high", "p0", "p1", "高"} else BLUE if priority in {"medium", "中"} else MID_BLUE
        diameter = 0.9 + min(0.6, float(item.get("weight", 0) or 0) / 100)
        point_specs.append((item, px, py, diameter, color, priority))
        builder.shape(px - diameter / 2, py - diameter / 2, diameter, diameter, preset="ellipse",
                      fill=color, opacity=0.88, line=f"{WHITE}:1", shadow=f"{color}-4-0-1-14")

    def overlaps(left: tuple[float, float, float, float], right: tuple[float, float, float, float], pad: float = 0.12) -> bool:
        lx, ly, lw, lh = left
        rx, ry, rw, rh = right
        return not (
            lx + lw + pad <= rx or rx + rw + pad <= lx
            or ly + lh + pad <= ry or ry + rh + pad <= ly
        )

    point_rects = [
        (px - diameter / 2, py - diameter / 2, diameter, diameter)
        for _, px, py, diameter, _, _ in point_specs
    ]
    placed_labels: list[tuple[float, float, float, float]] = []
    label_w, label_h = 3.6, 0.88
    for item_index, (item, px, py, diameter, _, priority) in enumerate(point_specs):
        raw_candidates = [
            (px + diameter / 2 + 0.18, py - label_h / 2),
            (px - diameter / 2 - label_w - 0.18, py - label_h / 2),
            (px + 0.22, py - label_h - diameter / 2 - 0.22),
            (px + 0.22, py + diameter / 2 + 0.22),
            (px - label_w - 0.22, py - label_h - diameter / 2 - 0.22),
            (px - label_w - 0.22, py + diameter / 2 + 0.22),
        ]
        candidates = []
        for candidate_x, candidate_y in raw_candidates:
            candidate_x = max(x0 + 0.18, min(x0 + width - label_w - 0.18, candidate_x))
            candidate_y = max(y0 + 1.0, min(y0 + height - label_h - 0.18, candidate_y))
            candidate = (candidate_x, candidate_y, label_w, label_h)
            score = sum(overlaps(candidate, rect) for rect in point_rects)
            score += 3 * sum(overlaps(candidate, rect) for rect in placed_labels)
            candidates.append((score, candidate))
        _, (label_x, label_y, _, _) = min(candidates, key=lambda value: value[0])
        placed_labels.append((label_x, label_y, label_w, label_h))
        builder.shape(label_x, label_y, label_w, label_h, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", text=_text(item.get("label") or item.get("title"), 35),
                      size=12, color=TEXT, bold=priority in {"high", "p0", "p1", "高"},
                      valign="middle", margin=0.10)
    builder.shape(24.65, 5.0, 7.85, 10.7, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                  line="none", shadow="0A2A66-6-45-3-14", radius_adj="adj:val 8000")
    builder.shape(25.35, 5.65, 6.45, 0.9, text="优先决策", size=18, color="BDEBFF", bold=True, margin=0)
    builder.shape(25.35, 6.85, 6.35, 6.2, text=_bullet_text(_findings(page), limit=4), size=13.5,
                   color=WHITE, margin=0.02, line_spacing="1.22x")
    builder.shape(25.35, 13.35, 6.35, 1.95, preset="roundRect", fill=WHITE, opacity=0.13,
                  line=f"{WHITE}:1", line_opacity=0.2, text=_text(page.get("recommendation") or page.get("key_message")),
                  size=15.5, color=WHITE, bold=True, align="center", valign="middle", margin=0.25)


def _render_quotes(builder: OfficeCliDeckBuilder, page: dict) -> None:
    findings = _findings(page)
    quotes = [item for item in _items(page.get("quotes")) if isinstance(item, dict)][:3]
    builder.shape(1.35, 4.6, 10.2, 11.85, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                  line="none", shadow="0A2A66-6-45-3-14", radius_adj="adj:val 8000")
    builder.shape(2.0, 5.35, 3.0, 0.75, preset="roundRect", fill=CYAN, line="none",
                  text="研究解读", size=12, color=NAVY, bold=True, align="center", valign="middle", margin=0)
    quote_key = _display_text(page.get("key_message"))
    quote_key_size = _density_font(
        quote_key, 16.5, medium_at=52, long_at=88, medium=14, long=11.5
    )
    builder.shape(2.05, 6.42, 8.75, 3.72, text=quote_key, size=quote_key_size,
                  color=WHITE, bold=True, valign="top", margin=0, line_spacing="1.12x")
    builder.shape(1.75, 10.55, 9.75, 5.25, text=_balanced_bullet_text(findings, limit=4), size=11.5,
                   color=WHITE, margin=0.02, line_spacing="1.22x")
    if not quotes:
        quotes = [{"text": page.get("purpose") or "待补充用户原声", "respondent_label": "项目访谈"}]
    quote_h = (11.85 - 0.5 * (len(quotes) - 1)) / len(quotes)
    for index, quote in enumerate(quotes):
        y = 4.6 + index * (quote_h + 0.5)
        builder.shape(12.35, y, 20.15, quote_h, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                      shadow="0A2A66-5-45-2-11", radius_adj="adj:val 8000")
        builder.shape(12.8, y + 0.35, 1.6, 1.6, preset="ellipse", fill=BLUE if index == 0 else MID_BLUE,
                      line="none", text="“", size=24, color=WHITE, bold=True, align="center", valign="middle", margin=0)
        quote_text = _text(quote.get("text"))
        quote_size = 19 if len(quote_text) < 60 else 17.5 if len(quote_text) < 120 else 16 if len(quote_text) < 200 else 14.5
        builder.shape(14.65, y + 0.45, 16.95, quote_h - 1.55, text=quote_text,
                      size=quote_size, color=NAVY,
                      bold=True, valign="middle", margin=0, line_spacing="1.16x")
        builder.shape(14.65, y + quote_h - 0.82, 16.95, 0.58,
                      text=_text(quote.get("respondent_label") or quote.get("source_label")),
                      size=11.5, color=MUTED, align="right", margin=0)


def _render_case(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)[:4]
    if not blocks:
        blocks = [{"title": f"机制 {i + 1}", "items": [item]} for i, item in enumerate(_findings(page))]
    case_key = _text(page.get("key_message"))
    case_key_size = _density_font(
        case_key, 22, medium_at=50, long_at=82, medium=19, long=16.5
    )
    builder.shape(1.35, 4.55, 31.15, 2.3, preset="roundRect", gradient=f"{NAVY}-{BLUE}-0",
                  line="none", shadow="0A2A66-5-45-2-13", text=_text(page.get("key_message")),
                  size=case_key_size, color=WHITE, bold=True, align="center", valign="middle", margin=0.2)
    count = max(1, len(blocks))
    gap = 0.45
    card_w = (31.15 - gap * (count - 1)) / count
    for index, block in enumerate(blocks):
        x = 1.35 + index * (card_w + gap)
        builder.shape(x, 7.35, card_w, 7.25, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                      shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(x + card_w / 2 - 0.65, 6.72, 1.3, 1.3, preset="ellipse",
                      gradient=f"{BLUE}-{CYAN}-45", line=f"{WHITE}:1", text=str(index + 1),
                      size=16, color=WHITE, bold=True, align="center", valign="middle", margin=0)
        case_title = _text(block.get("title"))
        case_title_size = _density_font(
            case_title, 18.5, medium_at=13, long_at=22, medium=16, long=14
        )
        builder.shape(x + 0.55, 8.15, card_w - 1.1, 1.45, text=case_title,
                      size=case_title_size, color=NAVY, bold=True, align="center", valign="middle", margin=0)
        builder.shape(x + 0.55, 9.7, card_w - 1.1, 4.0, text=_bullet_text(_block_lines(block), limit=5),
                      size=15.5, color=TEXT, margin=0.04, line_spacing="1.18x")
        if index < count - 1:
            builder.connector(x + card_w, 10.9, gap, 0, color="8CB8FF")
    builder.shape(4.0, 15.25, 25.85, 1.25, preset="roundRect", fill=PALE, line="none",
                  text=f"案例启示｜{_text(page.get('purpose'))}", size=17, color=DEEP_BLUE,
                  bold=True, align="center", valign="middle", margin=0.12)


def _render_matrix(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)[:4]
    labels = _items(page.get("quadrant_labels")) or ["高价值 / 高可行", "高价值 / 低可行", "低价值 / 高可行", "低价值 / 低可行"]
    positions = [(1.8, 5.0), (9.7, 5.0), (1.8, 10.55), (9.7, 10.55)]
    fills = ["EAF3FF", "F3F7FF", "F5FAFF", "F7F9FC"]
    for index, (x, y) in enumerate(positions):
        block = blocks[index] if index < len(blocks) else {}
        builder.shape(x, y, 7.55, 5.15, preset="roundRect", fill=fills[index],
                      line=f"{BLUE if index == 0 else BORDER}:1", radius_adj="adj:val 8000")
        builder.shape(x + 0.45, y + 0.3, 6.65, 0.82,
                      text=_text(block.get("title") or (labels[index] if index < len(labels) else f"象限 {index + 1}")),
                      size=17, color=BLUE if index == 0 else NAVY, bold=True, margin=0)
        builder.shape(x + 0.45, y + 1.25, 6.65, 3.1, text=_bullet_text(_block_lines(block), limit=4),
                      size=14.5, color=TEXT, margin=0.03, line_spacing="1.16x")
    builder.shape(18.3, 5.0, 14.2, 10.7, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                  line="none", shadow="0A2A66-6-45-3-14", radius_adj="adj:val 8000")
    builder.shape(19.1, 5.7, 12.6, 0.95, text="决策含义", size=19, color="BDEBFF", bold=True, margin=0)
    builder.shape(19.1, 7.0, 12.5, 4.6, text=_text(page.get("key_message")), size=23,
                  color=WHITE, bold=True, valign="middle", margin=0, line_spacing="1.18x")
    builder.shape(19.1, 12.35, 12.5, 2.15, preset="roundRect", fill=WHITE, opacity=0.13,
                  line=f"{WHITE}:1", line_opacity=0.2, text=_text(page.get("recommendation") or page.get("purpose")),
                  size=16, color=WHITE, align="center", valign="middle", margin=0.25)


def _render_action(builder: OfficeCliDeckBuilder, page: dict, recommendation: bool) -> None:
    blocks = _blocks(page)[:3]
    findings = _findings(page)
    while len(blocks) < 3:
        blocks.append({"title": ["问题", "原因", "行动" if recommendation else "影响"][len(blocks)],
                       "items": [findings[len(blocks)]] if len(findings) > len(blocks) else ["待补充"]})
    labels = ["问题", "原因", "行动" if recommendation else "影响"]
    accents = [DEEP_BLUE, BLUE, CYAN]
    for index, block in enumerate(blocks):
        x = 1.35 + index * 10.55
        action_title = _text(block.get("title") or labels[index])
        action_title_size = _density_font(
            action_title, 19, medium_at=10, long_at=18, medium=16, long=13.5
        )
        builder.shape(x, 5.0, 9.8, 2.8, preset="hexagon", gradient=f"{accents[index]}-{BLUE if index == 0 else MID_BLUE}-0",
                      line="none", shadow="0A2A66-4-45-2-9", text=action_title,
                      size=action_title_size, color=NAVY if index == 2 else WHITE, bold=True,
                      align="center", valign="middle", margin=0.25)
        builder.shape(x, 8.0, 9.8, 7.05, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                      shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(x + 0.6, 8.7, 8.6, 5.45, text=_bullet_text(_block_lines(block), limit=6),
                      size=16.5, color=TEXT, margin=0.04, line_spacing="1.2x")
        if index < 2:
            builder.connector(x + 9.8, 6.4, 0.75, 0, color="8CB8FF", line_width=2)
    key = _text(page.get("key_message") or page.get("purpose"))
    builder.shape(3.35, 15.35, 27.2, 1.7, preset="roundRect", fill=PALE, line="none",
                  text=f"{'行动原则' if recommendation else '诊断结论'}｜{key}", size=14.5,
                  color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0.1)
    if recommendation and _text(page.get("recommendation_priority")):
        builder.shape(28.85, 4.08, 3.65, 0.7, preset="roundRect", fill=BLUE, line="none",
                      text=f"优先级 {_text(page.get('recommendation_priority'))}", size=11.5,
                      color=WHITE, bold=True, align="center", valign="middle", margin=0)


def _render_fishbone(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)[:6]
    findings = _findings(page)[:6]
    if findings and len(blocks) < 4:
        blocks = _finding_blocks(page, fallback="原因")[:6]
    elif not blocks:
        blocks = _finding_blocks(page, fallback="原因")[:6]
    builder.shape(1.35, 4.55, 5.0, 0.72, name="layout_variant_fishbone",
                  preset="roundRect", fill=PALE, line="none", text="ROOT CAUSE MAP",
                  size=11.5, color=BLUE, bold=True, align="center", valign="middle", margin=0)
    spine_y = 10.45
    builder.connector(2.55, spine_y, 24.25, 0, color=DEEP_BLUE, line_width=3)
    builder.shape(1.55, 9.65, 1.6, 1.6, preset="chevron", fill=DEEP_BLUE, line="none")
    column_count = max(1, (len(blocks) + 1) // 2)
    joints = {1: [13.2], 2: [8.5, 20.0]}.get(column_count, [7.0, 13.2, 19.4])
    box_w = 6.7 if column_count <= 2 else 5.35
    for index, block in enumerate(blocks):
        row = index % 2
        column = index // 2
        joint_x = joints[min(column, len(joints) - 1)]
        top = row == 0
        endpoint_x = joint_x - 2.25
        endpoint_y = 7.55 if top else 13.35
        builder.connector(endpoint_x, endpoint_y, joint_x - endpoint_x,
                          spine_y - endpoint_y, color="77A8FF", line_width=1.7, arrow="")
        box_x = joint_x - box_w + 0.35
        box_y = 5.15 if top else 12.15
        builder.shape(box_x, box_y, box_w, 1.05, preset="roundRect",
                      fill=DEEP_BLUE if top else BLUE, line="none",
                      text=_text(block.get("title") or f"原因 {index + 1}"), size=15,
                      color=WHITE, bold=True, align="center", valign="middle", margin=0.08)
        body_y = 6.35 if top else 13.35
        body = _bullet_text(_block_lines(block), limit=3)
        body_size = _density_font(body, 11.5, medium_at=42, long_at=68, medium=10.5, long=9.5)
        builder.shape(box_x, body_y, box_w, 2.3, text=body,
                      size=body_size, color=TEXT, margin=0.02, line_spacing="1.08x")
    full_outcome = _text(page.get("key_message") or page.get("title"))
    outcome = _text(page.get("outcome_label"), 28)
    if not outcome:
        title_clauses = [item.strip() for item in re.split(r"[：:，,]", _text(page.get("title"))) if item.strip()]
        outcome = _text(title_clauses[0] if title_clauses else full_outcome, 20)
    outcome_size = _density_font(outcome, 16, medium_at=20, long_at=26, medium=14.5, long=13)
    builder.shape(26.1, 8.05, 6.4, 4.8, preset="hexagon", gradient=f"{NAVY}-{BLUE}-0",
                  line="none", shadow="0A2A66-5-45-2-12", text=outcome,
                  size=outcome_size, color=WHITE, bold=True, align="center", valign="middle", margin=0.55)
    verdict = _text(page.get("verdict") or page.get("purpose"))
    builder.shape(4.0, 16.0, 24.0, 0.88, text=f"诊断结论｜{verdict}", size=14,
                  color=DEEP_BLUE, bold=True, align="center", valign="middle", margin=0)


def _render_action_roadmap(builder: OfficeCliDeckBuilder, page: dict) -> None:
    blocks = _blocks(page)[:5]
    if len(blocks) < 3 and len(_findings(page)) >= 3:
        blocks = _finding_blocks(page, fallback="行动")[:5]
    elif not blocks:
        blocks = _finding_blocks(page, fallback="行动")[:5]
    count = max(1, len(blocks))
    builder.shape(1.35, 4.55, 31.15, 1.45, name="layout_variant_action_roadmap",
                  preset="roundRect", gradient=f"{NAVY}-{BLUE}-0", line="none",
                  text=_text(page.get("key_message") or page.get("title")), size=_density_font(_text(page.get("key_message") or page.get("title")), 18, medium_at=55, long_at=100, medium=14, long=11),
                  color=WHITE, bold=True, align="center", valign="middle", margin=0.18)
    x0, total_w, gap = 1.35, 31.15, 0.35
    card_w = (total_w - gap * (count - 1)) / count
    rail_y = 8.25
    builder.connector(2.0, rail_y, 29.0, 0, color="77A8FF", line_width=2.5)
    accents = [DEEP_BLUE, BLUE, MID_BLUE, CYAN, "8FD8FF"]
    for index, block in enumerate(blocks):
        x = x0 + index * (card_w + gap)
        accent = accents[min(index, len(accents) - 1)]
        # The HTML screenshot renderer compresses shallow chevrons and can make
        # their labels collide with the arrow edges.  A compact native pill plus
        # the numbered rail below communicates sequence without that ambiguity.
        builder.shape(x, 6.35, card_w, 1.15, preset="roundRect", fill=accent, line="none",
                      text=_text(block.get("title") or f"阶段 {index + 1}"), size=15,
                      color=NAVY if index >= 3 else WHITE, bold=True,
                      align="center", valign="middle", margin=0.12,
                      radius_adj="adj:val 6500")
        builder.shape(x + card_w / 2 - 0.48, rail_y - 0.48, 0.96, 0.96,
                      preset="ellipse", fill=accent, line=f"{WHITE}:1", text=str(index + 1),
                      size=11, color=NAVY if index >= 3 else WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        builder.shape(x, 9.1, card_w, 5.7, preset="roundRect", fill=WHITE,
                      line=f"{BORDER}:1", shadow="0A2A66-3-45-1-7", radius_adj="adj:val 6500")
        body = _bullet_text(_block_lines(block), limit=4)
        body_size = _density_font(body, 14, medium_at=50, long_at=86, medium=12.5, long=11)
        builder.shape(x + 0.45, 9.65, card_w - 0.9, 4.25, text=body,
                      size=body_size, color=TEXT, margin=0.02, line_spacing="1.15x")
        builder.shape(x + 0.55, 14.1, card_w - 1.1, 0.4, preset="roundRect",
                      fill=accent, line="none")
    principle = _display_text(page.get("recommendation") or page.get("purpose"))
    builder.shape(3.4, 15.45, 27.0, 1.5, preset="roundRect", fill=PALE, line="none",
                  text=f"落地原则｜{principle}", size=14.5, color=DEEP_BLUE,
                  bold=True, align="center", valign="middle", margin=0.12)
    if _text(page.get("recommendation_priority")):
        builder.shape(28.85, 3.72, 3.65, 0.7, preset="roundRect", fill=CYAN, line="none",
                      text=f"优先级 {_text(page.get('recommendation_priority'))}", size=11.5,
                      color=NAVY, bold=True, align="center", valign="middle", margin=0)


def _render_insight(builder: OfficeCliDeckBuilder, page: dict) -> None:
    findings = _findings(page)
    quotes = [item for item in _items(page.get("quotes")) if isinstance(item, dict)]
    builder.shape(1.35, 4.55, 12.2, 11.9, preset="roundRect", gradient=f"{DEEP_BLUE}-{BLUE}-35",
                  line="none", shadow="0A2A66-7-45-3-16", radius_adj="adj:val 8000")
    builder.shape(2.05, 5.35, 3.0, 0.75, preset="roundRect", fill=CYAN, line="none",
                  text="核心洞察", size=12, color=NAVY, bold=True, align="center", valign="middle", margin=0)
    insight_statement = _text(page.get("key_message") or page.get("title"))
    insight_size = _density_font(
        insight_statement, 24, medium_at=30, long_at=78, medium=19, long=15.5
    )
    builder.shape(2.05, 6.65, 10.0, 5.25, text=insight_statement,
                  size=insight_size, color=WHITE, bold=True, valign="middle", margin=0, line_spacing="1.18x")
    builder.shape(2.05, 13.1, 10.0, 1.7, preset="roundRect", fill=WHITE, opacity=0.13,
                  line=f"{WHITE}:1", line_opacity=0.2, text=_text(page.get("purpose")),
                  size=15, color=WHITE, align="center", valign="middle", margin=0.2)
    display = findings[:4] or [line for block in _blocks(page) for line in _block_lines(block)][:4]
    for index, finding in enumerate(display):
        y = 4.55 + index * 2.75
        builder.shape(14.35, y, 18.15, 2.35, preset="roundRect", fill=WHITE, line=f"{BORDER}:1",
                      shadow="0A2A66-4-45-2-9", radius_adj="adj:val 8000")
        builder.shape(14.9, y + 0.58, 0.9, 0.9, preset="ellipse", fill=BLUE if index < 2 else MID_BLUE,
                      line="none", text=str(index + 1), size=11, color=WHITE, bold=True,
                      align="center", valign="middle", margin=0)
        builder.shape(16.35, y + 0.35, 15.35, 1.65, text=finding, size=17,
                      color=NAVY, bold=True, valign="middle", margin=0.05)
    if quotes:
        quote = quotes[0]
        quote_text = _text(quote.get("text"))
        if len(display) <= 3:
            builder.shape(14.35, 13.45, 18.15, 3.25, preset="roundRect", fill=PALE,
                          line=f"BFD5FF:1", radius_adj="adj:val 8000")
            builder.shape(14.85, 13.93, 1.15, 1.15, preset="ellipse", fill=BLUE, line="none",
                          text="“", size=18, color=WHITE, bold=True, align="center", valign="middle", margin=0)
            displayed_quote = quote_text if len(quote_text) <= 150 else f"{quote_text[:150].rstrip('，。；; ')}……"
            quote_size = 13 if len(displayed_quote) > 100 else 14
            builder.shape(16.35, 13.95, 15.35, 1.92, text=displayed_quote, size=quote_size,
                          color=NAVY, bold=True, valign="middle", margin=0.02, line_spacing="1.15x")
            builder.shape(16.35, 15.98, 15.35, 0.45, text=_text(quote.get("respondent_label") or quote.get("source_label")),
                          size=11, color=MUTED, align="right", margin=0)
        else:
            quote_size = 11 if len(quote_text) > 150 else 11.8 if len(quote_text) > 100 else 12.5
            builder.shape(14.35, 15.25, 18.15, 1.45, text=f"“{quote_text}”  — {_text(quote.get('respondent_label'))}",
                          size=quote_size, color=MUTED, italic=True, align="right", valign="middle", margin=0)


def _render_page(builder: OfficeCliDeckBuilder, page: dict, report_title: str, template_id: str = "") -> None:
    page_type = _text(page.get("page_type"))
    variant = resolve_layout_variant(page, template_id)
    page = {**page, "_resolved_layout_variant": variant}
    if page_type == "navigation":
        _render_cover(builder, page, report_title)
    elif page_type == "section_intro":
        _render_section(builder, page)
    else:
        builder.slide(page_type or "Insight", ICE)
        _title(builder, page)
        if page_type in {"executive_summary", "qualitative_summary", "theme_summary"}:
            _render_editorial_overview(builder, page) if variant == "editorial_overview" else _render_summary(builder, page)
        elif page_type in {"framework", "research_framework"}:
            _render_framework(builder, page)
        elif page_type == "segmentation_map":
            _render_segmentation(builder, page)
        elif page_type == "persona":
            _render_persona(builder, page)
        elif page_type == "journey":
            _render_journey_curve(builder, page) if variant == "journey_curve" else _render_journey(builder, page)
        elif page_type in {"comparison", "segment_comparison", "competitor_comparison"}:
            _render_comparison(builder, page)
        elif page_type == "evidence_diagnostic":
            _render_evidence(builder, page)
        elif page_type == "concept_definition":
            _render_definition(builder, page)
        elif page_type == "needs_pyramid":
            _render_needs(builder, page)
        elif page_type == "priority_matrix":
            _render_priority(builder, page)
        elif page_type == "quote_evidence":
            _render_quotes(builder, page)
        elif page_type == "case_study":
            _render_case(builder, page)
        elif page_type == "matrix":
            _render_matrix(builder, page)
        elif page_type == "problem_reason" and variant == "fishbone":
            _render_fishbone(builder, page)
        elif page_type == "recommendation" and variant == "action_roadmap":
            _render_action_roadmap(builder, page)
        elif page_type in {"problem_reason", "recommendation"}:
            _render_action(builder, page, page_type == "recommendation")
        else:
            _render_insight(builder, page)
        _footer(builder, page)
    builder.notes(_speaker_notes(page))


def build_officecli_commands(script: dict, pages: list[dict]) -> list[dict[str, Any]]:
    builder = OfficeCliDeckBuilder()
    report_title = _text(script.get("title") or "定性研究报告")
    style_profile = script.get("style_profile") if isinstance(script.get("style_profile"), dict) else {}
    template_id = _text(style_profile.get("id"))
    for page in pages:
        _render_page(builder, page, report_title, template_id)
    return builder.commands


def render_officecli_qualitative_report(script: dict, officecli: OfficeCliRunner) -> dict:
    """Render an editable native deck and return production metadata."""
    if not isinstance(script, dict):
        raise ValueError("qualitative PPT script 必须是 JSON 对象")
    pages, split_issues = prepare_pages(script)
    if not pages:
        raise ValueError("qualitative PPT script 至少需要一页")
    validation = validate_script(script, pages, split_issues)
    commands = build_officecli_commands(script, pages)
    content, generation_gate = officecli.create_from_batch(commands)
    prs = Presentation(BytesIO(content))
    validation["checks"].extend(["officecli_validate", "officecli_issue_scan", "officecli_native_objects"])
    if not generation_gate.get("passed"):
        validation["issues"].append(
            {
                "code": "OFFICECLI_OUTPUT_INVALID",
                "severity": "error",
                "page_id": "deck",
                "message": "OfficeCLI 输出未通过 validate 或 issues 扫描。",
            }
        )
    validation["issue_count"] = len(validation["issues"])
    validation["error_count"] = sum(item.get("severity") == "error" for item in validation["issues"])
    validation["passed"] = validation["error_count"] == 0
    return {
        "content": content,
        "slide_count": len(pages),
        "validation": validation,
        "object_counts": _object_counts(prs),
        "render_llm_tokens": 0,
        "prepared_pages": pages,
        "layout_adaptations": layout_adaptations(script, pages, split_issues),
        "generation_quality_gate": generation_gate,
        "officecli_operation_count": len(commands),
    }
