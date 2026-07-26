"""Smoke tests for one-slide editable research model chart exports."""

from io import BytesIO
from pathlib import Path
import sys

from pptx import Presentation
from pptx.enum.dml import MSO_FILL_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.model_chart_export import render_model_chart_pptx


SAMPLES = {
    "psm": {
        "sampleCount": 200,
        "acceptable": "¥120 - ¥260",
        "pmc": 120,
        "pme": 260,
        "ipp": 190,
        "opp": 180,
        "curve": [
            {"price": 100, "tooCheap": 80, "cheap": 90, "expensive": 10, "tooExpensive": 2},
            {"price": 180, "tooCheap": 35, "cheap": 60, "expensive": 45, "tooExpensive": 20},
            {"price": 280, "tooCheap": 5, "cheap": 15, "expensive": 85, "tooExpensive": 75},
        ],
    },
    "kano": [
        {"name": "配送速度", "classification": "期望属性", "better": 0.72, "worse": -0.66},
        {"name": "包装设计", "classification": "魅力属性", "better": 0.65, "worse": -0.25},
        {"name": "包装质感", "classification": "魅力属性", "better": 0.38, "worse": -0.69},
        {"name": "售后保障", "classification": "必备属性", "better": 0.42, "worse": -0.81},
    ],
    "maxdiff": [
        {"item": "口味更好", "score": 0.45},
        {"item": "价格更划算", "score": 0.28},
        {"item": "售后更安心", "score": -0.18},
    ],
    "driver": {
        "r2": 0.62,
        "n": 320,
        "dvName": "整体满意度",
        "results": [
            {"name": "产品质量", "importance": 0.34},
            {"name": "售后服务", "importance": 0.26},
            {"name": "价格合理性", "importance": 0.18},
        ],
    },
}


def main() -> None:
    for model_type, data in SAMPLES.items():
        blob = render_model_chart_pptx(model_type, data)
        assert blob.startswith(b"PK")
        presentation = Presentation(BytesIO(blob))
        assert len(presentation.slides) == 1
        shapes = list(presentation.slides[0].shapes)
        charts = [shape for shape in shapes if getattr(shape, "has_chart", False)]
        assert len(charts) == 1, model_type
        assert all(shape.shape_type != MSO_SHAPE_TYPE.PICTURE for shape in shapes)
        text = "\n".join(shape.text for shape in shapes if getattr(shape, "has_text_frame", False))
        assert "可编辑" in text
        assert charts[0].chart.part.chart_workbook.xlsx_part is not None
        if model_type == "kano":
            assert all(
                series.format.line.fill.type == MSO_FILL_TYPE.BACKGROUND
                for series in charts[0].chart.series
            )

    api_source = (ROOT / "deploy" / "aliyun_api.py").read_text(encoding="utf-8")
    assert '/api/pptx-report/model-chart' in api_source
    assert 'X-SurveyKit-Editable-Chart' in api_source
    print("editable model chart PPTX smoke: ok")


if __name__ == "__main__":
    main()
