/**
 * AI 报告生成模块
 * 提取自 app.js — 定量报告生成核心逻辑
 */
import { state } from "../../shared/store.js";
import { loadAiSettings, validateAiSettings, callAiChatCompletion, aiProviderPresets } from "../../shared/ai-client.js";

/* ─── 项目类型指引 ─── */
const projectTypeHints = {
  general: "通用定量分析：根据数据内容自行选择最有分析价值的维度展开。",
  ua: "U&A分析要点：品类认知与渗透、使用场景与行为、购买决策路径、品牌态度与忠诚度、需求痛点与未满足需求。",
  concept: "概念测试分析要点：概念理解度与传达效果、购买吸引力与转化意愿、卖点偏好排序、价格接受度、概念弱点与改进方向。",
  nps: "满意度/NPS分析要点：NPS得分与人群分布、满意度维度矩阵、驱动因素拆解、体验短板与贬损者痛点、改进优先级。",
  brand: "品牌健康度分析要点：品牌认知度、品牌漏斗、品牌形象感知地图、品牌流失与转换、品牌竞争力。",
  launch: "新品上市复盘分析要点：上市KPI达成率、认知-试用-复购漏斗、消费者体验评价、复购意愿与流失原因。",
  ad: "广告测试分析要点：广告回忆度与关键元素记忆、信息理解度与品牌关联、情感反应与喜好度、购买意愿影响。",
  mystery: "神秘客分析要点：整体体验评分与达标率、各环节体验拆解、服务标准执行率、问题定位与典型案例。"
};

const projectTypeLabels = {
  general: "通用定量研究",
  ua: "U&A",
  concept: "概念测试",
  nps: "满意度/NPS",
  brand: "品牌健康度",
  launch: "新品上市复盘",
  ad: "广告测试",
  mystery: "神秘客"
};

export function getProjectTypeGuidance(projectType) {
  const types = Array.isArray(projectType) ? projectType : [projectType];
  const hints = types.map((t) => projectTypeHints[t] || projectTypeHints.general).filter(Boolean);
  const typeLabel = types.map((t) => projectTypeLabels[t] || t).join(" + ");

  return {
    role: "你是一位拥有15年经验的资深市场研究总监，擅长将定量数据转化为商业洞察。",
    structure: [
      "报告采用三段式大框架：",
      "",
      "一、项目概述",
      "  核心结论 + 关键发现亮点（3-5条）+ 研究说明（1段带过）。",
      "",
      "二、主要研究发现",
      "  根据数据和项目类型自行组织章节。每个发现遵循金字塔结构。",
      "",
      "三、结论与建议",
      "  直接回答研究目标，给出分人群/分场景策略建议和优先级排序。",
      "",
      `【本次项目类型：${typeLabel}】`,
      "分析要点参考：",
      ...hints.map((h) => `  - ${h}`)
    ].join("\n")
  };
}

/* ─── 上下文格式化 ─── */
export function formatAiReportContext(context) {
  const typeLabels = Array.isArray(context.projectType)
    ? context.projectType.map((t) => projectTypeLabels[t] || t).join(" + ")
    : projectTypeLabels[context.projectType] || "通用定量研究";
  const required = [
    ["项目名称", context.projectName || "未填写"],
    ["项目类型", typeLabels],
    ["研究目标", context.objective || "未填写，请先基于数据提炼最可能的3个研究假设"]
  ];
  const optional = [
    ["核心假设", context.hypothesis],
    ["目标人群", context.targetAudience],
    ["数据时间", context.dataPeriod],
    ["品类背景", context.categoryContext],
    ["报告受众", context.audienceType],
    ["加权状态", context.weightingStatus]
  ].filter(([, v]) => v);
  return [
    "【项目背景信息】",
    ...required.map(([k, v]) => `- ${k}：${v}`),
    ...(optional.length ? ["", "【补充背景】", ...optional.map(([k, v]) => `- ${k}：${v}`)] : [])
  ].join("\n");
}

export function buildAiReportVariableNotes(dataContext) {
  if (!dataContext?.headerInfos?.length) return "未识别到关键变量说明。";
  const groups = dataContext.headerInfos.filter((h) => h.type === "group").map((h) => h.header).slice(0, 20);
  const questions = dataContext.headerInfos.filter((h) => h.type === "question").map((h) => h.header).slice(0, 30);
  return [
    "【关键变量说明】",
    `- 行/题目变量：${questions.length ? questions.join("、") : "未识别"}`,
    `- 列/分群变量：${groups.length ? groups.join("、") : "未识别"}`,
    "- 变量类型由系统自动识别，报告中需结合变量含义谨慎解读。"
  ].join("\n");
}

/* ─── Prompt 构建 ─── */
export function buildAiReportPrompt(context, summary, dataContext) {
  const contextText = formatAiReportContext(context);
  const variableNotes = buildAiReportVariableNotes(dataContext);
  const guidance = getProjectTypeGuidance(context.projectType);
  return [
    {
      role: "system",
      content: [
        guidance.role,
        "",
        "【六阶段报告生成流程】阶段1已由系统在本地完成，你负责阶段2-5：",
        "阶段2 洞察挖掘：关键发现、人群差异、反常与矛盾、弱信号。",
        "阶段3 自适应框架：基于项目类型组织报告。",
        "阶段4 分段撰写：金字塔结构——结论→数据支撑→业务解读→反常延伸。",
        "阶段5 整合审查：确保执行摘要与正文一致。",
        "",
        "【核心写作原则】",
        "- 数据引用精确到百分比（1位小数），标注基数N=XXX。",
        "- 洞察标题使用『四字标签+一句话解读』格式。",
        "- 未达显著差异的数据禁止说「显著高于」。",
        "- 禁止模板化过渡语。",
        "",
        "【输出纪律】直接输出报告正文，严禁对话过渡语。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        contextText,
        "",
        variableNotes,
        "",
        "【数据摘要】",
        summary,
        "",
        "【报告结构】",
        guidance.structure,
        "",
        "---",
        "",
        "## PPT 可视化脚本（必选）",
        "PPT脚本至少15-25页，用Markdown表格输出：| 页码 | 页面标题 | 图表类型建议 | 数据呈现要点 | 页面洞察话术 |"
      ].join("\n")
    }
  ];
}

/* ─── 数据摘要（本地统计） ─── */
export function summarizeRawDataForReport(dataContext) {
  if (!dataContext?.rawRows?.length) return null;
  const { rawRows, displayHeaders = [], headerInfos = [] } = dataContext;
  const totalN = rawRows.length;
  const lines = [`## 数据概览`, `- 样本量：N=${totalN}`, `- 字段数：${displayHeaders.length}`, ""];

  const questionHeaders = headerInfos.filter((h) => h.type === "question").slice(0, 12);
  if (questionHeaders.length) {
    lines.push(`## 各题频率分布（前${Math.min(questionHeaders.length, 12)}题）`);
    for (const h of questionHeaders) {
      const values = rawRows.map((r) => r[h.index]).filter((v) => v !== "" && v != null);
      const freq = {};
      for (const v of values) {
        const key = String(v).trim();
        freq[key] = (freq[key] || 0) + 1;
      }
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      lines.push(`### ${displayHeaders[h.index] || h.header}`);
      lines.push(`基数：${values.length}（${(values.length / totalN * 100).toFixed(1)}%）`);
      for (const [k, c] of sorted.slice(0, 8)) {
        lines.push(`- ${k}：${c}人（${(c / values.length * 100).toFixed(1)}%）`);
      }
      if (sorted.length > 8) lines.push(`- … 其他${sorted.length - 8}项省略`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/* ─── 生成入口 ─── */
export async function generateAiReport(context, dataContext, options = {}) {
  const settings = loadAiSettings();
  const summary = options.summary || summarizeRawDataForReport(dataContext);
  if (!summary) return { output: null, source: "数据不足", error: "无法生成有效统计摘要" };

  let output = summary;
  let source = "本地统计摘要";

  if (settings.mode !== "local") {
    const errors = validateAiSettings(settings);
    if (!errors.length) {
      try {
        const prompt = buildAiReportPrompt(context, summary, dataContext);
        output = await callAiChatCompletion(settings, prompt, {
          maxTokens: 8000,
          timeoutMs: 180000,
          stream: true,
          onProgress: options.onProgress
        });
        source = aiProviderPresets[settings.provider]?.name || "大模型";
      } catch (error) {
        output = `## 数据摘要（本地生成）\n\n${summary}\n\n---\n\n> 大模型调用失败：${error.message}`;
        source = "本地统计摘要（模型调用失败）";
      }
    } else {
      output = `## 数据摘要（本地生成）\n\n${summary}\n\n---\n\n> 设置未通过校验：${errors.join("；")}`;
      source = "本地统计摘要（设置未通过校验）";
    }
  }

  state.lastAiReport = output;
  return { output, source };
}

/* ─── 导出辅助 ─── */
export function createAiReportPptMarkdown(markdown, context = {}) {
  const projectName = context.projectName || "AI定量研究报告";
  const projectType = Array.isArray(context.projectType)
    ? context.projectType.join(" / ")
    : context.projectType || "定量研究";
  const cleanMarkdown = String(markdown || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^好的[，,][\s\S]{0,220}?---\s*/m, "")
    .trim();
  return [
    `# ${projectName}`,
    "",
    "## 报告信息",
    `- 项目类型：${projectType}`,
    `- 研究目标：${context.objective || "基于数据输出核心发现与行动建议"}`,
    `- 目标人群：${context.targetAudience || "目标样本"}`,
    "",
    "## 核心输出",
    "- 数据结构与样本概况",
    "- 总体结果与关键指标",
    "- 主要分群差异",
    "- 业务解释与行动建议",
    "",
    cleanMarkdown
  ].join("\n");
}
