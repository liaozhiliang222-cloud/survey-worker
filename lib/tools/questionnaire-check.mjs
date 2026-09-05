import { ToolInputError } from "./errors.mjs";

export const QUESTIONNAIRE_CHECK_TOOL_ID = "questionnaire-check";
export const QUESTIONNAIRE_SCENARIO_LABELS = Object.freeze({
  general: "通用上线质检",
  concept: "概念测试",
  ua: "U&A 使用与态度研究",
  satisfaction: "满意度 / NPS",
  psm: "价格研究 / PSM",
  kanoMaxdiff: "KANO / MaxDiff",
});

const typoRules = [
  ["请选则", "疑似错字：请选则", "建议改为“请选择”。"],
  ["瓶牌", "疑似错字：瓶牌", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["牌品", "疑似错字：牌品", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["品脾", "疑似错字：品脾", "如果这里指品牌名称或品牌选择，建议改为“品牌”。"],
  ["产牌", "疑似错字：产牌", "如果这里指产品或品牌，请确认是否应改为“品牌”或“产品”。"],
  ["登陆", "用词不统一：登陆", "如指账号操作，建议统一为“登录”。"],
  ["帐号", "用词不统一：帐号", "建议与项目标准统一，常见写法为“账号”。"],
  ["价钱", "口语化表述：价钱", "价格研究中建议统一为“价格”。"],
  ["非常满", "疑似漏字：非常满", "请确认是否应为“非常满意”。"],
  ["比交", "疑似错字：比交", "请确认是否应为“比较”。"],
  ["添写", "疑似错字：添写", "请确认是否应为“填写”。"],
  ["是否愿意购买吗", "句式重复", "建议改为“您是否愿意购买？”或“您愿意购买吗？”。"],
];

export function normalizeQuestionnaireId(value) {
  const text = String(value || "").trim().replace(/[＊*]/g, "").replace(/[－—–]/g, "-").replace(/\s+/g, "");
  if (!text) return "";
  const match = text.match(/^([A-Za-z]*)(\d+)(?:[-_](\d+))?$/);
  if (!match) return text.toUpperCase().replace(/-/g, "_");
  const prefix = (match[1] || "Q").toUpperCase();
  return match[3] ? `${prefix}${match[2]}_${match[3]}` : `${prefix}${match[2]}`;
}

export function parseQuestionnaire(text) {
  const questions = [];
  let current = null;
  String(text || "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const structuredMatch = trimmed.match(/^([A-Za-z]*\d+(?:[-_]\d+)?[＊*]?)\s*[.．、]\s*(.+)$/);
    const prefixedMatch = trimmed.match(/^(Q|S|A|B|C|D|题)\s*(\d+(?:[-_]\d+)?)[\.、\s]/i);
    const numericMatch = trimmed.match(/^(\d+(?:[-_]\d+)?)[\.、\s](.+)$/);
    const looksLikeQuestion = numericMatch && /[？?]|请|您|是否|哪|什么|如何|多少|为什么|评价|打分|选择/.test(numericMatch[2]);
    const structuredLooksLikeQuestion = structuredMatch && /[？?]|请|您|是否|哪|什么|如何|多少|为什么|评价|打分|选择|隐藏题/.test(structuredMatch[2]);
    const questionMatch = structuredLooksLikeQuestion ? structuredMatch : prefixedMatch || (looksLikeQuestion ? numericMatch : null);
    if (questionMatch) {
      const rawId = structuredLooksLikeQuestion ? questionMatch[1] : prefixedMatch ? `${questionMatch[1]}${questionMatch[2]}` : questionMatch[1];
      const id = normalizeQuestionnaireId(rawId.replace(/^题/i, "Q"));
      current = { id, prefix: id.match(/^[A-Z]+/)?.[0] || "Q", number: Number(id.match(/\d+/)?.[0] || 0), display: id, title: trimmed, line: index + 1, options: [], lines: [trimmed] };
      questions.push(current);
      return;
    }
    if (!current || !trimmed) return;
    current.lines.push(trimmed);
    const optionMatch = trimmed.match(/^([A-Z]|[0-9]+)[\.、\)]\s*(.+)$/i);
    if (optionMatch) current.options.push({ key: optionMatch[1], text: optionMatch[2].trim(), line: index + 1 });
  });
  return questions;
}

function issueType(title) {
  if (/跳题|条件/.test(title)) return "logic";
  if (/题号|缺少问卷稿|未识别/.test(title)) return "structure";
  if (/场景模板/.test(title)) return "scenario";
  return "content";
}

function addIssue(issues, severity, title, detail, evidence = "") {
  const question = title.match(/\b(?:Q|S|A|B|C|D)\d+(?:_\d+)?\b/i)?.[0]?.toUpperCase() || null;
  issues.push({ type: issueType(title), level: severity === "high" ? "error" : "warning", severity, question, title, message: detail, detail, evidence });
}

function addScenarioIssues(issues, questions, text, scenario) {
  if (!scenario || scenario === "general" || !text.trim()) return;
  const fullText = text.replace(/\s+/g, "");
  const hasAny = (patterns) => patterns.some((pattern) => pattern.test(fullText));
  const add = (severity, title, detail, evidence = QUESTIONNAIRE_SCENARIO_LABELS[scenario]) => addIssue(issues, severity, `场景模板：${title}`, detail, evidence);
  if (scenario === "concept") {
    if (!hasAny([/概念|方案|创意|产品介绍|刺激物|图片|视频|文案/])) add("low", "概念材料呈现需确认", "概念测试通常需要明确概念材料、展示顺序和受访者阅读/观看要求。");
    if (!hasAny([/喜欢|吸引|独特|相关|可信|理解|清晰|购买意愿|尝试意愿/])) add("medium", "缺少概念评价维度", "建议覆盖吸引力、独特性、相关性、可信度、理解度或购买/尝试意愿等核心指标。");
    if (!hasAny([/为什么|原因|请说明|开放|改进|不喜欢/])) add("low", "缺少原因追问", "概念测试建议为核心评价题配置原因追问，方便解释高低分。");
  }
  if (scenario === "ua") {
    if (!hasAny([/使用频率|多久|每周|每月|频次|最近一次/])) add("medium", "缺少使用频率题", "U&A 研究通常需要识别品类或产品使用频率，用于区分轻中重度用户。");
    if (!hasAny([/使用场景|场合|什么时候|地点|用途|需求|动机/])) add("low", "缺少使用场景或需求题", "建议补充使用场景、需求动机或任务场景，方便后续人群和机会点分析。");
    if (!hasAny([/品牌|竞品|常用|购买过|使用过|知晓|考虑/])) add("medium", "缺少品牌/竞品使用题", "U&A 通常需要覆盖品牌知晓、使用、常用或购买关系，便于识别竞争格局。");
  }
  if (scenario === "satisfaction") {
    if (!hasAny([/满意度|满意|NPS|推荐|推荐意愿|净推荐/])) add("medium", "缺少总体满意度或 NPS", "满意度/NPS 项目建议至少包含总体满意度、推荐意愿或核心评价指标。");
    if (!hasAny([/原因|为什么|请说明|开放|不满意|改进/])) add("low", "缺少低分原因追问", "建议对低满意或低推荐人群设置原因追问，方便定位问题来源。");
    if (!hasAny([/服务|价格|质量|体验|配送|售后|功能|包装|门店|客服/])) add("low", "缺少细分维度评价", "建议加入产品、服务、价格、体验等细分维度，便于做驱动分析和改进排序。");
  }
  if (scenario === "psm") {
    const complete = /太便宜|便宜到怀疑|担心质量|质量问题/.test(fullText) && /便宜|划算|乐意购买|物超所值/.test(fullText) && /贵但|比较贵|可以接受|还能接受/.test(fullText) && /太贵|不会买|不考虑购买/.test(fullText);
    if (!complete) add("medium", "PSM 四类价格题不完整", "价格敏感度研究建议同时包含“太便宜、比较便宜、比较贵、太贵”四类价格问题。");
    if (!questions.some((question) => /价格|金额|元|预算/.test(question.lines.join("")))) add("low", "价格题单位需确认", "建议明确价格单位、区间或填写格式，例如“元/件”或“请输入整数”。");
  }
  if (scenario === "kanoMaxdiff") {
    const hasKano = /KANO|正向|反向|如果具备|如果不具备|满意|不满意/.test(fullText);
    const hasMaxdiff = /MaxDiff|best.?worst|最想|最不想|最重要|最不重要|最佳|最差/.test(fullText);
    if (!hasKano && !hasMaxdiff) { add("medium", "未识别到 KANO 或 MaxDiff 结构", "KANO 需成对正反向题，MaxDiff 需出现最佳/最差或最想/最不想选择任务。"); return; }
    if (hasKano && !(/正向|如果具备|满意/.test(fullText) && /反向|如果不具备|不满意/.test(fullText))) add("medium", "KANO 正反向题需成对", "每个属性建议同时配置具备时和不具备时的反应题，避免无法分类属性。");
    if (hasMaxdiff && !/(最想|最佳|最重要|best)/i.test(fullText)) add("low", "MaxDiff 缺少 Best 选择说明", "MaxDiff 题组建议明确要求选择最偏好/最重要的一项。");
    if (hasMaxdiff && !/(最不想|最差|最不重要|worst)/i.test(fullText)) add("low", "MaxDiff 缺少 Worst 选择说明", "MaxDiff 题组建议明确要求选择最不偏好/最不重要的一项。");
  }
}

export function checkQuestionnaire(input = {}) {
  const text = String(input.text ?? input.questionnaire_text ?? "");
  const scenario = String(input.scenario || "general");
  if (!Object.hasOwn(QUESTIONNAIRE_SCENARIO_LABELS, scenario)) throw new ToolInputError("研究场景无效。", "INVALID_INPUT", { field: "scenario" });
  if (text.length > 500_000) throw new ToolInputError("问卷稿超过 500,000 字符，请拆分后检查。", "INPUT_LIMIT_EXCEEDED", { field: "text" });
  const issues = [];
  const questions = parseQuestionnaire(text);
  const questionIds = questions.map((question) => question.id);
  const questionSet = new Set(questionIds);
  if (!text.trim()) addIssue(issues, "high", "缺少问卷稿", "请先粘贴问卷题目、选项和跳题说明，再运行质检。");
  else {
    if (!questions.length) addIssue(issues, "high", "未识别到题号", "建议使用 Q1、S1、A1、1. 或“题1”这类明确题号，方便检查跳题引用和题号连续性。");
    [...new Set(questionIds.filter((id, index) => questionIds.indexOf(id) !== index))].forEach((id) => addIssue(issues, "high", `题号重复：${id}`, "重复题号会导致跳题配置和数据字段混乱。", id));
    const groups = questions.reduce((result, question) => { (result[question.prefix || "Q"] ||= []).push(question); return result; }, {});
    Object.values(groups).forEach((group) => {
      if (group.length <= 1) return;
      const sorted = [...new Set(group.map((question) => question.number))].sort((left, right) => left - right);
      const prefix = group[0].prefix;
      for (let number = sorted[0]; number <= sorted.at(-1); number += 1) if (!questionSet.has(`${prefix}${number}`)) addIssue(issues, "medium", `题号缺失：${prefix}${number}`, "请确认是故意跳过，还是问卷稿漏题。", `${prefix}${number}`);
    });
    for (const match of text.matchAll(/(?:跳至|跳到|转至|进入|goto)\s*(Q|S|A|B|C|D|题)?\s*(\d+)/gi)) {
      const rawPrefix = match[1] ? match[1].toUpperCase() : "";
      const prefix = rawPrefix === "题" ? "Q" : rawPrefix;
      const number = Number(match[2]);
      const sameNumber = questions.filter((question) => question.number === number);
      if (!(questionSet.has(`${prefix}${number}`) || (!prefix && sameNumber.length === 1))) addIssue(issues, "high", `跳题目标不存在：${prefix || ""}${number}`, "跳题引用的目标题号没有在问卷稿中出现，上线后可能中断路径。", match[0]);
    }
    for (const match of text.matchAll(/如果\s*(Q|S|A|B|C|D|题)?\s*(\d+)\s*选择\s*([A-Z0-9]+)[，,、\s]*(?:则)?\s*(?:跳至|跳到|转至|进入)\s*(Q|S|A|B|C|D|题)?\s*(\d+)/gi)) {
      const sourcePrefix = (match[1]?.toUpperCase() === "题" ? "Q" : match[1]?.toUpperCase()) || "";
      const sourceNumber = Number(match[2]);
      const optionKey = match[3].toUpperCase();
      const targetPrefix = (match[4]?.toUpperCase() === "题" ? "Q" : match[4]?.toUpperCase()) || "";
      const targetNumber = Number(match[5]);
      const sources = questions.filter((question) => question.number === sourceNumber && (!sourcePrefix || question.prefix === sourcePrefix));
      const targets = questions.filter((question) => question.number === targetNumber && (!targetPrefix || question.prefix === targetPrefix));
      const source = sources.length === 1 ? sources[0] : null;
      if (!source) { addIssue(issues, "high", `条件跳题来源不存在：${sourcePrefix}${sourceNumber}`, "条件跳题引用的来源题没有在问卷稿中唯一识别到，请确认题号。", match[0]); continue; }
      if (!source.options.some((option) => option.key.toUpperCase() === optionKey)) addIssue(issues, "high", `${source.display} 条件选项不存在：${optionKey}`, "条件跳题引用的选项没有在该题选项中出现，上线后可能导致路径配置错误。", match[0]);
      if (!targets.length) addIssue(issues, "high", `条件跳题目标不存在：${targetPrefix}${targetNumber}`, "条件跳题的目标题号没有在问卷稿中出现。", match[0]);
      if (targets.length && targetNumber <= source.number) addIssue(issues, "low", `${source.display} 条件跳题方向需确认`, "跳题目标不在来源题之后，可能是回跳、循环或题号引用错误。", match[0]);
    }
    questions.forEach((question) => {
      const texts = question.options.map((option) => option.text.replace(/\s+/g, ""));
      [...new Set(texts.filter((option, index) => texts.indexOf(option) !== index))].forEach((option) => addIssue(issues, "medium", `${question.display} 选项重复`, "重复选项会影响受访者理解和后续数据编码。", option));
      question.options.forEach((option) => {
        if (/其他/.test(option.text) && !/(请注明|注明|填空|填写|开放|____|：|:)/.test(option.text)) addIssue(issues, "medium", `${question.display} “其他”缺少说明`, "如果需要收集开放答案，建议写明“其他，请注明”；如果不收集，请确认平台配置。", option.text);
        if (/(以上都没有|以上均无|都没有|无|没有)/.test(option.text) && !/(互斥|排他|单独显示|固定)/.test(question.lines.join(""))) addIssue(issues, "medium", `${question.display} 排他选项需确认`, "“以上都没有/无”等选项通常需要设置为互斥或固定位置。", option.text);
      });
      if (/(随机|轮换|random|rotate)/i.test(question.lines.join("")) && /(其他|以上|无|不知道|拒答)/.test(question.lines.join(""))) addIssue(issues, "low", `${question.display} 随机/轮换规则需确认`, "含“其他/以上都没有/不知道”等特殊选项时，建议明确哪些选项不参与随机或固定在末尾。", question.lines.join("\n"));
    });
    typoRules.forEach(([needle, title, detail]) => { if (text.includes(needle)) addIssue(issues, "low", title, detail, needle); });
    if (/1\s*[=＝]\s*非常满意/.test(text) && /5\s*[=＝]\s*非常满意/.test(text)) addIssue(issues, "medium", "量表方向可能不一致", "同一份问卷中出现了不同的满意度端点定义，建议统一量表方向。", "1=非常满意 / 5=非常满意");
    addScenarioIssues(issues, questions, text, scenario);
  }
  const high = issues.filter((issue) => issue.severity === "high").length;
  const medium = issues.filter((issue) => issue.severity === "medium").length;
  const low = issues.filter((issue) => issue.severity === "low").length;
  return { summary: { errors: high, warnings: medium + low, total: issues.length, by_severity: { high, medium, low } }, issues, question_count: questions.length, scenario, scenario_label: QUESTIONNAIRE_SCENARIO_LABELS[scenario] };
}
