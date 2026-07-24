/**
 * AI 方案设计模块
 * 提取自 app.js — 调研方案生成核心逻辑
 */
import { state } from "../../shared/store.js";
import { loadAiSettings, validateAiSettings, callAiChatCompletion, aiProviderPresets } from "../../shared/ai-client.js";

/* ─── 研究类型配置 ─── */
export const aiPlanStudyTypes = {
  concept: "概念/新品测试",
  ua: "U&A 使用与态度",
  satisfaction: "满意度/NPS",
  brand: "品牌健康度",
  pricing: "价格研究/PSM",
  launch: "新品上市复盘",
  ad: "广告/传播测试",
  segmentation: "用户分群/画像",
  mystery: "神秘客/体验审计"
};

export function aiPlanStudyTypeName(type) {
  return aiPlanStudyTypes[type] || "定量调研";
}

/* ─── 方案框架映射 ─── */
const aiPlanFrameworks = {
  concept: { name: "概念测试漏斗", models: ["概念理解", "吸引力", "购买意愿", "卖点取舍"], output: "概念优化方向与上市可行性判断" },
  ua: { name: "U&A 全链路", models: ["品类渗透", "使用场景", "品牌转换", "需求缺口"], output: "品类机会与品牌策略建议" },
  satisfaction: { name: "满意度驱动模型", models: ["NPS", "重要性-表现矩阵", "关键驱动分析"], output: "体验短板定位与改进优先级" },
  brand: { name: "品牌漏斗", models: ["认知漏斗", "品牌形象", "品牌资产"], output: "品牌竞争力评估与提升路径" },
  pricing: { name: "价格策略模型", models: ["PSM", "Gabor-Granger", "BPTO"], output: "最优价格区间与定价策略" },
  launch: { name: "上市复盘漏斗", models: ["认知-试用-复购", "KPI 达成", "渠道表现"], output: "上市效果诊断与二次推广建议" },
  ad: { name: "广告效果模型", models: ["回忆度", "信息传达", "情感反应", "行为影响"], output: "广告优化方向与媒介策略" },
  segmentation: { name: "分群画像模型", models: ["聚类分析", "RFM", "潜在类别"], output: "目标人群优先级与差异化策略" },
  mystery: { name: "体验审计模型", models: ["环节达标率", "服务蓝图", "NPS"], output: "服务短板与标准化改进方案" }
};

export function aiPlanPrimaryFramework(studyType) {
  return aiPlanFrameworks[studyType] || aiPlanFrameworks.concept;
}

export function aiPlanAdditionalModuleNames(modules) {
  if (!modules) return [];
  const list = Array.isArray(modules) ? modules : String(modules).split(/[,，、]/);
  return list.map((m) => aiPlanStudyTypes[String(m).trim()] || String(m).trim()).filter(Boolean);
}

/* ─── 本地方案生成 ─── */
export function buildBriefAiResearchPlan(config = {}) {
  const framework = aiPlanPrimaryFramework(config.studyType);
  const audience = config.audience || "目标品类用户";
  const sampleSize = config.sampleSize || 400;
  const timeline = config.timeline || "2-3 周";
  const constraints = config.constraints || "无特殊限制";
  return [
    `# ${config.project || "调研项目"} 研究方案`,
    "",
    "## 1. 研究背景与目标",
    `- 业务背景：${config.brief || "待补充"}`,
    `- 核心目标：围绕${framework.name}回答关键业务决策问题`,
    `- 目标人群：${audience}`,
    `- 建议样本量：N=${sampleSize}`,
    "",
    "## 2. 研究方法",
    `- 主线方法：定量问卷（在线/CAWI）`,
    `- 分析框架：${framework.name}`,
    `- 核心模型：${framework.models.join("、")}`,
    "",
    "## 3. 研究内容",
    `| 模块 | 关键内容 | 输出价值 |`,
    "|---|---|---|",
    ...framework.models.map((m) => `| ${m} | 围绕核心业务指标设置问题 | 形成可用于业务判断的指标和行动建议 |`),
    "",
    "## 4. 执行与交付",
    `- 项目周期：${timeline}`,
    `- 交付物：数据表、分析报告（Word/PPT）、原始数据`,
    `- 特殊要求：${constraints}`
  ].join("\n");
}

export function buildDetailedAiResearchPlan(config = {}) {
  const framework = aiPlanPrimaryFramework(config.studyType);
  const modules = framework.models;
  const audience = config.audience || "目标品类用户";
  const sampleSize = config.sampleSize || 400;
  const timeline = config.timeline || "3-4 周";
  const constraints = config.constraints || "无特殊限制";
  return [
    `# ${config.project || "调研项目"} 研究方案`,
    "",
    "## 1. 项目背景与决策需求",
    `- 业务背景：${config.brief || "待补充"}`,
    `- 需要支持的决策：产品/品牌/渠道/传播策略优化`,
    `- 目标人群：${audience}`,
    `- 建议样本量：N=${sampleSize}`,
    "",
    "## 2. 研究目标",
    ...modules.slice(0, 5).map((m, i) => `${i + 1}. 评估${m}相关指标，形成可执行建议`),
    "",
    "## 3. 研究内容与分析框架",
    "| 模块 | 关键内容 | 输出价值 |",
    "|---|---|---|",
    ...modules.slice(0, 7).map((module) => `| ${module} | 围绕用户行为、态度评价、竞争对标或决策因素设置问题 | 形成可用于业务判断的指标和行动建议 |`),
    `| ${framework.name} | ${framework.models.join("、")} | ${framework.output} |`,
    "",
    "## 4. 执行流程与质量控制",
    "| 阶段 | 工作内容 | 质量控制 |",
    "|---|---|---|",
    "| 方案确认 | 明确研究目标、样本边界、核心指标和交付口径 | 与业务方确认研究问题和样本条件 |",
    "| 问卷设计 | 输出问卷初稿、编码表、跳题和随机规则 | 上线前检查题号、逻辑、排他项、开放题说明 |",
    "| 数据回收 | 执行问卷发放并监控样本结构 | 控制答题时长、注意力检测、直线作答和异常样本 |",
    "| 数据处理 | 清洗、编码、加权、生成交叉表 | 复核缺失值、逻辑矛盾、显著性和加权影响 |",
    "| 分析交付 | 输出核心发现和业务建议 | 结论需由数据证据支撑，避免只做描述性罗列 |",
    "",
    "- 特殊要求：" + constraints,
    "",
    "## 5. 项目周期",
    `- 当前周期要求：${timeline}`,
    "- 建议排期：方案确认 1-2 天，问卷设计与质检 2-3 天，数据回收 3-7 天，清洗制表 1-2 天，报告分析 3-5 天。"
  ].join("\n");
}

export function buildLocalAiResearchPlan(config = {}) {
  return config.mode === "detailed" ? buildDetailedAiResearchPlan(config) : buildBriefAiResearchPlan(config);
}

/* ─── Prompt 构建 ─── */
export function buildAiResearchPlanPrompt(config = {}) {
  const framework = aiPlanPrimaryFramework(config.studyType);
  const additionalModuleNames = aiPlanAdditionalModuleNames(config.additionalModules);
  const audience = config.audience || "未填写；请根据业务背景推导";
  const sampleSize = config.sampleSize ? `N=${config.sampleSize}` : "未填写；请给出建议值并说明依据";
  const timeline = config.timeline || "未填写；请给出合理排期建议";
  const constraints = config.constraints || "未填写";
  const project = config.project || "未填写";
  return [
    {
      role: "system",
      content: [
        "你是一名资深市场研究方案架构师，擅长把清晰或模糊的业务需求转化为策略层面可执行的调研方案，输出中文 Markdown。",
        "直接从方案标题开始输出，不要写开场白或推理过程。",
        "需求信息模糊时，应结合行业常规做合理推断并继续生成。",
        "只保留能直接支持业务决策的必要模块。",
        "研究方法必须说明选择理由和阶段关系。"
      ].join("")
    },
    {
      role: "user",
      content: [
        `项目名称/场景：${project}`,
        `方案模式：${config.mode === "detailed" ? "详细方案" : "简要方案"}`,
        `核心研究模块：${aiPlanStudyTypeName(config.studyType)}`,
        `附加研究模块：${additionalModuleNames.join("、") || "未选择"}`,
        `研究主线参考：${framework.name}`,
        `可能适用的分析模型：${framework.models.join("、")}`,
        `目标人群：${audience}`,
        `建议样本量：${sampleSize}`,
        `项目周期：${timeline}`,
        `特殊要求：${constraints}`,
        "",
        "用户需求：",
        config.brief || "用户暂未填写详细需求，请基于输入字段生成一版通用但可执行的方案。"
      ].join("\n")
    }
  ];
}

export function buildAiPlanRevisionPrompt(instruction, currentDraft) {
  return [
    {
      role: "system",
      content: "你是一名资深市场研究方案架构师。请根据用户修改意见修订方案，直接输出修订后的完整方案 Markdown。"
    },
    {
      role: "user",
      content: [
        "修改意见：",
        instruction,
        "",
        "当前方案：",
        currentDraft
      ].join("\n")
    }
  ];
}

/* ─── 输出清洗 ─── */
export function sanitizeAiPlanOutput(output) {
  let text = String(output || "").trim();
  text = text.replace(/^好的[，,。\s\S]*?(?=\n#{1,3}\s+)/, "");
  text = text.replace(/^作为[^\n]{0,80}(?:专家|顾问)[^\n]*\n+/, "");
  text = text.replace(/^我将[^\n]*\n+/, "");
  text = text.replace(/^\s*(?:思考过程|分析过程|方案思考过程|我的思路)[:：][\s\S]*?(?=\n#{1,3}\s+)/, "");

  const firstHeading = text.search(/^#{1,3}\s+/m);
  if (firstHeading > 0) {
    const intro = text.slice(0, firstHeading).trim();
    if (/^(好的|作为|我将|以下|下面|根据|首先|本方案|方案将)/.test(intro) || intro.length < 220) {
      text = text.slice(firstHeading).trim();
    }
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text || output;
}

/* ─── 生成入口（含 DOM 交互） ─── */
export async function generateAiPlan(config, options = {}) {
  const settings = loadAiSettings();
  const localPlan = buildLocalAiResearchPlan(config);
  let output = localPlan;
  let source = "本地方案框架";

  if (settings.mode !== "local") {
    const errors = validateAiSettings(settings);
    if (!errors.length) {
      try {
        const maxTokens = config.mode === "detailed" ? 12000 : 5000;
        output = await callAiChatCompletion(settings, buildAiResearchPlanPrompt(config), { maxTokens });
        source = settings.apiKey ? (aiProviderPresets[settings.provider]?.name || "大模型") : "平台内置免费模型";
      } catch (error) {
        output = `${localPlan}\n\n---\n\n> 大模型调用失败，已回退为本地方案框架。错误信息：${error.message}`;
        source = "本地方案框架（模型调用失败）";
      }
    } else {
      output = `${localPlan}\n\n---\n\n> 大模型设置未通过校验：${errors.join("；")}`;
      source = "本地方案框架（设置未通过校验）";
    }
  }

  output = sanitizeAiPlanOutput(output);
  state.lastAiPlan = output;
  return { output, source };
}
