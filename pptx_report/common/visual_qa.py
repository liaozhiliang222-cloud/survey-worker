"""Optional rendered-image QA for generated PowerPoint files."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any, Iterable

from PIL import Image, ImageChops, ImageStat


@dataclass
class VisualQAResult:
    status: str = "skipped"
    checked_slides: int = 0
    issues: list[dict[str, Any]] = field(default_factory=list)
    score: int = 100
    reason: str = ""
    toolchain: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not any(issue.get("level") == "error" for issue in self.issues)

    @property
    def error_count(self) -> int:
        return sum(issue.get("level") == "error" for issue in self.issues)

    @property
    def warning_count(self) -> int:
        return len(self.issues) - self.error_count

    def to_dict(self) -> dict[str, Any]:
        return {
            **asdict(self),
            "ok": self.ok,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
        }


def _background_color(image: Image.Image) -> tuple[int, int, int]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    inset_x = max(0, min(width - 1, int(width * 0.01)))
    inset_y = max(0, min(height - 1, int(height * 0.01)))
    samples = [
        rgb.getpixel((inset_x, inset_y)),
        rgb.getpixel((width - 1 - inset_x, inset_y)),
        rgb.getpixel((inset_x, height - 1 - inset_y)),
        rgb.getpixel((width - 1 - inset_x, height - 1 - inset_y)),
    ]
    return tuple(int(sum(sample[channel] for sample in samples) / len(samples)) for channel in range(3))


def _foreground_mask(image: Image.Image, threshold: int = 28) -> Image.Image:
    rgb = image.convert("RGB")
    if max(rgb.size) > 1000:
        scale = 1000 / max(rgb.size)
        rgb = rgb.resize((max(1, int(rgb.width * scale)), max(1, int(rgb.height * scale))))
    background = Image.new("RGB", rgb.size, _background_color(rgb))
    difference = ImageChops.difference(rgb, background).convert("L")
    return difference.point(lambda value: 255 if value >= threshold else 0)


def _foreground_ratio(mask: Image.Image, box: tuple[int, int, int, int] | None = None) -> float:
    sample = mask.crop(box) if box else mask
    if sample.width <= 0 or sample.height <= 0:
        return 0.0
    mean = ImageStat.Stat(sample).mean[0]
    return float(mean / 255.0)


def inspect_slide_images(paths: Iterable[str | Path]) -> VisualQAResult:
    result = VisualQAResult(status="completed")
    for slide_index, path in enumerate(paths, 1):
        with Image.open(path) as image:
            mask = _foreground_mask(image)
        result.checked_slides += 1
        content_ratio = _foreground_ratio(mask)
        if slide_index > 3 and content_ratio < 0.004:
            result.issues.append({
                "level": "warning",
                "code": "visually_near_empty_slide",
                "slide": slide_index,
                "content_ratio": round(content_ratio, 4),
            })
        margin_x = max(2, int(mask.width * 0.008))
        margin_y = max(2, int(mask.height * 0.012))
        edge_ratio = max(
            _foreground_ratio(mask, (0, 0, mask.width, margin_y)),
            _foreground_ratio(mask, (0, mask.height - margin_y, mask.width, mask.height)),
            _foreground_ratio(mask, (0, 0, margin_x, mask.height)),
            _foreground_ratio(mask, (mask.width - margin_x, 0, mask.width, mask.height)),
        )
        if 0.01 < content_ratio < 0.75 and edge_ratio > 0.38:
            result.issues.append({
                "level": "warning",
                "code": "content_touches_page_edge",
                "slide": slide_index,
                "edge_ratio": round(edge_ratio, 4),
            })
        if content_ratio > 0.62:
            result.issues.append({
                "level": "warning",
                "code": "visually_overdense_slide",
                "slide": slide_index,
                "content_ratio": round(content_ratio, 4),
            })

        left_ratio = _foreground_ratio(mask, (0, 0, mask.width // 2, mask.height))
        right_ratio = _foreground_ratio(mask, (mask.width // 2, 0, mask.width, mask.height))
        denser_half = max(left_ratio, right_ratio)
        emptier_half = min(left_ratio, right_ratio)
        if slide_index > 3 and 0.02 < content_ratio < 0.55 and denser_half > 0.18 and emptier_half < 0.004:
            result.issues.append({
                "level": "warning",
                "code": "large_asymmetric_blank_area",
                "slide": slide_index,
                "denser_half_ratio": round(denser_half, 4),
                "emptier_half_ratio": round(emptier_half, 4),
            })
    result.score = max(0, 100 - result.error_count * 12 - result.warning_count * 3)
    return result


def run_visual_qa(
    pptx_path: str | Path,
    *,
    office_converter: str | None = None,
    pdf_rasterizer: str | None = None,
    timeout: int = 180,
) -> VisualQAResult:
    converter = office_converter or shutil.which("libreoffice") or shutil.which("soffice")
    rasterizer = pdf_rasterizer or shutil.which("pdftoppm")
    toolchain = {
        "office": Path(converter).name if converter else "",
        "rasterizer": Path(rasterizer).name if rasterizer else "",
    }
    if not converter:
        return VisualQAResult(reason="LibreOffice is not installed", toolchain=toolchain)
    if not rasterizer:
        return VisualQAResult(reason="pdftoppm is not installed", toolchain=toolchain)
    source = Path(pptx_path)
    try:
        with tempfile.TemporaryDirectory(prefix="surveykit-visual-qa-") as temp_dir:
            completed = subprocess.run(
                [converter, "--headless", "--convert-to", "pdf", "--outdir", temp_dir, str(source)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
            pdf_path = Path(temp_dir) / f"{source.stem}.pdf"
            if completed.returncode != 0 or not pdf_path.exists():
                detail = (completed.stderr or completed.stdout or "conversion failed").strip()[-500:]
                return VisualQAResult(status="failed", reason=detail, score=0, toolchain=toolchain)
            prefix = Path(temp_dir) / "slide"
            rasterized = subprocess.run(
                [rasterizer, "-png", "-r", "110", str(pdf_path), str(prefix)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
            images = sorted(Path(temp_dir).glob("slide-*.png"), key=lambda item: int(item.stem.rsplit("-", 1)[-1]))
            if rasterized.returncode != 0 or not images:
                detail = (rasterized.stderr or rasterized.stdout or "rasterization failed").strip()[-500:]
                return VisualQAResult(status="failed", reason=detail, score=0, toolchain=toolchain)
            result = inspect_slide_images(images)
            result.toolchain = toolchain
            return result
    except Exception as exc:  # noqa: BLE001
        return VisualQAResult(status="failed", reason=str(exc), score=0, toolchain=toolchain)
