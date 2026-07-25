"""确定性 PPT 生成质量检查（Render QA）与自动修复模块。

管线：SlideBrief → Renderer → RenderAudit → AutoFix → FinalValidation → PPTX

本模块不引入 AI，所有检查和修复基于：
  - 页面数据结构（SlideBrief / ChartSpec）
  - Shape/TextBox 几何信息
  - Renderer 输出结果
"""

from .models import (
    QAIssue,
    RenderAction,
    SlideQAReport,
    PageDensityScore,
    FinalValidationResult,
)
from .text_checks import check_text_overflow, fix_text_overflow
from .layout_checks import check_boundaries, compute_page_density
from .chart_checks import check_chart_space
from .auto_fix import run_auto_fix, split_text_for_pages
from .render_audit import run_render_qa, final_validation

__all__ = [
    "QAIssue",
    "RenderAction",
    "SlideQAReport",
    "PageDensityScore",
    "FinalValidationResult",
    "check_text_overflow",
    "fix_text_overflow",
    "check_boundaries",
    "compute_page_density",
    "check_chart_space",
    "run_auto_fix",
    "split_text_for_pages",
    "run_render_qa",
    "final_validation",
]
