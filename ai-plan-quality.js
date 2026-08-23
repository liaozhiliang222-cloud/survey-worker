(function initAiPlanQuality(root) {
  "use strict";

  const QUALITY_THRESHOLD = 78;
  const CRITICAL_DIMENSIONS = new Set(["decision_alignment", "method_fit", "module_traceability"]);
  const GENERIC_TERMS = new Set([
    "研究", "调研", "分析", "评估", "识别", "判断", "明确", "验证", "用户", "产品",
    "市场", "项目", "方案", "核心", "业务", "问题", "目标", "模块", "输出", "建议"
  ]);

  function uniqueStrings(values, limit = 20) {
    return Array.from(new Set((values || []).map(function (value) {
      return String(value || "").trim();
    }).filter(Boolean))).slice(0, limit);
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().replace(/[\s，。；：、（）()《》“”"'!?！？/\\_\-]+/g, "");
  }

  function meaningfulTerms(value, limit = 18) {
    const source = String(value || "");
    const terms = [];
    const latin = source.match(/[A-Za-z][A-Za-z0-9.+-]{1,20}/g) || [];
    latin.forEach(function (term) { terms.push(term.toLowerCase()); });
    const chinese = source.match(/[\u4e00-\u9fff]{2,18}/g) || [];
    chinese.forEach(function (chunk) {
      if (chunk.length <= 4) terms.push(chunk);
      const maxSize = Math.min(4, chunk.length);
      for (let size = 2; size <= maxSize; size += 1) {
        for (let index = 0; index <= chunk.length - size; index += 1) {
          terms.push(chunk.slice(index, index + size));
        }
      }
    });
    return uniqueStrings(terms.filter(function (term) {
      return term.length >= 2 && !GENERIC_TERMS.has(term);
    }), limit);
  }

  function extractDecisionAnchors(config = {}) {
    const source = [config.project, config.brief, config.constraints].filter(Boolean).join("。")
      .replace(/[\r\n]+/g, "。")
      .split(/[。；;！？!?]/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item.length >= 8; });
    const decisionLike = source.filter(function (item) {
      return /验证|判断|评估|明确|识别|优化|选择|定位|决策|上市|增长|提升|改进|支持|提供/.test(item);
    });
    return uniqueStrings((decisionLike.length ? decisionLike : source).slice(0, 5), 5);
  }

  function buildPlanBrief(config = {}, context = {}) {
    const moduleNames = uniqueStrings([
      ...(context.modules || []),
      ...(context.additionalModuleNames || []),
      context.studyTypeName || ""
    ], 12);
    return {
      project: String(config.project || "").trim(),
      objective: String(config.brief || "").trim(),
      study_type: String(context.studyTypeName || config.studyType || "").trim(),
      decision_anchors: extractDecisionAnchors(config),
      required_modules: moduleNames,
      framework_name: String(context.frameworkName || "").trim(),
      framework_output: String(context.frameworkOutput || "").trim(),
      confirmed_inputs: {
        audience: Boolean(config.audience),
        sample_size: Boolean(config.sampleSize),
        timeline: Boolean(config.timeline),
        constraints: Boolean(config.constraints)
      }
    };
  }

  function termCoverage(text, items) {
    if (!items.length) return 1;
    const normalized = normalizeText(text);
    let matched = 0;
    items.forEach(function (item) {
      const terms = meaningfulTerms(item, 24);
      if (terms.some(function (term) { return normalized.includes(normalizeText(term)); })) matched += 1;
    });
    return matched / items.length;
  }

  function countMatches(text, expressions) {
    return expressions.reduce(function (count, expression) {
      return count + (expression.test(text) ? 1 : 0);
    }, 0);
  }

  function scoreDimension(id, label, weight, ratio, evidence, repair) {
    const bounded = Math.max(0, Math.min(1, Number(ratio) || 0));
    return {
      id,
      label,
      weight,
      score: Math.round(weight * bounded),
      ratio: Math.round(bounded * 100),
      evidence,
      repair,
      critical: CRITICAL_DIMENSIONS.has(id) && bounded < 0.58
    };
  }

  function auditPlan(markdown, brief = {}, config = {}) {
    const text = String(markdown || "").trim();
    const decisionCoverage = termCoverage(text, brief.decision_anchors || []);
    const moduleCoverage = termCoverage(text, brief.required_modules || []);

    const decisionSignals = countMatches(text, [
      /业务决策|决策需求|需要支持的决策/,
      /待验证|研究问题|关键问题|研究目标/,
      /所需证据|判断依据|数据证据|成功标准/,
      /业务动作|支持.{0,12}决策|行动建议|策略建议/
    ]) / 4;
    const methodPresence = countMatches(text, [/研究方法|方法设计|研究设计/, /定量|定性|访谈|座谈|问卷|桌面研究/]) / 2;
    const methodRationale = countMatches(text, [/选择理由|方法策略|适用原因|之所以|因为|用于验证|适合/, /阶段关系|先.{0,12}后|定性.{0,40}定量|定量.{0,40}定性|相互验证/]) / 2;
    const moduleChain = countMatches(text, [
      /研究模块|研究内容与分析框架|模块设计/,
      /业务决策.{0,120}(研究问题|证据|方法|输出)|(研究问题|证据|方法).{0,120}业务决策/,
      /分析输出|输出价值|支持决策|形成判断/
    ]) / 3;
    const audience = /目标人群|调查对象|研究对象|甄别条件|样本边界/.test(text) ? 1 : 0;
    const sample = /样本量|有效样本|N\s*[=＝]|配额/.test(text) ? 1 : 0;
    const sampleReason = /样本.{0,120}(依据|建议|误差|置信|最小样本|分群|可达)|配额.{0,100}(原则|维度|对比|依据)/.test(text) ? 1 : 0;
    const feasibility = /可行性|可达性|招募难度|样本风险|执行限制|备用方案/.test(text) ? 1 : 0;
    const qualitySignals = countMatches(text, [
      /质量控制|质控/,
      /试访|预测试|问卷逻辑校验/,
      /答题时长|直线作答|异常样本|开放题质量|回访/,
      /数据清洗|复核|回收监控/
    ]) / 4;
    const deliverableSignals = countMatches(text, [
      /交付物|交付成果|报告大纲|数据表|原始数据/,
      /业务使用|使用场景|决策应用|行动建议|策略建议/,
      /优先级|路线图|机会清单|优化方向/
    ]) / 3;
    const assumptionSignals = countMatches(text, [
      /关键假设|研究假设|待验证假设/,
      /AI\s*建议值|建议值|建议样本|建议周期/,
      /待确认事项|已确认信息|需要确认/
    ]) / 3;

    const dimensions = [
      scoreDimension(
        "decision_alignment", "决策对齐", 25,
        decisionCoverage * 0.55 + decisionSignals * 0.45,
        `业务目标覆盖 ${Math.round(decisionCoverage * 100)}%，决策链信号 ${Math.round(decisionSignals * 100)}%`,
        "补齐每个核心业务决策对应的待验证问题、判断证据和后续动作。"
      ),
      scoreDimension(
        "method_fit", "方法适配", 18,
        methodPresence * 0.42 + methodRationale * 0.58,
        `方法说明 ${Math.round(methodPresence * 100)}%，选择依据 ${Math.round(methodRationale * 100)}%`,
        "说明为何选择当前方法，以及各阶段如何分工或相互验证。"
      ),
      scoreDimension(
        "module_traceability", "模块闭环", 20,
        moduleCoverage * 0.54 + moduleChain * 0.46,
        `配置模块覆盖 ${Math.round(moduleCoverage * 100)}%，模块闭环 ${Math.round(moduleChain * 100)}%`,
        "把核心模块改写为“决策—问题—证据—方法—分析输出”的闭环。"
      ),
      scoreDimension(
        "sample_feasibility", "样本可行", 15,
        audience * 0.22 + sample * 0.24 + sampleReason * 0.34 + feasibility * 0.2,
        `对象 ${audience ? "已说明" : "缺失"}，样本 ${sample ? "已说明" : "缺失"}，依据 ${sampleReason ? "已说明" : "偏弱"}`,
        "补充目标人群边界、样本量依据、关键分群最小样本和可达性风险。"
      ),
      scoreDimension(
        "execution_control", "执行质控", 10, qualitySignals,
        `识别到 ${Math.round(qualitySignals * 4)}/4 类执行质控`,
        "按当前研究方法补充预测试、回收监控、异常样本处理和数据复核。"
      ),
      scoreDimension(
        "deliverable_clarity", "交付清晰", 7, deliverableSignals,
        `识别到 ${Math.round(deliverableSignals * 3)}/3 类交付与应用说明`,
        "说明核心交付物由谁使用、支持什么决策，并给出行动优先级输出。"
      ),
      scoreDimension(
        "assumption_hygiene", "假设透明", 5, assumptionSignals,
        `识别到 ${Math.round(assumptionSignals * 3)}/3 类假设与待确认标识`,
        "在结尾集中区分关键假设、AI 建议值和待确认事项。"
      )
    ];
    const score = dimensions.reduce(function (sum, item) { return sum + item.score; }, 0);
    const issues = dimensions
      .filter(function (item) { return item.ratio < 72; })
      .map(function (item) {
        return {
          code: item.id,
          label: item.label,
          level: item.critical ? "critical" : "warning",
          message: item.repair,
          evidence: item.evidence
        };
      });
    const missingInputs = [];
    if (!config.audience) missingInputs.push("目标人群边界未确认");
    if (!config.sampleSize) missingInputs.push("样本量为 AI 建议值");
    if (!config.timeline) missingInputs.push("项目周期未确认");
    return {
      score,
      threshold: QUALITY_THRESHOLD,
      passed: score >= QUALITY_THRESHOLD && !dimensions.some(function (item) { return item.critical; }),
      dimensions,
      issues,
      missing_inputs: missingInputs,
      audit_type: "local_structure_review"
    };
  }

  function repairInstructions(audit) {
    return uniqueStrings((audit && audit.issues || []).map(function (issue) {
      return issue.message;
    }), 6);
  }

  function buildRepairInstruction(audit) {
    const instructions = repairInstructions(audit);
    if (!instructions.length) return "保留当前方案内容，仅检查表述一致性和待确认事项。";
    return [
      "请只针对以下本地质量审校问题修补当前调研方案，保留已经正确的项目事实、研究范围和章节内容，不要扩大研究范围，也不要添加未经要求的专项模型：",
      ...instructions.map(function (item, index) { return `${index + 1}. ${item}`; }),
      "修订后直接输出完整 Markdown 方案，不要输出修改说明。"
    ].join("\n");
  }

  root.AiPlanQuality = {
    QUALITY_THRESHOLD,
    buildPlanBrief,
    auditPlan,
    repairInstructions,
    buildRepairInstruction
  };
})(typeof window !== "undefined" ? window : globalThis);
