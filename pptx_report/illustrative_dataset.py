"""Illustrative report data normalization and consistency checks."""
from __future__ import annotations

from copy import deepcopy

EXAMPLE_LABEL = "REPORT EXAMPLE｜报告输出示例"
DISCLAIMER = "本页数据为AI生成的示例数据，仅用于展示未来报告的分析形式，不代表实际研究结果。"


def normalize_illustrative_dataset(value: dict | None) -> dict | None:
    if not isinstance(value, dict):
        return None
    data = deepcopy(value)
    data["dataset_id"] = str(data.get("dataset_id") or "illustrative_dataset_v1")
    data["data_status"] = "illustrative"
    data["usable_for_decision"] = False
    data["example_label"] = EXAMPLE_LABEL
    data["disclaimer"] = DISCLAIMER
    return data


def audit_illustrative_dataset(data: dict | None) -> list[dict]:
    if not data:
        return [{"level": "error", "code": "missing_illustrative_dataset"}]
    issues: list[dict] = []
    metrics = [float(v) for v in (data.get("metrics") or {}).values()]
    if metrics and any(v < 0 or v > 100 for v in metrics):
        issues.append({"level": "error", "code": "illustrative_percentage_out_of_range"})
    if any(value > metrics[index - 1] for index, value in enumerate(metrics[1:], 1)):
        issues.append({"level": "error", "code": "illustrative_funnel_reversal"})
    scores = [float(v) for v in (data.get("selling_point_scores") or {}).values()]
    if scores and abs(sum(scores) - 100) > 2:
        issues.append({"level": "error", "code": "selling_point_share_total"})
    pricing = data.get("pricing") or {}
    low, optimal, high = pricing.get("acceptable_low"), pricing.get("optimal_price"), pricing.get("acceptable_high")
    if not all(isinstance(v, (int, float)) for v in (low, optimal, high)) or not low < optimal < high:
        issues.append({"level": "error", "code": "illustrative_pricing_order"})
    curve = pricing.get("purchase_curve") or []
    if any(curve[index]["price"] <= curve[index - 1]["price"] or curve[index]["intention"] >= curve[index - 1]["intention"] for index in range(1, len(curve))):
        issues.append({"level": "error", "code": "illustrative_price_curve"})
    if data.get("data_status") != "illustrative" or data.get("usable_for_decision") is not False:
        issues.append({"level": "error", "code": "illustrative_decision_guard"})
    if data.get("example_label") != EXAMPLE_LABEL or data.get("disclaimer") != DISCLAIMER:
        issues.append({"level": "error", "code": "illustrative_labels_missing"})
    return issues
