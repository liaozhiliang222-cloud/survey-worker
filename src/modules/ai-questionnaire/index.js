/**
 * AI 问卷设计模块
 * 提取自 app.js — 问卷生成核心逻辑
 */
import { state } from "../../shared/store.js";
import { loadAiSettings, validateAiSettings, callAiChatCompletion, aiProviderPresets } from "../../shared/ai-client.js";

/* ─── 研究类型标签 ─── */
export const aiStudyTypeLabels = {
  concept: "概念/新品测试",
  ua: "U&A 使用与态度",
  satisfaction: "满意度/NPS",
  brand: "品牌健康度",
  pricing: "价格研究/PSM",
  kano: "KANO 需求分类",
  maxdiff: "MaxDiff 偏好排序",
  launch: "新品上市复盘",
  ad: "广告/传播测试",
  segmentation: "用户分群/画像",
  mystery: "神秘客/体验审计"
};

export function aiStudyTypeValues(typeOrTypes) {
  const values = Array.isArray(typeOrTypes)
    ? typeOrTypes
    : String(typeOrTypes || "").split(/[,，、]/);
  const valid = values.map((v) => String(v).trim()).filter((v) => aiStudyTypeLabels[v]);
  return valid.length ? Array.from(new Set(valid)) : ["concept"];
}

export function aiStudyTypeName(type) {
  if (Array.isArray(type)) return aiStudyTypeValues(type).map((v) => aiStudyTypeLabels[v] || v).join("、");
  return aiStudyTypeLabels[type] || "定量调研";
}

/* ─── 题量目标 ─── */
export function targetAiQuestionCount(studyTypes, lengthMode = "long") {
  const selectedTypeCount = aiStudyTypeValues(studyTypes).length;
  if (lengthMode === "short") {
    const target = Math.min(36, 29 + Math.max(0, selectedTypeCount - 1) * 3);
    return { min: Math.max(25, target - 4), max: Math.min(40, target + 5), target, level: "精简短卷" };
  }
  const target = Math.min(64, 54 + Math.max(0, selectedTypeCount - 1) * 5);
  return { min: Math.max(48, target - 5), max: Math.min(70, target + 6), target, level: "专业长卷" };
}

/* ─── 问卷题目构建 ─── */
export function aiQuestion(code, type, title, options, note = "") {
  return { code, type, title, options, note };
}

export function uniqueAiQuestions(questions) {
  const seen = new Set();
  return questions.filter((q) => {
    const key = `${q.type}|${q.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recodeAiBodyQuestions(questions) {
  const counters = { Q: 0, RS: 0, N: 0, NPS: 0, K: 0, OE: 0 };
  return questions.map((q) => {
    let prefix = "Q";
    if (/开放/.test(q.type)) prefix = "OE";
    else if (/NPS/.test(q.type)) prefix = "NPS";
    else if (/KANO/.test(q.type)) prefix = "K";
    else if (/数值/.test(q.type)) prefix = "N";
    else if (/量表|矩阵/.test(q.type)) prefix = "RS";
    counters[prefix] += 1;
    return { ...q, code: `${prefix}${counters[prefix]}` };
  });
}

/* ─── 本地问卷初稿 ─── */
export function buildLocalQuestionnaire(config = {}) {
  const projectName = config.project || "调研项目";
  const studyName = aiStudyTypeName(config.studyTypes || config.studyType);
  const audience = config.audience || "目标品类用户";
  const target = targetAiQuestionCount(config.studyTypes || config.studyType, config.lengthMode);
  const lines = [
    `# ${projectName} 调研问卷`,
    "",
    "## 一、问卷说明与编程约定",
    `- 研究类型：${studyName}`,
    `- 目标人群：${audience}`,
    `- 目标样本量：N=${config.sampleSize || 400}`,
    `- 问卷模式：${target.level}（约${target.min}-${target.max}题）`,
    "- 题号体系：S=甄别、Q=单选/多选、RS=量表/矩阵、N=数值、OE=开放",
    "- 所有选项需编码；标注跳题、终止、随机、轮换、排他、置底规则",
    "",
    "## 二、问卷正文",
    "",
    "### 模块A：开场白与甄别",
    "| 编码 | 题型 | 题目 | 选项 | 逻辑与备注 |",
    "|---|---|---|---|---|",
    "| S1 | 单选 | 请问您的年龄是？ | 18岁以下/18-24/25-29/30-34/35-39/40-44/45-54/55+ | 按目标人群条件设置终止 |",
    "| S2 | 单选 | 您目前长期居住在哪类地区？ | 一线/新一线/二线/三线/四线及以下 | 按地域配额设置终止 |",
    "| S3 | 单选 | 过去3个月您是否购买/使用过该品类？ | 是/否 | 否→终止或跳转潜在用户路径 |",
    "",
    "### 模块B：品类行为与场景",
    "（根据研究类型展开品类使用频率、场景、渠道等基础行为题）",
    "",
    "### 模块C：核心研究模块",
    `（围绕${studyName}展开核心诊断题目）`,
    "",
    "### 模块D：转化/价格/功能评价",
    "（购买意愿、价格接受度、功能偏好等）",
    "",
    "### 模块E：背景信息",
    "| 编码 | 题型 | 题目 | 选项 | 逻辑与备注 |",
    "|---|---|---|---|---|",
    "| Q_END1 | 单选 | 您的性别？ | 男/女 | 置底 |",
    "| Q_END2 | 单选 | 家庭月收入？ | 按档位设置 | 置底 |",
    "",
    "### 模块F：结束语",
    "感谢您的参与！",
    "",
    "## 三、质量自查清单",
    "- [ ] 甄别题未直接暴露招募标准",
    "- [ ] 选项互斥且穷尽",
    "- [ ] 量表端点完整",
    "- [ ] 跳题逻辑闭环",
    "- [ ] 排他项已标注"
  ];
  return lines.join("\n");
}

/* ─── Prompt 构建 ─── */
export function buildAiQuestionnairePrompt(config = {}) {
  const target = targetAiQuestionCount(config.studyTypes || config.studyType, config.lengthMode);
  const localDraft = buildLocalQuestionnaire(config);
  return [
    {
      role: "system",
      content: [
        "你是一名资深市场研究问卷设计专家，输出质量须对齐主流专业调研公司的正式定量问卷交付习惯。必须使用中文。",
        "直接从Markdown一级标题开始输出，第一行必须是『# 项目名称 调研问卷』。不要写开场白或推理过程。",
        "甄别题不得直接询问受访者是否属于目标人群，必须拆成可回忆、可验证的客观问题。",
        "主体问卷必须围绕业务决策形成完整链路。",
        "题目与选项必须具体、全面、互斥且尽量穷尽。",
        "每道选择题必须包含三列表格：编码、选项内容、逻辑与备注。"
      ].join("")
    },
    {
      role: "user",
      content: [
        `项目名称/背景：${config.project || "未命名调研项目"}`,
        `研究类型：${aiStudyTypeName(config.studyTypes || config.studyType)}`,
        `目标人群：${config.audience || "目标品类用户"}`,
        `目标样本量：N=${config.sampleSize || 400}`,
        `问卷模式：${config.lengthMode === "short" ? "精简短卷" : "专业长卷"}`,
        `完整度建议：${target.level}，建议约${target.min}-${target.max}个主问题编号`,
        "",
        "研究需求：",
        config.brief || "用户未填写详细需求，请根据项目背景主动推导。",
        "",
        "可参考的本地初稿：",
        localDraft
      ].join("\n")
    }
  ];
}

/* ─── 输出清洗 ─── */
export function sanitizeAiQuestionnaireOutput(output) {
  let text = String(output || "").trim();
  text = text.replace(/^好的[，,。\s\S]*?(?=\n(?:---\n)?\s*(?:#{1,5}\s+|\*\*|一、|[^\n]{2,40}调研问卷))/m, "");
  text = text.replace(/^作为[^\n]{0,100}(?:专家|顾问)[^\n]*\n+/, "");
  text = text.replace(/^我将[^\n]*\n+/, "");
  text = text.replace(/^\s*(?:思考过程|设计思路|问卷思考过程|分析过程)[:：][\s\S]*?(?=\n(?:---\n)?\s*(?:#{1,5}\s+|\*\*|一、|[^\n]{2,40}调研问卷))/m, "");
  text = text.replace(/^\s*---\s*/, "");

  const firstBody = text.search(/^(?:#{1,5}\s+|\*\*[^*\n]{2,80}(?:问卷|测试)[^*\n]*\*\*|[^\n]{2,60}调研问卷|一、问卷说明)/m);
  if (firstBody > 0) {
    const intro = text.slice(0, firstBody).trim();
    if (/^(好的|作为|我将|以下|下面|根据|本问卷|问卷将)/.test(intro) || intro.length < 260) {
      text = text.slice(firstBody).trim();
    }
  }

  return text.replace(/\n{3,}/g, "\n\n").trim() || output;
}

/* ─── 生成入口 ─── */
export async function generateAiQuestionnaire(config, options = {}) {
  const settings = loadAiSettings();
  const localDraft = buildLocalQuestionnaire(config);
  let output = localDraft;
  let source = "本地规则";

  if (settings.mode !== "local") {
    const errors = validateAiSettings(settings);
    if (!errors.length) {
      try {
        output = await callAiChatCompletion(settings, buildAiQuestionnairePrompt(config), {
          maxTokens: 32000,
          timeoutMs: config.lengthMode === "long" ? 600000 : 360000,
          stream: true,
          onProgress: options.onProgress
        });
        source = aiProviderPresets[settings.provider]?.name || "大模型";
      } catch (error) {
        output = `${localDraft}\n\n---\n\n> 大模型调用失败，已回退为本地初稿。错误信息：${error.message}`;
        source = "本地规则（模型调用失败）";
      }
    } else {
      output = `${localDraft}\n\n---\n\n> 大模型设置未通过校验：${errors.join("；")}`;
      source = "本地规则（设置未通过校验）";
    }
  }

  output = sanitizeAiQuestionnaireOutput(output);
  state.lastAiQuestionnaireText = output;
  return { output, source };
}
