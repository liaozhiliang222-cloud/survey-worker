"""Regression coverage for multi-level crosstab headers."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report import build_jd_report  # noqa: E402
from pptx_report.build_jd_report import apply_dimension, parse_crosstab  # noqa: E402


def main() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        path = Path(temp_dir) / "multi-dimension-crosstab.xlsx"
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Table (%)"
        rows = [
            ["CAPTION:[B16].请问您的性别是"],
            [
                None, "Total", "人群", None, None, "使用用户", None, None,
                "目标人群", None, None, None, "购买者年龄", None, None, None,
                "购买者性别", None,
            ],
            [
                None, "Total", "老人组", "儿童组", "老人+儿童组", "老人", "儿童",
                "老人+儿童", "目标人群总体", "老人", "儿童", "老人+儿童",
                "30-34岁", "35-39岁", "40-44岁", "45-49岁", "男性", "女性",
            ],
            ["BASE", 200, 60, 60, 80, 76, 61, 63, 196, 75, 60, 61, 69, 83, 35, 7, 80, 120],
            ["男", 0.4, 0.58, 0.28, 0.35, 0.51, 0.28, 0.38, 0.39, 0.51, 0.27, 0.36, 0.46, 0.22, 0.6, 1, 1, None],
            ["女", 0.6, 0.42, 0.72, 0.65, 0.49, 0.72, 0.62, 0.61, 0.49, 0.73, 0.64, 0.54, 0.78, 0.4, None, None, 1],
        ]
        for row in rows:
            sheet.append(row)
        workbook.save(path)

        questions = parse_crosstab(str(path))
        assert len(questions) == 1
        assert questions[0]["segments"] == ["Total", "老人组", "儿童组", "老人+儿童组"]
        assert list(questions[0]["data"]) == questions[0]["segments"]

        groups = build_jd_report._cached_dimension_groups
        assert [group["name"] for group in groups] == [
            "人群", "使用用户", "目标人群", "购买者年龄", "购买者性别",
        ]
        age_questions = apply_dimension(questions, groups, "购买者年龄")
        assert age_questions[0]["segments"] == [
            "Total", "30-34岁", "35-39岁", "40-44岁", "45-49岁",
        ]
        assert age_questions[0]["data"]["30-34岁"] == [0.46, 0.54]

        pivot_path = Path(temp_dir) / "spss-pivot-crosstab.xlsx"
        pivot_workbook = Workbook()
        pivot_sheet = pivot_workbook.active
        pivot_sheet.title = "Sheet1"
        pivot_rows = [
            [None, None, "省份", None, None, None, "年龄", None, None, None],
            [None, None, "总计", None, "上海", None, "18-24岁", None, "25-34岁", None],
            [None, None, "计数", "列 N %", "计数", "列 N %", "计数", "列 N %", "计数", "列 N %"],
            ["Q1.满意度", "总计", 100, 1, 40, 1, 45, 1, 55, 1],
            [None, "满意", 60, 0.6, 30, 0.75, 31, 0.69, 29, 0.53],
            [None, "不满意", 40, 0.4, 10, 0.25, 14, 0.31, 26, 0.47],
            ["Q2.购买意愿", "总计", 100, 1, 40, 1, 45, 1, 55, 1],
            [None, "愿意", 70, 0.7, 32, 0.8, 34, 0.76, 36, 0.65],
            [None, "不愿意", 30, 0.3, 8, 0.2, 11, 0.24, 19, 0.35],
        ]
        for row in pivot_rows:
            pivot_sheet.append(row)
        pivot_workbook.save(pivot_path)

        pivot_questions = parse_crosstab(str(pivot_path))
        assert len(pivot_questions) == 2
        assert pivot_questions[0]["code"] == "Q1"
        assert pivot_questions[0]["segments"] == ["Total", "上海"]
        pivot_groups = build_jd_report._cached_dimension_groups
        assert [group["name"] for group in pivot_groups] == ["省份", "年龄"]
        pivot_age = apply_dimension(pivot_questions, pivot_groups, "年龄")
        assert pivot_age[0]["segments"] == ["Total", "18-24岁", "25-34岁"]
        assert pivot_age[0]["data"]["18-24岁"] == [0.69, 0.31]
        assert pivot_age[0]["base"]["25-34岁"] == 55
    print("crosstab parser smoke passed")


if __name__ == "__main__":
    main()
