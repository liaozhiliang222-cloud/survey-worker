"""Build sanitized XLSX fixtures that preserve real survey export structures."""

from __future__ import annotations

import json
from pathlib import Path

from openpyxl import Workbook


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "imports"


def save_workbook(name: str, sheets: list[tuple[str, list[list[object]]]]) -> None:
    workbook = Workbook()
    workbook.remove(workbook.active)
    for sheet_name, rows in sheets:
        sheet = workbook.create_sheet(sheet_name)
        for row in rows:
            sheet.append(row)
    workbook.save(FIXTURE_DIR / name)


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    save_workbook(
        "standard-crosstab.xlsx",
        [("Table (%)", [
            ["CAPTION:[Q1].购买意愿"],
            [None, "Total", "人群", None, "年龄", None],
            [None, "Total", "高意向", "低意向", "18-29岁", "30岁以上"],
            ["BASE", 120, 60, 60, 48, 72],
            ["愿意", 0.68, 0.82, 0.54, 0.71, 0.66],
            ["不愿意", 0.32, 0.18, 0.46, 0.29, 0.34],
            ["CAPTION:[Q2].核心功能偏好"],
            ["BASE", 120, 60, 60, 48, 72],
            ["自动清洁", 0.74, 0.81, 0.67, 0.77, 0.72],
            ["远程控制", 0.51, 0.58, 0.44, 0.55, 0.48],
        ])],
    )

    save_workbook(
        "flat-crosstab.xlsx",
        [("交叉表", [
            ["题目/选项", "总体", "C0-高意向", "C0-低意向", "年龄-18至29岁", "年龄-30岁以上"],
            ["有效样本量", "n=120", "n=60", "n=60", "n=48", "n=72"],
            ["Q1. 购买意愿【单选】", None, None, None, None, None],
            ["愿意", 0.68, 0.82, 0.54, 0.71, 0.66],
            ["不愿意", 0.32, 0.18, 0.46, 0.29, 0.34],
            ["Q2. 使用场景【多选】", None, None, None, None, None],
            ["家庭泳池", 0.72, 0.79, 0.65, 0.75, 0.70],
            ["商业泳池", 0.28, 0.21, 0.35, 0.25, 0.30],
        ])],
    )

    save_workbook(
        "raw-survey.xlsx",
        [("responses", [
            ["rid", "性别", "年龄", "Q1购买意愿", "Q2核心需求"],
            ["R001", "男", "18-29岁", "愿意", "自动清洁"],
            ["R002", "女", "30岁以上", "不愿意", "远程控制"],
            ["R003", "女", "18-29岁", "愿意", "自动清洁"],
        ])],
    )

    kano_headers = ["rid"]
    for index in range(1, 24):
        kano_headers.extend([f"Q76_{index}__1", f"Q76_{index}__2"])
    kano_rows: list[list[object]] = [kano_headers]
    for respondent in range(1, 9):
        row: list[object] = [f"R{respondent:03d}"]
        for feature in range(1, 24):
            row.extend([2 if (respondent + feature) % 3 else 1, 4 if feature % 2 else 5])
        kano_rows.append(row)
    feature_rows = [["feature_id", "feature_name"]] + [
        [f"Q76_{index}", f"功能项{index:02d}"] for index in range(1, 24)
    ]
    save_workbook(
        "kano-data-features.xlsx",
        [
            ("data", kano_rows),
            ("features", feature_rows),
            ("instructions", [["KANO 原始正反向题模板"], ["每项功能由正向题和反向题组成。"]]),
        ],
    )

    save_workbook(
        "data-code.xlsx",
        [
            ("data", [
                ["rid", "S1", "S2", "Q1", "Q2__1", "Q2__2"],
                ["R001", 1, 2, 4, 1, 0],
                ["R002", 2, 1, 5, 0, 1],
                ["R003", 1, 1, 4, 1, 1],
            ]),
            ("code", [
                ["S1. 性别【单选】"], ["本题选项"], ["1. 男"], ["2. 女"],
                ["S2. 年龄【单选】"], ["本题选项"], ["1. 18-29岁"], ["2. 30岁以上"],
                ["Q1. 购买意愿【单选】"], ["本题选项"], ["4. 可能购买"], ["5. 一定购买"],
                ["Q2. 使用场景【多选】"], ["本题选项"], ["1. 家庭泳池"], ["2. 商业泳池"],
            ]),
        ],
    )

    save_workbook(
        "unknown-layout.xlsx",
        [("说明", [
            ["项目说明"],
            ["本文件不包含可识别的数据表。"],
            ["请上传标准交叉表、原始问卷或 data + code 工作簿。"],
        ])],
    )

    manifest = {
        "version": "surveykit_import_fixture_manifest_v1",
        "privacy": "sanitized synthetic values preserving production workbook structures",
        "fixtures": [
            {"file": "standard-crosstab.xlsx", "format": "standard_crosstab", "questions": 2, "min_dimensions": 2},
            {"file": "flat-crosstab.xlsx", "format": "flat_crosstab", "questions": 2, "min_dimensions": 2},
            {"file": "raw-survey.xlsx", "format": "raw_survey", "questions": 4, "min_dimensions": 2},
            {"file": "kano-data-features.xlsx", "format": "kano", "questions": 23, "min_dimensions": 0},
            {"file": "data-code.xlsx", "format": "data_code", "questions": 4, "min_dimensions": 2},
        ],
    }
    (FIXTURE_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
