"""Content-completeness audit used before and after PPT rendering."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class RenderAudit:
    input_blocks: int = 0
    rendered_blocks: int = 0
    truncated_blocks: int = 0
    split_slide_ids: list[str] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    removed_content: list[dict[str, Any]] = field(default_factory=list)

    def record_split(self, *slide_ids: str) -> None:
        for slide_id in slide_ids:
            if slide_id and slide_id not in self.split_slide_ids:
                self.split_slide_ids.append(slide_id)

    def warn(self, code: str, **details: Any) -> None:
        self.warnings.append({"code": code, **details})

    def merge(self, other: "RenderAudit") -> "RenderAudit":
        self.input_blocks += other.input_blocks
        self.rendered_blocks += other.rendered_blocks
        self.truncated_blocks += other.truncated_blocks
        self.removed_content.extend(other.removed_content)
        self.warnings.extend(other.warnings)
        self.record_split(*other.split_slide_ids)
        return self

    @property
    def complete(self) -> bool:
        return (
            self.input_blocks == self.rendered_blocks
            and self.truncated_blocks == 0
            and not self.removed_content
        )

    def validate(self) -> None:
        if not self.complete:
            raise ValueError(
                "render audit failed: "
                f"input={self.input_blocks}, rendered={self.rendered_blocks}, "
                f"truncated={self.truncated_blocks}, removed={len(self.removed_content)}"
            )

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "complete": self.complete}
