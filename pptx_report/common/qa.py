"""Object-level QA for generated editable PowerPoint files."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE


@dataclass
class ObjectQAResult:
    slide_count: int = 0
    checked_shapes: int = 0
    issues: list[dict[str, Any]] = field(default_factory=list)
    score: int = 100

    @property
    def ok(self) -> bool:
        return not any(issue.get("level") == "error" for issue in self.issues)

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "ok": self.ok}


def _text_font_sizes(shape) -> list[float]:
    sizes: list[float] = []
    if not getattr(shape, "has_text_frame", False):
        return sizes
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            if run.text.strip() and run.font.size is not None:
                sizes.append(float(run.font.size.pt))
    return sizes


def inspect_presentation(
    path: str | Path,
    *,
    min_font_pt: float = 7.0,
    require_sources: bool = True,
) -> ObjectQAResult:
    prs = Presentation(str(path))
    width, height = int(prs.slide_width), int(prs.slide_height)
    result = ObjectQAResult(slide_count=len(prs.slides))
    for slide_index, slide in enumerate(prs.slides, 1):
        has_source = False
        nonempty_text = 0
        header_text_shapes = []
        header_pictures = []
        for shape_index, shape in enumerate(slide.shapes, 1):
            result.checked_shapes += 1
            left, top = int(shape.left), int(shape.top)
            right, bottom = left + int(shape.width), top + int(shape.height)
            if left < 0 or top < 0 or right > width or bottom > height:
                result.issues.append(
                    {
                        "level": "error",
                        "code": "shape_out_of_bounds",
                        "slide": slide_index,
                        "shape": shape_index,
                    }
                )
            text = str(getattr(shape, "text", "") or "").strip()
            if text:
                nonempty_text += 1
                if top < height * 0.20 and int(shape.width) > width * 0.25:
                    header_text_shapes.append((shape_index, shape, text))
                    if text.count("\n") >= 2:
                        result.issues.append({
                            "level": "warning",
                            "code": "title_over_two_lines",
                            "slide": slide_index,
                            "shape": shape_index,
                        })
                if "数据来源" in text or "Source" in text:
                    has_source = True
                if "nan" in text.lower():
                    result.issues.append(
                        {
                            "level": "error",
                            "code": "nan_text",
                            "slide": slide_index,
                            "shape": shape_index,
                        }
                    )
            sizes = _text_font_sizes(shape)
            if sizes and min(sizes) < min_font_pt:
                result.issues.append(
                    {
                        "level": "warning",
                        "code": "font_below_threshold",
                        "slide": slide_index,
                        "shape": shape_index,
                        "value": min(sizes),
                    }
                )
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE and top < height * 0.20:
                header_pictures.append((shape_index, shape))
            if getattr(shape, "has_chart", False):
                chart = shape.chart
                if not chart.series:
                    result.issues.append(
                        {
                            "level": "error",
                            "code": "empty_chart",
                            "slide": slide_index,
                            "shape": shape_index,
                        }
                    )
        for text_index, text_shape, _ in header_text_shapes:
            text_box = (
                int(text_shape.left), int(text_shape.top),
                int(text_shape.left + text_shape.width), int(text_shape.top + text_shape.height),
            )
            for picture_index, picture in header_pictures:
                picture_box = (
                    int(picture.left), int(picture.top),
                    int(picture.left + picture.width), int(picture.top + picture.height),
                )
                overlap_width = max(0, min(text_box[2], picture_box[2]) - max(text_box[0], picture_box[0]))
                overlap_height = max(0, min(text_box[3], picture_box[3]) - max(text_box[1], picture_box[1]))
                if overlap_width * overlap_height > 0:
                    result.issues.append({
                        "level": "error",
                        "code": "template_logo_overlaps_title",
                        "slide": slide_index,
                        "shape": text_index,
                        "related_shape": picture_index,
                    })
        if slide_index > 3 and require_sources and nonempty_text and not has_source:
            result.issues.append(
                {
                    "level": "warning",
                    "code": "source_missing",
                    "slide": slide_index,
                }
            )
    errors = sum(issue.get("level") == "error" for issue in result.issues)
    warnings = len(result.issues) - errors
    result.score = max(0, 100 - errors * 12 - warnings * 2)
    return result
