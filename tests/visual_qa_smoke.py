from pathlib import Path
from tempfile import TemporaryDirectory
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw

from pptx_report.common.visual_qa import inspect_slide_images


def main() -> None:
    with TemporaryDirectory(prefix="surveykit-visual-qa-smoke-") as temp_dir:
        paths = []
        for slide_number in range(1, 8):
            image = Image.new("RGB", (1200, 675), "white")
            draw = ImageDraw.Draw(image)
            if slide_number not in {4, 6, 7}:
                draw.rectangle((250, 160, 950, 520), fill=(40, 90, 160))
            if slide_number == 5:
                draw.rectangle((0, 80, 100, 600), fill=(220, 30, 50))
            if slide_number == 6:
                draw.rectangle((25, 25, 1175, 650), fill=(40, 90, 160))
            if slide_number == 7:
                draw.rectangle((80, 120, 480, 570), fill=(40, 90, 160))
            path = Path(temp_dir) / f"slide-{slide_number}.png"
            image.save(path)
            paths.append(path)
        qa = inspect_slide_images(paths).to_dict()
        codes = [issue["code"] for issue in qa["issues"]]
        assert qa["status"] == "completed" and qa["checked_slides"] == 7
        assert "visually_near_empty_slide" in codes, qa
        assert "content_touches_page_edge" in codes, qa
        assert "visually_overdense_slide" in codes, qa
        assert "large_asymmetric_blank_area" in codes, qa
        assert qa["warning_count"] >= 2 and qa["score"] < 100
    print("visual QA smoke: ok")


if __name__ == "__main__":
    main()
