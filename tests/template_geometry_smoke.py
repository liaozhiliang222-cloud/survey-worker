"""Regression check for deep-template table/chart alignment."""

from pathlib import Path
import sys

import pandas as pd
from pptx import Presentation
from pptx.util import Inches

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pptx_report.model import MultiGroupBarPageContent  # noqa: E402
from pptx_report.pages import build_multi_group_bar_page  # noqa: E402
from pptx_report.renderer import ReportRenderer  # noqa: E402
from pptx_report.theme import Theme  # noqa: E402


def main() -> None:
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])

    segments = ["Total", "都市中产", "都市蓝领", "都市家庭", "都市Z世代", "小镇中年", "小镇青年"]
    options = ["北京", "河北", "广东", "山东", "江苏", "天津", "上海", "辽宁", "四川", "湖北", "河南"]
    rows = []
    for row_index, option in enumerate(options):
        row = {"选项": option}
        for segment_index, segment in enumerate(segments):
            row[segment] = ((row_index * 7 + segment_index * 11) % 48 + 2) / 100
        rows.append(row)

    page = MultiGroupBarPageContent(
        title="[上海] 占比最高（44.0%）",
        groups_data=[{"title": "省份", "data": pd.DataFrame(rows)}],
        segments=segments,
        data_source="数据来源：测试数据",
    )
    build_multi_group_bar_page(
        slide,
        page,
        Theme(),
        (prs.slide_width, prs.slide_height),
    )

    renderer = ReportRenderer()
    renderer._prs = prs
    renderer._slide_w = prs.slide_width
    renderer._slide_h = prs.slide_height
    renderer.template_path = "synthetic-template.pptx"
    renderer._template_mapping = {
        "roles": {
            "matrix": {
                "zones": {
                    "title": {"x": 0.03, "y": 0.01, "w": 0.68, "h": 0.12},
                    "content": {"x": 0.041, "y": 0.17, "w": 0.95, "h": 0.76},
                    "footer": {"x": 0.03, "y": 0.94, "w": 0.90, "h": 0.04},
                }
            }
        }
    }
    renderer._apply_template_geometry(slide, 0, "matrix")

    table_shape = next(shape for shape in slide.shapes if getattr(shape, "has_table", False))
    chart_shapes = [shape for shape in slide.shapes if getattr(shape, "has_chart", False)]
    if not chart_shapes:
        raise AssertionError("Expected overlaid bar charts in regression slide")

    data_columns_left = int(table_shape.left) + sum(
        int(table_shape.table.columns[index].width) for index in (0, 1)
    )
    first_chart_left = min(int(shape.left) for shape in chart_shapes)
    alignment_gap = first_chart_left - data_columns_left
    if not 0 <= alignment_gap <= Inches(0.20):
        raise AssertionError(
            f"Table/chart columns are misaligned by {alignment_gap / 914400:.3f} inches"
        )
    if abs(int(table_shape.width) - sum(int(column.width) for column in table_shape.table.columns)) > 2:
        raise AssertionError("Table frame width and internal column grid diverged")
    if abs(int(table_shape.height) - sum(int(row.height) for row in table_shape.table.rows)) > 2:
        raise AssertionError("Table frame height and internal row grid diverged")

    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("qa_template_alignment_fixed.pptx")
    prs.save(output)
    print(f"Template alignment smoke passed: {output}")


if __name__ == "__main__":
    main()
