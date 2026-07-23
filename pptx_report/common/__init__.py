"""Shared semantic, capacity, audit, and QA primitives for PPT workflows."""

from .capacity import CapacityError, split_preserving_order
from .qa import ObjectQAResult, inspect_presentation
from .render_audit import RenderAudit
from .slide_brief import SlideBrief

__all__ = [
    "CapacityError",
    "ObjectQAResult",
    "RenderAudit",
    "SlideBrief",
    "inspect_presentation",
    "split_preserving_order",
]
