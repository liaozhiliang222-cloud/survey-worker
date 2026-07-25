"""QA 模块核心数据模型。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class IssueType(str, Enum):
    TEXT_OVERFLOW = "TEXT_OVERFLOW"
    OUT_OF_BOUND = "OUT_OF_BOUND"
    CHART_DENSITY_HIGH = "CHART_DENSITY_HIGH"
    CHART_TOO_SMALL = "CHART_TOO_SMALL"
    LEGEND_TOO_LONG = "LEGEND_TOO_LONG"
    PAGE_OVERLOAD = "PAGE_OVERLOAD"
    CONTENT_MISSING = "CONTENT_MISSING"
    LAYOUT_REPEAT = "LAYOUT_REPEAT"
    EMPTY_ELEMENT = "EMPTY_ELEMENT"


class PageDensityScore(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    OVERLOAD = "OVERLOAD"


@dataclass
class QAIssue:
    """单个质量问题。"""

    slide_id: str
    issue_type: IssueType
    severity: Severity
    message: str
    element_id: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "slide_id": self.slide_id,
            "issue_type": self.issue_type.value,
            "severity": self.severity.value,
            "message": self.message,
            "element_id": self.element_id,
            "details": self.details,
        }


@dataclass
class RenderAction:
    """记录一次自动修复操作。"""

    slide_id: str
    issue_type: str
    severity: str
    action: str
    before: str
    after: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SlideQAReport:
    """单页 QA 报告。"""

    slide_id: str
    issues: list[QAIssue] = field(default_factory=list)
    actions: list[RenderAction] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    passed: bool = True
    density: PageDensityScore = PageDensityScore.MEDIUM

    def add_issue(self, issue: QAIssue) -> None:
        self.issues.append(issue)
        if issue.severity in (Severity.MEDIUM, Severity.HIGH):
            self.passed = False

    def add_action(self, action: RenderAction) -> None:
        self.actions.append(action)

    def to_dict(self) -> dict[str, Any]:
        return {
            "slide_id": self.slide_id,
            "issues": [i.to_dict() for i in self.issues],
            "actions": [a.to_dict() for a in self.actions],
            "warnings": self.warnings,
            "passed": self.passed,
            "density": self.density.value,
        }


@dataclass
class FinalValidationResult:
    """最终验证结果。"""

    passed: bool = True
    content_ok: bool = True
    layout_ok: bool = True
    chart_ok: bool = True
    issues: list[QAIssue] = field(default_factory=list)
    actions: list[RenderAction] = field(default_factory=list)
    slide_reports: list[SlideQAReport] = field(default_factory=list)
    score: int = 100

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "content_ok": self.content_ok,
            "layout_ok": self.layout_ok,
            "chart_ok": self.chart_ok,
            "score": self.score,
            "issues": [i.to_dict() for i in self.issues],
            "auto_fixed": [a.to_dict() for a in self.actions],
            "warnings": [
                w for sr in self.slide_reports for w in sr.warnings
            ],
            "slide_count": len(self.slide_reports),
        }
