"""Semantic contract shared by quantitative reports and proposal decks."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class SlideBrief:
    """A renderer-independent explanation of why a slide exists.

    The AI may propose these semantic fields, but deterministic code validates
    references and owns all geometry, typography, colors, and chart data.
    """

    slide_id: str
    slide_type: str
    chapter: str
    title: str
    question_answered: str
    claim: str
    business_implication: str
    evidence_question_ids: list[str] = field(default_factory=list)
    evidence_fact_ids: list[str] = field(default_factory=list)
    source_references: list[str] = field(default_factory=list)
    visual_intent: str = "evidence"
    layout_family: str = "chart_with_insight"
    relation_type: str = "sequential"
    density: str = "medium"
    relationship_to_previous: str = ""
    relationship_to_next: str = ""
    locked: bool = False
    template_id: str = ""

    def validate(
        self,
        *,
        question_ids: set[str] | None = None,
        fact_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        required = {
            "slide_id": self.slide_id,
            "slide_type": self.slide_type,
            "chapter": self.chapter,
            "question_answered": self.question_answered,
            "claim": self.claim,
        }
        for field_name, value in required.items():
            if not str(value or "").strip():
                issues.append(
                    {
                        "level": "error",
                        "code": "slide_brief_required",
                        "field": field_name,
                        "slide_id": self.slide_id,
                    }
                )
        if question_ids is not None:
            missing = sorted(set(self.evidence_question_ids) - question_ids)
            if missing:
                issues.append(
                    {
                        "level": "error",
                        "code": "unknown_question_reference",
                        "slide_id": self.slide_id,
                        "values": missing,
                    }
                )
        if fact_ids is not None:
            missing = sorted(set(self.evidence_fact_ids) - fact_ids)
            if missing:
                issues.append(
                    {
                        "level": "error",
                        "code": "unknown_fact_reference",
                        "slide_id": self.slide_id,
                        "values": missing,
                    }
                )
        return issues

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SlideBrief":
        fields = cls.__dataclass_fields__
        payload = {name: data[name] for name in fields if name in data}
        for name in (
            "evidence_question_ids",
            "evidence_fact_ids",
            "source_references",
        ):
            payload[name] = [str(value) for value in data.get(name, [])]
        return cls(**payload)
