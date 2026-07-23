"""Deterministic quantitative fact extraction.

The AI layer receives these verified facts instead of recalculating values from
wide crosstabs. All values retain question, segment, category, base, and source
references so generated claims remain auditable.
"""

from __future__ import annotations

import math
import re
from dataclasses import asdict
from typing import Iterable

from .model import DataFact


DERIVED_LABELS = {"T2B", "B2B", "JAR", "TH", "TL", "SUM", "MEAN"}
LOW_BASE_DEFAULT = 30


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _source_reference(question: dict) -> str:
    code = _clean(question.get("code"))
    title = _clean(question.get("title"))
    return f"{code}.{title}" if code else title


def _as_number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def infer_data_kind(question: dict) -> str:
    """Infer the metric semantic without treating every numeric value as a %."""

    explicit = _clean(question.get("data_kind")).lower()
    if explicit in {
        "percentage",
        "count",
        "mean",
        "score",
        "index",
        "currency",
        "frequency",
        "nps",
    }:
        return explicit
    title = _clean(question.get("title")).lower()
    stats = question.get("stats") or {}
    if "nps" in title or "净推荐" in title:
        return "nps"
    if any(token in title for token in ("金额", "价格", "费用", "元", "预算")):
        return "currency"
    if any(token in title for token in ("次数", "频次", "频率")):
        return "frequency"
    if "指数" in title:
        return "index"
    if "MEAN" in stats or "mean" in stats:
        return "mean"
    values = [
        _as_number(value)
        for series in (question.get("data") or {}).values()
        for value in (series or [])
    ]
    values = [value for value in values if value is not None]
    if values and all(0 <= value <= 1 for value in values):
        return "percentage"
    if values and all(float(value).is_integer() and value >= 0 for value in values):
        return "count"
    return "score"


def _normalized_percentage(value: float | None, data_kind: str) -> float | None:
    if value is None:
        return None
    if data_kind == "percentage":
        return value * 100 if abs(value) <= 1 else value
    return value


def _fact(
    *,
    fact_id: str,
    fact_type: str,
    question: dict,
    metric_name: str,
    segment: str | None = None,
    category: str | None = None,
    value: float | None = None,
    benchmark_value: float | None = None,
    gap_pp: float | None = None,
    rank: int | None = None,
    base: int | None = None,
    significant: bool | None = None,
    confidence: float = 1.0,
) -> DataFact:
    return DataFact(
        fact_id=fact_id,
        fact_type=fact_type,
        question_id=_clean(question.get("code")),
        metric_name=metric_name,
        segment=segment,
        category=category,
        value=value,
        benchmark_value=benchmark_value,
        gap_pp=gap_pp,
        rank=rank,
        base=base,
        significant=significant,
        source_reference=_source_reference(question),
        confidence=confidence,
    )


def extract_question_facts(
    question: dict,
    *,
    low_base_threshold: int = LOW_BASE_DEFAULT,
    gap_threshold_pp: float = 5.0,
) -> list[DataFact]:
    code = _clean(question.get("code")) or "Q"
    categories = [_clean(value) for value in question.get("categories") or []]
    data = question.get("data") or {}
    segments = list(question.get("segments") or data.keys())
    data_kind = infer_data_kind(question)
    bases = question.get("base") or {}
    facts: list[DataFact] = []
    fact_index = 0

    def add(**kwargs) -> None:
        nonlocal fact_index
        fact_index += 1
        facts.append(
            _fact(
                fact_id=f"{code}__{kwargs['fact_type']}__{fact_index:03d}",
                question=question,
                **kwargs,
            )
        )

    total_segment = next(
        (segment for segment in segments if str(segment).strip().lower() == "total"),
        segments[0] if segments else None,
    )
    total_values = list(data.get(total_segment) or []) if total_segment else []
    ranked = [
        (index, _as_number(value))
        for index, value in enumerate(total_values)
        if index < len(categories)
        and _as_number(value) is not None
        and categories[index].upper() not in DERIVED_LABELS
    ]
    ranked.sort(key=lambda pair: pair[1], reverse=True)
    for rank, (index, raw_value) in enumerate(ranked, 1):
        if rank == 1:
            add(
                fact_type="top_rank",
                metric_name=data_kind,
                segment=total_segment,
                category=categories[index],
                value=_normalized_percentage(raw_value, data_kind),
                rank=rank,
                base=bases.get(total_segment),
            )
        if rank == len(ranked):
            add(
                fact_type="bottom_rank",
                metric_name=data_kind,
                segment=total_segment,
                category=categories[index],
                value=_normalized_percentage(raw_value, data_kind),
                rank=rank,
                base=bases.get(total_segment),
            )

    if total_segment and total_values:
        for segment in segments:
            if segment == total_segment:
                continue
            segment_values = list(data.get(segment) or [])
            gaps: list[tuple[float, int, float, float]] = []
            for index, total_raw in enumerate(total_values):
                if index >= len(categories) or index >= len(segment_values):
                    continue
                if categories[index].upper() in DERIVED_LABELS:
                    continue
                total_value = _as_number(total_raw)
                segment_value = _as_number(segment_values[index])
                if total_value is None or segment_value is None:
                    continue
                if data_kind == "percentage":
                    total_display = _normalized_percentage(total_value, data_kind)
                    segment_display = _normalized_percentage(segment_value, data_kind)
                    gap = segment_display - total_display
                    gaps.append((abs(gap), index, segment_display, gap))
                    if abs(gap) >= gap_threshold_pp:
                        add(
                            fact_type="segment_gap",
                            metric_name=data_kind,
                            segment=str(segment),
                            category=categories[index],
                            value=segment_display,
                            benchmark_value=total_display,
                            gap_pp=gap,
                            base=bases.get(segment),
                            significant=None,
                        )
                elif data_kind in {"mean", "score", "index", "currency", "frequency"}:
                    gap = segment_value - total_value
                    gaps.append((abs(gap), index, segment_value, gap))
                    if abs(gap) > 0:
                        add(
                            fact_type="mean_difference",
                            metric_name=data_kind,
                            segment=str(segment),
                            category=categories[index],
                            value=segment_value,
                            benchmark_value=total_value,
                            gap_pp=None,
                            base=bases.get(segment),
                            significant=None,
                        )
            if gaps:
                gaps.sort(reverse=True)
                _, index, segment_value, gap = gaps[0]
                add(
                    fact_type="segment_ranking",
                    metric_name=data_kind,
                    segment=str(segment),
                    category=categories[index],
                    value=segment_value,
                    benchmark_value=_normalized_percentage(
                        _as_number(total_values[index]), data_kind
                    ),
                    gap_pp=gap if data_kind == "percentage" else None,
                    rank=1,
                    base=bases.get(segment),
                )

    for segment in segments:
        base = bases.get(segment)
        if base is not None and int(base) < low_base_threshold:
            add(
                fact_type="low_base_warning",
                metric_name="base",
                segment=str(segment),
                value=float(base),
                base=int(base),
                confidence=max(0.2, float(base) / max(1, low_base_threshold)),
            )

    upper_categories = [category.upper() for category in categories]
    for fact_type, label in (("top2box", "T2B"), ("bottom2box", "B2B")):
        if label in upper_categories and total_segment:
            index = upper_categories.index(label)
            raw = _as_number(total_values[index]) if index < len(total_values) else None
            if raw is not None:
                add(
                    fact_type=fact_type,
                    metric_name=data_kind,
                    segment=total_segment,
                    category=categories[index],
                    value=_normalized_percentage(raw, data_kind),
                    base=bases.get(total_segment),
                )

    # For ordered percentage scales without explicit derived rows, expose T2B
    # and B2B as the first/last two categories in the preserved source order.
    ordered = bool(question.get("ordered_scale"))
    if (
        ordered
        and data_kind == "percentage"
        and len(total_values) >= 4
        and "T2B" not in upper_categories
        and "B2B" not in upper_categories
    ):
        top = sum(_as_number(value) or 0 for value in total_values[:2]) * 100
        bottom = sum(_as_number(value) or 0 for value in total_values[-2:]) * 100
        add(
            fact_type="top2box",
            metric_name="percentage",
            segment=total_segment,
            value=top,
            base=bases.get(total_segment),
        )
        add(
            fact_type="bottom2box",
            metric_name="percentage",
            segment=total_segment,
            value=bottom,
            base=bases.get(total_segment),
        )
        if top >= 35 and bottom >= 35:
            add(
                fact_type="distribution_polarization",
                metric_name="percentage",
                segment=total_segment,
                value=max(top, bottom),
                benchmark_value=min(top, bottom),
                base=bases.get(total_segment),
            )

    stats = question.get("stats") or {}
    mean_values = stats.get("MEAN") or stats.get("mean") or {}
    if isinstance(mean_values, dict):
        total_mean = _as_number(mean_values.get(total_segment))
        for segment, value in mean_values.items():
            numeric = _as_number(value)
            if numeric is None:
                continue
            if segment == total_segment:
                continue
            add(
                fact_type="mean_difference",
                metric_name="mean",
                segment=str(segment),
                value=numeric,
                benchmark_value=total_mean,
                base=bases.get(segment),
                significant=None,
            )

    benchmark = _as_number(question.get("benchmark_value"))
    if benchmark is not None and ranked:
        index, value = ranked[0]
        display = _normalized_percentage(value, data_kind)
        add(
            fact_type="benchmark_gap",
            metric_name=data_kind,
            segment=total_segment,
            category=categories[index],
            value=display,
            benchmark_value=benchmark,
            gap_pp=(display - benchmark) if data_kind == "percentage" else None,
            base=bases.get(total_segment),
        )
    return facts


def extract_data_facts(
    questions: Iterable[dict],
    *,
    low_base_threshold: int = LOW_BASE_DEFAULT,
    gap_threshold_pp: float = 5.0,
) -> list[DataFact]:
    question_list = list(questions)
    facts: list[DataFact] = []
    for question in question_list:
        question_facts = extract_question_facts(
            question,
            low_base_threshold=low_base_threshold,
            gap_threshold_pp=gap_threshold_pp,
        )
        facts.extend(question_facts)
        gaps = [fact for fact in question_facts if fact.fact_type == "segment_gap" and fact.gap_pp is not None]
        magnitudes = sorted(abs(float(fact.gap_pp)) for fact in gaps)
        if len(magnitudes) >= 3:
            median = magnitudes[len(magnitudes) // 2]
            for index, fact in enumerate(gaps, 1):
                if abs(float(fact.gap_pp)) >= max(15.0, median * 2.0):
                    facts.append(DataFact(
                        fact_id=f"{fact.question_id}__outlier__{index:03d}",
                        fact_type="outlier", question_id=fact.question_id,
                        metric_name=fact.metric_name, segment=fact.segment,
                        category=fact.category, value=fact.value,
                        benchmark_value=fact.benchmark_value, gap_pp=fact.gap_pp,
                        base=fact.base, significant=None,
                        source_reference=fact.source_reference,
                        confidence=fact.confidence,
                    ))

    by_segment_direction: dict[tuple[str, int], list[DataFact]] = {}
    for fact in facts:
        if fact.fact_type != "segment_gap" or fact.gap_pp is None or not fact.segment:
            continue
        key = (fact.segment, 1 if fact.gap_pp > 0 else -1)
        by_segment_direction.setdefault(key, []).append(fact)
    consistency_index = 0
    for (segment, direction), related in by_segment_direction.items():
        question_ids = list(dict.fromkeys(fact.question_id for fact in related))
        if len(question_ids) < 2:
            continue
        consistency_index += 1
        references = list(dict.fromkeys(fact.source_reference for fact in related))
        facts.append(DataFact(
            fact_id=f"GLOBAL__cross_question_consistency__{consistency_index:03d}",
            fact_type="cross_question_consistency",
            question_id="|".join(question_ids), metric_name="percentage",
            segment=segment, category="跨题一致方向",
            value=float(len(question_ids)), gap_pp=float(direction),
            significant=None, source_reference="；".join(references),
            confidence=min(1.0, 0.6 + 0.1 * len(question_ids)),
        ))
    return facts


def build_funnel_facts(
    stages: Iterable[tuple[str, float]],
    *,
    question_id: str = "FUNNEL",
    source_reference: str = "derived funnel",
) -> list[DataFact]:
    values = list(stages)
    facts: list[DataFact] = []
    for index in range(1, len(values)):
        previous_name, previous_value = values[index - 1]
        name, value = values[index]
        facts.append(
            DataFact(
                fact_id=f"{question_id}__funnel_drop__{index:03d}",
                fact_type="funnel_drop",
                question_id=question_id,
                metric_name="percentage",
                category=f"{previous_name}→{name}",
                value=float(value),
                benchmark_value=float(previous_value),
                gap_pp=float(value) - float(previous_value),
                rank=index,
                source_reference=source_reference,
            )
        )
    return facts


def facts_as_dicts(facts: Iterable[DataFact]) -> list[dict]:
    return [asdict(fact) for fact in facts]
