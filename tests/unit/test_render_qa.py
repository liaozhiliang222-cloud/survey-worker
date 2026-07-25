"""Render QA 模块单元测试。

覆盖 6 类场景：
  1. 文本溢出检测与修复
  2. 内容完整性检查
  3. 元素越界检测与修复
  4. 图表密度检查
  5. 空内容检查
  6. 模板重复检查
"""

import sys
from pathlib import Path

# 确保项目根目录在 sys.path 中
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from pptx.util import Inches, Pt
from pptx_report.qa.models import (
    QAIssue, IssueType, Severity, PageDensityScore,
    RenderAction, SlideQAReport, FinalValidationResult,
)
from pptx_report.qa.text_checks import (
    TextBoxInfo, estimate_text_height, check_text_overflow, fix_text_overflow,
)
from pptx_report.qa.layout_checks import (
    ShapeInfo, PageInfo, check_boundaries, compute_page_density, check_page_density,
)
from pptx_report.qa.chart_checks import ChartGeometry, check_chart_space
from pptx_report.qa.auto_fix import (
    run_auto_fix, check_content_completeness, check_layout_repeat,
)
from pptx_report.qa.render_audit import final_validation


# ═══════════════════════════════════════════════════════════
# 1. 文本溢出测试
# ═══════════════════════════════════════════════════════════

class TestTextOverflow:
    def test_long_text_triggers_overflow(self):
        """超长标题触发 TEXT_OVERFLOW。"""
        long_text = "这是一个非常非常长的标题" * 20  # ~240 字符
        tb = TextBoxInfo(
            element_id="title_1",
            text=long_text,
            font_size_pt=18,
            box_width_emu=int(Inches(5)),
            box_height_emu=int(Inches(0.75)),
            is_title=True,
        )
        issues = check_text_overflow("slide_01", [tb])
        assert len(issues) >= 1
        assert issues[0].issue_type == IssueType.TEXT_OVERFLOW
        assert issues[0].severity in (Severity.MEDIUM, Severity.HIGH)

    def test_short_text_no_overflow(self):
        """短文本不触发溢出。"""
        tb = TextBoxInfo(
            element_id="title_2",
            text="简短标题",
            font_size_pt=18,
            box_width_emu=int(Inches(8)),
            box_height_emu=int(Inches(1)),
            is_title=True,
        )
        issues = check_text_overflow("slide_01", [tb])
        assert len(issues) == 0

    def test_fix_reduces_font_size(self):
        """自动修复缩小字号。"""
        long_text = "这是一段较长的正文内容" * 15
        tb = TextBoxInfo(
            element_id="body_1",
            text=long_text,
            font_size_pt=18,
            box_width_emu=int(Inches(5)),
            box_height_emu=int(Inches(1.5)),
            is_title=False,
        )
        fixed_tb, actions = fix_text_overflow("slide_01", tb)
        assert len(actions) >= 1
        assert actions[0].action in ("reduce_font_size", "reduce_spacing", "reduce_margin", "NEED_SPLIT")
        # 内容不丢失
        assert fixed_tb.text == long_text

    def test_fix_never_deletes_content(self):
        """修复后内容不丢失。"""
        text = "重要数据内容 " * 50
        tb = TextBoxInfo(
            element_id="body_2",
            text=text,
            font_size_pt=16,
            box_width_emu=int(Inches(4)),
            box_height_emu=int(Inches(1)),
            is_title=False,
        )
        fixed_tb, actions = fix_text_overflow("slide_02", tb)
        assert fixed_tb.text == text  # 内容完整保留

    def test_estimate_height_increases_with_text(self):
        """文本越长，估算高度越大。"""
        h_short = estimate_text_height("短文本", 14, int(Inches(5)))
        h_long = estimate_text_height("这是一段很长的文本内容" * 10, 14, int(Inches(5)))
        assert h_long > h_short


# ═══════════════════════════════════════════════════════════
# 2. 内容完整性测试
# ═══════════════════════════════════════════════════════════

class TestContentCompleteness:
    def test_empty_title_detected(self):
        """空标题触发 CONTENT_MISSING。"""
        issues = check_content_completeness(
            "slide_03", title="", claim="有结论",
            evidence_fact_ids=["f1"], source_references=[],
        )
        assert any(i.issue_type == IssueType.CONTENT_MISSING for i in issues)

    def test_empty_claim_detected(self):
        """空结论触发 CONTENT_MISSING。"""
        issues = check_content_completeness(
            "slide_04", title="有标题", claim="",
            evidence_fact_ids=["f1"], source_references=[],
        )
        assert any(i.issue_type == IssueType.CONTENT_MISSING for i in issues)

    def test_complete_content_passes(self):
        """完整内容不触发问题。"""
        issues = check_content_completeness(
            "slide_05", title="标题", claim="结论",
            evidence_fact_ids=["f1", "f2"], source_references=["src"],
        )
        assert len(issues) == 0

    def test_empty_chart_data_detected(self):
        """空图表数据触发 EMPTY_ELEMENT。"""
        issues = check_content_completeness(
            "slide_06", title="标题", claim="结论",
            evidence_fact_ids=[], source_references=[],
            charts_data=[{"categories": [], "series": []}],
        )
        assert any(i.issue_type == IssueType.EMPTY_ELEMENT for i in issues)


# ═══════════════════════════════════════════════════════════
# 3. 越界测试
# ═══════════════════════════════════════════════════════════

class TestBoundary:
    def test_shape_out_of_bound_fixed(self):
        """Shape 超过页面边界时自动调整。"""
        slide_w = int(Inches(13.333))
        slide_h = int(Inches(7.5))
        shape = ShapeInfo(
            element_id="chart_1",
            shape_type="chart",
            left=int(Inches(11)),
            top=int(Inches(6)),
            width=int(Inches(4)),  # 超出右边界
            height=int(Inches(3)),  # 超出下边界
        )
        issues, actions, fixed = check_boundaries("slide_07", [shape], slide_w, slide_h)
        assert len(issues) == 1
        assert issues[0].issue_type == IssueType.OUT_OF_BOUND
        assert len(actions) == 1
        # 修复后在页面内
        f = fixed[0]
        assert f.left + f.width <= slide_w
        assert f.top + f.height <= slide_h

    def test_shape_within_bounds_passes(self):
        """页面内的 Shape 不触发问题。"""
        slide_w = int(Inches(13.333))
        slide_h = int(Inches(7.5))
        shape = ShapeInfo(
            element_id="tb_1",
            shape_type="textbox",
            left=int(Inches(1)),
            top=int(Inches(1)),
            width=int(Inches(5)),
            height=int(Inches(2)),
        )
        issues, actions, fixed = check_boundaries("slide_08", [shape], slide_w, slide_h)
        assert len(issues) == 0
        assert len(actions) == 0

    def test_negative_position_fixed(self):
        """负坐标自动修复。"""
        slide_w = int(Inches(13.333))
        slide_h = int(Inches(7.5))
        shape = ShapeInfo(
            element_id="img_1",
            shape_type="image",
            left=-100000,
            top=-50000,
            width=int(Inches(3)),
            height=int(Inches(2)),
        )
        issues, actions, fixed = check_boundaries("slide_09", [shape], slide_w, slide_h)
        assert len(issues) == 1
        assert fixed[0].left >= 0
        assert fixed[0].top >= 0


# ═══════════════════════════════════════════════════════════
# 4. 图表密度测试
# ═══════════════════════════════════════════════════════════

class TestChartDensity:
    def test_too_many_categories_column(self):
        """纵向柱状图超过 12 个类目触发警告。"""
        chart = ChartGeometry(
            element_id="chart_2",
            chart_type="column",
            categories=[f"类目{i}" for i in range(30)],
            series_names=["系列1"],
            width_emu=int(Inches(6)),
            height_emu=int(Inches(4)),
        )
        issues, actions = check_chart_space("slide_10", [chart])
        assert any(i.issue_type == IssueType.CHART_DENSITY_HIGH for i in issues)
        # 建议切换为横向
        assert any(a.action == "switch_to_horizontal_bar" for a in actions)

    def test_normal_categories_passes(self):
        """正常类目数不触发问题。"""
        chart = ChartGeometry(
            element_id="chart_3",
            chart_type="column",
            categories=["A", "B", "C", "D"],
            series_names=["系列1"],
            width_emu=int(Inches(6)),
            height_emu=int(Inches(4)),
        )
        issues, actions = check_chart_space("slide_11", [chart])
        assert len(issues) == 0

    def test_chart_too_small(self):
        """图表尺寸不足触发警告。"""
        chart = ChartGeometry(
            element_id="chart_4",
            chart_type="bar",
            categories=["A", "B"],
            series_names=["S1"],
            width_emu=int(Inches(2)),  # < 3.5 inch
            height_emu=int(Inches(1)),  # < 2.0 inch
        )
        issues, actions = check_chart_space("slide_12", [chart])
        assert any(i.issue_type == IssueType.CHART_TOO_SMALL for i in issues)


# ═══════════════════════════════════════════════════════════
# 5. 空内容测试
# ═══════════════════════════════════════════════════════════

class TestEmptyContent:
    def test_empty_textbox_skipped(self):
        """空文本框不参与溢出检查。"""
        tb = TextBoxInfo(
            element_id="empty_tb",
            text="",
            font_size_pt=14,
            box_width_emu=int(Inches(5)),
            box_height_emu=int(Inches(1)),
        )
        issues = check_text_overflow("slide_13", [tb])
        assert len(issues) == 0

    def test_empty_chart_categories(self):
        """空图表类目触发 EMPTY_ELEMENT。"""
        issues = check_content_completeness(
            "slide_14", title="标题", claim="结论",
            evidence_fact_ids=[], source_references=[],
            charts_data=[{"categories": [], "series": ["S1"]}],
        )
        assert any(i.issue_type == IssueType.EMPTY_ELEMENT for i in issues)


# ═══════════════════════════════════════════════════════════
# 6. 模板重复测试
# ═══════════════════════════════════════════════════════════

class TestLayoutRepeat:
    def test_consecutive_same_layout_detected(self):
        """连续 3 页以上相同布局触发 LAYOUT_REPEAT。"""
        slides = [
            ("slide_05", "KEY_FINDING", "KF_01"),
            ("slide_06", "KEY_FINDING", "KF_01"),
            ("slide_07", "KEY_FINDING", "KF_01"),
            ("slide_08", "KEY_FINDING", "KF_01"),
        ]
        issues, actions = check_layout_repeat(slides)
        assert len(issues) >= 1
        assert issues[0].issue_type == IssueType.LAYOUT_REPEAT

    def test_alternating_layouts_pass(self):
        """交替布局不触发问题。"""
        slides = [
            ("slide_01", "CHART", "chart_with_insight"),
            ("slide_02", "KEY_FINDING", "KF_01"),
            ("slide_03", "CHART", "chart_with_insight"),
            ("slide_04", "KEY_FINDING", "KF_01"),
        ]
        issues, actions = check_layout_repeat(slides)
        assert len(issues) == 0

    def test_two_consecutive_ok(self):
        """仅 2 页相同不触发。"""
        slides = [
            ("slide_01", "CHART", "chart_with_insight"),
            ("slide_02", "CHART", "chart_with_insight"),
            ("slide_03", "KEY_FINDING", "KF_01"),
        ]
        issues, actions = check_layout_repeat(slides)
        assert len(issues) == 0


# ═══════════════════════════════════════════════════════════
# 7. 密度评分测试
# ═══════════════════════════════════════════════════════════

class TestPageDensity:
    def test_overload_density(self):
        """高密度页面评为 OVERLOAD。"""
        shapes = [
            ShapeInfo(
                element_id=f"tb_{i}", shape_type="textbox",
                left=0, top=0, width=int(Inches(3)), height=int(Inches(1)),
                text="密集文本内容" * 30,
            )
            for i in range(15)
        ]
        page = PageInfo(slide_id="slide_15", shapes=shapes)
        density = compute_page_density(page)
        assert density in (PageDensityScore.HIGH, PageDensityScore.OVERLOAD)

    def test_low_density(self):
        """稀疏页面评为 LOW。"""
        shapes = [
            ShapeInfo(
                element_id="tb_1", shape_type="textbox",
                left=0, top=0, width=int(Inches(3)), height=int(Inches(1)),
                text="短文本",
            )
        ]
        page = PageInfo(slide_id="slide_16", shapes=shapes)
        density = compute_page_density(page)
        assert density == PageDensityScore.LOW


# ═══════════════════════════════════════════════════════════
# 8. Final Validation 测试
# ═══════════════════════════════════════════════════════════

class TestFinalValidation:
    def test_clean_report_scores_100(self):
        """无问题报告得 100 分。"""
        result = FinalValidationResult()
        result = final_validation(result)
        assert result.score == 100
        assert result.passed is True

    def test_high_issues_reduce_score(self):
        """HIGH 问题降低评分。"""
        result = FinalValidationResult()
        result.issues.append(QAIssue(
            slide_id="s1", issue_type=IssueType.CONTENT_MISSING,
            severity=Severity.HIGH, message="标题为空",
        ))
        result = final_validation(result)
        assert result.score < 100
        assert result.content_ok is False

    def test_actions_add_bonus(self):
        """自动修复加分。"""
        result = FinalValidationResult()
        result.issues.append(QAIssue(
            slide_id="s1", issue_type=IssueType.TEXT_OVERFLOW,
            severity=Severity.MEDIUM, message="文本溢出",
        ))
        result.actions.append(RenderAction(
            slide_id="s1", issue_type="TEXT_OVERFLOW",
            severity="low", action="reduce_font_size",
            before="18pt", after="16pt", reason="适配",
        ))
        result = final_validation(result)
        # 有修复加分
        assert result.score > 80


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
