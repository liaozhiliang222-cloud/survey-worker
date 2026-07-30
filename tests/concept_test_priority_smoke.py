from pathlib import Path
from tempfile import TemporaryDirectory
import sys

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.build_jd_report import parse_crosstab
from pptx_report.wizard import _categorize_question, build_page_plan, build_research_modules


with TemporaryDirectory() as tmp:
    path = Path(tmp) / "concept.xlsx"
    wb = Workbook()
    ws = wb.active
    ws.title = "Table (%)"
    rows = [
        ["PART:[\u7b2c\u4e8c\u90e8\u5206\uff1a\u6982\u5ff5\u6d4b\u8bd5]"],
        ["CAPTION:[B1].\u4e86\u89e3\u8fd9\u4e2a\u4ea7\u54c1\u6982\u5ff5\u540e\uff0c\u60a8\u8d2d\u4e70\u5b83\u7684\u53ef\u80fd\u6027\u6709\u591a\u5927"],
        [None, "Total", "\u9ad8\u610f\u5411\u7528\u6237"],
        ["\u4e00\u5b9a\u4f1a\u8d2d\u4e70", 0.4, 0.8],
        ["\u53ef\u80fd\u4f1a\u8d2d\u4e70", 0.3, 0.2],
        ["BASE", 100, 30],
        ["PART:[\u7b2c\u4e09\u90e8\u5206\uff1a\u7528\u6237\u57fa\u672c\u4fe1\u606f]"],
        ["CAPTION:[S1].\u60a8\u7684\u6027\u522b\u662f"],
        [None, "Total", "\u9ad8\u610f\u5411\u7528\u6237"],
        ["\u7537", 0.4, 0.3],
        ["\u5973", 0.6, 0.7],
        ["BASE", 100, 30],
    ]
    for row in rows:
        ws.append(row)
    wb.save(path)

    questions = parse_crosstab(str(path))
    assert questions[0]["part"] == "\u7b2c\u4e8c\u90e8\u5206\uff1a\u6982\u5ff5\u6d4b\u8bd5"
    assert questions[1]["part"] == "\u7b2c\u4e09\u90e8\u5206\uff1a\u7528\u6237\u57fa\u672c\u4fe1\u606f"
    assert _categorize_question(questions[0]) == "\u6982\u5ff5\u6d4b\u8bd5"

    modules = build_research_modules(questions)
    assert modules["recommended_core_module"] == "\u6982\u5ff5\u6d4b\u8bd5"
    assert modules["research_modules"][0]["key"] == "\u6982\u5ff5\u6d4b\u8bd5"

    plan = build_page_plan(questions, title="Concept test")
    assert plan["pages"][0]["chapter"] == "\u6982\u5ff5\u6d4b\u8bd5"
    assert [q["code"] for q in plan["pages"][0]["questions"]] == ["B1"]
    assert all(
        len({item["chapter"] for item in plan["question_catalog"] if item["code"] == q["code"]}) == 1
        for q in plan["pages"][0]["questions"]
    )

print("Concept-test parsing and priority smoke passed.")
