"""Deterministic capacity handling that never silently drops user content."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import TypeVar

from .render_audit import RenderAudit

T = TypeVar("T")


class CapacityError(ValueError):
    """Raised when content cannot be preserved by splitting or re-layout."""


@dataclass(frozen=True)
class CapacityRule:
    max_blocks: int
    max_weight: int | None = None


def split_preserving_order(
    items: Sequence[T] | Iterable[T],
    *,
    max_items: int,
    max_weight: int | None = None,
    weight: Callable[[T], int] | None = None,
    source_slide_id: str = "",
) -> tuple[list[list[T]], RenderAudit]:
    """Split content in order and account for every input block.

    A single item heavier than ``max_weight`` is kept intact on its own page and
    recorded as a warning. It is never removed or truncated.
    """

    values = list(items)
    if max_items < 1:
        raise CapacityError("max_items must be at least 1")
    weight = weight or (lambda _item: 1)
    pages: list[list[T]] = []
    current: list[T] = []
    current_weight = 0
    audit = RenderAudit(input_blocks=len(values))

    for item in values:
        item_weight = max(1, int(weight(item)))
        over_count = len(current) >= max_items
        over_weight = (
            max_weight is not None
            and current
            and current_weight + item_weight > max_weight
        )
        if over_count or over_weight:
            pages.append(current)
            current = []
            current_weight = 0
        if max_weight is not None and item_weight > max_weight:
            audit.warn(
                "single_block_over_capacity",
                slide_id=source_slide_id,
                weight=item_weight,
                capacity=max_weight,
            )
        current.append(item)
        current_weight += item_weight
    if current:
        pages.append(current)

    audit.rendered_blocks = sum(len(page) for page in pages)
    if len(pages) > 1:
        audit.record_split(
            *[
                f"{source_slide_id}__part_{index + 1}"
                for index in range(len(pages))
            ]
        )
    audit.validate()
    return pages, audit
