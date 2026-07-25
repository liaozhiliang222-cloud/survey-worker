"""自动修复执行引擎。

执行顺序（Renderer 之后严格执行）：
  1. 内容完整性检查
  2. 文本容量检查
  3. 元素边界检查
  4. 图表空间检查
  5. 页面密度检查
  6. 模板重复检查
  7. Final Validation
"""

from __future__ import annotations

from typing import Any

from .models import (
    QAIssue,
    IssueType,
    RenderAction,
    Severity,
    SlideQAReport,
    PageDensityScore,
)
from .text_checks import TextBoxInfo, check_text_overflow, fix_text_overflow, estimate_text_height
from .layout_checks import ShapeInfo, PageInfo, check_boundaries, compute_page_density, check_page_density
from .chart_checks import ChartGeometry, check_chart_space


# ─── 文本拆页策略 ─────────────────────────────────────────────────────

def split_text_for_pages(
    text: str,
    font_size_pt: float,
    box_width_emu: int,
    box_height_emu: int,
    line_spacing: float = 1.2,
    space_after_pt: float = 4.0,
    margin_left_emu: int = 91440,
    margin_right_emu: int = 91440,
) -> list[str]:
    """按段落/句子边界将溢出文本拆分为多页。

    策略：
      1. 优先按段落（\n）边界拆分
      2. 单段落仍溢出时按句子边界（。！？；）拆分
      3. 单句仍溢出时按字符数硬切

    Returns:
        拆分后的文本列表，每个元素对应一页。
    """
    if not text or not text.strip():
        return [text]

    def fits(chunk: str) -> bool:
        h = estimate_text_height(
            chunk, font_size_pt, box_width_emu,
            line_spacing, space_after_pt,
            margin_left_emu, margin_right_emu,
        )
        return h <= box_height_emu

    # 如果整体能放下，无需拆分
    if fits(text):
        return [text]

    # 第一步：按段落拆分
    paragraphs = text.split("\n")
    pages: list[str] = []
    current_page = ""

    for para in paragraphs:
        candidate = f"{current_page}\n{para}" if current_page else para
        if fits(candidate):
            current_page = candidate
        else:
            # 当前页已满，先保存
            if current_page:
                pages.append(current_page)
            # 检查单段落是否能放入一页
            if fits(para):
                current_page = para
            else:
                # 单段落溢出，按句子拆分
                sentence_pages, remainder = _split_paragraph_by_sentences(
                    para, font_size_pt, box_width_emu, box_height_emu,
                    line_spacing, space_after_pt, margin_left_emu, margin_right_emu,
                )
                pages.extend(sentence_pages[:-1])  # 前面的完整页
                current_page = sentence_pages[-1] if sentence_pages else ""
                if remainder:
                    current_page = f"{current_page}\n{remainder}" if current_page else remainder

    if current_page:
        pages.append(current_page)

    return pages if pages else [text]


def _split_paragraph_by_sentences(
    paragraph: str,
    font_size_pt: float,
    box_width_emu: int,
    box_height_emu: int,
    line_spacing: float,
    space_after_pt: float,
    margin_left_emu: int,
    margin_right_emu: int,
) -> tuple[list[str], str]:
    """按句子边界拆分单个段落。

    Returns:
        (pages, remainder) — pages 是拆分后的页面列表，remainder 是剩余未放置内容。
    """
    import re

    def fits(chunk: str) -> bool:
        h = estimate_text_height(
            chunk, font_size_pt, box_width_emu,
            line_spacing, space_after_pt,
            margin_left_emu, margin_right_emu,
        )
        return h <= box_height_emu

    # 按中英文句子结束符拆分
    sentences = re.split(r'(?<=[。！？；.!?;])', paragraph)
    sentences = [s for s in sentences if s.strip()]

    if not sentences:
        return [paragraph], ""

    pages: list[str] = []
    current = ""

    for sent in sentences:
        candidate = f"{current}{sent}" if current else sent
        if fits(candidate):
            current = candidate
        else:
            if current:
                pages.append(current)
            # 单句仍溢出，硬切
            if not fits(sent):
                chunks = _hard_split(sent, font_size_pt, box_width_emu, box_height_emu,
                                      line_spacing, space_after_pt, margin_left_emu, margin_right_emu)
                pages.extend(chunks[:-1])
                current = chunks[-1] if chunks else ""
            else:
                current = sent

    if current:
        pages.append(current)

    return pages, ""


def _hard_split(
    text: str,
    font_size_pt: float,
    box_width_emu: int,
    box_height_emu: int,
    line_spacing: float,
    space_after_pt: float,
    margin_left_emu: int,
    margin_right_emu: int,
) -> list[str]:
    """按字符数硬切（最后手段）。"""
    def fits(chunk: str) -> bool:
        h = estimate_text_height(
            chunk, font_size_pt, box_width_emu,
            line_spacing, space_after_pt,
            margin_left_emu, margin_right_emu,
        )
        return h <= box_height_emu

    if fits(text):
        return [text]

    # 二分法找到每页最大字符数
    pages = []
    remaining = text
    while remaining:
        if fits(remaining):
            pages.append(remaining)
            break
        # 二分查找最大可放置长度
        lo, hi = 1, len(remaining)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if fits(remaining[:mid]):
                lo = mid
            else:
                hi = mid - 1
        pages.append(remaining[:lo])
        remaining = remaining[lo:]

    return pages


def check_content_completeness(
    slide_id: str,
    title: str,
    claim: str,
    evidence_fact_ids: list[str],
    source_references: list[str],
    charts_data: list[dict[str, Any]] | None = None,
) -> list[QAIssue]:
    """检查核心内容完整性。

    核心元素为空时标记 CONTENT_MISSING，阻止导出。
    非核心元素为空时直接删除（不记录 issue）。
    """
    issues: list[QAIssue] = []

    if not title or not title.strip():
        issues.append(QAIssue(
            slide_id=slide_id,
            issue_type=IssueType.CONTENT_MISSING,
            severity=Severity.HIGH,
            message="页面标题为空",
            element_id="title",
        ))

    if not claim or not claim.strip():
        issues.append(QAIssue(
            slide_id=slide_id,
            issue_type=IssueType.CONTENT_MISSING,
            severity=Severity.MEDIUM,
            message="核心结论（claim）为空",
            element_id="claim",
        ))

    if charts_data:
        for i, chart in enumerate(charts_data):
            categories = chart.get("categories", [])
            series = chart.get("series", [])
            if not categories:
                issues.append(QAIssue(
                    slide_id=slide_id,
                    issue_type=IssueType.EMPTY_ELEMENT,
                    severity=Severity.MEDIUM,
                    message=f"图表 {i + 1} 类目数据为空",
                    element_id=f"chart_{i}",
                ))
            if not series:
                issues.append(QAIssue(
                    slide_id=slide_id,
                    issue_type=IssueType.EMPTY_ELEMENT,
                    severity=Severity.MEDIUM,
                    message=f"图表 {i + 1} 系列数据为空",
                    element_id=f"chart_{i}",
                ))

    return issues


def check_layout_repeat(
    slide_ids_and_types: list[tuple[str, str, str]],
) -> tuple[list[QAIssue], list[RenderAction]]:
    """检查连续页面模板重复。

    Args:
        slide_ids_and_types: [(slide_id, slide_type, layout_family), ...]

    Returns:
        (issues, actions)
    """
    issues: list[QAIssue] = []
    actions: list[RenderAction] = []

    if len(slide_ids_and_types) < 3:
        return issues, actions

    # 检查连续 3 页以上使用相同 slide_type + layout_family
    streak_start = 0
    for i in range(1, len(slide_ids_and_types) + 1):
        if i < len(slide_ids_and_types):
            _, cur_type, cur_family = slide_ids_and_types[i]
            _, prev_type, prev_family = slide_ids_and_types[i - 1]
            if cur_type == prev_type and cur_family == prev_family:
                continue
        # streak ended
        streak_len = i - streak_start
        if streak_len >= 3:
            streak_slides = slide_ids_and_types[streak_start:i]
            slide_id = streak_slides[0][0]
            layout = streak_slides[0][2]
            issues.append(QAIssue(
                slide_id=slide_id,
                issue_type=IssueType.LAYOUT_REPEAT,
                severity=Severity.LOW,
                message=f"连续 {streak_len} 页使用相同布局（{layout}），建议交替使用不同模板",
                details={
                    "streak_length": streak_len,
                    "layout_family": layout,
                    "slide_ids": [s[0] for s in streak_slides],
                },
            ))
            actions.append(RenderAction(
                slide_id=slide_id,
                issue_type=IssueType.LAYOUT_REPEAT.value,
                severity=Severity.LOW.value,
                action="suggest_alternate_layout",
                before=f"{streak_len}x {layout}",
                after="alternate_layouts",
                reason="连续页面布局重复，建议交替使用备用模板",
            ))
        streak_start = i

    return issues, actions


def run_auto_fix(
    slide_id: str,
    textboxes: list[TextBoxInfo] | None = None,
    shapes: list[ShapeInfo] | None = None,
    charts: list[ChartGeometry] | None = None,
    page_info: PageInfo | None = None,
    title: str = "",
    claim: str = "",
    evidence_fact_ids: list[str] | None = None,
    source_references: list[str] | None = None,
    charts_data: list[dict[str, Any]] | None = None,
    slide_width: int | None = None,
    slide_height: int | None = None,
) -> SlideQAReport:
    """对单页执行完整的自动修复管线。

    执行顺序：
      1. 内容完整性检查
      2. 文本容量检查 + 修复
      3. 元素边界检查 + 修复
      4. 图表空间检查
      5. 页面密度检查
    """
    report = SlideQAReport(slide_id=slide_id)

    # ─── 1. 内容完整性检查 ──────────────────────────────────
    content_issues = check_content_completeness(
        slide_id, title, claim,
        evidence_fact_ids or [],
        source_references or [],
        charts_data,
    )
    for issue in content_issues:
        report.add_issue(issue)

    # ─── 2. 文本容量检查 + 修复 ─────────────────────────────
    if textboxes:
        text_issues = check_text_overflow(slide_id, textboxes)
        for issue in text_issues:
            report.add_issue(issue)
        # 对溢出的文本框执行修复
        for tb in textboxes:
            estimated_issues = [
                i for i in text_issues if i.element_id == tb.element_id
            ]
            if estimated_issues:
                _fixed_tb, fix_actions = fix_text_overflow(slide_id, tb)
                for action in fix_actions:
                    report.add_action(action)

    # ─── 3. 元素边界检查 + 修复 ─────────────────────────────
    if shapes:
        sw = slide_width or int(12192000)  # 13.333 inch
        sh = slide_height or int(6858000)  # 7.5 inch
        bound_issues, bound_actions, _fixed = check_boundaries(
            slide_id, shapes, sw, sh
        )
        for issue in bound_issues:
            report.add_issue(issue)
        for action in bound_actions:
            report.add_action(action)

    # ─── 4. 图表空间检查 ────────────────────────────────────
    if charts:
        chart_issues, chart_actions = check_chart_space(slide_id, charts)
        for issue in chart_issues:
            report.add_issue(issue)
        for action in chart_actions:
            report.add_action(action)

    # ─── 5. 页面密度检查 ────────────────────────────────────
    if page_info:
        density = compute_page_density(page_info)
        report.density = density
        density_issues = check_page_density(page_info)
        for issue in density_issues:
            report.add_issue(issue)

    return report
