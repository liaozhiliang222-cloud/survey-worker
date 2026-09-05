import { publicDataset } from "./data-engine.mjs";

export const dataAnalysisWorkflowStages = Object.freeze([
  Object.freeze({ id: "understanding", label: "正在理解分析任务" }),
  Object.freeze({ id: "data_profile", label: "正在读取数据结构" }),
  Object.freeze({ id: "cleaning", label: "正在确认数据清洗" }),
  Object.freeze({ id: "weighting", label: "正在确认数据加权" }),
  Object.freeze({ id: "analysis_plan", label: "正在设计分析计划" }),
  Object.freeze({ id: "crosstab", label: "正在执行交叉分析" }),
  Object.freeze({ id: "interpretation", label: "正在总结主要发现" }),
  Object.freeze({ id: "artifact", label: "正在生成分析成果" }),
]);

function parsed(value, fallback = {}) { if (value && typeof value === "object") return value; try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function clipped(value, maximum) { const text = String(value || ""); return text.length > maximum ? `${text.slice(0, maximum)}\n[已截断]` : text; }

export function isDataAnalysisWorkflow(taskType, artifact = null) {
  return taskType === "data_analysis" || (taskType === "artifact_revision" && artifact?.type === "analysis");
}

export function dataAnalysisToolPolicy(dataset, toolResults = []) {
  const reusable = toolResults.filter((item) => {
    if (!["data-profile", "data-clean", "data-weight", "crosstab"].includes(item.tool_id)) return false;
    const result = parsed(item.result); const input = parsed(item.input);
    return [result.dataset_id, result.source_dataset_id, input.dataset_id].includes(dataset.id);
  }).slice(0, 8);
  return { allowed_tools: ["data_profile", "data_clean", "data_weight", "crosstab"], reusable_results: reusable };
}

export function enhanceDataAnalysisPrompt({ basePrompt, dataset, message, toolResults = [], maxChars = 30_000 }) {
  const safeDataset = publicDataset(dataset); const metadata = safeDataset.metadata || {};
  const fields = Array.isArray(metadata.fields) ? metadata.fields : [];
  const indexedFields = fields.slice(0, 1_000);
  const reusable = toolResults.slice(0, 8).map((item) => ({ tool_id: item.tool_id, result: parsed(item.result), created_at: item.created_at }));
  const instruction = [
    "【正式 Data Analysis Workflow】",
    "你负责判断分析路径和解释结果；所有数据结构检查、清洗、百分比、NPS、均值、交叉表和显著性必须由 SurveyKit 确定性工具完成。禁止自行读取、索要、复算或推测原始数据行。",
    "原始数据行不在上下文中；你只能看到 Dataset 元数据、字段索引和工具返回的精简结果。",
    `当前数据集：${safeDataset.name} (${safeDataset.id})`,
    `版本：${safeDataset.type}；${safeDataset.row_count} 样本 × ${safeDataset.column_count} 字段`,
    `Sheet：${metadata.sheet_name || "未标注"}`,
    `字段索引（已提供 ${indexedFields.length}/${safeDataset.column_count || fields.length || 0} 个）：${indexedFields.join("、") || "请先调用 data_profile"}`,
    fields.length > indexedFields.length ? "字段索引因安全上限被截断；不要把当前列表当作完整字段集合。" : "上述字段索引是当前数据集的完整字段名列表，但字段标签和值标签需要通过 data_profile 查询。",
    "调用 data_profile 时，应根据用户目标使用 field_query（最多 8 个关键词）检索全部变量的字段名、题目标签和值标签，例如 NPS 任务使用 [\"NPS\",\"推荐\",\"满意\"]。如果目标变量未返回，应更换关键词再查一次，不得仅凭前几十个字段认定变量不存在。",
    "先形成最小必要分析计划，只调用与用户问题相关的数据工具；不要遍历全部变量。",
    "若需要清洗：先调用 data_clean(confirmed=false)获取预计影响。除空白行、完全重复记录且影响很小外，必须向用户列出规则和预计删除量，等待明确确认后才能 confirmed=true。",
    "Weighted Dataset 不支持直接清洗；需要修改样本时，返回其 Raw/Clean 来源版本完成清洗，再重新加权，不能把已有权重静默丢弃。",
    "若样本结构需要校准，只有在用户提供了覆盖实际类别的明确目标总体分布后，才能先调用 data_weight(confirmed=false)展示预计权重范围、有效样本量和边际校准结果；任何加权都必须等待用户明确确认后再 confirmed=true。不得假设市场比例。",
    "加权截尾范围约束最终均值为 1 的权重。必须检查 diagnostics.converged 与 max_margin_delta；若未收敛，要说明最终分布与目标的偏差，不能宣称已完成目标校准。",
    "交叉分析必须调用 crosstab，并只依据它返回的 result_id、key_findings 和显著性标识陈述数据事实。工具失败或字段不存在时不得编造替代结果，最多修正字段后重试一次。",
    "最终正文必须包含：一、分析目标；二、数据说明；三、关键发现；四、核心差异；五、可能原因；六、待进一步验证事项。",
    "每条核心结论分别写明 数据事实、分析解释、待验证假设；证据格式为 `Evidence: <result_id> | <具体数值/显著性>`。没有 result_id 的内容只能作为假设，不能写成事实。",
    "这是分析中间成果，不生成正式客户报告或 PPT。",
    reusable.length ? `可复用的精简工具结果：\n${JSON.stringify(reusable)}` : "当前没有可复用的数据工具结果。",
    `用户当前分析要求：${message}`,
  ].join("\n");
  return clipped(`${basePrompt}\n\n${instruction}`, Math.max(8_000, Number(maxChars) || 30_000));
}

export function dataMutationAwaitingConfirmation(toolResults = []) {
  const latest = toolResults.find((item) => ["data-clean", "data-weight"].includes(item.tool_id) && parsed(item.result).requires_confirmation === true);
  return latest?.tool_id === "data-weight" ? "weighting" : latest ? "cleaning" : "";
}

export function evaluateDataAnalysisQuality({ content, toolResults = [] }) {
  const text = String(content || ""); const resultIds = toolResults.map((item) => parsed(item.result).result_id).filter(Boolean);
  const cited = resultIds.filter((id) => text.includes(id)); const headings = ["分析目标", "数据说明", "关键发现", "核心差异", "可能原因", "待进一步验证"];
  const issues = [];
  if (!toolResults.some((item) => item.tool_id === "crosstab")) issues.push("未形成交叉分析结果；如本轮仅做数据检查，应在数据说明中明确。 ");
  if (resultIds.length && !cited.length) issues.push("正文未引用可追溯的 result_id。");
  if (!/数据事实/.test(text)) issues.push("未明确区分数据事实与解释。");
  if (!/假设|待验证/.test(text)) issues.push("未声明解释边界或待验证假设。");
  return { passed: issues.length === 0, score: Math.max(0, 100 - issues.length * 20 - headings.filter((heading) => !text.includes(heading)).length * 5), issues, cited_result_ids: cited };
}

export function summarizeDataAnalysisResult({ artifact, quality, toolCalls = [] }) {
  const completed = toolCalls.filter((item) => item.status === "completed").map((item) => item.label).filter(Boolean);
  return `数据分析已完成，并保存为「${artifact.title}」V${artifact.version}。${completed.length ? `本轮使用：${[...new Set(completed)].join("、")}。` : ""}${quality?.cited_result_ids?.length ? `已关联 ${quality.cited_result_ids.length} 个可追溯结果。` : ""}`;
}
