# SurveyKit 定性研究报告 PPT 设计系统 V2.0

## 1. 设计目标

这套模板服务于可编辑的企业级定性研究报告，不复刻任一参考报告，而是统一吸收四类成熟表达：

- 人群树、定位图、静态画像与画像旅程；
- 概念定义、边界判断与分类体系；
- 需求金字塔、痛点/机会优先级矩阵；
- 决策旅程、假设验证、产品定义与渠道行动。

最终页面必须满足：一页一个观点、三秒读懂结论、证据可追溯、对象级可编辑、内容超载时拆页而非缩字。

## 2. 统一视觉语言

### 2.1 画布与网格

- 画布：16:9，13.333 × 7.5 英寸。
- 安全边距：左右 0.55 英寸，上 0.35 英寸，下 0.34 英寸。
- 内容起始线：标题区结束后 1.45 英寸。
- 栅格：12 列；标准卡片间距 0.24 英寸；大区块间距 0.38 英寸。
- 每页至少保留约 20% 的负空间。

### 2.2 色彩

| 角色 | 色值 | 使用场景 |
|---|---:|---|
| Tech Navy | `0A2A66` | 封面、章节页、结论标题、核心框架 |
| Electric Blue | `176BFF` | 品牌主色、关键节点、重点数据 |
| Cyan Blue | `37BFF3` | 第二层信息、坐标点、流程节点 |
| Mist Blue | `EAF3FF` | 证据区、辅助底色、低强度信息 |
| Ice White | `F7FAFF` | 内容页背景 |
| Deep Text | `18263D` | 正文 |
| Muted Blue Gray | `6F7D93` | 注释、轴标签、来源 |
| Border Blue Gray | `D7E3F2` | 分隔线、弱边界 |
| Alert Coral | `E35D6A` | 仅用于风险、冲突、最高优先级 |
| Success Teal | `22A699` | 仅用于验证通过或明确机会 |

整套报告的品牌识别只使用 Tech Navy、Electric Blue、Cyan Blue 和 Mist Blue。科技蓝体系占页面视觉重量的 70% 以上；Alert Coral 与 Success Teal 不进入常规标题、卡片或图形，只在风险/通过等语义必须区分时少量出现。

### 2.3 字体与层级

- 中文字体：微软雅黑；英文与数字沿用微软雅黑，避免跨环境替换。
- 封面标题：30–36 pt；章节标题：28–32 pt；内容页结论标题：24–28 pt。
- 核心结论/大数字：22–30 pt；模块标题：15–17 pt；正文：13–15 pt；来源：8.5–9.5 pt。
- 标题优先写结论句；同一套报告不要混用“主题名标题”和“结论句标题”。
- 正文左对齐；只对章节标题、节点序号和短标签居中。

### 2.4 固定页面骨架

内容页统一包含四个区域：

1. 顶部语义标签：页型或章节名，帮助快速定位；
2. 结论标题：页面最大的文字，承担核心观点；
3. 主体证据区：图形、结构、比较或原声；
4. 底部证据脚注：读者可见来源 + 页码，内部 Evidence ID 仅进入备注。

统一视觉母题为“科技蓝语义标签 + 证据胶囊”：不使用标题下划线，不使用贯穿全页的装饰竖线，不使用圆角卡片左侧彩条。内容页左侧安全边距内保持干净留白，不放置任何纵向色带。

## 3. 核心页面与 V2 版式目录

| # | 核心页型 | 主要用途 | 内置变体 | 关键输入 |
|---:|---|---|---|---|
| 1 | `navigation` | 封面、目录、章节过渡 | cover / contents / divider | title, subtitle, section_number |
| 2 | `executive_summary` | 汇总 3–5 条核心结论 | insight_cards / north_star / editorial_overview | core_insights, evidence_coverage |
| 3 | `research_framework` | 研究设计、执行回顾、概念测试流程 | flow / hub / protocol | stages, sample, methods |
| 4 | `segmentation_map` | 建立人群体系 | hierarchy_tree / positioning_map | segments, hierarchy, x_axis, y_axis |
| 5 | `persona` | 描述典型人群 | profile / profile_journey / profile_evidence | profile, traits, behaviors, quotes |
| 6 | `journey` | 场景、行为或决策链路 | scenario / persona_journey / decision_journey / journey_curve | stages, actions, needs, pains |
| 7 | `comparison` | 人群或竞品差异 | two_side / multi_column / rubric | objects, dimensions, differences |
| 8 | `evidence_diagnostic` | 洞察证据、正反论证、问题归因 | insight_quotes / pro_con / verdict | hypothesis, findings, quotes, verdict |
| 9 | `concept_definition` | 概念定义、边界、分类体系 | nested_definition / taxonomy | definition_layers, boundaries, taxonomy_nodes |
| 10 | `needs_pyramid` | 需求或动机分层 | three_level / segment_mapping / evidence_pyramid | levels, segment_mapping, evidence_ids |
| 11 | `priority_matrix` | 痛点、机会或定位判断 | pain / opportunity / positioning / impact_frequency | axes, thresholds, items, quadrant_labels |
| 12 | `problem_reason` | 把高优先级问题拆成可解释根因 | cause_cards / fishbone | cause_groups, outcome_label, verdict |
| 13 | `recommendation` | 把洞察转成分阶段行动 | action_cards / action_roadmap | phases, actions, priority |

V2 的完整机器可读目录位于 `pptx_report/templates/qualitative-tech-blue-v2/layout_catalog.json`，共 16 个原生 OfficeCLI 版式。默认路由为：总结页 `editorial_overview`、旅程页 `journey_curve`、问题归因页 `fishbone`、建议页 `action_roadmap`。显式 `layout_variant` 永远优先于默认路由，旧脚本未选择 V2 风格时继续使用旧版式，保证向后兼容。

## 4. 页面编排规则

- 一份 15–25 页定性报告通常只使用 6–8 类页型，不强求 11 类全覆盖。
- 每个章节采用“章节页 → 定义/背景 → 关键洞察 → 证据/差异 → 小结/行动”的节奏。
- 静态画像与画像旅程优先成对出现；画像页回答“是谁”，旅程页回答“怎么行动”。
- 矩阵必须由显式坐标值驱动；缺少数值或分级证据时，退化为定性四象限卡片，禁止自动编造坐标。
- 需求金字塔必须有层级依据；没有层级关系时使用主题归纳页，不强行做金字塔。
- 超过 5 个旅程阶段、4 个比较对象、3 条原声或 4 个核心模块时优先拆页。

### 4.1 自适应容量与续页规则

渲染前先按页型切分语义集合，两个渲染引擎共享同一份 `prepared_pages`，因此 OfficeCLI 主渲染与 python-pptx 回退不会出现不同的内容取舍。

| 页面区域 | 单页容量 | 续页保留的上下文 |
|---|---:|---|
| 总结卡片 | 4 张 | 结论标题、Key Message、Evidence |
| 旅程阶段 | 5 个 | 旅程判断、显式重点阶段 |
| 对比对象 / 四象限卡片 | 4 个 | 比较维度、共同底线、坐标含义 |
| 分群树 / 定位图 | 4 类 | 分群轴、象限标签、分群判断 |
| 画像特征 / 行为 | 各 4 条 | 画像档案；短上下文可重复，原声不重复 |
| 原声 | 3 条；任一原声超过 140 字时每页 1 条 | 研究解读、来源、Evidence |
| 概念定义 | 3 层定义 + 4 条边界 | 定义层作为边界续页上下文 |
| 需求金字塔 | 4 层 + 4 个人群映射 | 完整需求结构 |
| 优先级矩阵 | 6 个点 | 坐标轴、象限、优先决策摘要 |
| 鱼骨根因 | 6 个原因组，每组 3 条 | 完整结论、结果短标签与诊断判断 |
| 行动路线 | 5 个阶段，每阶段 4 条 | 行动原则与优先级 |

- 同一卡片超过该页型允许的正文行数时，先把卡片按原文切成多个卡片，再参与页面续页。
- 续页 ID 使用 `原 page_id__part_N`，同时写入 `split_from_page_id`、`split_part` 和 `split_total`，便于审计和回链。
- 续页标题追加“（续 N）”；原始段落、列表项和逐字原声不摘要、不改写、不丢弃。
- 标题超过 28 字时优先在中文标点处做平衡换行；超过 36/48/62 字时分级调整字号，但不压缩正文区域。

## 5. 组件规范

### 5.1 证据胶囊

- 显示 `定性证据`、`多源互证`、`待验证` 等读者语义，不显示内部 ID。
- 常规证据用 Electric Blue，多源互证用 Cyan Blue；风险/冲突才使用 Alert Coral，验证通过才使用 Success Teal。

### 5.2 原声卡

- 1–3 条原声；正文 13–15 pt，受访者标签 9–10 pt。
- 只保留一枚低饱和引号标记，不使用头像拼贴或装饰性大引号。
- 原文不得改写；超长时拆页。

### 5.3 卡片与表格

- 常规卡片使用白底、弱边界、顶部语义色带；圆角仅用于信息容器。
- 对比页优先使用并列块和差异脊柱，避免大面积 Excel 式网格。
- 表格仅用于真正需要精确交叉读取的内容；默认最多 5 行 × 4 列。

### 5.4 图形

- 流程节点使用原生形状和带箭头连接线。
- 矩阵、金字塔、树和旅程均使用 PowerPoint 原生对象。
- 头像/场景图是可选增强，不是页面成立的前提；没有合规图片时使用抽象人物符号，不生成假照片。

## 6. 证据与备注

- 页面可见来源只显示“消费者访谈 / 专家访谈 / 定性分析 / 项目资料”等自然语言。
- `evidence_ids`、`transcript_segment_ids`、页面转场和演讲提示写入 Speaker Notes。
- Direct Quote 必须同时具备 evidence_id 与 segment_id；否则渲染失败。
- 结论、发现、原声和建议必须保持从 Insight 到 Evidence 的可追溯链路。

## 7. 样板验收

- 文件可在 Microsoft PowerPoint 打开，且文本、形状、表格、连接线均可编辑。
- 不允许整页图片；图片仅能作为局部可替换素材。
- OfficeCLI `validate` 无错误，`view issues` 无阻断问题。
- 全部页面经过逐页截图检查，并至少完成一轮修复后复验。
- 页面无占位符、无文字越界、无低对比文字、无脚注冲突、无缺失箭头。
- 业务验收使用 12 份访谈结构的脱敏样例；排版回归另使用 6 类高压页面，覆盖长标题、长原声、8 分群、12 个矩阵点、画像溢出与多人群需求映射。
- 验收必须证明压力样例中的可见原始条目全部进入最终 PPT，不允许依赖渲染函数的数组截断静默丢失内容。

## 8. 真实项目生产验收

真实项目应从已固化的 Analysis → Report Outline → PPT Script 产物断点续跑，并显式要求 V2 模板与 OfficeCLI 门禁。已有旧版 Script 时，验收脚本会保留原产物，再创建一个以原 Script 为 `parent_artifact_id` 的 V2 子产物；内容与证据链不被覆盖。

```powershell
$env:QUALITATIVE_PPT_RENDER_ENGINE = "officecli"
$env:QUALITATIVE_PPT_OFFICECLI_QA = "required"

npm run acceptance:qualitative-ppt -- `
  --project-id <project-id> `
  --analysis-artifact-id <analysis-artifact-id> `
  --outline-artifact-id <outline-artifact-id> `
  --script-artifact-id <ppt-script-artifact-id> `
  --skip-summaries `
  --template-id qualitative_tech_blue_v2 `
  --base-url http://127.0.0.1:4382 `
  --output-dir "test-results/real-project-v2-acceptance"
```

验收成功的硬条件：`renderer.engine=officecli`、`layout_adaptations.profile=qualitative_tech_blue_v2`、`editable_native=true`、`full_slide_images=false`，并通过 `officecli validate`、`view issues`、占位符扫描与逐页截图复核。若仅需复用已有三段产物重新渲染，不要求模型服务在线，也不会产生模型 Token。
