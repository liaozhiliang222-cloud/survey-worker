"""Lossless pagination and semantic slots for the business-blue template."""
from __future__ import annotations

from copy import deepcopy
import json
import math

from .business_blue_layouts import business_blue_layout, resolve_business_blue


def text(value) -> str:
    return str(value if value is not None else "").strip()


def values(value) -> list:
    return value if isinstance(value, list) else []


def atom(value) -> str:
    if isinstance(value, dict):
        return text(value.get("text") or value.get("body") or value.get("summary") or value.get("statement") or value.get("label"))
    return text(value)


def cards_for_page(page: dict) -> list[dict]:
    """Retain every supplied body/item; supporting_points often aliases findings."""
    result: list[dict] = []
    seen: set[tuple] = set()

    def add(title, body, **meta):
        title, body = text(title), text(body)
        signature = (title, body)
        if (title or body) and signature not in seen:
            seen.add(signature)
            result.append({"title": title, "body": body, **meta})

    for block in values(page.get("content_structure")):
        if not isinstance(block, dict):
            add("", atom(block))
            continue
        parts = [text(block.get("body") or block.get("summary") or block.get("statement"))]
        parts += [atom(item) for item in values(block.get("items")) + values(block.get("points"))]
        add(block.get("title") or block.get("region"), "\n".join(dict.fromkeys(p for p in parts if p)))
    for field, label in (("segments", "人群"), ("items", "需求"), ("definition_layers", "定义"),
                         ("boundary_rules", "边界"), ("levels", "层级")):
        for item in values(page.get(field)):
            if isinstance(item, dict):
                details = [atom(item)]
                if item.get("parent"):
                    details.insert(0, f"所属：{text(item['parent'])}")
                if item.get("priority"):
                    priority = {"high": "高", "medium": "中", "low": "低"}.get(text(item["priority"]).lower(), text(item["priority"]))
                    details.append(f"优先级：{priority}")
                add(item.get("title") or item.get("label") or label,
                    "\n".join(dict.fromkeys(v for v in details if v)),
                    x=item.get("x"), y=item.get("y"), priority=text(item.get("priority")))
            else:
                add(label, atom(item))
    profile = page.get("profile") if isinstance(page.get("profile"), dict) else {}
    details = [text(profile.get("archetype")), text(profile.get("motto"))]
    attributes = profile.get("attributes") or []
    if isinstance(attributes, dict):
        details += [f"{k}：{text(v)}" for k, v in attributes.items()]
    else:
        details += [f"{text(a.get('label') or a.get('name'))}：{text(a.get('value'))}" if isinstance(a, dict) else text(a) for a in values(attributes)]
    if profile.get("name") or any(details):
        add(profile.get("name") or "用户特征", "\n".join(d for d in details if d))
    if page.get("page_type") == "persona":
        profile_details = []
        for field, label in (("traits", "特征"), ("behaviors", "行为")):
            profile_details += [f"{label}：{atom(item)}" for item in values(page.get(field)) if atom(item)]
        add("特征与行为", "\n".join(profile_details))
    else:
        for field, label in (("traits", "特征"), ("behaviors", "行为")):
            for item in values(page.get(field)):
                add(label, atom(item))
    for item in values(page.get("segment_mapping")):
        if isinstance(item, dict):
            add(item.get("segment"), item.get("level"))
    findings = values(page.get("supporting_findings")) or values(page.get("supporting_points"))
    body_seen = {c["body"] for c in result}
    for item in findings:
        value = atom(item)
        if value and value not in body_seen:
            add("研究发现", value)
            body_seen.add(value)
    for field, label in (("hypothesis", "研究假设"), ("verdict", "证据判断"), ("recommendation", "行动建议")):
        value = text(page.get(field))
        if value and value not in body_seen and value != text(page.get("key_message")):
            add(label, value)
    return result


def split_cards(cards: list[dict], limit: int) -> list[dict]:
    result = []
    for card in cards:
        body = card["body"]
        pieces = [body[i:i + limit] for i in range(0, len(body), limit)] or [""]
        for i, part in enumerate(pieces):
            result.append({**card, "body": part,
                           "title": card["title"] + (f"（续 {i + 1}）" if i else "")})
    return result


def _chunks(items: list, n: int) -> list[list]:
    return [items[i:i + n] for i in range(0, len(items), n)]


def _position_card(card: dict) -> bool:
    return all(isinstance(card.get(k), (float, int)) and not isinstance(card.get(k), bool)
               and math.isfinite(card[k]) and 0 <= card[k] <= 100 for k in ("x", "y"))


def prepare_business_blue(script: dict) -> tuple[list[dict], list[dict]]:
    prepared, issues = [], []
    for index, original in enumerate(values(script.get("pages"))):
        if not isinstance(original, dict):
            raise ValueError("PPT 页面必须是对象")
        page = deepcopy(original)
        page.setdefault("id", f"page_{index + 1}")
        page.setdefault("page_number", index + 1)
        page.setdefault("page_type", "qualitative_insight")
        if page.get("data_points") or page["page_type"] == "data_insight":
            raise ValueError("蓝色商务第一期支持定性报告；定量图表请使用现有定量报告入口。")
        variant = resolve_business_blue(page)
        layout = business_blue_layout(variant)
        cards = cards_for_page(page)
        if variant == "bb_sources" and not cards:
            source_notes = dict.fromkeys(text(p.get("source_notes")) for p in values(script.get("pages")) if isinstance(p, dict) and text(p.get("source_notes")))
            cards = [{"title": f"研究来源 {n + 1}", "body": source} for n, source in enumerate(source_notes)]
        limits = {"bb_fishbone": 60, "bb_matrix": 45, "bb_sources": 65, "bb_positioning": 55,
                  "bb_feature_compare": 75, "bb_priority": 55, "bb_glossary": 70}
        cards = split_cards(cards, 200 if variant == "bb_persona_pair" and page["page_type"] == "persona" else limits.get(variant, 100))
        # A long heading needs content editing, never implicit truncation or tiny text.
        if len(text(page.get("title"))) > 90 or any(len(c["title"]) > 48 for c in cards):
            raise ValueError(f"页面“{text(page.get('title'))[:30]}”标题过长，请在脚本中缩短标题后重试。")
        if len(text(page.get("key_message"))) > 160:
            raise ValueError("单页核心结论超过160字，请在脚本中拆分结论。")
        quotes = []
        for quote in values(page.get("quotes")):
            if not isinstance(quote, dict):
                raise ValueError("原声必须包含正文与证据来源")
            raw = text(quote.get("text") or quote.get("quote"))
            parts = [raw[i:i + 180] for i in range(0, len(raw), 180)] or [""]
            for n, part in enumerate(parts):
                quotes.append({**quote, "text": part, "quote_part": n + 1, "quote_total": len(parts)})
        if variant == "bb_quotes" and not quotes:
            raise ValueError("用户原声版式需要逐字引语；请补充原声或切换为主题发现版式。")
        if variant == "bb_positioning":
            positioned = [c for c in cards if _position_card(c)]
            axes = page.get("axes") or {}
            if not positioned or not text(axes.get("x")) or not text(axes.get("y")):
                raise ValueError("市场定位需要明确的两轴和相对位置，请补充脚本或切换为人群画像版式。")
            # Explanatory cards without coordinates remain as readable continuation pages.
            cards = positioned + [c for c in cards if not _position_card(c)]

        chunks: list[tuple[str, list, list]] = []
        if variant == "bb_quotes":
            chunks += [(variant, [], q) for q in _chunks(quotes, 3)]
            chunks += [("bb_findings", c, []) for c in _chunks(cards, 4)]
        else:
            chunks += [(variant, c, []) for c in _chunks(cards, layout["capacity"])] or [(variant, [], [])]
            chunks += [("bb_quotes", [], q) for q in _chunks(quotes, 3)]
        if variant in {"bb_cover", "bb_section"}:
            chunks = [(variant, [], [])] + [("bb_findings", c, []) for c in _chunks(cards, 4)] + [("bb_quotes", [], q) for q in _chunks(quotes, 3)]
        if variant == "bb_positioning":
            chunks = [(variant, c, []) for c in _chunks([c for c in cards if _position_card(c)], 4)]
            chunks += [("bb_findings", c, []) for c in _chunks([c for c in cards if not _position_card(c)], 4)]
            chunks += [("bb_quotes", [], q) for q in _chunks(quotes, 3)]
        if page.get("layout_binding", {}).get("force_split") and len(chunks) == 1 and len(chunks[0][1]) > 1:
            v, c, q = chunks[0]
            chunks = [(v, group, q) for group in _chunks(c, max(1, math.ceil(len(c) / 2)))]
        if len(chunks) > 1:
            issues.append({"code": "PAGE_TOO_DENSE", "severity": "fixed", "page_id": page["id"],
                           "message": f"已保留全部内容并拆为 {len(chunks)} 页；额外发现和原声分别展示。"})
        for n, (resolved, card_group, quote_group) in enumerate(chunks):
            clone = deepcopy(page)
            clone["layout_variant"] = resolved
            if resolved != variant:
                clone["page_type"] = "quote_evidence" if resolved == "bb_quotes" else "qualitative_insight"
            clone["_bb_cards"] = card_group
            clone["quotes"] = quote_group
            clone["_bb_original_page"] = original
            clone["layout_binding"] = {**(page.get("layout_binding") or {}), "source_slide": business_blue_layout(resolved)["source_slide"]}
            if n:
                clone["id"] = f"{page['id']}__part_{n + 1}"
                clone["split_from_page_id"] = page["id"]
                clone["title"] = f"{page.get('title', '')}（续 {n + 1}）"
            if len(chunks) > 1:
                clone.update(split_part=n + 1, split_total=len(chunks))
            prepared.append(clone)
    # Allocate all TOC continuation pages before calculating final chapter positions.
    chapter_names = list(dict.fromkeys(text(p.get("chapter")) for p in prepared
                                      if text(p.get("chapter")) and p["layout_variant"] not in {"bb_cover", "bb_contents"}))
    if chapter_names:
        expanded, toc_seen = [], set()
        for page in prepared:
            if page["layout_variant"] != "bb_contents":
                expanded.append(page)
                continue
            source_id = page.get("split_from_page_id") or page["id"]
            if source_id in toc_seen:
                continue
            toc_seen.add(source_id)
            count = math.ceil(len(chapter_names) / 6)
            for n in range(count):
                clone = deepcopy(page)
                clone["_bb_toc_part"] = n
                if n:
                    clone["id"] = f"{source_id}__part_{n + 1}"
                    clone["split_from_page_id"] = source_id
                    clone["title"] = f"{page.get('title', '')}（续 {n + 1}）"
                if count > 1:
                    clone.update(split_part=n + 1, split_total=count)
                expanded.append(clone)
        prepared = expanded
    chapter_number = 0
    for index, page in enumerate(prepared, 1):
        page["page_number"] = index
        if page["layout_variant"] == "bb_section":
            chapter_number += 1
            page["_bb_chapter_number"] = chapter_number
    # TOC uses final rendered positions, including continuation pages.
    chapters, seen = [], set()
    for page in prepared:
        chapter = text(page.get("chapter"))
        if chapter and chapter not in seen and page["layout_variant"] not in {"bb_cover", "bb_contents"}:
            seen.add(chapter)
            chapters.append({"title": chapter, "body": f"第 {page['page_number']} 页"})
    for page in prepared:
        if page["layout_variant"] == "bb_contents":
            # Keep supplied TOC content when no actual chapter metadata exists.
            start = page.get("_bb_toc_part", 0) * 6
            page["_bb_toc"] = chapters[start:start + 6]
    return prepared, issues


def business_blue_notes(page: dict) -> str:
    return "\n".join([
        f"Source slide: {page['layout_binding']['source_slide']}",
        f"Layout: {page['layout_variant']}",
        f"Evidence IDs: {', '.join(map(str, values(page.get('evidence_ids'))))}",
        f"Source: {text(page.get('source_notes'))}",
        "Original page (verbatim, for audit):",
        json.dumps(page.get("_bb_original_page", page), ensure_ascii=False, sort_keys=True),
    ])
