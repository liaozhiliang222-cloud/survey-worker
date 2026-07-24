"""Shared semantic, capacity, audit, and QA primitives for PPT workflows."""

from .capacity import CapacityError, split_preserving_order
from .qa import ObjectQAResult, inspect_presentation
from .render_audit import RenderAudit
from .slide_brief import SlideBrief
from .visual_qa import VisualQAResult, inspect_slide_images, run_visual_qa

__all__ = [
    "CapacityError",
    "ObjectQAResult",
    "RenderAudit",
    "SlideBrief",
    "VisualQAResult",
    "inspect_presentation",
    "inspect_slide_images",
    "run_visual_qa",
    "split_preserving_order",
]
