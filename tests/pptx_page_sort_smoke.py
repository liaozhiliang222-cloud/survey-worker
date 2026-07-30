from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pptx_report.wizard import (
    _build_chart_for_question,
    _build_multi_group_bar_page,
    _sort_question,
)


question = {
    "code": "Q1",
    "title": "Age",
    "categories": ["18-24\u5c81", "25-34\u5c81", "35-44\u5c81"],
    "segments": ["Total"],
    "data": {"Total": [0.2, 0.6, 0.4]},
    "base": {"Total": 400},
}

natural_categories, _ = _sort_question(question)
assert natural_categories == question["categories"], "automatic sorting must preserve natural category order"

sorted_categories, sorted_data = _sort_question(question, force_desc=True)
expected = ["25-34\u5c81", "35-44\u5c81", "18-24\u5c81"]
assert sorted_categories == expected
assert sorted_data["Total"] == [0.6, 0.4, 0.2]

chart = _build_chart_for_question(
    question, ["Total"], forced_chart_type=None, force_sort_desc=True
)
assert chart.categories == expected, "native charts must honor per-page descending sort"

multi = _build_multi_group_bar_page(
    [question], ["Total"], "source.xlsx", 1, 1, force_sort_desc=True
)
frame = multi.groups_data[0]["data"]
assert frame.iloc[:, 0].tolist() == expected, "multi-group bar pages must honor per-page descending sort"

print("PPT per-page descending sort smoke passed.")
