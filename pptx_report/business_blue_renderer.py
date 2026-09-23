"""Editable OfficeCLI layouts adapted from the supplied business-blue library.

Only receives prepared slots. No LLM calls, example data, or raster slide bodies.
"""
from __future__ import annotations

from .business_blue_content import business_blue_notes, text, values
from .business_blue_layouts import business_blue_layout

NAVY, BLUE, MID, PALE, ICE = "0B2545", "0B3E8F", "1B5AA8", "EAF0F9", "F4F7FC"
WHITE, ORANGE, MUTED, BORDER = "FFFFFF", "E0703A", "64748B", "DDE5F0"
W, H = 33.87, 19.05


def label(b, x, y, w, h, value, size=14, color=NAVY, bold=False, align="left"):
    b.shape(x, y, w, h, text=text(value), size=size, color=color, bold=bold,
            margin=0.08, valign="middle", align=align, auto_fit="shrink", literal_text=True)


def rect(b, x, y, w, h, fill=WHITE, line="none", rounded=True, gradient=None):
    b.shape(x, y, w, h, preset="roundRect" if rounded else "rect", fill=fill,
            line=line, gradient=gradient, radius_adj="adj:val 7000" if rounded else None)


def circle(b, x, y, d, value, fill=BLUE, color=WHITE):
    b.shape(x, y, d, d, preset="ellipse", fill=fill, line="none")
    label(b, x, y, d, d, value, 15, color, True, "center")


def card(b, c, x, y, w, h, *, dark=False, number=None, accent=False):
    rect(b, x, y, w, h, BLUE if dark else WHITE, BORDER if not dark else "none")
    title = text(c.get("title"))
    body = text(c.get("body"))
    inset = 0.45
    if number is not None:
        label(b, x + inset, y + 0.3, 1.2, 0.7, f"{number:02d}", 17, ORANGE if accent else ("B4CEF0" if dark else MID), True)
        title_x, title_w = x + 1.8, w - 2.2
    else:
        title_x, title_w = x + inset, w - 2 * inset
    label(b, title_x, y + 0.28, title_w, 1.25, title, 15, WHITE if dark else BLUE, True)
    if body:
        label(b, x + inset, y + 1.62, w - 2 * inset, h - 1.95, body, 13.5, WHITE if dark else NAVY)


def grid(b, cards, *, columns=3, x=1.35, y=4.7, w=31.15, h=11.2, dark_first=False, start_number=1):
    if not cards:
        return
    rows = (len(cards) + columns - 1) // columns
    gap = 0.38
    cw, ch = (w - gap * (columns - 1)) / columns, (h - gap * (rows - 1)) / rows
    for i, c in enumerate(cards):
        card(b, c, x + (i % columns) * (cw + gap), y + (i // columns) * (ch + gap), cw, ch,
             dark=dark_first and i == 0, number=i + start_number)


def frame(b, page, layout):
    b.slide(layout["id"], ICE)
    # Small orange marker and generous whitespace retain the reference's identity.
    rect(b, 1.4, 0.64, 0.65, 0.09, ORANGE, rounded=False)
    label(b, 2.2, 0.43, 24, 0.52, layout["label"], 9.5, MUTED)
    label(b, 1.35, 1.1, 31.1, 2.55, page.get("title"), 24, NAVY, True)
    label(b, 1.4, 3.66, 30.9, 0.74, page.get("subtitle"), 11, MUTED)
    key = text(page.get("key_message"))
    if key:
        rect(b, 1.35, 16.45, 31.15, 1.12, PALE)
        label(b, 1.68, 16.54, 30.45, 0.93, key, 12, BLUE)
    source = text(page.get("source_notes"))
    if not source:
        source = "；".join(dict.fromkeys(text(q.get("source_label") or q.get("respondent_label")) for q in values(page.get("quotes"))))
    if len(source) > 135:
        source = source[:115] + "…（完整来源见演讲者备注）"
    label(b, 1.4, 17.94, 29.2, 0.7, "来源：" + (source or "项目研究材料；详见证据备注"), 9, MUTED)
    label(b, 31, 17.94, 1.45, 0.7, f"{page.get('page_number', 0):02d}", 10, MUTED, align="right")


def cover(b, page, report_title):
    b.slide("bb_cover", ICE)
    rect(b, 21.5, 0, 12.37, H, BLUE, rounded=False, gradient="0B3E8F-2E77C2-0")
    b.shape(22.5, 3.0, 9, 9, preset="ellipse", fill="none", line="6D9DD2")
    b.shape(24.0, 4.5, 6, 6, preset="ellipse", fill="none", line="98B9DE")
    rect(b, 23.4, 13.4, 8.3, 2.4, ORANGE)
    label(b, 24.0, 13.65, 7.1, 1.8, "研究发现与行动建议", 20, WHITE, True)
    label(b, 2.0, 3.7, 18.2, 1.0, "RESEARCH REPORT", 12, MID, True)
    label(b, 2.0, 5.6, 18.2, 6.2, page.get("title") or report_title, 30, NAVY, True)
    label(b, 2.0, 12.2, 18.2, 2.0, page.get("subtitle") or page.get("key_message"), 16, MUTED)
    label(b, 2.0, 16.15, 18.2, 1.4, page.get("source_notes"), 11, MUTED)


def section(b, page):
    b.slide("bb_section", ICE)
    rect(b, 0, 0, 11.0, H, BLUE, rounded=False)
    label(b, 1.8, 4.0, 7.5, 1.2, "CHAPTER", 16, "B4CEF0", True)
    label(b, 1.8, 6.0, 7.5, 4.5, f"{page.get('_bb_chapter_number', 1):02d}", 70, WHITE, True)
    rect(b, 13.0, 4.8, 1.2, 0.15, ORANGE, rounded=False)
    label(b, 13.0, 6.0, 18.5, 5.0, page.get("title"), 28, NAVY, True)
    label(b, 13.0, 12.0, 18.5, 3.6, page.get("key_message") or page.get("subtitle"), 17, MUTED)


def contents(b, cards):
    for i, c in enumerate(cards):
        y = 4.7 + i * 1.82
        circle(b, 1.7, y + 0.2, 1.1, f"{i + 1:02d}")
        rect(b, 3.4, y, 29.1, 1.55, WHITE)
        label(b, 4.0, y + 0.1, 20.6, 1.35, c["title"], 18, NAVY, True)
        label(b, 25.3, y + 0.1, 6.5, 1.35, c["body"], 12, MID, align="right")


def summary(b, cards):
    if not cards:
        return
    card(b, cards[0], 1.35, 4.7, 11.1, 11.2, dark=True, number=1)
    if len(cards) > 1:
        grid(b, cards[1:], columns=2, x=12.9, w=19.6, dark_first=False, start_number=2)


def quotes(b, page):
    qs = page["quotes"]
    cw = (31.15 - 0.5 * (len(qs) - 1)) / max(1, len(qs))
    for i, q in enumerate(qs):
        x, dark = 1.35 + i * (cw + 0.5), i == 1
        rect(b, x, 4.7, cw, 11.2, BLUE if dark else WHITE, "none" if dark else BORDER)
        label(b, x + 0.5, 4.95, cw - 1, 1.2, "“", 34, "B4CEF0" if dark else MID, True)
        label(b, x + 0.6, 6.2, cw - 1.2, 7.0, q.get("text"), 15, WHITE if dark else NAVY)
        source = text(q.get("respondent_label") or q.get("source_label"))
        if q.get("quote_total", 1) > 1:
            source += f" · 原声 {q['quote_part']}/{q['quote_total']}"
        label(b, x + 0.6, 13.65, cw - 1.2, 1.6, source, 11, "B4CEF0" if dark else MUTED)


def persona(b, cards):
    for i, c in enumerate(cards):
        x = 1.35 + i * 15.8
        rect(b, x, 4.7, 15.35, 11.2, WHITE, BORDER)
        rect(b, x, 4.7, 15.35, 2.5, BLUE if i == 0 else MID)
        circle(b, x + 0.6, 5.25, 1.25, str(i + 1), WHITE, BLUE)
        label(b, x + 2.3, 5.0, 12.3, 1.9, c["title"], 20, WHITE, True)
        label(b, x + 0.75, 7.75, 13.85, 7.4, c["body"], 17)


def journey(b, cards, roadmap=False):
    if not cards:
        return
    cw = (31.15 - 0.35 * (len(cards) - 1)) / len(cards)
    b.connector(2.2, 6.0, 29.4, 0, color=MID, line_width=2)
    for i, c in enumerate(cards):
        x = 1.35 + i * (cw + 0.35)
        circle(b, x + cw / 2 - 0.65, 5.35, 1.3, str(i + 1), ORANGE if i == 0 else BLUE)
        card(b, c, x, 7.2 if not roadmap else 7.55, cw, 8.5 if not roadmap else 8.15)


def fishbone(b, cards, page):
    b.connector(2.0, 10.35, 28.8, 0, color=BLUE, line_width=2.5)
    for i, c in enumerate(cards):
        col, bottom = i % 3, i >= 3
        x, y = 1.35 + col * 10.45, 11.5 if bottom else 4.7
        stem_x = x + 4.7
        b.connector(stem_x, 10.35, -0.8, 1.15 if bottom else -1.15, color=MID, arrow="")
        card(b, c, x, y, 9.95, 4.45, number=i + 1)


def matrix(b, cards):
    # Equal cells express categories, never numerical intensity without a score.
    grid(b, cards, columns=3, dark_first=True)


def value_canvas(b, cards):
    if cards:
        card(b, cards[0], 1.35, 4.7, 10.1, 11.2, dark=True)
    for i, c in enumerate(cards[1:]):
        card(b, c, 13.0, 4.7 + i * 5.8, 19.5, 5.4, number=i + 2, accent=True)
    b.connector(11.6, 10.2, 1.1, 0, color=ORANGE, line_width=2)


def swot(b, cards):
    # Labels come from source content; do not turn unlabeled observations into SWOT claims.
    grid(b, cards, columns=2, dark_first=True)


def comparison(b, cards):
    grid(b, cards, columns=max(1, len(cards)), dark_first=True)


def rows(b, cards, *, label_width=9.0, numbered=True):
    if not cards:
        return
    rh = min(2.65, (11.2 - 0.22 * (len(cards) - 1)) / len(cards))
    for i, c in enumerate(cards):
        y = 4.7 + i * (rh + 0.22)
        rect(b, 1.35, y, 31.15, rh, WHITE, BORDER)
        if numbered:
            label(b, 1.65, y + 0.1, 1.1, rh - 0.2, f"{i + 1:02d}", 12, MID, True)
        label(b, 3.0 if numbered else 1.8, y + 0.15, label_width - (1.65 if numbered else 0.45), rh - 0.3, c["title"], 13.5, BLUE, True)
        label(b, 1.8 + label_width, y + 0.15, 30.1 - label_width, rh - 0.3, c["body"], 13)


def positioning(b, cards, page):
    axes = page.get("axes") or {}
    rect(b, 1.35, 4.7, 18.2, 11.2, WHITE, BORDER)
    # Compact numeric coordinates are qualitative positions, not measured scores.
    b.connector(3.0, 14.2, 14.8, 0, color=MUTED, arrow="")
    b.connector(3.0, 14.2, 0, -7.7, color=MUTED, arrow="")
    label(b, 3.1, 14.55, 14.5, 0.9, axes.get("x"), 11, BLUE, align="center")
    label(b, 3.1, 5.15, 14.5, 0.9, axes.get("y"), 11, BLUE)
    for i, c in enumerate(cards):
        x, y = 3.1 + float(c["x"]) / 100 * 13.2, 12.9 - float(c["y"]) / 100 * 5.9
        circle(b, x, y, 1.05, str(i + 1), ORANGE if i == 0 else BLUE)
        cy = 4.7 + i * 2.82
        rect(b, 20.1, cy, 12.4, 2.55, WHITE, BORDER)
        label(b, 20.5, cy + 0.15, 11.5, 0.8, f"{i + 1}. {c['title']}", 14, BLUE, True)
        label(b, 20.5, cy + 1.0, 11.5, 1.35, c["body"], 12)
    label(b, 3.1, 15.4, 14.5, 0.4, "定性相对定位，非统计测量", 9, MUTED)


def priority(b, cards):
    # Priority values are printed as supplied. No fabricated XY scores.
    rect(b, 1.35, 4.7, 7.2, 11.2, BLUE)
    label(b, 2.0, 5.4, 5.9, 1.5, "需求优先级", 23, WHITE, True)
    label(b, 2.0, 8.0, 5.9, 4.5, "按研究证据呈现\n优先级以脚本为准\n未提供评分不作量化排序", 15, WHITE)
    rh = min(2.4, (11.2 - 0.2 * (len(cards) - 1)) / max(1, len(cards)))
    for i, c in enumerate(cards):
        y = 4.7 + i * (rh + 0.2)
        rect(b, 9.0, y, 23.5, rh, WHITE, BORDER)
        label(b, 9.45, y + 0.1, 9.1, rh - 0.2, c["title"], 14, BLUE, True)
        label(b, 18.9, y + 0.1, 13.1, rh - 0.2, c["body"] or "优先级待确认", 13)


def actions(b, cards):
    rows(b, cards, label_width=10.5)


def glossary(b, cards):
    grid(b, cards, columns=2)


def sources(b, cards):
    rect(b, 1.35, 4.7, 6.0, 11.2, BLUE)
    label(b, 2.0, 5.4, 4.7, 3.0, "数据口径\n与来源", 23, WHITE, True)
    label(b, 2.0, 10.0, 4.7, 3.9, "来源可追溯\n适用边界明确", 15, WHITE)
    rh = min(2.65, (11.2 - 0.2 * (len(cards) - 1)) / max(1, len(cards)))
    for i, c in enumerate(cards):
        y = 4.7 + i * (rh + 0.2)
        rect(b, 7.85, y, 24.65, rh, WHITE, BORDER)
        label(b, 8.25, y + 0.12, 8.0, rh - 0.24, c["title"], 13, BLUE, True)
        label(b, 16.7, y + 0.12, 15.3, rh - 0.24, c["body"], 12)


def closing(b, cards):
    rect(b, 1.35, 4.7, 10.1, 11.2, BLUE)
    label(b, 2.0, 6.0, 8.8, 3.7, "核心共识\n与下一步", 30, WHITE, True)
    label(b, 2.0, 12.0, 8.8, 1.5, "RESEARCH TAKEAWAYS", 10, "B4CEF0")
    for i, c in enumerate(cards):
        card(b, c, 12.0, 4.7 + i * 3.85, 20.5, 3.5, number=i + 1)


def start_stop_continue(b, cards):
    for i, c in enumerate(cards):
        x = 1.35 + i * 10.5
        card(b, c, x, 6.6, 10.15, 9.3)
        rect(b, x, 4.7, 10.15, 1.5, [BLUE, ORANGE, MID][i])
        label(b, x + 0.3, 4.8, 9.55, 1.2, c["title"], 17, WHITE, True, "center")


def strategy_house(b, cards, page):
    # A neutral roof uses the stated goal, with equal-width evidence-backed pillars.
    b.shape(1.35, 4.55, 31.15, 2.6, preset="triangle", fill=BLUE, line="none")
    rect(b, 1.35, 6.5, 31.15, 1.0, BLUE, rounded=False)
    label(b, 2.0, 6.53, 29.85, 0.9, page.get("key_message") or page.get("title"), 15, WHITE, True, "center")
    if cards:
        grid(b, cards, columns=len(cards), y=7.9, h=6.7)
    rect(b, 1.35, 15.0, 31.15, 0.9, MID)
    label(b, 1.8, 15.1, 30.2, 0.7, "支撑依据：项目研究证据", 11, WHITE, align="center")


def gap(b, cards):
    for i, c in enumerate(cards):
        x = 1.35 + i * 10.5
        card(b, c, x, 5.2 + (0.65 if i == 1 else 0), 9.8, 9.7, dark=i == 2)
        if i < len(cards) - 1:
            b.connector(x + 9.9, 10.3, 0.5, 0, color=ORANGE, line_width=2)


def render_business_blue_page(b, page, report_title):
    variant = page["layout_variant"]
    layout = business_blue_layout(variant)
    cards = page.get("_bb_cards", [])
    if variant == "bb_cover":
        cover(b, page, report_title)
    elif variant == "bb_section":
        section(b, page)
    else:
        frame(b, page, layout)
        if variant == "bb_contents": contents(b, page.get("_bb_toc") or cards)
        elif variant == "bb_summary": summary(b, cards)
        elif variant == "bb_quotes": quotes(b, page)
        elif variant == "bb_persona_pair": persona(b, cards)
        elif variant == "bb_journey": journey(b, cards)
        elif variant == "bb_fishbone": fishbone(b, cards, page)
        elif variant == "bb_matrix": matrix(b, cards)
        elif variant == "bb_value_canvas": value_canvas(b, cards)
        elif variant == "bb_swot": swot(b, cards)
        elif variant == "bb_comparison": comparison(b, cards)
        elif variant == "bb_feature_compare": rows(b, cards)
        elif variant == "bb_positioning": positioning(b, cards, page)
        elif variant == "bb_priority": priority(b, cards)
        elif variant == "bb_actions": actions(b, cards)
        elif variant == "bb_roadmap": journey(b, cards, roadmap=True)
        elif variant == "bb_glossary": glossary(b, cards)
        elif variant == "bb_sources": sources(b, cards)
        elif variant == "bb_closing": closing(b, cards)
        elif variant == "bb_findings": grid(b, cards, columns=3, dark_first=True)
        elif variant == "bb_start_stop_continue": start_stop_continue(b, cards)
        elif variant == "bb_strategy_house": strategy_house(b, cards, page)
        elif variant == "bb_gap": gap(b, cards)
        else: raise ValueError(f"尚未实现的版式：{variant}")
    b.notes(business_blue_notes(page))
