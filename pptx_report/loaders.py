"""从 Excel 读取数据并生成图表规格（pandas + openpyxl）。

演示「数据与渲染分离」：先用熟悉的工具把表格整理成
:class:`~pptx_report.model.ChartSpec`，再交给渲染器，无需改动渲染逻辑。
适用于：周报 / 月报的源数据来自 Excel 交叉表的场景。
"""

from __future__ import annotations

from typing import List, Optional

import pandas as pd

from .model import ChartSpec, ChartType, Series


def read_sheet(path, sheet_name=0, engine="openpyxl") -> pd.DataFrame:
    """读取一个 Excel 工作表为 DataFrame。"""
    return pd.read_excel(path, sheet_name=sheet_name, engine=engine)


def crosstab_to_chart(path, sheet_name=0, title="", index_col=0,
                       value_cols=None, chart_type: str = "bar",
                       insight="", engine="openpyxl") -> ChartSpec:
    """读取交叉表，第一列作分类，其余列作系列，生成图表规格。

    Args:
        path: Excel 路径。
        sheet_name: 工作表名或索引。
        index_col: 作为分类轴的列索引（默认第一列）。
        value_cols: 作为数值系列的列名列表；为空则取除 index_col 外的全部列。
        chart_type: ``"bar"`` / ``"line"`` / ``"stacked_bar"``。
        insight: 图表下方一句话结论。
    """
    df = read_sheet(path, sheet_name=sheet_name, engine=engine)
    categories = df.iloc[:, index_col].astype(str).tolist()
    cols = value_cols or [c for i, c in enumerate(df.columns) if i != index_col]

    series: List[Series] = []
    for col in cols:
        series.append(Series(name=str(col),
                             values=[float(v) for v in df[col].tolist()]))

    ctype = {
        "bar": ChartType.BAR,
        "line": ChartType.LINE,
        "stacked_bar": ChartType.STACKED_BAR,
    }.get(chart_type, ChartType.BAR)

    return ChartSpec(
        title=title or str(sheet_name),
        type=ctype,
        categories=categories,
        series=series,
        insight=insight,
    )
