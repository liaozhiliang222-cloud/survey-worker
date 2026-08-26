"""用真实问卷交叉表（京东常温牛奶-Output-0320.xlsx）测试 pptx_report 模块。

本脚本演示「数据与渲染分离」的真实落地：
  1. :func:`parse_crosstab` 把腾讯问卷 / SPSS 风格的交叉表导出解析为结构化题目；
  2. 用解析结果组装 :class:`~pptx_report.model.ReportSpec`（纯数据）；
  3. 交给 :class:`~pptx_report.renderer.ReportRenderer` 渲染成 .pptx。

刻意覆盖全部 8 种图表类型与 4 种布局，以检验实现能力。

运行：``PYTHONPATH=D:/调研工具 python -m pptx_report.build_jd_report``
"""

from __future__ import annotations

import os
import re

import openpyxl

from .model import (
    AppendixContent,
    ChartPageContent,
    ChartSpec,
    ChartType,
    CoverContent,
    ExecutiveSummaryContent,
    KPI,
    LayoutType,
    ReportSpec,
    TableData,
    TocContent,
)
from .renderer import ReportRenderer
from .theme import Theme

# 六大人群（交叉表表头顺序）
SEGMENT_ORDER = ["都市中产", "都市蓝领", "都市家庭", "都市Z世代", "小镇中年", "小镇青年"]

SHEET_NAME = "Table (%)"
TOTAL_ALIASES = (
    "Total", "total", "Grand Total", "grand total", "All", "all",
    "合计", "总计", "总体", "整体", "全体", "全部",
)
BASE_ALIASES = {
    "base", "valid n", "sample size", "n",
    "有效样本", "有效样本量", "样本量", "样本数",
}

# 模块缓存：最近一次 parse_crosstab 的维度分组结果
_cached_dimension_groups: list[dict] = []


def _is_total(value) -> bool:
    return re.sub(r"\s+", " ", _norm(value)).lower() in {
        re.sub(r"\s+", " ", str(alias).strip()).lower()
        for alias in TOTAL_ALIASES
    }


def _is_base(value) -> bool:
    return re.sub(r"\s+", " ", _norm(value)).lower() in BASE_ALIASES


def _numeric_cell(value):
    if isinstance(value, (int, float)):
        return float(value)
    text = _norm(value).replace(",", "").replace("，", "")
    if not text or text in {"-", "—", "–"}:
        return None
    text = re.sub(r"^[nN]\s*=\s*", "", text)
    try:
        if text.endswith("%"):
            return float(text[:-1]) / 100
        return float(text)
    except (TypeError, ValueError):
        return None


def _caption_parts(value, fallback_index: int) -> tuple[str, str] | None:
    text = _norm(value)
    marker = re.match(r"^CAPTION\s*[:：]\s*(.*)$", text, re.IGNORECASE)
    if not marker:
        return None
    body = marker.group(1).strip()
    bracketed = re.match(r"^\[([^\]]+)\]\s*[.．。:：、]?\s*(.*)$", body)
    if bracketed:
        return bracketed.group(1).strip(), bracketed.group(2).strip()
    numbered = re.match(
        r"^([A-Za-z]*\d+(?:[_-]\d+)*)\s*[.．。:：、]?\s*(.*)$",
        body,
    )
    if numbered:
        return numbered.group(1).strip(), numbered.group(2).strip()
    return f"Q{fallback_index}", body


def _sheet_crosstab_score(ws) -> int:
    """按内容结构为候选 Sheet 评分，避免依赖固定工作表名称。"""
    name = _norm(ws.title)
    score = 0
    if re.search(r"目录|索引|说明|index|toc|readme", name, re.IGNORECASE):
        score -= 100
    if re.search(r"%|百分比|percent|percentage|table\s*\(%\)", name, re.IGNORECASE):
        score += 40
    elif re.search(r"频数|count|frequency", name, re.IGNORECASE):
        score += 10
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 250), values_only=True):
        values = [_norm(value) for value in row if value is not None]
        if any(re.match(r"^CAPTION\s*[:：]", value, re.IGNORECASE) for value in values):
            score += 6
        if any(_is_total(value) for value in values):
            score += 3
        if any(_is_base(value) for value in values[:3]):
            score += 3
        if any(re.match(
            r"^(?:百分比|列\s*n?\s*%|column\s*n?\s*%|percent(?:age)?)$",
            value,
            re.IGNORECASE,
        ) for value in values):
            score += 8
    return score

def _detect_dimension_groups(
    rows: list, header_row_idx: int
) -> list[dict]:
    """从多级表头中检测维度分组（如「整体」「是否购买」「手机价格」等）。

    在数据表头行（header_row_idx）上方查找「分组标签行」：
    该行满足 ``row[0] 为空`` 且非空列数**显著少于**数据表头行，
    每个非空单元格代表一个分组的名称及其起始列位置。
    返回 ``[{"name":"整体", "segments":["总体","荣耀",...]}, ...]`` 。
    """
    if header_row_idx < 2:
        return []

    # 取数据表头行作为段名参考
    hdr = rows[header_row_idx]
    hdr_nonempty = sum(1 for i in range(1, len(hdr)) if hdr[i] is not None)

    all_seg_names = []
    for i in range(1, len(hdr)):
        if hdr[i] is not None:
            n = _norm(hdr[i])
            if n:
                all_seg_names.append((i, n))

    if not all_seg_names:
        return []

    # 向上搜索分组标签行：row[0] 为空，且非空列数明显少于数据表头（< 60%）
    # 这样可以区分「分组层」（3~5 个大组）与「数据表头层」（7+ 个细分段）
    group_label_rows = []
    for ri in range(max(0, header_row_idx - 15), header_row_idx):
        r = rows[ri]
        if r[0] is None or not _norm(r[0]):
            labels = [
                (ci, _norm(r[ci]))
                for ci in range(1, min(len(r), len(hdr)))
                if r[ci] is not None
                and _norm(r[ci]) != ""
                and not _is_total(r[ci])
            ]
            ne = len(labels)
            # 分组标签行的非空列数应该远少于数据表头
            if 2 <= ne < hdr_nonempty * 0.7:
                group_label_rows.append((ri, labels))

    if not group_label_rows:
        # 无多级表头 → 单组退化
        return [{"name": "全部维度",
                 "segments": [n for _, n in all_seg_names],
                 "cols": [i for i, _ in all_seg_names]}]

    # 使用离表头最近的那个分组标签行（最精确的层级）
    best_ri, best_labels = group_label_rows[-1]

    groups = []
    for gi, (col_start, gname) in enumerate(best_labels):
        next_col = best_labels[gi + 1][0] if gi + 1 < len(best_labels) else len(hdr)
        group_segs = []
        group_cols = []
        for sci, sname in all_seg_names:
            if sci >= next_col:
                break
            if sci >= col_start:
                if sname not in group_segs:
                    group_segs.append(sname)
                group_cols.append(sci)
        if group_segs:
            groups.append({"name": gname, "segments": group_segs, "cols": group_cols})

    if not groups:
        groups = [{"name": "全部维度",
                   "segments": [n for _, n in all_seg_names],
                   "cols": [i for i, _ in all_seg_names]}]

    return groups

    if not groups:
        groups = [{"name": "全部维度", "segments": [n for _, n in all_seg_names]}]

    return groups


def _parse_spss_pivot_rows(rows: list) -> tuple[list, list[dict]] | None:
    """解析 SPSS Custom Tables 风格的横向透视交叉表。

    该格式使用固定三层列表头：维度名、维度取值、指标（计数/列 N %），
    题目与选项则沿行方向连续堆叠。返回 ``None`` 表示并非此类格式。
    """
    if len(rows) < 4:
        return None

    def cell_text(value) -> str:
        return "" if value is None else _norm(value)

    def metric_name(value) -> str:
        return re.sub(r"\s+", "", cell_text(value)).lower()

    def numeric_value(value):
        if isinstance(value, (int, float)):
            return float(value)
        text = cell_text(value).replace(",", "")
        if not text or text in {"-", "—", "–"}:
            return None
        try:
            if text.endswith("%"):
                return float(text[:-1]) / 100
            return float(text)
        except (TypeError, ValueError):
            return None

    metric_row_idx = None
    percent_cols = []
    for ri in range(min(10, len(rows))):
        candidate = []
        for ci in range(2, len(rows[ri])):
            name = metric_name(rows[ri][ci])
            if name in {"列n%", "列%", "columnn%", "column%"}:
                candidate.append(ci)
        if len(candidate) >= 2:
            metric_row_idx = ri
            percent_cols = candidate
            break

    if metric_row_idx is None or metric_row_idx < 2:
        return None

    group_row = rows[metric_row_idx - 2]
    segment_row = rows[metric_row_idx - 1]
    metric_row = rows[metric_row_idx]
    total_aliases = {str(alias).strip().lower() for alias in TOTAL_ALIASES}

    column_pairs = []
    groups = []
    group_lookup = {}
    current_group = ""
    for pct_col in percent_cols:
        count_col = pct_col - 1
        if count_col < 2 or metric_name(metric_row[count_col]) not in {"计数", "count", "n"}:
            continue
        if count_col < len(group_row) and cell_text(group_row[count_col]):
            current_group = cell_text(group_row[count_col])
        segment = ""
        if count_col < len(segment_row):
            segment = cell_text(segment_row[count_col])
        if not segment and pct_col < len(segment_row):
            segment = cell_text(segment_row[pct_col])
        if not segment:
            continue
        column_pairs.append((segment, pct_col, count_col, current_group))
        if segment.lower() in total_aliases or not current_group:
            continue
        if current_group not in group_lookup:
            group_lookup[current_group] = {
                "name": current_group,
                "segments": [],
                "cols": [],
            }
            groups.append(group_lookup[current_group])
        group = group_lookup[current_group]
        if segment not in group["segments"]:
            group["segments"].append(segment)
            group["cols"].append(pct_col)

    if not column_pairs:
        return None

    total_pair = next(
        (pair for pair in column_pairs if pair[0].lower() in total_aliases),
        column_pairs[0],
    )
    first_group_pairs = []
    if groups:
        first_cols = set(groups[0]["cols"])
        first_group_pairs = [pair for pair in column_pairs if pair[1] in first_cols]
    default_pairs = [total_pair, *first_group_pairs]
    default_segments = []
    for name, _, _, _ in default_pairs:
        normalized = "Total" if name.lower() in total_aliases else name
        if normalized not in default_segments:
            default_segments.append(normalized)

    starts = [
        ri for ri in range(metric_row_idx + 1, len(rows))
        if len(rows[ri]) > 1
        and cell_text(rows[ri][0])
        and cell_text(rows[ri][1]).lower() in total_aliases
    ]
    if not starts:
        return None

    questions = []
    for question_idx, start in enumerate(starts):
        end = starts[question_idx + 1] if question_idx + 1 < len(starts) else len(rows)
        raw_title = cell_text(rows[start][0])
        code_match = re.match(r"^([A-Za-z]+\d+[A-Za-z]?(?:\.\d+)*)[.．]\s*(.*)$", raw_title)
        code = code_match.group(1) if code_match else f"Q{question_idx + 1}"
        title = code_match.group(2).strip() if code_match else raw_title

        seg_cols = [(name, pct_col) for name, pct_col, _, _ in column_pairs]
        data_by_col = {pct_col: [] for _, pct_col, _, _ in column_pairs}
        base_by_col = {}
        for _, pct_col, count_col, _ in column_pairs:
            if count_col < len(rows[start]):
                base_value = numeric_value(rows[start][count_col])
                if base_value is not None:
                    base_by_col[pct_col] = int(base_value) if base_value.is_integer() else base_value

        categories = []
        for ri in range(start + 1, end):
            row = rows[ri]
            category = cell_text(row[1]) if len(row) > 1 else ""
            if not category:
                continue
            values = {}
            has_numeric = False
            for _, pct_col, _, _ in column_pairs:
                value = numeric_value(row[pct_col]) if pct_col < len(row) else None
                values[pct_col] = value
                has_numeric = has_numeric or value is not None
            if not has_numeric:
                continue
            categories.append(category)
            for _, pct_col, _, _ in column_pairs:
                data_by_col[pct_col].append(values[pct_col])

        if not categories:
            continue

        data = {}
        base = {}
        for name, pct_col, _, _ in default_pairs:
            key = "Total" if name.lower() in total_aliases else name
            if key in data:
                continue
            data[key] = data_by_col.get(pct_col, [])
            base[key] = base_by_col.get(pct_col)

        questions.append({
            "code": code,
            "title": title,
            "categories": categories,
            "segments": default_segments,
            "seg_cols": seg_cols,
            "data": data,
            "data_by_col": data_by_col,
            "stats": {},
            "stats_by_col": {},
            "base": base,
            "base_by_col": base_by_col,
        })

    return questions, groups


def _parse_flat_question_rows(rows: list) -> tuple[list, list[dict]] | None:
    """Parse flat crosstabs with one segment header row and inline question rows.

    A common export shape is::

        题目/选项 | 总体 | C0总体 | C0-高意向 | ...
        有效样本量 | n=100 | n=40 | n=20 | ...
        Q1. 题目文本
        选项一    | 0.4  | 0.5  | 0.6  | ...

    Unlike CAPTION and SPSS pivot exports, question rows do not carry a
    dedicated marker. Detecting the header/base pair first keeps the fallback
    conservative and prevents ordinary data sheets from being misclassified.
    """
    if len(rows) < 4:
        return None

    def cell_text(value) -> str:
        return "" if value is None else _norm(value)

    def numeric_value(value):
        if isinstance(value, (int, float)):
            return float(value)
        text = cell_text(value).replace(",", "")
        if not text or text in {"-", "—", "–"}:
            return None
        text = re.sub(r"^[nN]\s*=\s*", "", text)
        try:
            if text.endswith("%"):
                return float(text[:-1]) / 100
            return float(text)
        except (TypeError, ValueError):
            return None

    header_row_idx = None
    base_row_idx = None
    for ri in range(min(15, len(rows) - 1)):
        row = rows[ri]
        next_row = rows[ri + 1]
        first = cell_text(row[0]) if row else ""
        next_first = cell_text(next_row[0]) if next_row else ""
        headers = [cell_text(value) for value in row[1:] if cell_text(value)]
        base_values = [numeric_value(value) for value in next_row[1:]]
        has_question_option_header = (
            ("题目" in first and "选项" in first)
            or first.lower() in {"question/option", "question / option"}
        )
        has_base_row = (
            "样本" in next_first
            or next_first.upper() == "BASE"
            or sum(value is not None for value in base_values) >= 2
        )
        if len(headers) >= 2 and has_question_option_header and has_base_row:
            header_row_idx = ri
            base_row_idx = ri + 1
            break

    if header_row_idx is None or base_row_idx is None:
        return None

    header_row = rows[header_row_idx]
    segment_columns = [
        ("Total" if cell_text(header_row[ci]).lower() in {
            str(alias).lower() for alias in TOTAL_ALIASES
        } else cell_text(header_row[ci]), ci)
        for ci in range(1, len(header_row))
        if cell_text(header_row[ci])
    ]
    if len(segment_columns) < 2:
        return None

    base_row = rows[base_row_idx]
    base_by_col = {
        ci: numeric_value(base_row[ci])
        for _, ci in segment_columns
        if ci < len(base_row) and numeric_value(base_row[ci]) is not None
    }

    question_pattern = re.compile(
        r"^([A-Za-z]+\d+(?:[_-]\d+)*(?:\.\d+)*)[.．]\s*(.+)$"
    )
    starts = []
    for ri in range(base_row_idx + 1, len(rows)):
        row = rows[ri]
        first = cell_text(row[0]) if row else ""
        match = question_pattern.match(first)
        if not match:
            continue
        trailing_cells = row[1:] if len(row) > 1 else []
        if any(numeric_value(value) is not None for value in trailing_cells):
            continue
        starts.append((ri, match))
    if not starts:
        return None

    questions = []
    for question_idx, (start, match) in enumerate(starts):
        end = starts[question_idx + 1][0] if question_idx + 1 < len(starts) else len(rows)
        code = match.group(1)
        title = match.group(2).strip()
        title = re.sub(rf"^{re.escape(code)}[.．]\s*", "", title).strip()

        categories = []
        data_by_col = {ci: [] for _, ci in segment_columns}
        for ri in range(start + 1, end):
            row = rows[ri]
            category = cell_text(row[0]) if row else ""
            if not category:
                continue
            values = {
                ci: numeric_value(row[ci]) if ci < len(row) else None
                for _, ci in segment_columns
            }
            if not any(value is not None for value in values.values()):
                continue
            categories.append(
                re.sub(r"\s*[（(][^（）()]*[）)]\s*$", "", category).strip()
            )
            for _, ci in segment_columns:
                data_by_col[ci].append(values[ci])

        if not categories:
            continue

        segments = [name for name, _ in segment_columns]
        data = {name: data_by_col[ci] for name, ci in segment_columns}
        base = {
            name: (
                int(base_by_col[ci])
                if ci in base_by_col and float(base_by_col[ci]).is_integer()
                else base_by_col.get(ci)
            )
            for name, ci in segment_columns
        }
        questions.append({
            "code": code,
            "title": title,
            "categories": categories,
            "segments": segments,
            "seg_cols": segment_columns,
            "data": data,
            "data_by_col": data_by_col,
            "stats": {},
            "stats_by_col": {},
            "base": base,
            "base_by_col": base_by_col,
            "part": "",
        })

    if not questions:
        return None

    groups = []
    group_lookup = {}
    for name, ci in segment_columns:
        if name.lower() in {str(alias).lower() for alias in TOTAL_ALIASES}:
            continue
        match = re.match(r"^([A-Za-z]+\d+(?:_\d+)*)(?:-|总体|整体|总计|合计)", name)
        group_name = match.group(1) if match else "全部维度"
        if group_name not in group_lookup:
            group_lookup[group_name] = {
                "name": group_name,
                "segments": [],
                "cols": [],
            }
            groups.append(group_lookup[group_name])
        group_lookup[group_name]["segments"].append(name)
        group_lookup[group_name]["cols"].append(ci)

    if not groups:
        groups = [{
            "name": "全部维度",
            "segments": [name for name, _ in segment_columns if name != "Total"],
            "cols": [ci for name, ci in segment_columns if name != "Total"],
        }]
    return questions, groups


def parse_crosstab(path: str, sheet_name: str = None) -> list:
    """解析问卷交叉表导出为题目列表。

    每个题目字典结构::

        {
            "code": "VAR1",
            "title": "省份",
            "categories": ["上海", "北京", ...],       # 选项标签（已清洗）
            "segments": ["Total", "都市中产", ...],    # 列：Total + 各人群
            "data": {"Total": [0.049, ...], "都市中产": [...], ...},
            "stats": {"MEAN": {"Total": 34.1, ...}},   # (MEAN)/(AVG.MENTION) 等
            "base": {"Total": 1680, "都市中产": 473, ...},
        }

    说明：
        - 百分比以小数存储（0.049 ≈ 4.9%），渲染时统一 ×100；
        - ``BASE`` 行与 ``(MEAN)`` 等统计行单独提取，不混入分类数据；
        - 整行均为空的选项（如「其他」无数据）会被跳过。

    通用化（v11 集成 PWA）：
        - ``sheet_name`` 为 None 时按题目标记、总体列、样本量和百分比指标综合评分；
        - 总体列可位于任意列，兼容题干占一列或合并占多列；
        - 支持半角/全角 CAPTION 标记、BASE/有效样本量别名和百分数字符串；
        - 人群列不再硬编码 ``SEGMENT_ORDER``，支持任意数量、任意命名的人群维度。
    """
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    if sheet_name and sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
    else:
        # 同时检查工作表名称和实际内容结构；名称仅作为加分项，不再作为硬条件。
        ws = max(
            (wb[name] for name in wb.sheetnames),
            key=_sheet_crosstab_score,
        )
    rows = list(ws.iter_rows(values_only=True))
    selected_sheet_name = ws.title
    wb.close()
    percentage_sheet = bool(re.search(
        r"%|百分比|percent|percentage",
        selected_sheet_name,
        re.IGNORECASE,
    )) or any(
        any(re.match(
            r"^(?:百分比|列\s*n?\s*%|column\s*n?\s*%|percent(?:age)?)$",
            _norm(value),
            re.IGNORECASE,
        ) for value in row if value is not None)
        for row in rows[:250]
    )

    questions: list = []
    cur = None
    cur_segments = None
    current_part = ""

    # 模块缓存：最近一次 parse_crosstab 检测到的维度分组（供 CLI 读取）
    global _cached_dimension_groups
    _cached_dimension_groups = []

    spss_pivot = _parse_spss_pivot_rows(rows)
    if spss_pivot is not None:
        questions, _cached_dimension_groups = spss_pivot
        return questions

    flat_crosstab = _parse_flat_question_rows(rows)
    if flat_crosstab is not None:
        questions, _cached_dimension_groups = flat_crosstab
        return questions

    for ri, row in enumerate(rows):
        # 表头行：row[0] 为空，后续某列为 Total/合计/总计/总体/整体。
        # 题干可能合并占用一列或多列，因此不能固定假设总体在第 2 列。
        # 必须在「row[0] 为 None 即跳过」之前检测，否则表头会被漏掉。
        # 通用化：人群列名不再硬编码，row[2:] 全部自动收集（跳过空值）。
        # 排除"人群"分组占位行（腾讯问卷导出常把 row[2] 写成合并单元格的
        # 占位标签「人群」，真正的列名在紧随其后的第二行表头）。
        # 注意：多级表头文件（如荣耀电商）可能连续 2~3 行都满足此条件，
        # 此时取**最后一行匹配**（列最细的那行）作为正式表头。
        total_col = next(
            (i for i in range(1, len(row)) if _is_total(row[i])),
            None,
        )
        if (
            cur is not None
            and len(row) > 2
            and total_col is not None
            and sum(
                1 for i in range(total_col + 1, len(row))
                if row[i] is not None and _norm(row[i]) != ""
            ) >= 1
        ):
            new_groups = _detect_dimension_groups(rows, ri)

            # 收集默认展示表头。多级表头优先取第一个真实维度组；
            # 无分组标签时，沿用“遇到重复段名即停止”的兼容逻辑。
            # 荣耀电商等导出会在同一行内把"7 品牌"结构在多个分析维度上
            # 重复铺开（整体×7、是否购买×7、…），若全部收集会导致
            # segments 重复 20+ 次、图表错乱。只取第一组有效维度。
            if new_groups and new_groups[0]["name"] != "全部维度":
                segs = [_norm(row[total_col]), *new_groups[0].get("segments", [])]
            else:
                segs = []
                for i in range(total_col, len(row)):
                    if row[i] is None:
                        continue
                    name = _norm(row[i])
                    if not name or name in ("人群",):
                        continue
                    if name in segs:  # 段名重复，说明下一组维度开始
                        break
                    segs.append(name)
            if len(segs) < 2:  # 退化情况（只有一个段），退回原逻辑
                segs = [_norm(row[total_col])] + [
                    _norm(row[i])
                    for i in range(total_col + 1, len(row))
                    if i < len(row) and row[i] is not None and _norm(row[i]) != ""
                ]
            cur["segments"] = segs
            cur_segments = segs
            # 完整列映射（含所有重复铺开的维度组）：(段名, 列索引)。
            # 取**最后一行匹配**（列最细）作为正式表头，覆盖前面较粗的行。
            seg_cols = [
                (_norm(row[i]), i)
                for i in range(total_col, len(row))
                if row[i] is not None and _norm(row[i]) not in ("", "人群")
            ]
            cur["seg_cols"] = seg_cols
            # 数据容器：data 按段名（首列出现）键控，data_by_col 按列索引键控（支持维度切换）
            cur["data"] = {s: [] for s in segs}
            cur["data_by_col"] = {col: [] for (_, col) in seg_cols}
            cur["base"] = {}
            cur["base_by_col"] = {}
            cur["stats"] = {}
            cur["stats_by_col"] = {}
            # 每次更新表头都重新检测分组（保留段数最多的那次结果）
            if len(new_groups) > len(_cached_dimension_groups):
                _cached_dimension_groups = new_groups
            # 不 continue —— 多级表头文件中后续行可能也是表头，
            # 取最后匹配的一行（列最细）作为正式表头。

        if row[0] is None:
            continue
        a = _norm(row[0])

        # 章节标记 PART:[...] —— 仅作分隔，不形成题目
        if a.startswith("PART:["):
            match = re.match(r"PART:\[([^\]]+)\]", a)
            current_part = _norm(match.group(1) if match else a[6:-1])
            continue

        # 题目标记兼容中英文冒号、全角句号、方括号与普通编号。
        caption = _caption_parts(a, len(questions) + 1)
        if caption:
            code, title = caption
            cur = {
                "code": code,
                "title": title,
                "categories": [],
                "segments": None,
                "data": {},
                "stats": {},
                "base": {},
                "part": current_part,
            }
            questions.append(cur)
            cur_segments = None
            continue

        if cur is None:
            continue

        # 表头检测已前置到循环顶部（处理 row[0] 为 None 的表头行）
        if cur_segments is None:
            continue

        cat = a

        # 统计行：(MEAN) / (STD.DEV.) / (AVG.MENTION)
        if cat.startswith("("):
            stat = cat.strip("()").split()[0].replace(".", "_")
            for (name, col) in cur["seg_cols"]:
                v = row[col] if col < len(row) else None
                if v is not None:
                    try:
                        cur["stats_by_col"].setdefault(col, {})[stat] = float(v)
                    except (TypeError, ValueError):
                        pass
            # 首列出现 → stats（向后兼容）
            seen = set()
            for (name, col) in cur["seg_cols"]:
                if name in seen:
                    continue
                seen.add(name)
                if name in cur["segments"]:
                    cur["stats"].setdefault(stat, {})[name] = cur["stats_by_col"].get(col, {}).get(stat)
            continue

        # 样本量行：BASE
        if _is_base(cat):
            for (name, col) in cur["seg_cols"]:
                v = row[col] if col < len(row) else None
                if v is not None:
                    numeric = _numeric_cell(v)
                    if numeric is not None:
                        cur["base_by_col"][col] = int(numeric) if numeric.is_integer() else numeric
            # 首列出现 → base（向后兼容）
            seen = set()
            for (name, col) in cur["seg_cols"]:
                if name in seen:
                    continue
                seen.add(name)
                if name in cur["segments"]:
                    cur["base"][name] = cur["base_by_col"].get(col)
            continue

        # 普通分类数据行：清洗尾部 "（...）" 注释
        clean = re.sub(r"\s*[（(][^（）()]*[）)]\s*$", "", cat).strip()
        col_vals = {}
        all_none = True
        for (name, col) in cur["seg_cols"]:
            v = row[col] if col < len(row) else None
            if v is not None:
                fv = _numeric_cell(v)
                if fv is not None:
                    if percentage_sheet and not (
                        isinstance(v, str) and _norm(v).endswith("%")
                    ) and 1 < abs(fv) <= 100:
                        fv /= 100
                    col_vals[col] = fv
                    all_none = False
        if all_none:
            continue
        cur["categories"].append(clean)
        for (name, col) in cur["seg_cols"]:
            cur["data_by_col"][col].append(col_vals.get(col))
        # 首列出现 → data（向后兼容，默认整体维度）
        seen = set()
        for (name, col) in cur["seg_cols"]:
            if name in seen:
                continue
            seen.add(name)
            if name in cur["data"]:
                cur["data"][name].append(col_vals.get(col))

    return questions


def apply_dimension(questions: list, dimension_groups: list, group_name: str = None) -> list:
    """按选中的「维度分组」重映射每题的 segments / data / base / stats。

    多级表头文件（如荣耀电商）中，各分组列名相同（整体/购买/未购买 下的
    「荣耀」都是同一名字），必须用**列索引**区分。``dimension_groups`` 中
    每组带 ``cols``（列索引列表）。

    Args:
        questions: 解析出的题目列表。
        dimension_groups: 维度分组列表。
        group_name: 分组名，支持以下形式：
            - ``None`` → 取第一个分组（默认行为）
            - 单个名称（如 ``"购买"``）→ 匹配该分组
            - 逗号分隔的多名（如 ``"省份,年龄,性别"``）→ **合并**多个分组的列

    Returns:
        重映射后的题目列表；找不到则原样返回。
    """
    if not dimension_groups:
        return questions

    # 支持逗号分隔的多组选择（前端多选时传 "省份,年龄,性别"）
    targets = [n.strip() for n in (group_name or "").split(",") if n.strip()] if group_name else []

    if len(targets) <= 1:
        # 单选或默认：取第一个命中的组
        grp = None
        if targets:
            for g in dimension_groups:
                if g["name"] == targets[0]:
                    grp = g; break
        if grp is None:
            grp = dimension_groups[0]
        _groups_to_apply = [grp]
    else:
        # 多选：逐个查找，全部命中才生效（忽略未命中的名字）
        _groups_to_apply = []
        for t in targets:
            for g in dimension_groups:
                if g["name"] == t:
                    _groups_to_apply.append(g)
                    break
        if not _groups_to_apply:
            _groups_to_apply = [dimension_groups[0]]

    # 合并所有选中组的 segments + cols（按加入顺序去重保序）
    merged_names = []
    merged_cols = []
    seen_cols = set()
    for g in _groups_to_apply:
        for name, col in zip(g.get("segments", []), g.get("cols", [])):
            if col not in seen_cols:
                seen_cols.add(col)
                merged_names.append(name)
                merged_cols.append(col)

    if not merged_names or not merged_cols:
        return questions

    out = []
    for q in questions:
        by_col = q.get("data_by_col", {})
        base_by_col = q.get("base_by_col", {})
        stats_by_col = q.get("stats_by_col", {})
        nq = dict(q)
        # 所有分维度分析都保留总体列，便于把分群结果与市场整体基准直接比较。
        total_key = next(
            (name for name in (q.get("segments") or []) if _is_total(name)),
            None,
        )
        selected_pairs = []
        total_pair_seen = False
        for name, col in zip(merged_names, merged_cols):
            is_total = _is_total(name)
            if is_total and total_key:
                # 总体基准统一从原题数据读取，避免维度表头中的“总体”与
                # 原始“Total”同时成为两列。
                continue
            if is_total and total_pair_seen:
                continue
            selected_pairs.append((name, col))
            total_pair_seen = total_pair_seen or is_total
        selected_names = [name for name, _ in selected_pairs]
        if total_key:
            selected_names.insert(0, total_key)
        nq["segments"] = selected_names
        nq["data"] = {name: by_col.get(col, []) for name, col in selected_pairs}
        nq["base"] = {name: base_by_col.get(col) for name, col in selected_pairs}
        if total_key and total_key not in nq["data"]:
            nq["data"] = {total_key: list((q.get("data") or {}).get(total_key, [])), **nq["data"]}
            nq["base"] = {total_key: (q.get("base") or {}).get(total_key), **nq["base"]}
        new_stats = {}
        for stat in set().union(*[set(sc.keys()) for sc in stats_by_col.values()]) if stats_by_col else []:
            new_stats[stat] = {}
            for name, col in selected_pairs:
                if col in stats_by_col and stat in stats_by_col[col]:
                    new_stats[stat][name] = stats_by_col[col][stat]
            if total_key:
                total_stat = (q.get("stats") or {}).get(stat, {}).get(total_key)
                if total_stat is not None:
                    new_stats[stat] = {total_key: total_stat, **new_stats[stat]}
        nq["stats"] = new_stats
        _repair_single_choice_dimension_outliers(nq)
        out.append(nq)
    return out

def _repair_single_choice_dimension_outliers(question: dict) -> None:
    """Repair one leaked cell in an otherwise valid single-choice slice.

    Only the deterministic case is repaired: Total is a complete distribution,
    one segment exceeds 108%, and removing exactly one cell leaves a valid
    remainder. Multi-select questions are left untouched.
    """
    segments = list(question.get("segments") or [])
    data = question.get("data") or {}
    total_aliases = {
        "total", "\u603b\u4f53", "\u6574\u4f53", "\u5408\u8ba1", "\u603b\u8ba1",
    }
    total_name = next(
        (name for name in segments if str(name).strip().lower() in total_aliases),
        None,
    )
    if not total_name:
        return
    total_values = data.get(total_name) or []
    numeric_total = [float(value) for value in total_values if value is not None]
    if len(numeric_total) < 2:
        return
    scale = 100.0 if max(abs(value) for value in numeric_total) > 1.5 else 1.0
    total_sum = sum(numeric_total)
    if not (0.97 * scale <= total_sum <= 1.03 * scale):
        return

    warnings = list(question.get("data_quality_warnings") or [])
    for segment in segments:
        if segment == total_name:
            continue
        raw_values = list(data.get(segment) or [])
        if len(raw_values) != len(total_values) or any(value is None for value in raw_values):
            continue
        values = [float(value) for value in raw_values]
        segment_sum = sum(values)
        if segment_sum <= 1.08 * scale:
            continue
        candidates = []
        for index, value in enumerate(values):
            remaining = segment_sum - value
            residual = scale - remaining
            if -0.005 * scale <= residual <= 0.20 * scale:
                expected = float(total_values[index] or 0)
                candidates.append((abs(residual - expected), index, residual, value))
        if len(candidates) != 1:
            continue
        _, index, residual, old_value = candidates[0]
        values[index] = max(0.0, residual)
        data[segment] = values
        warnings.append({
            "code": "single_choice_dimension_cell_repaired",
            "segment": str(segment),
            "category": str((question.get("categories") or [""])[index]),
            "old_value": old_value,
            "new_value": values[index],
        })
    if warnings:
        question["data_quality_warnings"] = warnings



def get_q(questions: list, code: str) -> dict:
    """按题号取题目字典。"""
    for q in questions:
        if q["code"] == code:
            return q
    raise KeyError(f"未找到题目 {code}")


def _series_pct(q: dict, seg: str, categories: list) -> list:
    """取某人群在指定分类上的百分比（×100，缺失补 0）。"""
    data = q["data"].get(seg, [])
    out = []
    for i in range(len(categories)):
        v = data[i] if i < len(data) else None
        out.append(round(v * 100, 1) if v is not None else 0.0)
    return out


def _shorten(label: str) -> str:
    """场景等长标签去掉尾部括号注释，便于图表阅读。"""
    return label.split("（")[0].split("(")[0].strip()


def _norm(value) -> str:
    """归一化单元格文本：去首尾空白，并剥掉导出时包裹的单/双引号。

    该交叉表导出把文本单元格包成 ``'Total'`` / ``'都市中产'`` 形式，
    若不处理会导致表头识别与人群列匹配全部失败。
    """
    s = str(value).strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1]
    return s


# ------------------------- 2. 组装报告 -------------------------
def build_report_spec(questions: list) -> ReportSpec:
    """用解析结果组装 ReportSpec（纯数据，与渲染解耦）。"""

    # —— 封面 ——
    cover = CoverContent(
        title="京东常温牛奶消费者洞察报告",
        client="京东",
        date="2026-03-20",
        subtitle="定量调研 · 八大人群 × 消费场景深度分析",
    )

    # —— 执行摘要 KPI ——
    kpis = [
        KPI(label="总样本量", value="1,680"),
        KPI(label="覆盖城市人群", value="6 类"),
        KPI(label="都市蓝领占比", value="33.8%"),
        KPI(label="早餐场景渗透", value="72.9%"),
        KPI(label="周均饮用频次", value="4.7 次"),
    ]
    exec_summary = ExecutiveSummaryContent(
        kpis=kpis,
        conclusion=(
            "常温奶消费以都市人群为基本盘，早餐为核心场景；营养（高蛋白 / 高钙）、"
            "新鲜（保质期短）与性价比是核心购买驱动，家庭人群更关注子女饮用场景。"
        ),
    )

    # —— 解析常用题目 ——
    q_prov = get_q(questions, "VAR1")        # 省份
    q_city = get_q(questions, "VAR11")       # 城市级别
    q_age = get_q(questions, "S2")           # 年龄
    q_edu = get_q(questions, "D1")           # 学历
    q_inc = get_q(questions, "D3")           # 家庭月收入
    q_freq = get_q(questions, "HS8")         # 购买频率
    q_obj = get_q(questions, "HB1")          # 购买对象
    q_scene = get_q(questions, "HB2")        # 消费场景
    q_nutri = get_q(questions, "HA2A")       # 营养成分关注
    q_v1 = get_q(questions, "V1")            # 八大人群构成
    q_hb3 = get_q(questions, "HB3")          # 每周饮用频次（含 MEAN）

    # 图表页集合
    chart_pages: list = []

    # P4 单图大版面：省份分布
    chart_pages.append(
        ChartPageContent(
            title="消费者地域分布",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.bar(
                    title="常温牛奶消费者省份分布（Total，%）",
                    categories=q_prov["categories"],
                    series_dict={"Total": _series_pct(q_prov, "Total", q_prov["categories"])},
                    insight="北京、广东、河北为三大主力省份，合计占比超五成。",
                )
            ],
        )
    )

    # P5 仪表盘 2x2：城市级别 / 年龄 / 学历 / 收入
    chart_pages.append(
        ChartPageContent(
            title="人群基础画像（仪表盘）",
            layout=LayoutType.DASHBOARD,
            charts=[
                ChartSpec.bar(
                    title="城市级别分布（%）",
                    categories=q_city["categories"],
                    series_dict={"Total": _series_pct(q_city, "Total", q_city["categories"])},
                    insight="一线 + 新一线合计约六成。",
                ),
                ChartSpec.line(
                    title="年龄结构（%）",
                    categories=q_age["categories"],
                    series_dict={"Total": _series_pct(q_age, "Total", q_age["categories"])},
                    insight="26-40 岁为主力。",
                ),
                ChartSpec.bar(
                    title="学历分布（%）",
                    categories=q_edu["categories"],
                    series_dict={"Total": _series_pct(q_edu, "Total", q_edu["categories"])},
                    insight="本科及以上过七成。",
                ),
                ChartSpec.bar(
                    title="家庭月收入分布（%）",
                    categories=q_inc["categories"],
                    series_dict={"Total": _series_pct(q_inc, "Total", q_inc["categories"])},
                    insight="8,001-15,000 元为主力收入带。",
                ),
            ],
        )
    )

    # P6 对比式双图：营养成分关注 中产 vs 蓝领
    chart_pages.append(
        ChartPageContent(
            title="营养成分关注度对比（都市中产 vs 都市蓝领）",
            layout=LayoutType.DUAL,
            charts=[
                ChartSpec.bar(
                    title="营养成分关注 — 都市中产（%）",
                    categories=q_nutri["categories"],
                    series_dict={"都市中产": _series_pct(q_nutri, "都市中产", q_nutri["categories"])},
                    insight="中产更关注高蛋白质、高钙、A2-β酪蛋白。",
                ),
                ChartSpec.bar(
                    title="营养成分关注 — 都市蓝领（%）",
                    categories=q_nutri["categories"],
                    series_dict={"都市蓝领": _series_pct(q_nutri, "都市蓝领", q_nutri["categories"])},
                    insight="蓝领同样看重高蛋白，但更在意保质期新鲜。",
                ),
            ],
        )
    )

    # P7 图文混排：消费场景 + 洞察
    scene_cats = q_scene["categories"]
    scene_short = [_shorten(c) for c in scene_cats]
    chart_pages.append(
        ChartPageContent(
            title="消费场景分布",
            layout=LayoutType.MIXED,
            charts=[
                ChartSpec.bar(
                    title="常温牛奶消费场景（Total，%）",
                    categories=scene_short,
                    series_dict={"Total": _series_pct(q_scene, "Total", scene_cats)},
                    insight="早餐为核心场景，居家与睡眠场景为辅。",
                )
            ],
            side_insights=[
                "早餐场景渗透最高（72.9%），是常温奶第一消费场景",
                "睡前饮用（38.5%）、佐餐（31.7%）次之",
                "运动后 / 办公室加餐场景稳步渗透",
                "社交聚会、学习备考场景占比较低",
                "家庭人群在「子女」相关场景显著突出",
            ],
        )
    )

    # P8 单图：八大人群构成（环形图）
    v1_cats = q_v1["categories"]
    chart_pages.append(
        ChartPageContent(
            title="八大人群构成",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.doughnut(
                    title="八大人群占比构成（%）",
                    categories=v1_cats,
                    values=_series_pct(q_v1, "Total", v1_cats),
                    insight="都市蓝领（33.8%）+ 都市中产（28.2%）合计超六成。",
                )
            ],
        )
    )

    # P9 单图组合图：样本量（柱）+ 平均年龄（折线，副轴）
    base = q_prov.get("base") or q_city.get("base") or {}
    mean_age = q_age.get("stats", {}).get("MEAN", {})
    base_list = [base.get(s, 0) for s in SEGMENT_ORDER]
    age_list = [round(mean_age.get(s, 0), 1) for s in SEGMENT_ORDER]
    chart_pages.append(
        ChartPageContent(
            title="人群规模与年龄结构",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.combo(
                    title="各人群样本量（柱）与平均年龄（折线）",
                    categories=SEGMENT_ORDER,
                    bars={"样本量": base_list},
                    line=age_list,
                    line_name="平均年龄",
                    secondary_axis_title="平均年龄",
                    insight="小镇中年样本虽少，但平均年龄最高（近 40 岁）。",
                )
            ],
        )
    )

    # P10 单图雷达：消费场景多维对比（中产 / 蓝领 / 家庭）
    desired = {"早餐时", "佐餐", "闲暇时", "下午茶/DIY 饮品",
               "运动后/健身时补充能量", "睡前饮用助眠", "办公室/工位上", "户外/长途出行时"}
    picks = [(scene_short[i], scene_cats[i])
             for i in range(len(scene_cats)) if scene_short[i] in desired]
    radar_labels = [p[0] for p in picks]
    radar_full = [p[1] for p in picks]
    chart_pages.append(
        ChartPageContent(
            title="消费场景偏好多维对比",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.radar(
                    title="消费场景偏好 — 中产 / 蓝领 / 家庭（%）",
                    categories=radar_labels,
                    series_dict={
                        "都市中产": _series_pct(q_scene, "都市中产", radar_full),
                        "都市蓝领": _series_pct(q_scene, "都市蓝领", radar_full),
                        "都市家庭": _series_pct(q_scene, "都市家庭", radar_full),
                    },
                    insight="家庭人群在「子女」场景外更均衡；中产场景分布最广。",
                )
            ],
        )
    )

    # P11 单图散点：家庭月收入 vs 每周饮用频次
    mean_inc = q_inc.get("stats", {}).get("MEAN", {})
    mean_freq = q_hb3.get("stats", {}).get("MEAN", {})
    x_vals = [round(mean_inc.get(s, 0), 0) for s in SEGMENT_ORDER]
    y_vals = [round(mean_freq.get(s, 0), 2) for s in SEGMENT_ORDER]
    chart_pages.append(
        ChartPageContent(
            title="收入与饮用频次相关性",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.scatter(
                    title="家庭月收入 vs 每周饮用频次（按人群）",
                    x_values=x_vals,
                    y_values=y_vals,
                    name="人群",
                    insight="收入与饮用频次无明显正相关，饮用习惯更受场景驱动。",
                )
            ],
        )
    )

    # P12 单图堆积柱：购买对象构成（按 3 类核心人群）
    obj_cats = q_obj["categories"]
    chart_pages.append(
        ChartPageContent(
            title="购买对象构成",
            layout=LayoutType.SINGLE,
            charts=[
                ChartSpec.bar(
                    title="购买对象构成 — 中产 / 蓝领 / 家庭（%）",
                    categories=obj_cats,
                    series_dict={
                        "都市中产": _series_pct(q_obj, "都市中产", obj_cats),
                        "都市蓝领": _series_pct(q_obj, "都市蓝领", obj_cats),
                        "都市家庭": _series_pct(q_obj, "都市家庭", obj_cats),
                    },
                    insight="均以「自己」饮用为主，「子女」在家庭中显著更高。",
                    stacked=True,
                )
            ],
        )
    )

    # —— 附录表格：人群画像汇总 ——
    mean_inc = q_inc.get("stats", {}).get("MEAN", {})
    mean_freq = q_hb3.get("stats", {}).get("MEAN", {})
    v1_total = q_v1["data"].get("Total", [])
    headers = ["人群", "样本量", "占比(%)", "平均年龄", "月收入均值(元)", "周均饮用(次)"]
    rows = []
    for s in SEGMENT_ORDER:
        i = v1_cats.index(s) if s in v1_cats else None
        share = round(v1_total[i] * 100, 1) if i is not None else 0.0
        rows.append([
            s,
            base.get(s, 0),
            share,
            round(mean_age.get(s, 0), 1),
            round(mean_inc.get(s, 0), 0),
            round(mean_freq.get(s, 0), 2),
        ])
    appendix = AppendixContent(
        title="数据附录 · 人群画像汇总",
        table=TableData(headers=headers, rows=rows),
        source="数据来源：京东常温牛奶消费者调研 Output-0320（N=1,680，6 类城市人群）。",
    )

    return ReportSpec(
        cover=cover,
        toc=TocContent(),
        executive_summary=exec_summary,
        chart_pages=chart_pages,
        appendix=appendix,
    )


# ------------------------- 3. 入口 -------------------------
def main() -> None:
    """生成优化版京东报告：全题目覆盖 + 数据标签 + 排序 + 多维度人群对比。

    通过通用向导 :mod:`pptx_report.wizard` 自动完成，对齐调研公司交付规范。
    （:func:`build_report_spec` 仍保留，作为「手工精选 11 题」版的可读示例。）
    """
    here = os.path.dirname(os.path.abspath(__file__))
    xlsx = os.path.join("C:/Users/a1382/Desktop", "京东常温牛奶-Output-0320.xlsx")
    out_dir = os.path.abspath(os.path.join(here, "..", "outputs"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "京东常温牛奶_调研报告.pptx")

    from .wizard import run_wizard
    saved = run_wizard(
        xlsx, out_path,
        title="京东常温牛奶消费者洞察报告",
        client="京东",
        date="2026-03-20",
        source="数据来源：京东常温牛奶消费者调研（腾讯问卷，全国样本 N=800）。",
        max_per_page=3,
    )
    print(f"\n报告已生成: {saved}")


if __name__ == "__main__":
    main()
