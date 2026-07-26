"""Single-slide editable PowerPoint exports for research models.

The browser research tools keep their calculations in JavaScript. This module
accepts those calculated results and renders one PowerPoint slide containing a
native Office chart, editable text boxes, and editable KPI cards.
"""

from __future__ import annotations

from io import BytesIO
import math
from typing import Any, Iterable

from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import (
    XL_CHART_TYPE,
    XL_DATA_LABEL_POSITION,
    XL_LEGEND_POSITION,
    XL_MARKER_STYLE,
)
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt


MODEL_TYPES = {"psm", "kano", "maxdiff", "driver"}
FONT = "Microsoft YaHei"
COLORS = {
    "navy": "17365D",
    "blue": "2563EB",
    "sky": "60A5FA",
    "teal": "0F766E",
    "green": "18875B",
    "orange": "E87645",
    "amber": "B7791F",
    "red": "B42318",
    "purple": "7C3AED",
    "ink": "24364B",
    "muted": "64748B",
    "grid": "DCE5EE",
    "panel": "F4F7FA",
    "white": "FFFFFF",
}


class ModelChartExportError(ValueError):
    """Raised when a model chart export request is invalid."""


def _rgb(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def _number(value: Any, *, default: float | None = None) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _rows(value: Any, *, limit: int = 60) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ModelChartExportError("model data must be an array")
    rows = [dict(item) for item in value if isinstance(item, dict)]
    if not rows:
        raise ModelChartExportError("model data cannot be empty")
    return rows[:limit]


def _add_text(
    slide,
    text: Any,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    size: float = 12,
    bold: bool = False,
    color: str = COLORS["ink"],
    align=PP_ALIGN.LEFT,
    valign=MSO_ANCHOR.MIDDLE,
) -> None:
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = box.text_frame
    frame.clear()
    frame.margin_left = frame.margin_right = Inches(0.04)
    frame.margin_top = frame.margin_bottom = Inches(0.02)
    frame.vertical_anchor = valign
    paragraph = frame.paragraphs[0]
    paragraph.text = str(text or "")
    paragraph.alignment = align
    paragraph.font.name = FONT
    paragraph.font.size = Pt(size)
    paragraph.font.bold = bold
    paragraph.font.color.rgb = _rgb(color)


def _add_header(slide, title: str, subtitle: str) -> None:
    _add_text(slide, title, 0.65, 0.30, 12.0, 0.55, size=25, bold=True)
    _add_text(slide, subtitle, 0.66, 0.86, 11.9, 0.34, size=10.5, color=COLORS["muted"])


def _add_panel(slide, x: float, y: float, w: float, h: float) -> None:
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h),
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb(COLORS["white"])
    shape.line.color.rgb = _rgb(COLORS["grid"])
    shape.line.width = Pt(0.8)


def _add_badge(slide, text: str, x: float, y: float, w: float, color: str) -> None:
    shape = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(0.28)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb(color)
    shape.line.fill.background()
    _add_text(slide, text, x + 0.03, y + 0.01, w - 0.06, 0.24, size=8.5, bold=True, color=COLORS["white"], align=PP_ALIGN.CENTER)


def _add_matrix_line(slide, x: float, y: float, w: float, h: float) -> None:
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb("8FA3B8")
    shape.line.fill.background()


def _short_label(value: Any, limit: int = 16) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"

def _add_kpis(slide, title: str, entries: Iterable[tuple[str, Any]]) -> None:
    x, y, w = 10.25, 1.38, 2.43
    _add_text(slide, title, x, y, w, 0.35, size=13, bold=True, color=COLORS["navy"])
    cursor = y + 0.48
    for label, value in list(entries)[:5]:
        card = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(x), Inches(cursor), Inches(w), Inches(0.78),
        )
        card.fill.solid()
        card.fill.fore_color.rgb = _rgb(COLORS["panel"])
        card.line.fill.background()
        _add_text(slide, label, x + 0.13, cursor + 0.08, w - 0.26, 0.22, size=9, color=COLORS["muted"])
        value_text = str(value)
        value_size = 15 if len(value_text) <= 16 else 12.5 if len(value_text) <= 24 else 10.5
        _add_text(
            slide,
            value_text,
            x + 0.13,
            cursor + 0.31,
            w - 0.26,
            0.34,
            size=value_size,
            bold=True,
            color=COLORS["navy"],
        )
        cursor += 0.91


def _add_footer(slide, source: str) -> None:
    _add_text(
        slide,
        f"来源：SurveyKit 研究模型计算结果 · {source} · 图表与数据可在 PowerPoint 中编辑",
        0.67, 7.09, 12.0, 0.20,
        size=8.5,
        color=COLORS["muted"],
    )


def _style_chart(chart, *, legend: bool = False) -> None:
    chart.has_title = False
    chart.has_legend = legend
    if legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
        chart.legend.font.name = FONT
        chart.legend.font.size = Pt(9)
    chart.font.name = FONT
    chart.font.size = Pt(9)
    for getter in (lambda: chart.category_axis, lambda: chart.value_axis):
        try:
            axis = getter()
            axis.tick_labels.font.name = FONT
            axis.tick_labels.font.size = Pt(9)
            axis.tick_labels.font.color.rgb = _rgb(COLORS["muted"])
            axis.has_minor_gridlines = False
        except Exception:
            continue


def _new_presentation(title: str) -> tuple[Presentation, Any]:
    presentation = Presentation()
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    presentation.core_properties.title = title
    presentation.core_properties.subject = "Editable SurveyKit research model chart"
    presentation.core_properties.author = "SurveyKit"
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = _rgb("F7F9FC")
    return presentation, slide


def _render_psm(slide, payload: dict[str, Any]) -> None:
    curve = sorted(
        _rows(payload.get("curve")),
        key=lambda item: _number(item.get("price"), default=0) or 0,
    )
    valid = [
        row for row in curve
        if _number(row.get("price")) is not None
        and all(_number(row.get(key)) is not None for key in (
            "tooCheap", "cheap", "expensive", "tooExpensive"
        ))
    ]
    if len(valid) < 2:
        raise ModelChartExportError("PSM curve requires at least two valid points")

    _add_header(slide, "PSM 价格敏感度分析", "四条价格认知曲线与关键交点 · 单页可编辑图表")
    _add_panel(slide, 0.62, 1.30, 9.28, 5.62)
    data = XyChartData()
    definitions = [
        ("太便宜", "tooCheap", COLORS["navy"]),
        ("比较便宜", "cheap", COLORS["blue"]),
        ("比较贵", "expensive", COLORS["green"]),
        ("太贵", "tooExpensive", COLORS["orange"]),
    ]
    for label, key, _ in definitions:
        series = data.add_series(label)
        for row in valid:
            series.add_data_point(float(row["price"]), float(row[key]) / 100.0)
    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.XY_SCATTER_SMOOTH_NO_MARKERS,
        Inches(0.88), Inches(1.62), Inches(8.72), Inches(4.88), data,
    ).chart
    _style_chart(chart, legend=True)
    chart.category_axis.minimum_scale = float(valid[0]["price"])
    chart.category_axis.maximum_scale = float(valid[-1]["price"])
    chart.category_axis.has_major_gridlines = False
    chart.value_axis.minimum_scale = 0.0
    chart.value_axis.maximum_scale = 1.0
    chart.value_axis.major_unit = 0.25
    chart.value_axis.number_format = "0%"
    chart.value_axis.number_format_is_linked = False
    chart.value_axis.has_major_gridlines = True
    chart.value_axis.major_gridlines.format.line.color.rgb = _rgb(COLORS["grid"])
    for series, (_, _, color) in zip(chart.series, definitions):
        series.format.line.color.rgb = _rgb(color)
        series.format.line.width = Pt(2.2)

    def price(name: str) -> str:
        value = _number(payload.get(name))
        return "—" if value is None else f"¥{value:,.1f}"

    _add_kpis(slide, "关键价格点", [
        ("可接受价格区间", payload.get("acceptable") or "—"),
        ("OPP 最优价格点", price("opp")),
        ("IPP 无差异价格点", price("ipp")),
        ("PMC 价格下限", price("pmc")),
        ("PME 价格上限", price("pme")),
    ])
    _add_footer(slide, f"PSM · N={int(_number(payload.get('sampleCount'), default=0) or 0)}")


def _render_kano(slide, payload: Any) -> None:
    rows = _rows(payload, limit=80)
    valid = []
    for row in rows:
        better = _number(row.get("better"))
        worse = _number(row.get("worse"))
        name = str(row.get("name") or "").strip()
        if name and better is not None and worse is not None:
            valid.append({**row, "name": name, "better": better, "worse": worse, "_code": f"A{len(valid) + 1:02d}"})
    if not valid:
        raise ModelChartExportError("KANO data requires name, better, and worse")

    _add_header(slide, "KANO Better–Worse 分析", "需求属性在满意提升与不满意风险上的位置 · 单页可编辑图表")
    _add_panel(slide, 0.62, 1.30, 9.28, 5.62)
    classifications = [
        ("魅力属性", COLORS["green"]),
        ("期望属性", COLORS["blue"]),
        ("必备属性", COLORS["amber"]),
        ("无差异属性", COLORS["muted"]),
    ]
    data = XyChartData()
    active = []
    for classification, color in classifications:
        items = [row for row in valid if str(row.get("classification") or "") == classification]
        if not items:
            continue
        series = data.add_series(classification)
        for row in items:
            series.add_data_point(abs(float(row["worse"])), float(row["better"]))
        active.append((classification, color))
    if not active:
        series = data.add_series("属性")
        for row in valid:
            series.add_data_point(abs(float(row["worse"])), float(row["better"]))
        active.append(("属性", COLORS["blue"]))

    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.XY_SCATTER,
        Inches(0.88), Inches(1.62), Inches(8.72), Inches(4.88), data,
    ).chart
    _style_chart(chart, legend=True)
    for axis in (chart.category_axis, chart.value_axis):
        axis.minimum_scale = 0.0
        axis.maximum_scale = 1.0
        axis.major_unit = 0.25
        axis.number_format = "0.00"
        axis.number_format_is_linked = False
        axis.has_major_gridlines = True
        axis.major_gridlines.format.line.color.rgb = _rgb(COLORS["grid"])
    for series, (_, color) in zip(chart.series, active):
        series.marker.style = XL_MARKER_STYLE.CIRCLE
        series.marker.size = 8
        series.format.fill.solid()
        series.format.fill.fore_color.rgb = _rgb(color)
        series.format.line.fill.background()

    mean_worse = sum(abs(float(row["worse"])) for row in valid) / len(valid)
    mean_better = sum(float(row["better"]) for row in valid) / len(valid)
    plot_left, plot_top, plot_width, plot_height = 1.46, 1.91, 7.70, 3.92
    line_x = plot_left + mean_worse * plot_width
    line_y = plot_top + (1.0 - mean_better) * plot_height
    _add_matrix_line(slide, line_x, plot_top, 0.018, plot_height)
    _add_matrix_line(slide, plot_left, line_y, plot_width, 0.018)
    _add_text(slide, f"Worse 均值 {mean_worse:.2f}", line_x + 0.05, plot_top + plot_height - 0.22, 1.18, 0.18, size=7, bold=True, color=COLORS["muted"])
    _add_text(slide, f"Better 均值 {mean_better:.2f}", plot_left + 0.05, line_y - 0.22, 1.18, 0.18, size=7, bold=True, color=COLORS["muted"])
    _add_badge(slide, "魅力属性", plot_left + 0.05, plot_top + 0.05, 0.92, COLORS["green"])
    _add_badge(slide, "期望属性", plot_left + plot_width - 0.97, plot_top + 0.05, 0.92, COLORS["blue"])
    _add_badge(slide, "无差异属性", plot_left + 0.05, plot_top + plot_height - 0.33, 1.05, COLORS["muted"])
    _add_badge(slide, "必备属性", plot_left + plot_width - 0.97, plot_top + plot_height - 0.33, 0.92, COLORS["amber"])

    compact_labels = len(valid) > 20
    occupied: list[tuple[float, float, float, float]] = []

    def overlaps(box: tuple[float, float, float, float]) -> bool:
        x1, y1, w1, h1 = box
        return any(not (x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1) for x2, y2, w2, h2 in occupied)

    for row in valid:
        px = plot_left + abs(float(row["worse"])) * plot_width
        py = plot_top + (1.0 - float(row["better"])) * plot_height
        label = row["_code"] if compact_labels else _short_label(row["name"])
        label_w, label_h = (0.34, 0.14) if compact_labels else (1.10, 0.18)
        candidates = []
        for radius in ((0.10, 0.18, 0.28, 0.40, 0.56, 0.74, 0.94, 1.16) if compact_labels else (0.10,)):
            for angle in (0, 45, 90, 135, 180, 225, 270, 315):
                radians = math.radians(angle)
                candidates.append((px + math.cos(radians) * radius, py + math.sin(radians) * radius))
        chosen = None
        for candidate_x, candidate_y in candidates:
            box = (
                max(plot_left, min(plot_left + plot_width - label_w, candidate_x)),
                max(plot_top, min(plot_top + plot_height - label_h, candidate_y)),
                label_w,
                label_h,
            )
            if not overlaps(box):
                chosen = box
                break
        chosen = chosen or (max(plot_left, min(plot_left + plot_width - label_w, px + 0.08)), py, label_w, label_h)
        occupied.append(chosen)
        _add_text(
            slide, label, *chosen, size=5.8 if compact_labels else 8.2,
            bold=True, color=COLORS["ink"], align=PP_ALIGN.CENTER if compact_labels else PP_ALIGN.LEFT,
        )
    ranked = sorted(valid, key=lambda row: abs(float(row["worse"])) + float(row["better"]), reverse=True)
    entries = [
        (
            f"{row.get('_code')} · {_short_label(row.get('name'), 10)}",
            f"B {float(row['better']):.2f} · W {float(row['worse']):.2f}",
        )
        for row in ranked[:5]
    ]
    _add_kpis(slide, "重点属性坐标", entries)
    _add_footer(slide, f"KANO · {len(valid)} 个属性 · 象限交叉线为有效属性系数均值" + (" · A01 起按导入顺序编号" if compact_labels else ""))


def _add_bar_chart(
    slide,
    labels: list[str],
    values: list[float],
    *,
    number_format: str,
    positive_color: str,
    negative_color: str | None = None,
    maximum: float | None = None,
) -> None:
    data = CategoryChartData()
    data.categories = labels
    data.add_series("结果", values)
    chart = slide.shapes.add_chart(
        XL_CHART_TYPE.BAR_CLUSTERED,
        Inches(0.88), Inches(1.62), Inches(8.72), Inches(4.88), data,
    ).chart
    _style_chart(chart, legend=False)
    chart.category_axis.reverse_order = True
    chart.category_axis.has_major_gridlines = False
    chart.value_axis.has_major_gridlines = True
    chart.value_axis.major_gridlines.format.line.color.rgb = _rgb(COLORS["grid"])
    chart.value_axis.number_format = number_format
    chart.value_axis.number_format_is_linked = False
    if maximum is not None:
        chart.value_axis.minimum_scale = 0.0
        chart.value_axis.maximum_scale = maximum
    elif values:
        peak = max(abs(value) for value in values) or 1.0
        chart.value_axis.minimum_scale = -peak * 1.2
        chart.value_axis.maximum_scale = peak * 1.2
    plot = chart.plots[0]
    plot.gap_width = 58
    plot.has_data_labels = True
    labels_format = plot.data_labels
    labels_format.position = XL_DATA_LABEL_POSITION.OUTSIDE_END
    labels_format.show_value = True
    labels_format.number_format = number_format
    labels_format.number_format_is_linked = False
    labels_format.font.name = FONT
    labels_format.font.size = Pt(9)
    labels_format.font.bold = True
    labels_format.font.color.rgb = _rgb(COLORS["ink"])
    series = chart.series[0]
    series.invert_if_negative = False
    series.format.fill.solid()
    series.format.fill.fore_color.rgb = _rgb(positive_color)
    series.format.line.fill.background()
    for index, value in enumerate(values):
        color = negative_color if negative_color and value < 0 else positive_color
        point = series.points[index]
        point.format.fill.solid()
        point.format.fill.fore_color.rgb = _rgb(color)
        point.format.line.color.rgb = _rgb(color)
        point.format.line.width = Pt(1.75)


def _render_maxdiff(slide, payload: Any) -> None:
    rows = _rows(payload, limit=30)
    valid = []
    for row in rows:
        score = _number(row.get("score"))
        item = str(row.get("item") or "").strip()
        if item and score is not None:
            valid.append({**row, "item": item, "score": score})
    if not valid:
        raise ModelChartExportError("MaxDiff data requires item and score")
    valid.sort(key=lambda row: float(row["score"]), reverse=True)
    _add_header(slide, "MaxDiff 相对偏好得分", "Best–Worst 快速计分结果与优先级排序 · 单页可编辑图表")
    _add_panel(slide, 0.62, 1.30, 9.28, 5.62)
    _add_bar_chart(
        slide,
        [str(row["item"]) for row in valid],
        [float(row["score"]) for row in valid],
        number_format="0.00",
        positive_color=COLORS["green"],
        negative_color=COLORS["red"],
    )
    _add_kpis(slide, "排序摘要", [
        (f"TOP {index + 1}", f"{row['item']} · {float(row['score']):.2f}")
        for index, row in enumerate(valid[:5])
    ])
    _add_footer(slide, f"MaxDiff · {len(valid)} 个项目")


def _render_driver(slide, payload: dict[str, Any]) -> None:
    if not isinstance(payload, dict):
        raise ModelChartExportError("driver data must be an object")
    rows = _rows(payload.get("results"), limit=30)
    valid = []
    for row in rows:
        importance = _number(row.get("importance"))
        name = str(row.get("name") or "").strip()
        if name and importance is not None:
            valid.append({**row, "name": name, "importance": importance})
    if not valid:
        raise ModelChartExportError("driver data requires name and importance")
    valid.sort(key=lambda row: float(row["importance"]), reverse=True)
    dv_name = str(payload.get("dvName") or "目标指标")
    _add_header(slide, "关键驱动分析", f"各维度对“{dv_name}”的相对贡献 · 单页可编辑图表")
    _add_panel(slide, 0.62, 1.30, 9.28, 5.62)
    maximum = max(float(row["importance"]) for row in valid)
    axis_maximum = min(1.0, max(0.1, math.ceil(maximum * 12) / 10))
    _add_bar_chart(
        slide,
        [str(row["name"]) for row in valid],
        [float(row["importance"]) for row in valid],
        number_format="0.0%",
        positive_color=COLORS["blue"],
        maximum=axis_maximum,
    )
    r2 = _number(payload.get("r2"), default=0) or 0
    sample = int(_number(payload.get("n"), default=0) or 0)
    top_entries = [
        ("R² / 样本量", f"{r2:.3f} / N={sample}"),
        ("因变量", dv_name),
    ] + [
        (f"驱动 {index + 1}", f"{row['name']} · {float(row['importance']):.1%}")
        for index, row in enumerate(valid[:3])
    ]
    _add_kpis(slide, "模型摘要", top_entries)
    _add_footer(slide, f"关键驱动 · R²={r2:.3f} · N={sample}")


def render_model_chart_pptx(model_type: str, data: Any) -> bytes:
    """Render one editable PPTX slide for a supported research model."""
    normalized = str(model_type or "").strip().lower()
    if normalized not in MODEL_TYPES:
        raise ModelChartExportError(f"unsupported model_type: {normalized or '(empty)'}")
    title = {
        "psm": "PSM 价格敏感度分析",
        "kano": "KANO Better–Worse 分析",
        "maxdiff": "MaxDiff 相对偏好得分",
        "driver": "关键驱动分析",
    }[normalized]
    presentation, slide = _new_presentation(title)
    if normalized == "psm":
        if not isinstance(data, dict):
            raise ModelChartExportError("PSM data must be an object")
        _render_psm(slide, data)
    elif normalized == "kano":
        _render_kano(slide, data)
    elif normalized == "maxdiff":
        _render_maxdiff(slide, data)
    else:
        _render_driver(slide, data)
    stream = BytesIO()
    presentation.save(stream)
    return stream.getvalue()
