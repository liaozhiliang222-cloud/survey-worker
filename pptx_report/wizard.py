"""通用问卷交叉表 → 调研报告向导（对齐尼尔森 / 益普索 / 凯度交付规范）。

本模块把 ``build_jd_report.parse_crosstab`` 解析出的结构化题目，自动组装成一份
**覆盖全部题目** 的调研报告，重点解决四类常见问题：

1. **题目覆盖不全** —— 全部可渲染题目进入主线图表页；不可渲染题目（甄别 /
   过滤 / 低信息量）自动进附录表格兜底，做到「卷面无遗漏」。
2. **没有数据标签** —— 所有图表（柱 / 条 / 线 / 堆积 / 环形 / 组合）统一显示
   百分比数据标签（``49.0%``，9pt，深灰，关闭自动换行）。
3. **数据未排序** —— 无序类目（省份 / 品牌 …）按总体降序、最大值置顶；有序类目
   （年龄 / 收入 / 满意度量表 …）保持原始顺序，符合阅读习惯。
4. **缺少多维度对比** —— 每题默认展示 ``Total + 全部细分人群`` 的多系列并排条形图，
   直接呈现人群差异；场景 / 评分类题目自动用雷达图做多维轮廓对比。

用法（程序化）：:

    from pptx_report.wizard import run_wizard
    run_wizard("交叉表.xlsx", "报告.pptx",
               title="XX消费者调研报告", client="XX", date="2026-03-20")

用法（命令行）::

    PYTHONPATH=D:/调研工具 python -m pptx_report.wizard
"""

from __future__ import annotations

import re

import pandas as pd

from .model import (
    AppendixContent,
    ChartPageContent,
    ChartSpec,
    ChartType,
    CoverContent,
    ExecutiveSummaryContent,
    KPI,
    LayoutType,
    MultiGroupBarPageContent,
    ReportSpec,
    TableData,
    TocContent,
)
from .renderer import ReportRenderer
from .theme import Theme
from .build_jd_report import parse_crosstab, apply_dimension, SEGMENT_ORDER, _norm, _shorten
from . import build_jd_report


# ───────────────────────── 题干关键字提取（组列短标签） ─────────────────────────
def _extract_group_label(title: str) -> str:
    """从完整题干中提取简短关键字标签，用于 multi_group_bar 组列显示。

    策略：语义槽位提取「品类 + 主题」，如：
        "请问您购买常温牛奶的频率是"           → "常温奶购买频率"
        "您对低温牛奶的购买情况更符合以下哪种"  → "低温奶购买情况"
        "请问您过去1个月购买的常温牛奶价格是"   → "常温奶价格"
        "您一直主要购买常温牛奶，主要是出于哪些方面的考虑" → "常温奶购买原因"
        "请问您的年龄是"                       → "年龄"
    """
    t = _norm(title).strip()
    if not t:
        return ""

    # ── 0) 人口属性/配额题：直接映射（无品类） ──
    demo_rules = [
        ("省份", "省份"), ("城市级别", "城市级别"), ("城市", "城市级别"),
        ("年龄配额", "年龄配额"), ("家庭结构配额", "家庭结构"),
        ("年龄", "年龄"), ("性别", "性别"),
        ("居住", "居住情况"), ("家庭结构", "家庭结构"),
        ("月收入", "月收入"), ("收入", "收入"), ("学历", "学历"), ("职业", "职业"),
        ("后台圈选", "用户分类"), ("用户分类", "用户分类"),
    ]
    # 人口属性题通常很短且不含品类词，优先匹配
    if not any(c in t for c in ["牛奶", "乳制品", "奶"]):
        for kw, label in demo_rules:
            if kw in t:
                return label

    # ── 1) 品类槽 ──
    cat = ""
    for c, short in [
        ("常温纯牛奶", "常温纯奶"), ("低温纯牛奶", "低温纯奶"),
        ("常温牛奶", "常温奶"), ("低温牛奶", "低温奶"),
        ("纯牛奶", "纯牛奶"), ("乳制品", "乳制品"),
    ]:
        if c in t:
            cat = short
            break

    # ── 2) 品牌槽（品牌细分题） ──
    brand = ""
    for b in ["金典", "君乐宝", "特仑苏", "伊利", "蒙牛", "光明", "三元", "悦鲜活"]:
        if b in t:
            brand = b
            break

    # ── 3) 主题槽（按特异性从高到低） ──
    topic = ""
    topic_rules = [
        (["营养成分", "营养"], "营养关注"),
        (["频率", "多久", "频次"], "购买频率"),
        (["价格", "价位", "单价", "花费"], "价格"),
        (["出于", "主要是.*考虑", "原因", "为什么"], "购买原因"),
        (["着重考虑", "考虑.*因素", "因素", "关注"], "考虑因素"),
        (["购买情况", "购买过", "计划购买", "更符合"], "购买情况"),
        (["目的", "用途"], "购买目的"),
        (["角色"], "购买角色"),
        (["品牌"], "品牌"),
        (["满意"], "满意度"),
        (["推荐", "NPS"], "推荐意愿"),
        (["顾虑", "担心", "担忧"], "顾虑"),
        (["渠道", "在哪", "购买途径"], "购买渠道"),
        (["包装"], "包装偏好"),
        (["口味", "口感"], "口味偏好"),
    ]
    for kws, label in topic_rules:
        if any(re.search(k, t) if ("." in k or "*" in k) else (k in t) for k in kws):
            topic = label
            break

    # ── 4) 组合输出 ──
    if brand and cat:
        return f"{brand}{cat}"[:10]            # 如「金典常温奶」
    if brand:
        return f"{brand}品牌"[:10]
    if cat and topic:
        return f"{cat}{topic}"[:10]            # 如「常温奶购买频率」
    if cat:
        return cat
    if topic:
        return topic

    # ── 5) 兜底：剥离前后缀后取核心名词 ──
    for prefix in ["请问在", "请问您", "请问", "在您", "您在", "您对", "您",
                   "过去6个月，", "过去3个月，", "过去一年，", "过去1个月，"]:
        if t.startswith(prefix):
            t = t[len(prefix):].strip()
            break
    for lead in ["的", "对", "在"]:
        if t.startswith(lead):
            t = t[len(lead):].strip()
    for suffix in ["是哪一类", "有哪些", "是哪", "更符合以下哪种", "以下哪种",
                   "以下哪些", "是什么", "？", "?", "是", "。"]:
        if t.endswith(suffix):
            t = t[:-len(suffix)].strip()
    return t[:8]


# ───────────────────────── 有序类目判定（移植自 crosstab-to-ppt skill） ─────────────────────────
_NATURAL_ORDER_KW = [
    "年龄", "岁", "收入", "月收入", "年收入", "家庭月收入", "时长", "小时", "分钟",
    "频率", "等级", "规模", "学历", "教育", "满意度", "满意", "一般", "不满意",
    "同意", "不同意", "台", "元", "分", "完全符合", "不太符合", "比较符合",
    "非常符合", "从不", "偶尔", "有时", "经常", "总是",
]
_NATURAL_ORDER_PATTERNS = [
    re.compile(r"^\d+(-\d+)?岁"),
    re.compile(r"^\d+[-~至]\d+\s*元"),
    re.compile(r"^每天|每日|每周|每月|每年"),
    re.compile(r"^\d+次[/每]"),
    re.compile(r"^[非常]?[不同]?满意"),
    re.compile(r"^[非常]?[不同]?同意"),
    re.compile(r"^\d+[\.\、\)\）]"),
    re.compile(r"^非常|^比较|^不太|^完全不"),
]


def has_natural_order(categories) -> bool:
    """判断类目是否具有内在顺序（年龄带 / 收入带 / Likert 量表 / NPS 分等）。"""
    for cat in categories:
        c = str(cat).strip()
        for pat in _NATURAL_ORDER_PATTERNS:
            if pat.match(c):
                return True
        for kw in _NATURAL_ORDER_KW:
            if kw in c:
                return True
    return False


# ───────────────────────── 题目自动分模块（对齐 6+1 报告结构） ─────────────────────────
_MODULE_RULES = [
    ("用户画像", ["年龄", "岁", "性别", "学历", "教育", "收入", "月收", "年收",
                 "职业", "家庭", "婚姻", "子女", "城市级别", "城市", "省份", "居住"]),
    ("消费行为", ["购买", "使用", "饮用", "频率", "场景", "渠道", "品牌", "选择",
                 "偏好", "消费", "花费", "价格", "金额", "尝试", "购买过", "未来",
                 "计划", "常温", "低温", "酸奶", "风味奶", "植物蛋白"]),
    ("品牌与满意度", ["满意度", "满意", "评价", "推荐", "NPS", "净推荐", "忠诚",
                     "认知", "知名度", "印象", "信任", "品质", "口碑", "打分",
                     "评分", " Likert", "同意", "不符合"]),
    ("专项研究", ["概念", "测试", "包装", "广告", "创意", "吸引力", "意愿",
                  "原因", "因素", "考虑", "驱动", "改进", "期望", "需求"]),
]

def _categorize_question(q: dict) -> str:
    """根据题面关键词把题目归入模块（对齐 6+1 结构）。"""
    title = _norm(q["title"])
    code = q.get("code", "").upper()
    combined = f"{title} {code}"
    for module_name, keywords in _MODULE_RULES:
        if any(kw in combined for kw in keywords):
            return module_name
    return "其他研究"


def _match_segment(name: str, segs: list):
    """把用户给定的人群名匹配到实际 segment（容错空白 / 引号 / 子串）。"""
    target = _norm(str(name)).strip()
    if not target:
        return None
    for s in segs:  # 精确匹配优先
        if _norm(s).strip() == target:
            return s
    for s in segs:  # 退而求其次：子串匹配（如「中产」匹配「都市中产」）
        ns = _norm(s).strip()
        if target and (target in ns or ns in target):
            return s
    return None


def _select_segments(segs: list, override=None) -> list:
    """决定要展示为数据列的人群。

    - ``override`` 指定时：按用户给定的人群名取交集，``Total`` 始终置于首位；
      指定的名字容错空白 / 引号 / 子串（见 :func:`_match_segment`）。
    - ``override`` 未指定时：**默认全部展示**——multi_group_bar 是表格布局，
      每个人群占一列、互不遮挡，可容纳全部人群，无需按差异筛选。
    """
    segs = list(segs)
    if not override:
        return segs
    picked = []
    if "Total" in segs:
        picked.append("Total")
    for name in override:
        m = _match_segment(name, segs)
        if m and m not in picked:
            picked.append(m)
    # 若指定的人群一个都没匹配上 → 退回全展示，避免生成空图
    non_total = [s for s in picked if s != "Total"]
    return picked if non_total else segs


# ───────────────────────── 数据变换助手 ─────────────────────────
def _sort_question(q: dict):
    """返回排序后的 (categories, data)。

    - 有序类目：保持原始顺序（年龄 / 收入 / 量表）；
    - 无序类目：按 ``Total``（无则第一个人群）降序，并反转列表，
      使最大值位于顶部（PPT 横向条形图把 [0] 渲染在底部）。
    """
    cats = list(q["categories"])
    segs = q.get("segments") or []
    data = q["data"]
    if not cats or not segs:
        return cats, {s: list(data.get(s, [])) for s in segs}

    ordered = has_natural_order(cats)
    ref = data.get("Total") or data.get(segs[0]) or []
    if ordered or not ref:
        return cats, {s: list(data.get(s, [])) for s in segs}

    order = sorted(
        range(len(cats)),
        key=lambda i: (ref[i] if ref[i] is not None else -1),
        reverse=True,
    )
    order = order[::-1]  # 反转：最大在顶部
    new_cats = [cats[i] for i in order]
    new_data = {
        s: [(data[s][i] if i < len(data[s]) else None) for i in order]
        for s in segs
    }
    return new_cats, new_data


def _pct_list(data: dict, seg: str, cats: list) -> list:
    """取某人群在指定类目顺序上的占比（×100，缺失补 0）。"""
    vals = data.get(seg, [])
    out = []
    for i in range(len(cats)):
        v = vals[i] if i < len(vals) else None
        out.append(round(v * 100, 1) if v is not None else 0.0)
    return out


def auto_chart_type(q: dict, cats: list, segs: list) -> ChartType:
    """按数据特征自动选图表类型（对齐调研公司选图规范）。"""
    n_cat = len(cats)
    n_seg = len(segs)
    title = q["title"]
    # 场景 / 评分 / 多维评价类 → 雷达图（各人群轮廓对比）
    if n_seg >= 2 and n_cat >= 4 and any(
        k in title for k in ("场景", "评分", "维度", "画像", "评价", "偏好", "对比")
    ):
        return ChartType.RADAR
    # 单人群 + ≤5 类目 → 环形图（构成占比）
    if n_seg == 1:
        return ChartType.DOUGHNUT if n_cat <= 5 else ChartType.BAR
    # 多人群 → 多系列并排条形图（多维度对比）
    return ChartType.BAR


def _auto_insight(q: dict, cats: list, data: dict, segs: list) -> str:
    """生成一条简短洞察：总体最高项 + （多人群时）偏离最大的人群。"""
    tot = data.get("Total", [])
    if not tot:
        return ""
    # v10: 跳过"其他"/内部代码类选项，不作为洞察主体
    _SKIP_INSIGHT_KW = ["其他", "其它", "请说明", "t2b", "b2b", "无",
                         "不适用", "跳过", "拒答", "none"]
    valid_indices = [
        i for i in range(len(cats))
        if not any(k in str(cats[i]).strip().lower() for k in _SKIP_INSIGHT_KW)
    ]
    if not valid_indices:
        return ""
    best_i = max(valid_indices, key=lambda i: tot[i] if tot[i] is not None else -1)
    best_v = tot[best_i]
    if best_v is None:
        return ""
    insight = f"「{cats[best_i]}」占比最高（{best_v * 100:.1f}%）"
    others = [s for s in segs if s != "Total"]
    if len(others) >= 2:
        diffs = []
        for s in others:
            v = data.get(s, [None] * len(cats))[best_i] if best_i < len(data.get(s, [])) else None
            if v is not None:
                diffs.append((v - best_v, s, v))
        if diffs:
            diffs.sort(key=lambda x: abs(x[0]), reverse=True)
            d, s, v = diffs[0]
            if abs(d) >= 0.05:  # 差异 ≥5pp 才提，避免无意义噪声
                cmp = "高于" if d > 0 else "低于"
                insight += f"；{s}{cmp}总体 {abs(d) * 100:.1f}pp（{v * 100:.1f}%）"
    return insight


def _build_chart_for_question(q: dict, display_segs=None, forced_chart_type=None) -> ChartSpec:
    """为单题构造 ChartSpec：排序 + 自动选图 + 多维度对比 + 洞察。

    ``display_segs`` 若给定，则限定为报告统一选定的人群列（与本题实际
    存在的人群取交集）；否则默认展示本题全部人群。
    """
    cats, data = _sort_question(q)
    segs = q.get("segments") or []
    if display_segs is None:
        display_segs = _select_segments(segs)
    else:
        display_segs = [s for s in display_segs if s in segs] or list(segs)
    ctype = forced_chart_type if forced_chart_type is not None else auto_chart_type(q, cats, display_segs)
    title = _norm(q["title"])[:24] or q["code"]
    insight = _auto_insight(q, cats, data, display_segs)

    if ctype == ChartType.RADAR:
        short_cats = [_shorten(c) for c in cats]
        series_dict = {s: _pct_list(data, s, cats) for s in display_segs}
        return ChartSpec.radar(
            title=f"{title}（多维对比）", categories=short_cats,
            series_dict=series_dict, insight=insight,
        )
    if ctype == ChartType.DOUGHNUT:
        ref_seg = "Total" if "Total" in display_segs else display_segs[0]
        vals = _pct_list(data, ref_seg, cats)
        return ChartSpec.doughnut(
            title=f"{title}（{ref_seg}，%）", categories=cats,
            values=vals, insight=insight,
        )
    if ctype == ChartType.PIE:
        ref_seg = "Total" if "Total" in display_segs else display_segs[0]
        vals = _pct_list(data, ref_seg, cats)
        return ChartSpec.pie(
            title=f"{title}（{ref_seg}，%）", categories=cats,
            values=vals, insight=insight,
        )
    if ctype == ChartType.STACKED_BAR:
        series_dict = {s: _pct_list(data, s, cats) for s in display_segs}
        return ChartSpec.bar(
            title=f"{title}（%）", categories=cats,
            series_dict=series_dict, insight=insight, stacked=True,
        )
    # 默认：多系列并排条形图（Total + 筛选后分群 → 可读的多维度对比）
    series_dict = {s: _pct_list(data, s, cats) for s in display_segs}
    return ChartSpec.bar(
        title=f"{title}（%）", categories=cats,
        series_dict=series_dict, insight=insight,
    )


# ───────────────────────── 报告组装 ─────────────────────────
def _extract_kpis(questions: list) -> list:
    """从解析结果抽取 3~5 个执行摘要 KPI。"""
    kpis: list = []
    # 总样本量（取最大 base）
    total_base = 0
    for q in questions:
        b = q.get("base", {}).get("Total")
        if b and b > total_base:
            total_base = b
    if total_base:
        kpis.append(KPI("总样本量", f"{total_base:,}"))
    # 覆盖人群数
    segs = next((q["segments"] for q in questions if q.get("segments")), [])
    if segs:
        kpis.append(KPI("覆盖人群", f"{len(segs) - 1} 类"))
    # 全局最高单选项占比
    best = (0.0, "", "")
    for q in questions:
        if not (q.get("segments") and q["categories"]):
            continue
        tot = q["data"].get("Total", [])
        for i, v in enumerate(tot):
            if v and v > best[0]:
                best = (v, q["categories"][i], _norm(q["title"]))
    if best[0]:
        kpis.append(KPI("最高单选项占比", f"{best[0] * 100:.1f}%", delta=best[1][:12]))
    # 首个含均值的题目
    for q in questions:
        mean = q.get("stats", {}).get("MEAN", {}).get("Total")
        if mean:
            kpis.append(KPI(_norm(q["title"])[:8] or q["code"], f"{mean:.1f}"))
            break
    while len(kpis) < 5:
        kpis.append(KPI("—", "—"))
    return kpis[:5]


def _is_appendix(q: dict) -> bool:
    """判断题目是否应进附录（不进主线图表）：甄别 / 配额 / 后台圈选 / 低信息量。"""
    code = q["code"].upper()
    title = _norm(q["title"])
    cats = q.get("categories", [])
    if code.startswith("FZ") or "FZS" in code:
        return True
    if any(k in title for k in ("配额", "后台圈选", "甄别", "过滤", "跳题")):
        return True
    if len(cats) < 2:
        return True
    return False


def _build_appendix(appendix_qs: list, source: str):
    """未纳入主线的题目 → 附录表格（题号 / 题面 / 选项数）。"""
    if not appendix_qs:
        return None
    headers = ["题号", "题面", "选项数"]
    rows = [
        [q["code"], _norm(q["title"])[:30], len(q.get("categories", []))]
        for q in appendix_qs
    ]
    return AppendixContent(
        title="附录 · 未纳入主线的题目",
        table=TableData(headers=headers, rows=rows),
        source=source,
    )


def _group_title(group: list, idx: int, total: int) -> str:
    base = _norm(group[0]["title"])[:12] or group[0]["code"]
    return f"{base} 等 {len(group)} 题 · 人群对比（第{idx}/{total}组）"


def _build_multi_group_bar_page(group: list, segments: list, source: str,
                                  idx: int, total: int) -> MultiGroupBarPageContent:
    """把一组题目组装成 MultiGroupBarPageContent（表格 + 图表叠加布局）。

    每个题作为 groups_data 中的一项（含排序后的 DataFrame），segments 决定列。
    """
    groups_data = []
    all_insights = []
    ranked_insights = []   # [(peak, insight), ...] 用于挑选标题

    for q in group:
        cats, data = _sort_question(q)
        title = _norm(q["title"])[:24] or q["code"]
        short_label = _extract_group_label(q.get("title", "")) or title[:8]

        # 构造 DataFrame：选项列 + 各分群数据
        df_rows = []
        for ci, cat in enumerate(cats):
            row = {"选项": cat}
            for seg in segments:
                vals = data.get(seg, [])
                v = vals[ci] if ci < len(vals) else None
                row[seg] = v * 100 if (v is not None and abs(v) <= 1) else (v or 0.0)
            df_rows.append(row)

        df = pd.DataFrame(df_rows)
        if df.empty:
            continue

        # v10: 过滤掉内部代码选项（T2B/B2B 等），不进入渲染
        _SKIP_OPTION_KW = ("T2B", "B2B")
        if not df.empty:
            mask = df["选项"].apply(
                lambda x: not any(k.upper() in str(x).strip().upper() for k in _SKIP_OPTION_KW)
            )
            df = df[mask].reset_index(drop=True)

        groups_data.append({"title": title, "short_label": short_label, "data": df})

        # 收集洞察（同时记录占比峰值，用于挑选最显著的一条作标题）
        insight = _auto_insight(q, cats, data, segments)
        if insight:
            tot = data.get("Total", [])
            peak = max((v for v in tot if v is not None), default=0)
            all_insights.append(insight)
            ranked_insights.append((peak, insight))

    # 标题用"最显著的单条核心洞察"（占比峰值最高的一题），避免多条拼接过长
    if ranked_insights:
        ranked_insights.sort(key=lambda x: x[0], reverse=True)
        page_title = ranked_insights[0][1]
    else:
        page_title = _group_title(group, idx, total)  # 兜底

    # 数据来源格式：数据来源：题干摘要（N=xx）；题干2（N=xx）…  （参考专业调研报告规范）
    q_refs = []
    for q in group:
        code = q.get("code", "")
        title = _norm(q.get("title", ""))[:25]
        base = q.get("base", {}).get("Total")
        n_str = f"N={base}" if base else ""
        # 单选/多选标记（如有）
        qtype = q.get("type", "")
        type_tag = f"（{qtype}）" if qtype else ""
        q_refs.append(f"{title}（{n_str}{type_tag}）" if n_str else title)
    q_label = "；".join(q_refs)
    ds = f"数据来源：{q_label}" if q_refs else source

    return MultiGroupBarPageContent(
        title=page_title,
        groups_data=groups_data,
        segments=list(segments),
        insights=all_insights,
        data_source=ds,
    )


def _build_toc(renderable: list, source: str) -> TocContent:
    """构建精简目录（对齐 skill 规范：项目概述 / 主要研究发现 / 结论与建议）。

    主要研究发现下按题目关键词自动归入子模块（用户画像 / 消费行为 /
    品牌与满意度 / 专项研究），每个子模块标注题目数量。
    """
    modules: dict = {}
    for q in renderable:
        m = _categorize_question(q)
        modules.setdefault(m, []).append(q)

    sections = [
        "一、项目概述",
        "二、主要研究发现",
    ]
    # 子模块按题目数降序排列（信息量大的放前面）
    for mod_name, mod_qs in sorted(modules.items(), key=lambda x: -len(x[1])):
        label = f"  {mod_name}（{len(mod_qs)}题）"
        sections.append(label)
    sections.append("三、结论与建议")
    if any(_is_appendix(q) for q in renderable):  # 实际由 appendix_qs 判定
        pass  # 附录不在 TOC 中单独列出（skill 规范）
    return TocContent(sections=sections)


def build_auto_report(
    questions: list,
    *,
    title: str,
    client: str,
    date: str,
    source: str = "",
    max_per_page: int = 3,  # 每页 multi_group_bar 聚合的题目数（默认 3 题/页）
    subtitle: str = None,
    segments=None,  # 指定要展示的人群列（None=全部人群）
    page_config: dict = None,  # 前端编辑后的页面规划（覆盖默认选图）
) -> ReportSpec:
    """把解析后的题目列表组装成完整 ReportSpec（全题目覆盖 + 自动选图 + 排序 + 对比）。

    布局策略（v3）：
      - 多分群题 → **MultiGroupBarPageContent**（表格 + 图表叠加，
        参考 crosstab-to-ppt skill 的 ``multi_group_bar`` 规范）；
      - 雷达图题 / 环形图题 → 降级为普通 ChartPageContent（Dashboard 布局）。

    Args:
        segments: 要作为数据列展示的人群名列表（如 ``["都市中产", "都市蓝领"]``）。
            默认 ``None`` → 展示全部人群，不做差异筛选；``Total`` 会自动置于首列。
        page_config: 来自 ``build_page_plan`` 的页面规划字典。
            若提供，每页的 ``chart_type`` 字段会覆盖默认自动选图结果；
            若为 ``None`` 则完全自动（向后兼容）。
    """
    renderable = [
        q for q in questions
        if q.get("segments") and q["categories"] and not _is_appendix(q)
    ]
    appendix_qs = [
        q for q in questions
        if not (q.get("segments") and q["categories"] and not _is_appendix(q))
    ]

    # 取全局 segments + 用户指定（或默认全展示）后的展示列表
    all_segs = next((q["segments"] for q in renderable if q.get("segments")), [])
    display_segs = _select_segments(all_segs, override=segments) if all_segs else all_segs

    # ── 先按图表类型分成两组，再各自批量分页（避免交替 flush 导致页数暴涨） ──
    # 绝大多数题（含单选题）都有人群交叉 → multi_group_bar 表格对比；
    # 仅评分/量表类雷达题降级为普通 Dashboard 布局。
    mgb_qs, radar_qs = [], []
    for q in renderable:
        cats = q.get("categories") or []
        segs = q.get("segments") or []
        ds = [s for s in display_segs if s in segs] or list(segs)
        ctype = auto_chart_type(q, cats, ds)
        if ctype == ChartType.RADAR:
            radar_qs.append(q)
        else:
            mgb_qs.append(q)

    chart_pages: list = []
    n_mgb_pages = max(1, (len(mgb_qs) + max_per_page - 1) // max_per_page)

    # multi_group_bar 分页（每页 max_per_page 题）
    for gi, i in enumerate(range(0, len(mgb_qs), max_per_page)):
        batch = mgb_qs[i:i + max_per_page]
        chart_pages.append(
            _build_multi_group_bar_page(
                batch, display_segs, source, gi + 1, n_mgb_pages)
        )

    # 雷达题分页（每页 2 题）
    radar_per_page = 2
    n_radar_pages = max(1, (len(radar_qs) + radar_per_page - 1) // radar_per_page)
    for gi, i in enumerate(range(0, len(radar_qs), radar_per_page)):
        batch = radar_qs[i:i + radar_per_page]
        charts = [_build_chart_for_question(q, display_segs) for q in batch]
        # 雷达页数据来源也带上题号
        r_refs = [f'{q.get("code","")}.{_norm(q.get("title",""))[:20]}' for q in batch]
        r_ds = f"{' | '.join(r_refs)} | {source}" if r_refs else source
        chart_pages.append(
            ChartPageContent(
                title=_group_title(batch, gi + 1, n_radar_pages),
                layout=LayoutType.DASHBOARD,
                charts=charts,
                data_source=r_ds,
            )
        )

    # ââ åºç¨åç«¯ç¼è¾ç page_config è¦çï¼v2ï¼å¾è¡¨ç±»å + åç»´åº¦æ¨¡å¼ï¼ ââ    if page_config and page_config.get("pages"):        cfg_pages = page_config["pages"]        new_pages = []        for idx, page in enumerate(chart_pages):            cfg = cfg_pages[idx] if idx < len(cfg_pages) else None            dim_mode = cfg.get("dimension_mode", "compare") if cfg else "compare"            requested = cfg.get("chart_type") if cfg else None            # ååºè¯¥é¡µé¢ç®            batch = [q for q in renderable if q.get("code") in {                pq.get("code") for pq in (cfg.get("questions") or [])            }]            is_chartpage = isinstance(page, ChartPageContent)            # ââ æ»ä½æ¨¡å¼ï¼æ¯é¢ç¬ç«ç®åå¾è¡¨ï¼æ è¡¨æ ¼ ââ            if dim_mode == "overall":                if not batch:                    new_pages.append(page)                    continue                overall_charts = []                for q in batch:                    if requested == "doughnut":                        overall_charts.append(_build_chart_for_question(q, ["Total"], forced_chart_type=ChartType.DOUGHNUT))                    elif requested == "pie":                        overall_charts.append(_build_chart_for_question(q, ["Total"], forced_chart_type=ChartType.PIE))                    elif requested == "stacked_bar":                        overall_charts.append(_build_chart_for_question(q, ["Total"], forced_chart_type=ChartType.BAR))                    else:                        overall_charts.append(_build_chart_for_question(q, ["Total"], forced_chart_type=ChartType.BAR))                r_refs = [f'{q.get("code","")}.{_norm(q.get("title",""))[:20]}' for q in batch]                r_ds = f"{' | '.join(r_refs)} | {source}" if r_refs else source                new_pages.append(ChartPageContent(                    title=_group_title(batch, idx + 1, len(cfg_pages)),                    layout=LayoutType.DASHBOARD, charts=overall_charts, data_source=r_ds,                ))                continue            # ââ å¯¹æ¯æ¨¡å¼ï¼é»è®¤ï¼ ââ            if not requested:                new_pages.append(page)                continue            if requested == "bar":                if is_chartpage and batch:                    new_pages.append(_build_multi_group_bar_page(                        batch, display_segs, source, idx + 1, len(cfg_pages)))                else:                    new_pages.append(page)                continue            if not batch:                new_pages.append(page)                continue            if requested == "radar":                charts = [_build_chart_for_question(q, display_segs) for q in batch]            elif requested == "doughnut":                charts = [_build_chart_for_question(q, display_segs, forced_chart_type=ChartType.DOUGHNUT) for q in batch]            elif requested == "pie":                charts = [_build_chart_for_question(q, display_segs, forced_chart_type=ChartType.PIE) for q in batch]            elif requested == "stacked_bar":                charts = [_build_chart_for_question(q, display_segs, forced_chart_type=ChartType.STACKED_BAR) for q in batch]            else:                new_pages.append(page)                continue            r_refs = [f'{q.get("code","")}.{_norm(q.get("title",""))[:20]}' for q in batch]            r_ds = f"{' | '.join(r_refs)} | {source}" if r_refs else source            new_pages.append(ChartPageContent(                title=_group_title(batch, idx + 1, len(cfg_pages)),                layout=LayoutType.DASHBOARD, charts=charts, data_source=r_ds,            ))        chart_pages = new_pages
    kpis = _extract_kpis(questions)
    conclusion = (
        f"基于 {len(renderable)} 道题目的交叉分析，覆盖 {len(display_segs)} 类人群；"
        "各题按总体占比降序排列并标注人群差异，详见正文图表。"
    )
    appendix = _build_appendix(appendix_qs, source)

    # 精简目录：项目概述 / 主要研究发现（含子模块）/ 结论与建议
    toc = _build_toc(renderable, source)

    return ReportSpec(
        cover=CoverContent(title=title, client=client, date=date, subtitle=subtitle),
        toc=toc,
        executive_summary=ExecutiveSummaryContent(kpis=kpis, conclusion=conclusion),
        chart_pages=chart_pages,
        appendix=appendix,
    )


def build_page_plan(
    questions: list,
    *,
    title: str = "调研报告",
    source: str = "",
    max_per_page: int = 3,
    segments=None,
    dimension: str = None,
) -> dict:
    """返回报告页面规划（轻量 JSON，不渲染 PPTX），供前端预览/编辑。

    返回结构::

        {
            "total_questions": N,
            "total_pages": M,
            "pages": [
                {
                    "page_idx": 1,
                    "type": "multi_group_bar",
                    "title": "品牌认知 等 3 题 · 人群对比（第1/12组）",
                    "questions": [{"code": "Q1", "title": "品牌认知", "categories":["A","B"]}, ...],
                    "segments": ["Total", "都市中产", ...],
                    "chart_type": "bar",
                },
                ...
            ],
            "appendix": {"count": 5} | null,
        }
    """
    from .build_jd_report import apply_dimension, _cached_dimension_groups

    # 复用 build_auto_report 的分类/分页逻辑，但不构造 ReportSpec
    if dimension:
        questions = apply_dimension(questions, _cached_dimension_groups, dimension)

    renderable = [
        q for q in questions
        if q.get("segments") and q["categories"] and not _is_appendix(q)
    ]
    appendix_qs = [
        q for q in questions
        if not (q.get("segments") and q["categories"] and not _is_appendix(q))
    ]

    all_segs = next((q["segments"] for q in renderable if q.get("segments")), [])
    display_segs = _select_segments(all_segs, override=segments) if all_segs else all_segs

    mgb_qs, radar_qs = [], []
    for q in renderable:
        cats = q.get("categories") or []
        segs = q.get("segments") or []
        ds = [s for s in display_segs if s in segs] or list(segs)
        ctype = auto_chart_type(q, cats, ds)
        if ctype == ChartType.RADAR:
            radar_qs.append(q)
        else:
            mgb_qs.append(q)

    pages = []

    # multi_group_bar 分页
    n_mgb_pages = max(1, (len(mgb_qs) + max_per_page - 1) // max_per_page)
    for gi, i in enumerate(range(0, len(mgb_qs), max_per_page)):
        batch = mgb_qs[i:i + max_per_page]
        pages.append({
            "page_idx": len(pages) + 1,
            "type": "multi_group_bar",
            "title": _group_title(batch, gi + 1, n_mgb_pages),
            "questions": [
                {
                    "code": q.get("code", ""),
                    "title": _norm(q.get("title", ""))[:40],
                    "categories": q.get("categories", []),
                }
                for q in batch
            ],
            "segments": list(display_segs),
            "chart_type": "bar",
            "dimension_mode": "compare",
        })

    # 雷达题分页
    radar_per_page = 2
    n_radar_pages = max(1, (len(radar_qs) + radar_per_page - 1) // radar_per_page)
    for gi, i in enumerate(range(0, len(radar_qs), radar_per_page)):
        batch = radar_qs[i:i + radar_per_page]
        pages.append({
            "page_idx": len(pages) + 1,
            "type": "radar_dashboard",
            "title": _group_title(batch, gi + 1, n_radar_pages),
            "questions": [
                {
                    "code": q.get("code", ""),
                    "title": _norm(q.get("title", ""))[:40],
                    "categories": q.get("categories", []),
                }
                for q in batch
            ],
            "segments": list(display_segs),
            "chart_type": "radar",
            "dimension_mode": "compare",
        })

    appendix_info = {"count": len(appendix_qs)} if appendix_qs else None

    # 构建可用维度选项（总体 + 各分组）
    dim_groups = getattr(build_jd_report, "_cached_dimension_groups", None) or []
    available_dimensions = [{"key": "总体", "label": "总体（单题独立图表）", "segments": ["Total"]}]
    for dg in dim_groups:
        available_dimensions.append({
            "key": dg.get("name", ""),
            "label": dg.get("name", "") + "（" + str(len(dg.get("segments", []))) + "人群对比）",
            "segments": dg.get("segments", []),
        })

    return {
        "total_questions": len(questions),
        "renderable_questions": len(renderable),
        "total_pages": len(pages),
        "pages": pages,
        "appendix": appendix_info,
        "all_segments": all_segs,
        "display_segments": display_segs,
        "available_dimensions": available_dimensions,
    }


def run_wizard(
    xlsx: str,
    out_path: str,
    *,
    title: str = "调研报告",
    client: str = "",
    date: str = "",
    source: str = "",
    max_per_page: int = 2,
    segments=None,
    dimension: str = None,
    page_config: dict = None,
) -> str:
    """端到端：解析交叉表 → 组装 → 渲染成 .pptx。

    Args:
        segments: 要展示为数据列的人群名列表（如 ``["都市中产", "都市蓝领"]``）。
            默认 ``None`` → 展示全部人群，不做差异筛选。
        dimension: 维度分组名（多级表头文件，如荣耀电商的「购买」「4K+」）。
            指定后按该分组的列切片重映射数据；``None`` → 默认整体维度。
        page_config: 前端编辑后的页面规划（来自 ``build_page_plan`` 输出）。
            若提供，``build_auto_report`` 会按其中每页的 ``chart_type`` 覆盖默认选图；
            若为 ``None`` 则完全自动（向后兼容）。

    Returns:
        实际保存路径。
    """
    questions = parse_crosstab(xlsx)
    print(f"  解析出题目 {len(questions)} 道")
    # 维度分组切换：按列索引抽选对应切片（荣耀各分组列名相同，必须按列区分）
    if dimension:
        questions = apply_dimension(
            questions, build_jd_report._cached_dimension_groups, dimension
        )
        print(f"  应用维度分组: {dimension}")
    renderable = [
        q for q in questions
        if q.get("segments") and q["categories"] and not _is_appendix(q)
    ]
    print(f"  主线图表 {len(renderable)} 道，附录 {len(questions) - len(renderable)} 道")
    if segments:
        all_segs = next((q["segments"] for q in renderable if q.get("segments")), [])
        picked = _select_segments(all_segs, override=segments)
        print(f"  指定展示人群: {picked}")
    spec = build_auto_report(
        questions, title=title, client=client, date=date,
        source=source, max_per_page=max_per_page, segments=segments,
        page_config=page_config,
    )
    spec.validate()
    theme = Theme()  # 调研公司标准：深蓝标题 + 6 色人群色板 + 数据标签
    renderer = ReportRenderer(theme=theme)
    return renderer.render(spec, out_path)


if __name__ == "__main__":
    import os

    here = os.path.dirname(os.path.abspath(__file__))
    xlsx = os.path.join("C:/Users/a1382/Desktop", "京东常温牛奶-Output-0320.xlsx")
    out_dir = os.path.abspath(os.path.join(here, "..", "outputs"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "京东常温牛奶_调研报告_向导版.pptx")
    saved = run_wizard(
        xlsx, out_path,
        title="京东常温牛奶消费者洞察报告",
        client="京东",
        date="2026-03-20",
        source="数据来源：京东常温牛奶消费者调研（腾讯问卷，全国样本 N=800）。",
        max_per_page=3,
    )
    print(f"\n报告已生成: {saved}")
