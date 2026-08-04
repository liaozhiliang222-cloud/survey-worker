"""Project-specific research theme contracts and chapter checks."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable


@dataclass
class ResearchTheme:
    """A project-defined research purpose used to constrain report chapters."""

    theme_id: str
    name: str
    description: str
    decision_area: str
    allowed_chapters: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    priority: int = 0

    def validate(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        required = {
            "theme_id": self.theme_id,
            "name": self.name,
            "description": self.description,
            "decision_area": self.decision_area,
        }
        for field_name, value in required.items():
            if not str(value or "").strip():
                issues.append({
                    "level": "error",
                    "code": "research_theme_required",
                    "field": field_name,
                    "theme_id": self.theme_id,
                })
        if not self.allowed_chapters:
            issues.append({
                "level": "error",
                "code": "research_theme_chapter_required",
                "field": "allowed_chapters",
                "theme_id": self.theme_id,
            })
        return issues

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ResearchTheme":
        return cls(
            theme_id=str(data.get("theme_id") or ""),
            name=str(data.get("name") or ""),
            description=str(data.get("description") or ""),
            decision_area=str(data.get("decision_area") or ""),
            allowed_chapters=[
                str(value) for value in data.get("allowed_chapters", [])
                if str(value).strip()
            ],
            keywords=[
                str(value) for value in data.get("keywords", [])
                if str(value).strip()
            ],
            priority=int(data.get("priority") or 0),
        )


def chapter_allows_theme(
    chapter: dict[str, Any],
    theme_id: str,
    themes: Iterable[ResearchTheme | dict[str, Any]],
) -> bool:
    """Return True when a project-defined theme may appear in a chapter."""

    explicit = {
        str(value) for value in chapter.get("allowed_themes", [])
        if str(value).strip()
    }
    if explicit:
        return theme_id in explicit
    chapter_title = str(chapter.get("title") or "").strip()
    for value in themes:
        theme = value if isinstance(value, ResearchTheme) else ResearchTheme.from_dict(value)
        if theme.theme_id == theme_id:
            return chapter_title in theme.allowed_chapters
    return True


def find_theme_chapter_warnings(
    chapters: Iterable[dict[str, Any]],
    assignments: Iterable[dict[str, Any]],
    themes: Iterable[ResearchTheme | dict[str, Any]],
) -> list[dict[str, Any]]:
    """Detect page assignments that violate the project taxonomy."""

    assignment_by_page = {
        int(item["page_idx"]): item
        for item in assignments
        if item.get("page_idx") is not None
    }
    warnings: list[dict[str, Any]] = []
    for chapter in chapters:
        for page_idx in chapter.get("page_idxs", []):
            assignment = assignment_by_page.get(int(page_idx))
            if not assignment:
                continue
            theme_id = str(
                assignment.get("research_theme")
                or assignment.get("theme_id")
                or ""
            )
            if not theme_id or chapter_allows_theme(chapter, theme_id, themes):
                continue
            warnings.append({
                "level": "warning",
                "code": "research_theme_chapter_mismatch",
                "page_idx": int(page_idx),
                "research_theme": theme_id,
                "chapter": str(chapter.get("title") or ""),
            })
    return warnings
