const WORKFLOW_STATUSES = new Set(["pending", "running", "waiting_input", "completed", "failed"]);
const PLAN_TOOL_IDS = new Set(["sample_size", "sample-size", "quota_design", "quota"]);

function text(value) { return String(value ?? "").trim(); }
function parsed(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { const result = JSON.parse(String(value || "")); return result && typeof result === "object" ? result : fallback; }
  catch { return fallback; }
}
function clipped(value, maximum) {
  const normalized = text(value);
  return normalized.length > maximum ? `${normalized.slice(0, Math.max(0, maximum - 1))}…` : normalized;
}

export const researchPlanWorkflowStatuses = [...WORKFLOW_STATUSES];

export const researchPlanWorkflowStages = Object.freeze([
  { id: "understanding", label: "正在理解项目需求" },
  { id: "method_design", label: "正在设计研究方法" },
  { id: "tool_work", label: "正在核定样本与配额" },
  { id: "quality_gate", label: "正在执行方案质量检查" },
  { id: "artifact", label: "正在生成项目成果" },
]);

export function normalizeProjectConstraints(value = {}) {
  const input = parsed(value);
  return {
    budget: clipped(input.budget, 500),
    timeline: clipped(input.timeline, 500),
    target_sample: clipped(input.target_sample, 500),
    research_method_preference: clipped(input.research_method_preference, 500),
    region_scope: clipped(input.region_scope, 500),
    other_constraints: clipped(input.other_constraints, 2_000),
  };
}

export function isResearchPlanWorkflow(taskType, artifact = null) {
  return text(taskType).toLowerCase() === "research_plan"
    || (text(taskType).toLowerCase() === "artifact_revision" && artifact?.type === "research_plan")
    || (artifact?.type === "research_plan" && text(taskType).toLowerCase() === "research_plan");
}

function latestToolResult(toolResults, toolId) {
  const aliases = toolId === "sample_size" ? new Set(["sample_size", "sample-size"]) : new Set(["quota_design", "quota"]);
  return (toolResults || []).find((item) => aliases.has(item?.tool_id)) || null;
}

export function classifyResearchPlanToolPolicy({ message = "", project = null, artifact = null, toolResults = [] } = {}) {
  const request = text(message);
  const projectSignal = `${text(project?.brief)}\n${text(project?.research_goal)}\n${text(normalizeProjectConstraints(project?.constraints).research_method_preference)}`;
  const qualitativeOnly = /纯定性|仅做定性|只做定性|不做定量|仅(?:做)?(?:深访|访谈|座谈|焦点小组)/i.test(`${request}\n${projectSignal}`);
  const revising = artifact?.type === "research_plan";
  const statisticalChanged = /(?:置信(?:水平|度)?|允许?误差|误差范围|抽样误差|总体(?:规模|数量)?|回收率|发放量|有效样本(?:量|规模)?|目标样本(?:量|规模)?|样本量(?:上限|下限|控制|调整|改为|降至|提高|不超过|左右)?)/i.test(request)
    && !/(?:访谈|深访|座谈|焦点小组).{0,8}(?:人数|样本)/i.test(request);
  const quotaChanged = /(?:配额|年龄结构|性别结构|城市(?:层级|级别|结构)?|区域结构|品牌结构|分层比例|加样|oversample|加权)/i.test(request);
  const sample = latestToolResult(toolResults, "sample_size");
  const quota = latestToolResult(toolResults, "quota_design");
  const reusable = [];
  if (sample && revising && !statisticalChanged) reusable.push(sample);
  if (quota && revising && !statisticalChanged && !quotaChanged) reusable.push(quota);
  const allowedTools = qualitativeOnly ? [] : revising
    ? [...(statisticalChanged ? ["sample_size"] : []), ...(quotaChanged || (statisticalChanged && Boolean(quota)) ? ["quota_design"] : [])]
    : ["sample_size", "quota_design"];
  return {
    revising,
    statistical_changed: statisticalChanged,
    quota_changed: quotaChanged,
    qualitative_only: qualitativeOnly,
    reusable_results: reusable,
    allowed_tools: [...new Set(allowedTools)],
  };
}

function compactToolResult(item) {
  const input = parsed(item?.input);
  const result = parsed(item?.result);
  return {
    id: text(item?.id),
    tool_id: text(item?.tool_id),
    input,
    result,
    created_at: text(item?.created_at),
  };
}

export function enhanceResearchPlanPrompt({ basePrompt, project, artifact = null, message = "", toolPolicy, toolResults = [], maxChars = 80_000 } = {}) {
  const constraints = normalizeProjectConstraints(project?.constraints);
  const candidates = (toolPolicy?.reusable_results?.length ? toolPolicy.reusable_results : toolResults.filter((item) => PLAN_TOOL_IDS.has(item?.tool_id)).slice(0, 4)).map(compactToolResult);
  const constraintLines = Object.entries({
    "预算约束": constraints.budget,
    "周期约束": constraints.timeline,
    "目标样本": constraints.target_sample,
    "方法偏好": constraints.research_method_preference,
    "地域范围": constraints.region_scope,
    "其他约束": constraints.other_constraints,
  }).filter(([, value]) => value).map(([key, value]) => `${key}：${value}`);
  const reuseRule = toolPolicy?.reusable_results?.length
    ? `以下确定性结果与本次修改无关且必须复用；禁止重复调用对应工具：\n${JSON.stringify(candidates, null, 2)}`
    : candidates.length
      ? `以下是项目中已有的确定性工具结果。仅当参数与本次方案一致时复用；参数改变时才重新调用：\n${JSON.stringify(candidates, null, 2)}`
      : "当前没有可复用的样本量或配额结果。";
  const permitted = toolPolicy?.allowed_tools?.length ? toolPolicy.allowed_tools.join("、") : "无（必须复用已有结果）";
  const workflowBlock = `【Research Plan Workflow 约束】
这是正式 research_plan 工作流，不是普通问答。先理解业务问题、研究目标、研究对象、范围、假设、预算、周期、方法偏好和已有资料；只在真正阻断整体设计的重大决策缺失时，才在回复第一行输出 [[WAITING_INPUT]] 并提出最少的澄清问题。普通消费者定量研究可采用 95% 置信水平等行业默认值，但必须在方案中明确说明假设。

允许调用的专业工具：${permitted}。涉及统计最低样本量且缺少可复用结果时，必须调用 sample_size；明确配额结构或已经确定需要配额时才调用 quota_design。研究方法由你判断，不得让工具替代研究判断。工具失败时不得自行估算或伪造数值。

${reuseRule}

${constraintLines.length ? `【项目约束】\n${constraintLines.join("\n")}` : "【项目约束】\n当前未单独登记；从 Brief 和用户当前要求中识别。"}

【正式方案质量要求】
输出完整调研方案正文，不要输出 JSON、执行日志或思考过程。根据项目实际裁剪章节，但必须建立“业务问题 → 研究问题 → 研究方法 → 研究对象/样本 → 研究内容 → 分析方法 → 交付成果”的对应关系。定量研究应区分“工具计算的统计最低样本”和“结合预算、分层及执行考虑的方案建议样本”，若二者不同必须解释。纯定性项目不得强行加入统计样本量计算。方案结尾列出当前假设与待确认事项。

在提交前进行一次不外显的 self-check：目标是否覆盖、问题与方法是否对应、研究对象是否匹配、研究内容能否回答目标、分析框架能否支撑决策、预算与周期是否被体现、样本数字是否与确定性工具结果一致或有明确取舍说明。修正发现的问题后只输出最终正文。

【本轮修改边界】
${artifact ? `当前基于 ${artifact.title} V${artifact.version} 生成新版本；只改变用户要求及其直接影响的内容，其余有效内容保持不变。` : "本轮生成调研方案 V1。"}
用户当前要求：${clipped(message, 5_000)}`;
  const maximum = Math.min(80_000, Math.max(8_000, Number(maxChars) || 80_000));
  const retainedBase = clipped(basePrompt, Math.max(1_000, maximum - workflowBlock.length - 2));
  return `${retainedBase}\n\n${workflowBlock}`.slice(0, maximum);
}

function containsAny(content, patterns) { return patterns.some((pattern) => pattern.test(content)); }
function quantitativePlan(content) { return /定量|问卷|量化|样本量|统计/.test(content); }

export function evaluateResearchPlanQuality({ content = "", project = {}, toolResults = [], toolCalls = [] } = {}) {
  const body = text(content).replace(/^\[\[WAITING_INPUT\]\]\s*/i, "");
  const errors = [];
  const warnings = [];
  if (body.length < 400) errors.push("方案正文过短，尚不足以构成正式调研方案。");
  const chainChecks = [
    ["研究目标", [/研究目标|业务目标|决策目标/]],
    ["研究问题", [/研究问题|核心问题|关键问题/]],
    ["研究方法", [/研究方法|研究设计|研究思路|方法与阶段/]],
    ["研究对象", [/研究对象|目标人群|受访对象/]],
    ["研究内容", [/研究内容|问卷模块|访谈模块|信息需求/]],
    ["分析框架", [/分析框架|分析方法|分析思路/]],
    ["交付成果", [/交付成果|交付物/]],
  ];
  for (const [label, patterns] of chainChecks) if (!containsAny(body, patterns)) warnings.push(`缺少清晰的“${label}”部分。`);
  const constraints = normalizeProjectConstraints(project?.constraints);
  if (constraints.budget && !/预算|成本|费用|万元|元/.test(body)) warnings.push("项目预算约束未在方案中体现。");
  if (constraints.timeline && !/周期|周|天|月|排期|进度/.test(body)) warnings.push("项目周期约束未在方案中体现。");
  const sampleResult = [...toolResults].find((item) => ["sample_size", "sample-size"].includes(item?.tool_id));
  const sampleData = parsed(sampleResult?.result);
  if (quantitativePlan(body) && !/\d[\d,，]*\s*(?:个|份|名)?(?:有效)?样本|样本量.{0,20}\d/.test(body)) warnings.push("定量研究已出现，但没有明确样本量。");
  if (sampleData.base && !body.includes(String(sampleData.base)) && !/统计最低样本|最低有效样本/.test(body)) warnings.push(`方案未清楚引用或解释工具计算的最低样本 ${sampleData.base}。`);
  if (sampleData.base) {
    const sampleNumbers = [...body.matchAll(/(?:样本(?:量|规模)?[^\d]{0,12}(\d[\d,，]*)|(\d[\d,，]*)\s*(?:个|份|名)?有效样本)/g)].map((match) => Number(String(match[1] || match[2]).replace(/[,，]/g, ""))).filter(Number.isFinite);
    const differentRecommendation = sampleNumbers.some((value) => value !== Number(sampleData.base) && value > 30);
    if (differentRecommendation && !/统计最低.{0,60}(?:方案建议|建议完成|执行样本)|(?:高于|低于|取舍|精度|分层分析|加样|预算).{0,60}(?:样本|统计)/s.test(body)) warnings.push("方案建议样本与工具最低样本不同，但没有解释统计精度、分析或执行取舍。");
  }
  const goalCoverage = [[/流失|流失原因/, /流失/], [/NPS|推荐意愿/i, /NPS|推荐意愿/i], [/满意度/, /满意度/], [/购买|转化/, /购买|转化/], [/品牌/, /品牌/]];
  for (const [goalPattern, contentPattern] of goalCoverage) if (goalPattern.test(text(project?.research_goal)) && !contentPattern.test(body)) warnings.push(`研究内容未清楚覆盖目标关键词“${text(project.research_goal).match(goalPattern)?.[0] || "核心目标"}”。`);
  const failedTool = (toolCalls || []).some((item) => item?.status === "error");
  const unavailable = /工具.{0,12}(?:不可用|失败|未完成)|无法(?:确认|获得).{0,12}(?:样本|配额)|不得自行估算/.test(body);
  return {
    passed: errors.length === 0,
    errors,
    warnings,
    checks: { chain_coverage: chainChecks.length - warnings.filter((item) => item.startsWith("缺少清晰")).length, quantitative: quantitativePlan(body), tool_failure: failedTool || unavailable },
  };
}

export function parseResearchPlanOutcome(reply) {
  const raw = text(reply);
  const waiting = /^\[\[WAITING_INPUT\]\]/i.test(raw);
  return { status: waiting ? "waiting_input" : "completed", content: raw.replace(/^\[\[WAITING_INPUT\]\]\s*/i, "").trim() };
}

export function researchPlanToolFailure({ content = "", toolCalls = [] } = {}) {
  return (toolCalls || []).some((item) => item?.status === "error")
    || /样本量计算工具.{0,20}(?:不可用|失败|未完成)|配额(?:设计)?工具.{0,20}(?:不可用|失败|未完成)|无法(?:确认|获得).{0,15}(?:最终样本|确定样本|配额)/.test(text(content));
}

export function summarizeResearchPlanResult({ artifact, quality, toolCalls = [], waiting = false } = {}) {
  if (waiting) return `调研方案工作流需要补充一项关键决策后才能继续。\n\n${artifact?.content || "请回复上方最少必要问题。"}`;
  const completedTools = toolCalls.filter((item) => item?.status === "completed").map((item) => item.label || item.tool_id);
  const warningText = quality?.warnings?.length ? `基础质量检查发现 ${quality.warnings.length} 项可继续优化的提示，已随工作流记录保存。` : "基础质量检查已通过。";
  return `调研方案已经完成并保存为项目成果 ${artifact?.title || "调研方案"} V${artifact?.version || 1}。\n\n${completedTools.length ? `本次使用了：${[...new Set(completedTools)].join("、")}。\n` : "本次未产生新的确定性工具调用。\n"}${warningText}\n\n你可以查看完整方案、继续提出修改要求，或导出 Word。`;
}

export function publicWorkflow(workflow) {
  if (!workflow) return null;
  return {
    ...workflow,
    tool_calls: Array.isArray(workflow.tool_calls) ? workflow.tool_calls : parsed(workflow.tool_calls, []),
    tool_result_ids: Array.isArray(workflow.tool_result_ids) ? workflow.tool_result_ids : parsed(workflow.tool_result_ids, []),
    stages: Array.isArray(workflow.stages) ? workflow.stages : parsed(workflow.stages, []),
    quality: workflow.quality && typeof workflow.quality === "object" ? workflow.quality : parsed(workflow.quality),
    constraints: workflow.constraints && typeof workflow.constraints === "object" ? workflow.constraints : parsed(workflow.constraints),
  };
}
