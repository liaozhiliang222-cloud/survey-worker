"""Build the editable SurveyKit qualitative enterprise template specimen."""
from __future__ import annotations

import json
from pathlib import Path

from .qualitative_service import QualitativePptRenderService


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE = ROOT / "tests" / "fixtures" / "qualitative-enterprise-template-script.json"
DEFAULT_OUTPUT = ROOT / "test-results" / "SurveyKit-qualitative-enterprise-officecli-v2.pptx"


def build(output: Path = DEFAULT_OUTPUT, fixture: Path = DEFAULT_FIXTURE) -> dict:
    script = json.loads(fixture.read_text(encoding="utf-8"))
    rendered = QualitativePptRenderService(quality_mode="required").render(script)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(rendered["content"])
    return {
        "output": str(output),
        "slide_count": rendered["slide_count"],
        "validation": rendered["validation"],
        "quality_gate": rendered["quality_gate"],
        "object_counts": rendered["object_counts"],
        "renderer": rendered["renderer"],
    }


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2))
