# pptx_report —— 市场调研报告 PPT 生成模块（python-pptx）

用 `python-pptx` + `pandas` + `openpyxl` 编写的生产级报告生成模块，
为「定量调研工具箱」PWA 产品提供可扩展、健壮的 PPT 渲染能力。

> 旧版用 `PptxGenJS` 实现、功能基础；本模块不沿用其实现，而是基于
> `python-pptx` 最佳实践重新设计，重点解决**中文渲染**、**图表/布局灵活组合**、
> **数据与渲染分离**三个核心问题。

---

## 1. 设计理念

| 原则 | 落地方式 |
| :--- | :--- |
| **数据与渲染分离** | 用 `ReportSpec`（或字典）描述「内容」，渲染器只负责把数据变成 `.pptx` |
| **模块化** | 封面 / 目录 / 摘要 / 图表页 / 附录 各自独立成函数与模块 |
| **中文优先** | 统一设置「拉丁 + 东亚 (a:ea)」字形，避免中文回退默认字体 |
| **可扩展** | 新增图表类型改 `charts.py`，新增布局改 `layouts.py` |
| **健壮** | 自定义异常体系 + 每页 / 每图 try/except + 数据校验 |

---

## 2. 安装与运行

```bash
# 使用隔离环境（推荐，避免污染系统 Python）
python -m venv .venv && .venv/Scripts/pip install python-pptx pandas openpyxl

# 运行内置完整示例（生成 outputs/ 下的三份报告）
python -m pptx_report.demo
```

依赖：`python-pptx>=1.0`、`pandas`、`openpyxl`。

---

## 3. 目录结构

```
pptx_report/
├── __init__.py        # 包入口，导出公共 API
├── model.py          # 内容数据模型（dataclass + from_dict/to_dict）
├── theme.py          # 主题与配色（≤4 色，中文字体）
├── utils.py          # 字体 / 填充 / 背景等底层助手
├── charts.py         # 8 种图表渲染 + 统一样式
├── layouts.py        # 4 种布局的矩形计算
├── pages.py          # 各页面（封面/目录/摘要/图表页/附录）绘制
├── renderer.py       # ReportRenderer 编排 + 模板支持
├── loaders.py       # 从 Excel 读取数据生成图表规格
├── wizard.py         # 通用向导：全题目覆盖 + 自动选图 + 排序 + 多维度对比
├── demo.py           # 完整使用示例
└── README.md
```

---

## 4. 快速开始

### 写法一：字典（最适合接口 / 配置驱动）

```python
from pptx_report import ReportSpec, ReportRenderer

report_dict = {
    "cover": {"title": "2026 智能家居市场调研", "client": "云栖智能",
               "date": "2026-07-11"},
    "toc": {"sections": []},          # 留空 → 自动提取章节标题
    "executive_summary": {
        "kpis": [{"label": "市场规模", "value": "1,280亿", "delta": "+18%"}],
        "conclusion": "结论……",
    },
    "chart_pages": [
        {"title": "各品牌市场份额", "layout": "single",
         "charts": [{"title": "份额", "type": "bar",
                     "categories": ["云栖", "竞品A"],
                     "series": [{"name": "份额", "values": [24, 19]}]}]},
    ],
    "appendix": {"title": "数据附录",
                 "table": {"headers": ["区域", "销售额"], "rows": [["华东", "330"]]},
                 "source": "来源说明"},
}
spec = ReportSpec.from_dict(report_dict)
ReportRenderer().render(spec, "outputs/报告.pptx")
```

### 写法二：dataclass + 便捷工厂（代码里更直观）

```python
from pptx_report.model import ChartSpec, ChartPageContent, LayoutType, ReportSpec
from pptx_report import ReportRenderer

combo = ChartSpec.combo(
    title="销售额及增长率",
    categories=["音箱", "扫地机"],
    bars={"销售额": [320, 280]},
    line=[12.5, 8.3],
    line_name="增长率(%)", secondary_axis_title="增长率(%)",
    insight="音箱规模领先，扫地机增速快。")

spec.chart_pages.append(ChartPageContent(
    title="组合分析", charts=[combo], layout=LayoutType.SINGLE))
ReportRenderer().render(spec, "outputs/报告.pptx")
```

---

## 5. 支持的图表与布局

**图表类型**（`ChartSpec.type` / `ChartType`）：
`bar`(条形/柱状比较)、`line`(趋势)、`pie`(饼)、`doughnut`(环形)、
`stacked_bar`(堆积构成)、`scatter`(相关性)、`radar`(多维评估)、`combo`(柱状+折线双轴)。

**布局**（`ChartPageContent.layout` / `LayoutType`，`AUTO` 会按图表数自动选）：
- `single` 单图大版面（图占 ~70%，底部留结论）
- `dual` 对比式双图（左右各一图）
- `dashboard` 仪表盘网格（2×2 或 3×2，最多 6 图）
- `mixed` 图文混排（图 60% + 侧栏 40% 洞察）

> 规范要点：全页配色 ≤4 种；删去网格线；图例置底且不占绘图区；
> 每个图表下方一句话结论；**最重要的图表始终放在页面左上角**（网格按阅读顺序填充）。

---

## 6. 主题与中文字体

```python
from pptx_report import Theme, ReportRenderer

theme = Theme(
    name="品牌蓝",
    font_name="微软雅黑",
    palette=["1F4E79", "2E75B6", "9DC3E6", "F2A900"],  # ≤4 色
    background="FFFFFF", text_dark="222222", text_light="FFFFFF")
ReportRenderer(theme=theme).render(spec, "outputs/报告.pptx")
```

模块会自动为**所有**文本写入东亚字形 (`<a:ea>`)，确保在各版本 PowerPoint 下中文正常显示。

### 多系列配色（分段色板）

当一道题需要同时展示 Total + 多个细分人群（如 6 个人群分段）时，
单页 `palette`（≤4 色）不够用。此时图表会自动改用 `Theme.segment_palette`
（10 色：灰→橙→红褐→绿→紫→青→金→蓝→品红→青绿），按系列序号循环取色，
保证每个分段都有可区分的颜色，且颜色稳定可复现。

---

## 7. 模板支持（两种用法）

**(a) 模板作为「设计底」**——继承母版背景与配色，最常用：

```python
ReportRenderer(template_path="outputs/template.pptx").render(spec, "out.pptx")
```

模板可以是你用 PowerPoint 设计好的 `.pptx`（含品牌背景 / LOGO / 母版）。
注意：若模板背景为深色，请相应调整 `Theme.text_dark / text_light`。

**(b) 模板「预设占位符」填充**——适合版式固定的场景：

```python
from pptx_report import ReportRenderer
from pptx import Presentation

prs = Presentation("template.pptx")
slide = prs.slides.add_slide(prs.slide_layouts[0])  # 含 title/subtitle 占位符
ReportRenderer().fill_named_placeholders(
    slide, {"Title": "报告标题", "Subtitle": "副标题"})
prs.save("out.pptx")
```

---

## 8. 从 Excel 加载数据

适合「周报 / 月报源数据在 Excel 交叉表」的场景：

```python
from pptx_report import loaders
from pptx_report.model import ChartPageContent, LayoutType

chart = loaders.crosstab_to_chart(
    "data.xlsx", sheet_name="份额", title="各品牌份额",
    index_col=0, chart_type="bar", insight="云栖居首")
spec.chart_pages.append(
    ChartPageContent(title="份额分析", charts=[chart], layout=LayoutType.SINGLE))
```

---

## 9. 扩展指南

- **新增图表类型**：在 `model.py` 的 `ChartType` 加枚举，在 `charts.py`
  的 `_CHART_TYPE_MAP` 映射原生类型，并在 `_build_*` 里写数据构造器即可。
- **新增布局**：在 `layouts.py` 的 `resolve_layout` 增加分支，返回
  `PageLayout(slots=[...])`，`pages.build_chart_page` 会自动套用。
- **换肤 / 多出 KPI 卡**：改 `theme.py` 的 `Theme` 或 `pages.build_exec_summary`。

---

## 10. 通用向导：问卷交叉表 → 全量报告

`wizard.py` 把一个腾讯问卷 / SPSS 风格的「交叉表 Excel」**一键**转成
覆盖全部题目的专业报告，直接解决四类常见交付缺陷：

| 痛点 | 向导的解法 |
| :--- | :--- |
| **题目覆盖不全** | 自动遍历 Excel 内所有交叉表，逐题生成图表；甄别 / 配额 / 后台圈选题自动归入附录表 |
| **图表无数据标签** | 全部非饼 / 环形图默认开启数据标签，百分比格式 `49.0%`、9pt 深灰、微软雅黑，并强制 `wrap=none` 防止换行 |
| **数据未排序** | 无序类目按 Total 降序排列（PPT 渲染时最大值置顶）；年龄 / 收入 / Likert / NPS 等有序类目保留原始顺序 |
| **无多维度对比** | 每题默认同时绘制 Total + 全部细分人群（约 7 个系列 / 图），一眼看清人群差异 |

### 10.1 用法

```python
from pptx_report.wizard import run_wizard

run_wizard(
    xlsx="C:/Users/a1382/Desktop/京东常温牛奶-Output-0320.xlsx",
    out_path="outputs/京东常温牛奶_调研报告.pptx",
    title="京东常温牛奶消费者调研",
    client="某乳企",
    date="2026-03-20",
    source="腾讯问卷 · 全国样本 N=800",
    max_per_page=3,          # 每页放几道题（dashboard 网格：2 或 3）
)
```

也可直接以模块方式运行：`python -m pptx_report.wizard`（默认生成京东样本的向导版报告）。

### 10.2 自动选图规则

`auto_chart_type` 依据「类目数 / 分段数 / 题面关键词」推断：

- 单分段且类目 ≤5 → **环形图**（构成占比）；
- 多分段（≥2）且类目 ≥4 且题面含「场景 / 评分 / 维度 / 画像 / 评价 / 偏好 / 对比」→ **雷达图**（多维评估）；
- 其余 → **柱状图**（多系列对比，最通用）。

> 如需把某题固定为指定类型，可在 `build_auto_report` 前先对题目做预处理，
> 或在 `wizard` 外层传入自定义 `auto_chart_type` 钩子。

### 10.3 排序与有序类目识别

`has_natural_order` 通过正则 + 关键词判断类目是否「有序」：

- 有序（保留原序）：`18-25`、`25-30`、`30岁以上`、`1-2次/月`、`非常满意→非常不满意`、`推荐者/中立者/贬损者` 等；
- 无序（按 Total 降序）：`省份`、`品牌`、`渠道` 等名义类目——排序后反转列表，让最大值落在图表顶部。

### 10.4 附录与样本量

- 题号前缀 `FZ`、含「后台圈选 / 配额」字样、或选项数 <2 的题目 → 判定为甄别 / 配额类，**不绘图表**，统一进附录表格；
- 报告开篇自动汇总样本量（N）与各人群基数，符合调研公司「6+1」交付结构。

---

## 11. 异常说明

| 异常 | 触发场景 |
| :--- | :--- |
| `ReportDataError` | 内容字段缺失 / 类型错误 |
| `UnsupportedChartTypeError` | 图表 / 布局类型不被支持 |
| `TemplateNotFoundError` | 模板文件不存在或无法读取 |
| `RenderingError` | 渲染某页 / 某图时发生未知错误（含 `page`/`chart` 上下文） |

建议调用方用 `try/except ReportError` 统一兜底。
