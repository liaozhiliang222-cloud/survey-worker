"""文本溢出检测与自动修复。

检测逻辑：基于文本长度、字体大小、文本框宽高、行距估算所需高度，
如果 estimated_height > textbox_height 则触发 TEXT_OVERFLOW。

修复策略（严格按顺序）：
  1. 缩小字号（正文 ≥ 10pt，标题 ≥ 14pt）
  2. 调整 paragraph spacing / margin / line spacing
  3. 增加文本区域 / 减少装饰区域
  4. 输出 NEED_SPLIT（不删除内容）
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from pptx.util import Emu, Pt

from .models import QAIssue, IssueType, RenderAction, Severity, SlideQAReport

# ─── 字号限制 ───────────────────────────────────────────────
MIN_BODY_FONT_PT = 10
MIN_TITLE_FONT_PT = 14
FONT_STEP_PT = 2

# ─── 估算参数 ───────────────────────────────────────────────
# 平均字符宽度系数（相对于字号），中文约 1.0em，英文约 0.55em
CJK_CHAR_WIDTH_RATIO = 1.05
LATIN_CHAR_WIDTH_RATIO = 0.58
DEFAULT_LINE_SPACING = 1.2
DEFAULT_SPACE_AFTER_PT = 4


@dataclass
class TextBoxInfo:
    """文本框几何与内容信息。"""

    element_id: str
    text: str
    font_size_pt: float
    box_width_emu: int
    box_height_emu: int
    is_title: bool = False
    line_spacing: float = DEFAULT_LINE_SPACING
    space_after_pt: float = DEFAULT_SPACE_AFTER_PT
    margin_left_emu: int = 91440   # 0.1 inch
    margin_right_emu: int = 91440
    margin_top_emu: int = 45720    # 0.05 inch
    margin_bottom_emu: int = 45720


def _is_cjk(char: str) -> bool:
    """判断字符是否为中日韩文字。"""
    cp = ord(char)
    return (
        0x4E00 <= cp <= 0x9FFF
        or 0x3400 <= cp <= 0x4DBF
        or 0xF900 <= cp <= 0xFAFF
        or 0x3000 <= cp <= 0x303F
        or 0xFF00 <= cp <= 0xFFEF
        or 0x2E80 <= cp <= 0x2EFF
    )


def estimate_text_height(text: str, font_size_pt: float, box_width_emu: int,
                         line_spacing: float = DEFAULT_LINE_SPACING,
                         space_after_pt: float = DEFAULT_SPACE_AFTER_PT,
                         margin_left_emu: int = 91440,
                         margin_right_emu: int = 91440) -> float:
    """估算文本在给定宽度文本框中所需的高度（EMU）。

    使用逐字符宽度累加 + 自动换行算法。
    """
    if not text or not text.strip():
        return 0.0

    font_size_emu = font_size_pt * 12700  # 1pt = 12700 EMU
    usable_width = box_width_emu - margin_left_emu - margin_right_emu
    if usable_width <= 0:
        usable_width = box_width_emu * 0.8

    line_height_emu = font_size_emu * line_spacing
    space_after_emu = space_after_pt * 12700

    paragraphs = text.split("\n")
    total_height = 0.0

    for para in paragraphs:
        if not para:
            total_height += line_height_emu
            continue
        # 逐字符累加宽度，计算换行数
        current_width = 0.0
        lines = 1
        for char in para:
            if _is_cjk(char):
                char_width = font_size_emu * CJK_CHAR_WIDTH_RATIO
            else:
                char_width = font_size_emu * LATIN_CHAR_WIDTH_RATIO
            if current_width + char_width > usable_width:
                lines += 1
                current_width = char_width
            else:
                current_width += char_width
        total_height += lines * line_height_emu + space_after_emu

    return total_height


def check_text_overflow(slide_id: str, textboxes: list[TextBoxInfo]) -> list[QAIssue]:
    """检测一页中所有文本框是否溢出。"""
    issues: list[QAIssue] = []
    for tb in textboxes:
        if not tb.text or not tb.text.strip():
            continue
        estimated = estimate_text_height(
            tb.text, tb.font_size_pt, tb.box_width_emu,
            tb.line_spacing, tb.space_after_pt,
            tb.margin_left_emu, tb.margin_right_emu,
        )
        if estimated > tb.box_height_emu:
            overflow_ratio = estimated / max(1, tb.box_height_emu)
            severity = Severity.HIGH if overflow_ratio > 1.5 else Severity.MEDIUM
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.TEXT_OVERFLOW,
                severity=severity,
                message=f"文本溢出：需要 {int(estimated)} EMU，可用 {tb.box_height_emu} EMU（超出 {int((overflow_ratio - 1) * 100)}%）",
                element_id=tb.element_id,
                details={
                    "estimated_height": int(estimated),
                    "available_height": tb.box_height_emu,
                    "overflow_ratio": round(overflow_ratio, 2),
                    "font_size_pt": tb.font_size_pt,
                    "text_length": len(tb.text),
                },
            ))
    return issues


def fix_text_overflow(slide_id: str, tb: TextBoxInfo) -> tuple[TextBoxInfo, list[RenderAction]]:
    """对单个溢出文本框执行自动修复，返回修复后的文本框信息和操作记录。

    修复策略：
      1. 逐步缩小字号
      2. 减小行距和段后间距
      3. 如果仍溢出，标记 NEED_SPLIT
    """
    actions: list[RenderAction] = []
    min_font = MIN_TITLE_FONT_PT if tb.is_title else MIN_BODY_FONT_PT
    current_font = tb.font_size_pt
    current_line_spacing = tb.line_spacing
    current_space_after = tb.space_after_pt

    # ─── 第一步：缩小字号 ───────────────────────────────────
    while current_font > min_font:
        estimated = estimate_text_height(
            tb.text, current_font, tb.box_width_emu,
            current_line_spacing, current_space_after,
            tb.margin_left_emu, tb.margin_right_emu,
        )
        if estimated <= tb.box_height_emu:
            actions.append(RenderAction(
                slide_id=slide_id,
                issue_type=IssueType.TEXT_OVERFLOW.value,
                severity=Severity.LOW.value,
                action="reduce_font_size",
                before=f"{tb.font_size_pt}pt",
                after=f"{current_font}pt",
                reason="文本高度不足，缩小字号适配",
            ))
            return TextBoxInfo(
                element_id=tb.element_id,
                text=tb.text,
                font_size_pt=current_font,
                box_width_emu=tb.box_width_emu,
                box_height_emu=tb.box_height_emu,
                is_title=tb.is_title,
                line_spacing=current_line_spacing,
                space_after_pt=current_space_after,
                margin_left_emu=tb.margin_left_emu,
                margin_right_emu=tb.margin_right_emu,
                margin_top_emu=tb.margin_top_emu,
                margin_bottom_emu=tb.margin_bottom_emu,
            ), actions
        current_font -= FONT_STEP_PT

    # ─── 第二步：调整行距和段后间距 ─────────────────────────
    current_font = max(min_font, current_font)
    current_line_spacing = 1.0
    current_space_after = 2.0
    estimated = estimate_text_height(
        tb.text, current_font, tb.box_width_emu,
        current_line_spacing, current_space_after,
        tb.margin_left_emu, tb.margin_right_emu,
    )
    if estimated <= tb.box_height_emu:
        actions.append(RenderAction(
            slide_id=slide_id,
            issue_type=IssueType.TEXT_OVERFLOW.value,
            severity=Severity.LOW.value,
            action="reduce_spacing",
            before=f"line_spacing={tb.line_spacing}, space_after={tb.space_after_pt}pt",
            after=f"line_spacing={current_line_spacing}, space_after={current_space_after}pt",
            reason="缩小字号后仍溢出，减小行距和段后间距",
        ))
        return TextBoxInfo(
            element_id=tb.element_id,
            text=tb.text,
            font_size_pt=current_font,
            box_width_emu=tb.box_width_emu,
            box_height_emu=tb.box_height_emu,
            is_title=tb.is_title,
            line_spacing=current_line_spacing,
            space_after_pt=current_space_after,
            margin_left_emu=tb.margin_left_emu,
            margin_right_emu=tb.margin_right_emu,
            margin_top_emu=tb.margin_top_emu,
            margin_bottom_emu=tb.margin_bottom_emu,
        ), actions

    # ─── 第三步：减小 margin ────────────────────────────────
    reduced_margin = 45720  # 0.05 inch
    estimated = estimate_text_height(
        tb.text, current_font, tb.box_width_emu,
        current_line_spacing, current_space_after,
        reduced_margin, reduced_margin,
    )
    if estimated <= tb.box_height_emu:
        actions.append(RenderAction(
            slide_id=slide_id,
            issue_type=IssueType.TEXT_OVERFLOW.value,
            severity=Severity.MEDIUM.value,
            action="reduce_margin",
            before=f"margin={tb.margin_left_emu} EMU",
            after=f"margin={reduced_margin} EMU",
            reason="减小行距后仍溢出，缩小文本框内边距",
        ))
        return TextBoxInfo(
            element_id=tb.element_id,
            text=tb.text,
            font_size_pt=current_font,
            box_width_emu=tb.box_width_emu,
            box_height_emu=tb.box_height_emu,
            is_title=tb.is_title,
            line_spacing=current_line_spacing,
            space_after_pt=current_space_after,
            margin_left_emu=reduced_margin,
            margin_right_emu=reduced_margin,
            margin_top_emu=tb.margin_top_emu,
            margin_bottom_emu=tb.margin_bottom_emu,
        ), actions

    # ─── 第四步：标记 NEED_SPLIT ────────────────────────────
    actions.append(RenderAction(
        slide_id=slide_id,
        issue_type=IssueType.TEXT_OVERFLOW.value,
        severity=Severity.HIGH.value,
        action="NEED_SPLIT",
        before=f"font={current_font}pt, spacing={current_line_spacing}",
        after="NEED_SPLIT",
        reason="所有自动修复策略均无法适配，需要拆页处理",
    ))
    return TextBoxInfo(
        element_id=tb.element_id,
        text=tb.text,
        font_size_pt=current_font,
        box_width_emu=tb.box_width_emu,
        box_height_emu=tb.box_height_emu,
        is_title=tb.is_title,
        line_spacing=current_line_spacing,
        space_after_pt=current_space_after,
        margin_left_emu=reduced_margin,
        margin_right_emu=reduced_margin,
        margin_top_emu=tb.margin_top_emu,
        margin_bottom_emu=tb.margin_bottom_emu,
    ), actions
