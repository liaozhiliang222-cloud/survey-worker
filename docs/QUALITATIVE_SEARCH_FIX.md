# 多访谈分析空结果修复（2026-09-05）

生产一次 12 份访谈分析的三次 transcript_search 均返回 transcript_count=0：模型将 transcript_ids 放入 filters，接口误作受访者 Metadata 筛选，排除了全部访谈。模型随后返回证据不足说明，但 finalizeQualitativeAnalysis 仍保存正式成果，workflow 忽略零原声条件显示 completed。

修复：接受 filters.transcript_ids 别名，同时提供顶层与嵌套范围时取交集，保留项目边界和其他 Metadata 筛选。非法参数返回明确错误。正式多访谈分析在创建任何成果前要求至少一条逐字核验原声；否则 Node / Pages 返回 qualitative_evidence_required，workflow 失败，不创建空成果。

验证：原生产三个检索条件与 12 份原始访谈只读重放，每次恢复 15 条候选。测试覆盖嵌套参数、顶层等价、范围交集、非法参数、无引用/伪造引用不保存、真实 HTTP 错误及 failed 状态。完整 npm test 与构建通过。原始访谈、请求与诊断数据只存在本机私有 .data，不纳入仓库。

之前两份人工访谈的验收未覆盖模型将 ID 嵌套进 filters 的情况，现已加入回归。候选检索命中不等同于报告内容质量验收。
