"""命令行入口：供 PWA 后端（Node server.js）调用生成 PPT 报告。

用法::
    python -m pptx_report.cli <xlsx> <out.pptx> <segments_json> <title>
    python -m pptx_report.cli --parse-only <xlsx>      # 仅返回 {segments, questions}

``segments_json`` 为 JSON 数组字符串，如 ``'["Total","都市中产"]'``；
空串 / ``"[]"`` / ``"null"`` 表示展示全部人群。

退出码：0=成功，1=运行时错误（错误信息写 stderr），2=参数错误。
"""
from __future__ import annotations

import json
import sys

from . import build_jd_report
from .build_jd_report import parse_crosstab
from .wizard import run_wizard, build_page_plan


def _collect_segments(xlsx: str) -> dict:
    """解析交叉表，收集去重后的人群维度列表与题目数。"""
    questions = parse_crosstab(xlsx)
    segs = []
    total_aliases = {"total", "总体", "整体", "合计", "总计"}
    for q in questions:
        for s in q.get("segments") or []:
            value = "Total" if str(s).strip().lower() in total_aliases else s
            if value not in segs:
                segs.append(value)
    result = {"segments": segs, "questions": len(questions)}
    # 附带维度分组信息（多级表头时每组对应一个分析维度）
    # 注意：必须通过模块属性访问，parse_crosstab 内部会对该全局变量重新赋值，
    # 直接 `from ... import _cached_dimension_groups` 会拿到导入时的旧空列表。
    if build_jd_report._cached_dimension_groups:
        result["dimension_groups"] = build_jd_report._cached_dimension_groups
    return result


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        sys.stderr.write(
            "用法: python -m pptx_report.cli <xlsx> <out.pptx> <segments_json> <title>\n"
            "      python -m pptx_report.cli --parse-only <xlsx>\n"
        )
        return 2

    # ── 仅解析模式：返回可用人群维度 ──
    if argv[0] == "--parse-only":
        if len(argv) < 2:
            sys.stderr.write("错误: --parse-only 需要 xlsx 路径\n")
            return 2
        try:
            result = _collect_segments(argv[1])
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"解析失败: {exc}\n")
            return 1
        print(json.dumps(result, ensure_ascii=False))
        return 0

    # ── 预览模式：返回页面规划 JSON（不渲染 PPTX）──
    if argv[0] == "--preview":
        if len(argv) < 2:
            sys.stderr.write("错误: --preview 需要 xlsx 路径\n")
            return 2
        xlsx = argv[1]
        dimension = None
        seg_json = "[]"
        title = "调研报告"
        rest = argv[2:]
        i = 0
        while i < len(rest):
            if rest[i] == "--dimension":
                if i + 1 < len(rest):
                    dimension = rest[i + 1]
                    i += 2
                    continue
            elif rest[i] == "--segments":
                if i + 1 < len(rest):
                    seg_json = rest[i + 1]
                    i += 2
                    continue
            elif rest[i] == "--title":
                if i + 1 < len(rest):
                    title = rest[i + 1]
                    i += 2
                    continue
            i += 1
        try:
            segs = json.loads(seg_json) if seg_json not in ("", "[]", "null") else None
        except json.JSONDecodeError:
            segs = None
        try:
            questions = parse_crosstab(xlsx)
            plan = build_page_plan(
                questions, title=title, segments=segs, dimension=dimension,
            )
            print(json.dumps(plan, ensure_ascii=False, default=str))
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"预览失败: {exc}\n")
            import traceback
            traceback.print_exc(file=sys.stderr)
            return 1
        return 0

    # ── 生成模式 ──
    if len(argv) < 2:
        sys.stderr.write("错误: 至少需要 <xlsx> <out.pptx>\n")
        return 2

    # 解析可选 --dimension <分组名> / --page-config <JSON>
    dimension = None
    page_config = None
    rest = []
    i = 0
    while i < len(argv):
        if argv[i] == "--dimension":
            if i + 1 < len(argv):
                dimension = argv[i + 1]
                i += 2
                continue
        elif argv[i] == "--page-config":
            if i + 1 < len(argv):
                page_config = argv[i + 1]
                i += 2
                continue
        else:
            rest.append(argv[i])
        i += 1
    argv = rest

    xlsx = argv[0]
    out = argv[1]
    seg_json = argv[2] if len(argv) > 2 else "[]"
    title = argv[3] if len(argv) > 3 else "调研分析报告"

    try:
        segs = json.loads(seg_json) if seg_json not in ("", "[]", "null") else None
    except json.JSONDecodeError:
        segs = None

    try:
        pc_dict = json.loads(page_config) if page_config else None
    except (json.JSONDecodeError, TypeError):
        pc_dict = None

    try:
        saved = run_wizard(
            xlsx, out, title=title, client="调研项目", segments=segs,
            dimension=dimension, max_per_page=3, page_config=pc_dict,
        )
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"生成失败: {exc}\n")
        return 1

    print(saved)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
