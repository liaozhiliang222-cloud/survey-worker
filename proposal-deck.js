(function () {
  "use strict";

  const VISUAL_TYPES = {
    cover_product_hero: "产品视觉封面",
    context_tension_map: "背景张力图",
    decision_tree: "业务决策树",
    evidence_threshold_matrix: "决策证据矩阵",
    dual_track_research_flow: "双轨研究路径",
    qualitative_design_canvas: "定性研究画布",
    quantitative_sample_architecture: "定量样本架构",
    questionnaire_decision_journey: "问卷决策链",
    concept_funnel_maxdiff_example: "概念漏斗与卖点示例",
    pricing_segment_example: "价格与人群示例",
    decision_output_map: "决策输出地图",
    timeline_gantt_risk: "甘特图与风险",
    deliverable_map: "交付物地图",
    risk_matrix: "风险矩阵",
    plan_comparison: "方案对比",
    pricing_table: "报价表"
  };
  const VISUAL_FALLBACK = {
    flow: "dual_track_research_flow",
    path: "dual_track_research_flow",
    timeline: "timeline_gantt_risk",
    matrix: "evidence_threshold_matrix",
    tree: "decision_tree",
    map: "decision_output_map",
    hierarchy: "quantitative_sample_architecture",
    funnel: "concept_funnel_maxdiff_example",
    sample: "quantitative_sample_architecture",
    cards: "deliverable_map"
  };
  const SLIDE_TYPE_BY_VISUAL = {
    cover_product_hero: "cover",
    context_tension_map: "project_context",
    decision_tree: "business_decisions",
    evidence_threshold_matrix: "decision_evidence",
    dual_track_research_flow: "research_path",
    qualitative_design_canvas: "qualitative_design",
    quantitative_sample_architecture: "sample_design",
    questionnaire_decision_journey: "questionnaire_design",
    concept_funnel_maxdiff_example: "report_example_concept",
    pricing_segment_example: "report_example_pricing",
    decision_output_map: "decision_outputs",
    timeline_gantt_risk: "timeline",
    deliverable_map: "deliverables",
    risk_matrix: "risks",
    plan_comparison: "comparison",
    pricing_table: "pricing"
  };

  const state = {
    deck: null,
    selectedSlideId: "",
    history: [],
    lastIssues: [],
    generating: false
  };

  function uid(prefix = "deck") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cleanText(value, limit = 0) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return limit ? text.slice(0, limit) : text;
  }

  function parseJsonCandidate(output) {
    const text = String(output || "").trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    const object = text.match(/\{[\s\S]*\}/)?.[0];
    const candidate = (fenced || object || text)
      .replace(/^\uFEFF/, "")
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    return JSON.parse(candidate);
  }

  function repairVisualType(value) {
    const raw = cleanText(value).toLowerCase();
    if (VISUAL_TYPES[raw]) return raw;
    const match = Object.entries(VISUAL_FALLBACK).find(([token]) => raw.includes(token));
    return match?.[1] || "decision_output_map";
  }

  function normalizeItem(item, index) {
    if (typeof item === "string") item = { headline: item };
    item = item && typeof item === "object" ? item : {};
    return {
      id: cleanText(item.id) || `item_${String(index + 1).padStart(2, "0")}`,
      label: cleanText(item.label, 12),
      headline: cleanText(item.headline || item.title, 32) || "待完善",
      description: cleanText(item.description, 110),
      priority: Number(item.priority) || index + 1,
      source_type: cleanText(item.source_type) || "project_brief"
    };
  }

  function normalizeSlide(raw, index) {
    raw = raw && typeof raw === "object" ? raw : {};
    const visual = index === 0 ? "cover_product_hero" : repairVisualType(raw.visual_type);
    return {
      id: cleanText(raw.id) || `slide_${index + 1}_${Math.random().toString(36).slice(2, 5)}`,
      order: index + 1,
      slide_type: cleanText(raw.slide_type) || SLIDE_TYPE_BY_VISUAL[visual] || visual,
      title: cleanText(raw.title, 38) || "待完善页面",
      subtitle: cleanText(raw.subtitle, 80),
      key_message: cleanText(raw.key_message, 65),
      slide_question: cleanText(raw.slide_question || raw.question, 100),
      unique_purpose: cleanText(raw.unique_purpose, 140),
      previous_slide_relation: cleanText(raw.previous_slide_relation, 140),
      next_slide_relation: cleanText(raw.next_slide_relation, 140),
      visual_type: visual,
      layout_variant: cleanText(raw.layout_variant) || "default",
      relation_type: cleanText(raw.relation_type) || "sequence",
      content_density: cleanText(raw.content_density) || "professional",
      target_canvas_occupancy: Math.min(.85, Math.max(.5, Number(raw.target_canvas_occupancy) || .72)),
      content: Array.isArray(raw.content) ? raw.content.map(normalizeItem) : [],
      charts: Array.isArray(raw.charts) ? raw.charts : [],
      source_references: Array.isArray(raw.source_references) ? raw.source_references : [],
      data_status: ["verified", "illustrative", "framework_only"].includes(raw.data_status) ? raw.data_status : "framework_only",
      example_output: Boolean(raw.example_output),
      timeline_tasks: Array.isArray(raw.timeline_tasks) ? raw.timeline_tasks : [],
      notes: cleanText(raw.notes, 240),
      locked: Boolean(raw.locked)
    };
  }

  function splitOverlongSlides(slides) {
    const result = [];
    slides.forEach((slide) => {
      const limit = ["questionnaire_decision_journey", "decision_output_map"].includes(slide.visual_type) ? 7 : 6;
      if (slide.content.length <= limit) {
        result.push(slide);
        return;
      }
      const chunks = [];
      for (let index = 0; index < slide.content.length; index += limit) chunks.push(slide.content.slice(index, index + limit));
      chunks.forEach((content, index) => {
        result.push({
          ...clone(slide),
          id: index ? `${slide.id}_part${index + 1}` : slide.id,
          title: index ? cleanText(`${slide.title}（续）`, 38) : slide.title,
          content
        });
      });
    });
    return result;
  }

  function normalizeDeck(input, options = {}) {
    if (!input || typeof input !== "object") throw new Error("Deck JSON 必须是对象。");
    if (!Array.isArray(input.slides) || !input.slides.length) throw new Error("Deck JSON 缺少页面。");
    let slides = input.slides.map(normalizeSlide);
    slides = splitOverlongSlides(slides).map((slide, index) => ({ ...slide, order: index + 1 }));
    const projectId = cleanText(input.project_id || options.projectId) || "project_local";
    return {
      deck_id: cleanText(input.deck_id) || uid("deck"),
      project_id: projectId,
      title: cleanText(input.title, 80) || slides[0].title,
      subtitle: cleanText(input.subtitle, 120),
      language: "zh-CN",
      aspect_ratio: "16:9",
      theme: "modern_insight_v2",
      purpose: cleanText(input.purpose || options.purpose) || "client_proposal",
      example_output_mode: cleanText(input.example_output_mode || options.exampleOutputMode) || "illustrative",
      illustrative_dataset_id: cleanText(input.illustrative_dataset_id),
      illustrative_dataset: input.illustrative_dataset && typeof input.illustrative_dataset === "object" ? input.illustrative_dataset : null,
      content_density: cleanText(input.content_density || options.contentDensity) || "professional",
      target_canvas_occupancy: Math.min(.82, Math.max(.5, Number(input.target_canvas_occupancy) || .72)),
      min_body_characters: Number(input.min_body_characters) || 160,
      max_body_characters: Number(input.max_body_characters) || 300,
      page_size: slides.length,
      source_summary: input.source_summary && typeof input.source_summary === "object" ? input.source_summary : {},
      slides
    };
  }

  function validateDeck(deck) {
    const issues = [];
    const ids = new Set();
    const titles = new Set();
    if (!deck?.slides?.length) issues.push({ level: "error", code: "empty_deck", message: "没有可导出的页面。" });
    (deck?.slides || []).forEach((slide, index) => {
      if (ids.has(slide.id)) issues.push({ level: "error", code: "duplicate_id", slide: index + 1, message: "页面 ID 重复。" });
      ids.add(slide.id);
      if (!slide.title) issues.push({ level: "error", code: "empty_title", slide: index + 1, message: "页面标题为空。" });
      if (titles.has(slide.title)) issues.push({ level: "warning", code: "duplicate_title", slide: index + 1, message: "页面标题重复。" });
      titles.add(slide.title);
      if (!VISUAL_TYPES[slide.visual_type]) issues.push({ level: "error", code: "invalid_visual", slide: index + 1, message: "页面版式不受支持。" });
      if (index && !slide.content.length) issues.push({ level: "error", code: "empty_content", slide: index + 1, message: "页面正文为空。" });
      const text = [slide.title, slide.key_message, ...slide.content.flatMap((item) => [item.headline, item.description])].join(" ");
      if (/\b\d+(?:\.\d+)?%\b/.test(text) && !slide.source_references.length) {
        issues.push({ level: "warning", code: "unreferenced_number", slide: index + 1, message: "页面包含无来源支持的比例数字。" });
      }
      const nodeLimit = ["questionnaire_decision_journey", "decision_output_map"].includes(slide.visual_type) ? 7 : 6;
      if (slide.content.length > nodeLimit) issues.push({ level: "error", code: "too_many_nodes", slide: index + 1, message: `页面节点超过 ${nodeLimit} 个。` });
      const bodyLength = slide.content.reduce((sum, item) => sum + item.headline.length + item.description.length, 0);
      if (index && !slide.example_output && bodyLength < 80) issues.push({ level: "warning", code: "low_density", slide: index + 1, message: "页面正文偏少，建议补充判断依据、方法作用或输出说明。" });
      if (index && deck.slides[index - 1]?.visual_type === slide.visual_type) issues.push({ level: "warning", code: "repeated_layout", slide: index + 1, message: "连续页面使用相同主结构。" });
      const quantity = slide.title.match(/([一二三四五六七八九十]|\d+)(?:个?模块|项)/);
      const chineseNumbers = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
      if (quantity) {
        const expected = Number(quantity[1]) || chineseNumbers[quantity[1]];
        if (expected !== slide.content.length) issues.push({ level: "error", code: "module_count_mismatch", slide: index + 1, message: `标题写明${expected}个模块，但实际展示${slide.content.length}个。` });
      }
      if (slide.example_output && slide.data_status === "illustrative") {
        if (!deck.illustrative_dataset) issues.push({ level: "error", code: "missing_dataset", slide: index + 1, message: "报告示例页缺少统一 illustrative_dataset。" });
        if (!slide.charts.length) issues.push({ level: "error", code: "missing_example_chart", slide: index + 1, message: "报告示例页缺少图表定义。" });
      }
    });
    const required = ["cover", "project_context", "business_decisions", "decision_evidence", "research_path", "sample_design", "questionnaire_design", "decision_outputs", "timeline"];
    const slideTypes = new Set((deck?.slides || []).map((slide) => slide.slide_type));
    required.filter((type) => !slideTypes.has(type)).forEach((type) => issues.push({ level: "warning", code: "missing_structure", message: `故事线缺少 ${type} 页面。` }));
    const dataset = deck?.illustrative_dataset;
    if (dataset && deck.example_output_mode === "illustrative") {
      const funnel = Object.values(dataset.metrics || {}).map(Number);
      if (funnel.some((value) => value < 0 || value > 100)) issues.push({ level: "error", code: "invalid_percentage", message: "示例漏斗数据必须位于0—100。" });
      if (funnel.some((value, index) => index && value > funnel[index - 1])) issues.push({ level: "error", code: "invalid_funnel", message: "示例概念漏斗出现无解释的逆向增长。" });
      const points = Object.values(dataset.selling_point_scores || {}).map(Number);
      if (points.length && Math.abs(points.reduce((a, b) => a + b, 0) - 100) > 2) issues.push({ level: "error", code: "invalid_share_total", message: "卖点示例份额合计应接近100。" });
      const pricing = dataset.pricing || {};
      if (!(pricing.acceptable_low < pricing.optimal_price && pricing.optimal_price < pricing.acceptable_high)) issues.push({ level: "error", code: "invalid_pricing", message: "示例价格区间逻辑不一致。" });
    }
    const cardTypes = new Set(["context_tension_map", "questionnaire_decision_journey", "deliverable_map", "plan_comparison", "pricing_table"]);
    const cardCount = (deck?.slides || []).filter((slide) => cardTypes.has(slide.visual_type)).length;
    if (deck?.slides?.length && cardCount / deck.slides.length > .25) issues.push({ level: "warning", code: "too_many_card_pages", message: "纯卡片型页面占比超过25%。" });
    const bigrams = (value) => new Set(Array.from(String(value || "").replace(/\s+/g, "")).slice(0, -1).map((char, index, chars) => char + chars[index + 1]));
    for (let left = 0; left < (deck?.slides || []).length; left += 1) {
      for (let right = left + 1; right < deck.slides.length; right += 1) {
        const a = bigrams(`${deck.slides[left].slide_question}${deck.slides[left].title}`); const b = bigrams(`${deck.slides[right].slide_question}${deck.slides[right].title}`);
        const union = new Set([...a, ...b]); const similarity = union.size ? [...a].filter((token) => b.has(token)).length / union.size : 0;
        if (similarity > .7) issues.push({ level: "warning", code: "story_similarity", message: `第${left + 1}页与第${right + 1}页内容目的相似度过高。` });
      }
    }
    return issues;
  }

  function configFromPage() {
    const base = typeof getAiPlanConfig === "function" ? getAiPlanConfig() : {};
    const deliverable = document.querySelector("#aiPlanMode")?.value || "word";
    return {
      ...base,
      deliverable,
      mode: "detailed",
      ppt: {
        pageSize: Number(document.querySelector("#aiPlanPptPageSize")?.value) || 12,
        purpose: document.querySelector("#aiPlanPptPurpose")?.value || "client_proposal",
        theme: "modern_insight_v2",
        exampleOutputMode: document.querySelector("#aiPlanPptExampleMode")?.value || "illustrative",
        contentDensity: document.querySelector("#aiPlanPptDensity")?.value || "professional",
        includeQuota: Boolean(document.querySelector("#aiPlanPptQuota")?.checked),
        includeRisks: Boolean(document.querySelector("#aiPlanPptRisks")?.checked),
        includeOutputs: Boolean(document.querySelector("#aiPlanPptOutputs")?.checked),
        includePricing: Boolean(document.querySelector("#aiPlanPptPricing")?.checked),
        includeTeam: Boolean(document.querySelector("#aiPlanPptTeam")?.checked)
      }
    };
  }

  function projectIdForDeck() {
    try {
      return loadWorkspaceProject()?.id || workspaceProject?.id || "project_local";
    } catch {
      return "project_local";
    }
  }

  function sourceRef(type = "project_brief") {
    return [{ source_type: type, source_id: type === "word_proposal" ? "word_plan_current" : "brief_current" }];
  }

  function item(label, headline, description, sourceType = "project_brief") {
    return { id: uid("item"), label, headline, description, priority: 1, source_type: sourceType };
  }

  function generateIllustrativeDataset(config) {
    const project = cleanText(config.project || "research_project").replace(/\s+/g, "_").slice(0, 24);
    return {
      dataset_id: `${project || "project"}_illustrative_v1`, project_type: config.studyType || "concept_test",
      data_status: "illustrative", usable_for_decision: false,
      example_label: "REPORT EXAMPLE｜报告输出示例",
      disclaimer: "本页数据为AI生成的示例数据，仅用于展示未来报告的分析形式，不代表实际研究结果。",
      metrics: { concept_understanding: 82, concept_relevance: 68, concept_uniqueness: 61, concept_credibility: 55, purchase_intention_t2b: 39 },
      selling_point_scores: { "健康活水": 31, "易清洁": 26, "静音运行": 21, "智能提醒": 13, "外观设计": 9 },
      segment_purchase_intention: { "高端养宠人群": 58, "智能设备尝鲜者": 51, "普通饮水机用户": 37, "普通水碗用户": 24 },
      pricing: { acceptable_low: 299, optimal_price: 399, acceptable_high: 499,
        purchase_curve: [{ price: 299, intention: 57 }, { price: 399, intention: 39 }, { price: 499, intention: 25 }, { price: 599, intention: 14 }] }
    };
  }

  function buildLocalStory(config) {
    const project = typeof aiPlanProjectName === "function" ? aiPlanProjectName(config) : (config.project || "待命名调研项目");
    const standard = [
      ["cover", project, "产品上市前用户研究提案", "cover_product_hero", "这是什么项目？", "hero", "product_right"],
      ["project_context", "饮水管理升级需求与产品决策风险同时出现", "从宠物健康、清洁负担和智能体验三条线识别真实机会", "context_tension_map", "为什么现在需要开展研究？", "causal", "tension_to_opportunity"],
      ["business_decisions", "研究结束后需要支持五项核心业务决策", "覆盖概念去留、卖点排序、目标人群、价格与体验优化", "decision_tree", "客户最终需要做出哪些决定？", "hierarchy", "center_branches"],
      ["decision_evidence", "每项业务决策都对应证据、判断方式与行动", "没有内部通过线时采用概念比较、历史基准或客户标准", "evidence_threshold_matrix", "什么证据支持每项业务决策？", "matrix", "decision_evidence_action"],
      ["research_path", "定性探索与定量验证逐步降低上市风险", "前一阶段输出直接成为后一阶段的输入，而非方法堆叠", "dual_track_research_flow", "研究如何逐步降低决策风险？", "sequence", "horizontal_with_outputs"],
      ["qualitative_design", "定性研究把真实饮水场景转化为可测试语言", "访问养宠决策者并观察清洁、补水和宠物适应过程", "qualitative_design_canvas", "定性研究具体访问谁、讨论什么、输出什么？", "input_output", "roles_topics_outputs"],
      ["sample_design", "样本架构兼顾概念比较与重点人群差异", "总体样本、概念单元和最低分析单元保持可追溯", "quantitative_sample_architecture", "为什么采用该样本量，样本如何分配？", "hierarchy", "sample_tree_with_limits"],
      ["questionnaire_design", "七个问卷模块沿用户决策过程逐步推进", "每个模块同时连接指标、业务决策与分析方法", "questionnaire_decision_journey", "问卷如何沿用户决策过程展开？", "sequence", "journey_with_metrics"],
      ["report_example_concept", "报告将识别最具转化潜力的概念与卖点", "以概念漏斗和MaxDiff优先级展示未来报告输出形式", "concept_funnel_maxdiff_example", "概念和卖点将如何呈现在最终报告中？", "data", "funnel_plus_bars"],
      ["report_example_pricing", "报告将界定价格空间并识别首发机会人群", "价格曲线与人群购买意愿共用同一套示例口径", "pricing_segment_example", "价格与人群机会将如何被判断？", "data", "curve_plus_segments"],
      ["decision_outputs", "研究指标最终汇聚为七类可执行上市结论", "把需求、概念、卖点、功能、价格、人群和障碍连接到行动", "decision_output_map", "项目最终形成哪些业务结论？", "input_output", "metrics_models_actions"],
      ["timeline", "两周内并行推进研究执行、客户确认与交付", "甘特条按真实起止日定位，并标记确认节点、依赖和风险", "timeline_gantt_risk", "项目如何执行，客户何时参与并获得交付？", "time", "gantt_with_risk"]
    ].map((values, index, all) => ({ slide_type: values[0], title: values[1], key_message: values[2], visual_type: values[3], slide_question: values[4], unique_purpose: values[4], relation_type: values[5], layout_variant: values[6], previous_slide_relation: index ? `承接第${index}页结论` : "故事线起点", next_slide_relation: index < all.length - 1 ? `引出第${index + 2}页` : "形成执行闭环" }));
    if (config.ppt.exampleOutputMode === "none") {
      standard[8] = { ...standard[8], slide_type: "deliverables", title: "交付物让研究证据可复核、可传播、可行动", key_message: "数据、洞察、策略和工作坊共同支持决策", visual_type: "deliverable_map" };
      standard[9] = { ...standard[9], slide_type: "risks", title: "四类项目风险需要在启动阶段共同锁定", key_message: "范围、样本、素材与确认效率决定最终质量", visual_type: "risk_matrix" };
    }
    if (config.ppt.pageSize === 8) return standard.filter((_, index) => ![3, 5, 8, 9].includes(index));
    if (config.ppt.pageSize >= 14) return [...standard, 
      { slide_type: "risks", title: "关键风险与应对措施在启动阶段前置确认", key_message: "风险管理与研究执行同步进行", visual_type: "risk_matrix", slide_question: "如何控制执行风险？", unique_purpose: "风险控制", relation_type: "matrix", layout_variant: "risk_matrix" },
      { slide_type: "deliverables", title: "交付组合覆盖数据、洞察、策略与共创", key_message: "不同角色获得适配的决策材料", visual_type: "deliverable_map", slide_question: "最终交付什么？", unique_purpose: "交付说明", relation_type: "input_output", layout_variant: "deliverable_map" }
    ];
    return standard;
  }

  function localContentForSlide(story, config) {
    const total = Number(config.sampleSize) || 700;
    const unit = Math.floor(total / 2); const cat = Math.round(unit * .63); const dog = unit - cat;
    const audience = config.audience || "城市养宠家庭的主要购买决策者";
    const content = {
      cover: [],
      project_context: [item("市场变化", "宠物健康管理从基础喂养走向精细化", "现象：饮水量、饮水质量和异常提醒成为可感知需求｜业务含义：用户开始为健康管理证据付费｜研究响应：验证需求普遍性、迫切度与支付关联"), item("用户张力", "自动循环并不等于真正省心", "现象：滤芯成本、清洁死角、噪音和宠物适应仍是负担｜业务含义：智能功能可能被维护成本抵消｜研究响应：还原持续使用旅程与流失节点"), item("产品机会", "健康价值必须转化为可持续体验", "现象：用户需要卫生、静音、易清洁和可信提醒协同成立｜业务含义：单一技术卖点不足以支撑升级｜研究响应：识别价值组合和MVP功能优先级"), item("决策风险", "未经验证会放大上市与资源投入风险", "现象：概念、人群、价格和体验边界尚未被证据锁定｜业务含义：错误定位会推高教育与获客成本｜研究响应：形成推进、优化或停止的判断依据")],
      business_decisions: [item("概念", "产品概念是否继续推进", "比较理解度、相关性、独特性、可信度与购买意愿"), item("卖点", "哪些价值应成为首要沟通", "区分基础购买价值、差异化卖点和低贡献信息"), item("人群", "哪类养宠家庭适合作为首发目标", "识别高需求、高接受度且可触达的机会人群"), item("价格", "建议价格区间能否成立", "结合价格敏感度和不同价位购买概率判断商业空间"), item("体验", "哪些使用问题必须优先解决", "聚焦清洁、噪音、宠物适应、提醒与持续使用障碍")],
      decision_evidence: [item("概念是否推进", "理解度、相关性、可信度、购买意愿", "概念间比较＋历史基准或客户内部标准｜推进、优化或停止"), item("卖点如何排序", "偏好、差异性、选择驱动作用", "MaxDiff＋驱动分析｜确定主卖点、辅助卖点与弱化信息"), item("首发人群是谁", "需求强度、购买意愿、支付能力、可触达性", "细分聚类＋机会矩阵｜确定核心、机会与非优先人群"), item("价格是否成立", "价格接受区间与各价位购买概率", "PSM＋Gabor-Granger｜确定价格区间和价格风险"), item("体验如何优化", "任务完成、清洁负担、噪音与持续使用障碍", "场景访谈＋问题优先级｜形成MVP体验优化清单")],
      research_path: [item("输入", "业务假设与产品刺激物", "客户确认概念、功能、价格和核心决策问题"), item("定性探索", "还原真实饮水管理场景", "输出用户语言、核心张力、问卷选项和概念优化建议"), item("概念优化", "把探索发现转成可测刺激物", "统一概念表达、卖点层级和测试版本"), item("定量验证", "量化规模、差异与优先级", "输出概念表现、卖点、价格和人群机会证据"), item("策略输出", "整合证据形成上市行动", "给出概念、MVP功能、价格、人群与营销建议")],
      qualitative_design: [item("访问对象", "新手与成熟养宠家庭", `${audience}；兼顾猫犬、多宠、现有饮水设备状态与消费层级`), item("访问形式", "居家场景深访＋任务演示", "建议8—12人，每次60—90分钟；观察补水、拆洗、滤芯和宠物适应过程"), item("讨论模块", "现状—痛点—概念—体验—转化", "还原饮水管理习惯，探索概念语言，识别信任门槛和持续使用障碍"), item("刺激材料", "概念板、功能卡与价格情景", "统一信息量和呈现顺序，避免外观细节干扰核心价值判断"), item("阶段输出", "定性假设清单与问卷输入", "形成用户自然语言、关键选项、概念优化点、分群假设和定量待验证问题")],
      sample_design: [item("总体样本", `N=${total}`, `${audience}；样本量来自用户输入或方案计算，正式执行前需验证可达性`), item("概念A", `N=${unit}`, `猫家庭 N=${cat}；犬家庭 N=${dog}；独立评价同一信息量的概念版本`), item("概念B", `N=${total - unit}`, `猫家庭 N=${total - unit - dog}；犬家庭 N=${dog}；与概念A保持配额一致`), item("重点加样", "高端宠物消费与智能设备高接受人群", "用于识别价格上探和智能功能差异化空间，不直接代表总体结构"), item("交叉分析", "猫犬类型×城市级别×设备经验×消费层级", "重点观察概念、卖点、价格与使用障碍的显著差异"), item("分析限制", "最低分析单元建议不低于N=80", "小样本分组只作方向判断；多重切分会降低统计稳定性")],
      questionnaire_design: [item("模块1", "使用现状", "指标：设备、角色、频率、维护投入｜决策：定义行为基线｜方法：描述统计｜输出：典型饮水管理路径"), item("模块2", "痛点和现有方案", "指标：清洁、噪音、卫生焦虑、宠物适应｜决策：确认需求真实性｜方法：痛点矩阵｜输出：高频高痛机会点"), item("模块3", "概念理解", "指标：正确理解、相关、独特、可信｜决策：判断概念去留｜方法：概念漏斗｜输出：概念优化方向"), item("模块4", "卖点取舍", "指标：健康活水、易清洁、静音、提醒、外观｜决策：确定沟通优先级｜方法：MaxDiff｜输出：主次卖点组合"), item("模块5", "购买意愿", "指标：Top2Box、使用情景、购买障碍｜决策：估计转化潜力｜方法：驱动分析｜输出：转化杠杆与障碍"), item("模块6", "价格测试", "指标：价格接受、各价位购买概率｜决策：判断商业空间｜方法：PSM＋Gabor-Granger｜输出：建议价格区间"), item("模块7", "人群和触点", "指标：需求、态度、消费、渠道｜决策：识别首发人群｜方法：聚类＋机会矩阵｜输出：人群与触达策略")],
      report_example_concept: [item("示例解读", "健康活水与易清洁构成基础购买价值", "智能提醒更适合作为差异化辅助卖点；示例解读，不代表实际研究结论")],
      report_example_pricing: [item("示例解读", "价格上升伴随购买意愿递减", "高端养宠人群和智能设备尝鲜者体现更高机会；示例解读，不代表实际研究结论")],
      decision_outputs: [item("结论1", "需求真实性判断", "确认饮水管理痛点是否真实、普遍且值得产品解决"), item("结论2", "最优概念方向", "比较不同概念的理解、吸引、独特与可信表现"), item("结论3", "核心卖点组合", "区分基础购买价值、差异化价值和低贡献信息"), item("结论4", "MVP功能优先级", "明确必须解决、建议增强和可以延后的功能"), item("结论5", "建议价格区间", "结合价格敏感度和购买概率判断商业空间"), item("结论6", "首发目标人群", "识别高需求、高接受度且可触达的机会人群"), item("结论7", "障碍与行动建议", "把产品体验和营销障碍转成责任明确的下一步动作")],
      timeline: [item("交付", "研究方案、定性小结、数据与交叉表", "最终报告、汇报材料和行动共创工作坊"), item("依赖", "概念刺激物与招募条件按时确认", "客户需在D2、D5、D10完成关键确认"), item("风险", "招募可达性、素材变更与确认延迟", "通过备选样本、版本冻结和明确确认人控制")],
      risks: [item("范围", "研究问题持续扩张", "冻结核心决策与非目标问题"), item("样本", "重点人群可达性不足", "预招募验证并准备替代配额"), item("素材", "概念版本临时变化", "设置刺激物冻结节点"), item("周期", "客户确认延迟", "明确单一确认人和响应时限")],
      deliverables: [item("数据", "清洗数据、交叉表与分析底表", "支持追溯和二次分析"), item("洞察", "管理层摘要与完整研究报告", "回答所有核心业务决策"), item("策略", "产品、价格、人群和营销行动路线图", "明确优先级和责任人"), item("共创", "结果汇报与行动工作坊", "把结论转成下一步任务")]
    };
    return content[story.slide_type] || content.deliverables;
  }

  function buildLocalDeck(config, story = buildLocalStory(config), wordPlan = "") {
    const title = typeof aiPlanProjectName === "function" ? aiPlanProjectName(config) : (config.project || "待命名调研项目");
    const projectId = projectIdForDeck();
    const dataset = generateIllustrativeDataset(config);
    const exampleMode = config.ppt.exampleOutputMode || "illustrative";
    const slides = story.map((page, index) => {
      const isExample = ["report_example_concept", "report_example_pricing"].includes(page.slide_type);
      const dataStatus = isExample ? (exampleMode === "illustrative" ? "illustrative" : "framework_only") : "framework_only";
      const charts = page.slide_type === "report_example_concept" ? [{ chart_id: "concept_funnel", chart_type: "funnel", dataset_id: dataset.dataset_id }, { chart_id: "selling_points", chart_type: "bar", dataset_id: dataset.dataset_id }] : page.slide_type === "report_example_pricing" ? [{ chart_id: "price_curve", chart_type: "line", dataset_id: dataset.dataset_id }, { chart_id: "segments", chart_type: "bar", dataset_id: dataset.dataset_id }] : [];
      const timelineTasks = page.slide_type === "timeline" ? [
        { task: "研究设计", start_day: 1, end_day: 2, owner: "研究团队", dependency: "项目启动", deliverable: "研究方案" },
        { task: "定性招募", start_day: 1, end_day: 3, owner: "执行团队", dependency: "招募条件确认", deliverable: "访问名单" },
        { task: "定性访问", start_day: 3, end_day: 5, owner: "研究团队", dependency: "定性招募", deliverable: "定性小结" },
        { task: "问卷设计", start_day: 2, end_day: 5, owner: "研究团队", dependency: "研究设计", deliverable: "问卷终稿" },
        { task: "编程测试", start_day: 4, end_day: 5, owner: "执行团队", dependency: "问卷设计", deliverable: "测试链接" },
        { task: "定量回收", start_day: 6, end_day: 10, owner: "执行团队", dependency: "编程测试", deliverable: "有效样本" },
        { task: "数据分析", start_day: 9, end_day: 11, owner: "分析团队", dependency: "阶段数据", deliverable: "分析底表" },
        { task: "报告输出", start_day: 11, end_day: 14, owner: "研究团队", dependency: "数据分析", deliverable: "最终报告" }
      ] : [];
      return { id: `slide_${String(index + 1).padStart(2, "0")}`, order: index + 1, ...page,
        subtitle: index === 0 ? `${config.studyType || "概念测试"}｜${config.audience || "养宠家庭"}` : page.key_message,
        content_density: config.ppt.contentDensity || "professional", target_canvas_occupancy: isExample ? .78 : .72,
        content: localContentForSlide(page, config), charts, timeline_tasks: timelineTasks,
        source_references: isExample ? [{ source_type: "illustrative_dataset", source_id: dataset.dataset_id }] : sourceRef(wordPlan ? "word_proposal" : "project_brief"),
        data_status: dataStatus, example_output: isExample, notes: page.slide_question || "", locked: false };
    });
    return normalizeDeck({ deck_id: uid("deck"), project_id: projectId, title, subtitle: "用户研究方案", language: "zh-CN", aspect_ratio: "16:9", theme: "modern_insight_v2", purpose: config.ppt.purpose,
      example_output_mode: exampleMode, illustrative_dataset_id: dataset.dataset_id, illustrative_dataset: exampleMode === "illustrative" ? dataset : null,
      content_density: config.ppt.contentDensity || "professional", target_canvas_occupancy: .72, min_body_characters: 160, max_body_characters: 300,
      page_size: slides.length, source_summary: { brief_used: Boolean(config.brief), word_proposal_used: Boolean(wordPlan), confirmed_research_task_used: true }, slides }, { projectId, purpose: config.ppt.purpose, exampleOutputMode: exampleMode, contentDensity: config.ppt.contentDensity });
  }

  function storyPrompt(config, sourceText) {
    return [{ role: "system", content: "你是资深市场研究提案故事线规划器。只输出严格JSON，不输出代码或坐标。不得把AI示例数据伪装成真实结论；允许使用统一illustrative_dataset展示报告形式。每页必须有唯一问题、独立作用和上下页递进。visual_type只能从白名单选择。" }, { role: "user", content: [
      `项目：${config.project || "请根据Brief拟定"}`, `页数：${config.ppt.pageSize}`, `场景：${config.ppt.purpose}`, `内容密度：${config.ppt.contentDensity}`, `报告示例模式：${config.ppt.exampleOutputMode}`,
      "标准12页必须覆盖背景机会、五项业务决策、证据矩阵、研究路径、定性设计、样本架构、七模块问卷、两页报告示例、决策输出和真实甘特图。",
      "输出JSON：{narrative,slides:[{slide_type,title,key_message,slide_question,unique_purpose,previous_slide_relation,next_slide_relation,visual_type,layout_variant,relation_type}]}。",
      `visual_type白名单：${Object.keys(VISUAL_TYPES).join(",")}`, "禁止两页回答同一问题；禁止连续同构；标题数量必须与内容数量一致。", `输入资料：${cleanText(sourceText || config.brief, 12000)}`
    ].join("\n") }];
  }

  function deckPrompt(config, story, sourceText, fallbackDeck) {
    return [{ role: "system", content: "你是Deck JSON内容规划器。只输出严格JSON。AI示例数据只能写入illustrative_dataset并标记illustrative/usable_for_decision=false；真实结论字段不得引用示例数据。HTML预览和PPTX共用此JSON。" }, { role: "user", content: [
      "在结构示例基础上补充项目专属语义，不得删除schema字段、charts、timeline_tasks或illustrative_dataset。",
      "页面字段包括故事线关系、relation_type、layout_variant、content_density、target_canvas_occupancy、data_status和example_output。",
      "方法与样本页正文180—320字；普通逻辑页160—260字；报告示例页60—150字＋图表；正文不得依赖小于10pt字号。",
      "不得改动统一示例数据的指标口径；第9、10页必须共用同一dataset_id。", `visual_type白名单：${Object.keys(VISUAL_TYPES).join(",")}`,
      `故事线：${JSON.stringify(story)}`, `输入资料：${cleanText(sourceText || config.brief, 12000)}`, `结构示例：${JSON.stringify(fallbackDeck)}`
    ].join("\n") }];
  }

  function pushHistory(label = "自动保存") {
    if (!state.deck) return;
    state.history.unshift({ id: uid("version"), label, createdAt: new Date().toISOString(), deck: clone(state.deck) });
    state.history = state.history.slice(0, 20);
    renderVersionOptions();
  }

  function selectedSlide() {
    return state.deck?.slides.find((slide) => slide.id === state.selectedSlideId) || state.deck?.slides[0] || null;
  }

  function visualClass(type) {
    if (type === "context_tension_map") return "context-cards";
    if (type === "questionnaire_decision_journey") return "journey-cards";
    if (["quantitative_sample_architecture", "timeline_gantt_risk"].includes(type)) return "vertical";
    if (["evidence_threshold_matrix", "plan_comparison", "pricing_table", "qualitative_design_canvas"].includes(type)) return "matrix";
    if (["decision_tree", "deliverable_map", "risk_matrix"].includes(type)) return "tree";
    if (["concept_funnel_maxdiff_example", "pricing_segment_example"].includes(type)) return "chart-preview";
    if (type === "decision_output_map") return "blueprint";
    return "horizontal";
  }

  function renderChartPreview(slide) {
    const dataset = state.deck?.illustrative_dataset;
    if (!dataset || slide.data_status !== "illustrative") return '<div class="proposal-framework-placeholder">分析框架模式｜导出后展示可编辑图表结构，不展示具体数值</div>';
    if (slide.visual_type === "concept_funnel_maxdiff_example") {
      const funnelLabels = ["正确理解", "相关性", "独特性", "技术可信度", "购买意愿"];
      const values = Object.values(dataset.metrics || {});
      const funnel = values.map((value, index) => `<div class="proposal-funnel-row" style="width:${Math.max(46, value)}%"><span>${escapeHtml(funnelLabels[index])}</span><b>${value}%</b></div>`).join("");
      const bars = Object.entries(dataset.selling_point_scores || {}).map(([label, value]) => `<div class="proposal-mini-bar"><span>${escapeHtml(label)}</span><i style="width:${value * 2.5}%"></i><b>${value}</b></div>`).join("");
      return `<div class="proposal-chart-grid"><div>${funnel}</div><div>${bars}</div></div>`;
    }
    const curve = (dataset.pricing?.purchase_curve || []).map((point) => `<div class="proposal-price-point" style="left:${((point.price - 260) / 380) * 85 + 5}%;bottom:${point.intention}%"><b>${point.intention}%</b><span>¥${point.price}</span></div>`).join("");
    const segments = Object.entries(dataset.segment_purchase_intention || {}).map(([label, value]) => `<div class="proposal-mini-bar"><span>${escapeHtml(label)}</span><i style="width:${value}%"></i><b>${value}%</b></div>`).join("");
    return `<div class="proposal-chart-grid"><div class="proposal-price-curve">${curve}</div><div>${segments}</div></div>`;
  }

  function renderCanvas() {
    const canvas = document.querySelector("#proposalDeckCanvas");
    const slide = selectedSlide();
    if (!canvas || !slide) return;
    canvas.className = `proposal-deck-canvas${slide.visual_type === "cover_product_hero" ? " cover" : ""}`;
    const nodes = slide.content.map((entry, index) => {
      const blueprintStyle = slide.visual_type === "decision_output_map" ? ` style="left:${18 + index * 16}%;top:${72 - (index % 3) * 18}%"` : "";
      return `<div class="proposal-node"${blueprintStyle}><strong>${escapeHtml(entry.headline || entry.label)}</strong>${entry.description ? `<small>${escapeHtml(entry.description)}</small>` : ""}</div>`;
    }).join("");
    canvas.innerHTML = `
      <h4 class="proposal-canvas-title">${escapeHtml(slide.title)}</h4>
      ${slide.key_message ? `<p class="proposal-canvas-message">${escapeHtml(slide.key_message)}</p>` : ""}
      ${slide.example_output ? '<span class="proposal-example-label">REPORT EXAMPLE｜报告输出示例</span>' : ""}
      ${slide.visual_type === "cover_product_hero" ? `<p class="proposal-canvas-message">${escapeHtml(slide.subtitle || state.deck.subtitle || "研究方案")}</p><div class="proposal-product-outline">产品示意</div>` : slide.example_output ? renderChartPreview(slide) : `<div class="proposal-visual ${visualClass(slide.visual_type)}">${nodes}</div>`}
      ${slide.example_output && slide.data_status === "illustrative" ? `<p class="proposal-example-disclaimer">${escapeHtml(state.deck.illustrative_dataset?.disclaimer || "")}</p>` : ""}
    `;
  }

  function renderThumbs() {
    const root = document.querySelector("#proposalDeckThumbs");
    if (!root || !state.deck) return;
    root.innerHTML = state.deck.slides.map((slide, index) => `
      <button class="proposal-deck-thumb ${slide.id === state.selectedSlideId ? "active" : ""}" type="button" data-slide-id="${escapeHtml(slide.id)}">
        <span>${index + 1} · ${escapeHtml(VISUAL_TYPES[slide.visual_type] || slide.visual_type)}${slide.locked ? " · 已锁定" : ""}</span>
        <strong>${escapeHtml(slide.title)}</strong>
      </button>`).join("");
    root.querySelectorAll("[data-slide-id]").forEach((button) => button.addEventListener("click", () => {
      state.selectedSlideId = button.dataset.slideId;
      renderAll();
    }));
  }

  function renderInspector() {
    const slide = selectedSlide();
    if (!slide) return;
    document.querySelector("#proposalSlideTitle").value = slide.title;
    document.querySelector("#proposalSlideMessage").value = slide.key_message;
    document.querySelector("#proposalSlideContent").value = slide.content.map((entry) => `${entry.headline}${entry.description ? `｜${entry.description}` : ""}`).join("\n");
    document.querySelector("#proposalSlideVisual").value = slide.visual_type;
    document.querySelector("#proposalSlideDensity").value = slide.content_density || "professional";
    document.querySelector("#proposalSlideLocked").checked = slide.locked;
    const showDataset = Boolean(slide.example_output);
    document.querySelector("#proposalDatasetField").hidden = !showDataset;
    document.querySelector("#proposalDatasetActions").hidden = !showDataset;
    document.querySelector("#proposalSlideDataset").value = showDataset && state.deck.illustrative_dataset ? JSON.stringify(state.deck.illustrative_dataset, null, 2) : "";
  }

  function renderIssues() {
    state.lastIssues = validateDeck(state.deck);
    const root = document.querySelector("#proposalDeckIssues");
    if (!root) return;
    root.innerHTML = state.lastIssues.length
      ? `<strong>质量检查</strong><br>${state.lastIssues.slice(0, 8).map((issue) => `${issue.slide ? `第${issue.slide}页：` : ""}${escapeHtml(issue.message)}`).join("<br>")}`
      : "<strong>质量检查通过</strong><br>未发现阻断导出的问题。";
  }

  function renderVersionOptions() {
    const select = document.querySelector("#proposalDeckVersionSelect");
    if (!select) return;
    select.innerHTML = '<option value="">历史版本</option>' + state.history.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(new Date(entry.createdAt).toLocaleString("zh-CN"))} · ${escapeHtml(entry.label)}</option>`).join("");
  }

  function renderAll() {
    const editor = document.querySelector("#aiPlanDeckEditor");
    if (!state.deck || !editor) return;
    editor.hidden = false;
    document.querySelector("#proposalDeckTitle").textContent = state.deck.title;
    document.querySelector("#proposalDeckStatus").textContent = `${state.deck.page_size} 页 · 16:9 · 现代洞察咨询风 · ${state.deck.slides.filter((slide) => slide.locked).length} 页已锁定`;
    renderThumbs(); renderCanvas(); renderInspector(); renderIssues(); renderVersionOptions();
    const pptButton = document.querySelector("#exportAiPlanPpt");
    if (pptButton) pptButton.disabled = false;
  }

  function setStatus(message, error = false) {
    const editor = document.querySelector("#aiPlanDeckEditor");
    if (editor) editor.hidden = false;
    const status = document.querySelector("#proposalDeckStatus");
    if (status) {
      status.textContent = message;
      status.classList.toggle("warning-text", error);
    }
  }

  function emitProgress(options, step, message) {
    if (typeof options?.onProgress === "function") options.onProgress({ step, message });
  }

  async function generate(config = configFromPage(), wordPlan = "", options = {}) {
    if (state.generating) return state.deck;
    state.generating = true;
    const editor = document.querySelector("#aiPlanDeckEditor");
    if (editor) editor.hidden = false;
    const fallbackStory = buildLocalStory(config);
    const fallbackDeck = buildLocalDeck(config, fallbackStory, wordPlan);
    let story = fallbackStory;
    let deck = fallbackDeck;
    const sourceText = wordPlan || config.brief;
    try {
      emitProgress(options, 1, "\u6b63\u5728\u5206\u6790\u8c03\u7814\u65b9\u6848");
      setStatus("1/5 正在解析调研方案");
      const settings = loadAiSettings();
      emitProgress(options, 2, "\u6b63\u5728\u89c4\u5212 PPT \u6545\u4e8b\u7ebf");
      setStatus("2/5 正在规划 PPT 故事线");
      const storyOutput = await callAiChatCompletion(settings, storyPrompt(config, sourceText), { responseFormat: "json_object", maxTokens: 4500, temperature: 0.25 });
      try {
        const parsedStory = parseJsonCandidate(storyOutput);
        if (Array.isArray(parsedStory.slides) && parsedStory.slides.length) story = parsedStory.slides;
      } catch {
        story = fallbackStory;
      }
      emitProgress(options, 3, "\u6b63\u5728\u751f\u6210\u9875\u9762\u5185\u5bb9");
      setStatus("3/5 正在生成页面内容");
      const deckOutput = await callAiChatCompletion(settings, deckPrompt(config, story, sourceText, fallbackDeck), { responseFormat: "json_object", maxTokens: 12000, temperature: 0.2 });
      try {
        deck = normalizeDeck(parseJsonCandidate(deckOutput), { projectId: projectIdForDeck(), purpose: config.ppt.purpose, exampleOutputMode: config.ppt.exampleOutputMode, contentDensity: config.ppt.contentDensity });
        deck.illustrative_dataset = deck.illustrative_dataset || fallbackDeck.illustrative_dataset;
        deck.illustrative_dataset_id = deck.illustrative_dataset_id || fallbackDeck.illustrative_dataset_id;
        deck.example_output_mode = config.ppt.exampleOutputMode;
      } catch {
        deck = fallbackDeck;
      }
    } catch (error) {
      deck = fallbackDeck;
      setStatus(`AI 生成未完成，已使用本地安全故事线：${error.message}`, true);
    }
    emitProgress(options, 4, "\u6b63\u5728\u68c0\u67e5\u9875\u9762\u8d28\u91cf");
    setStatus("4/5 正在检查页面质量");
    state.deck = normalizeDeck(deck, { projectId: projectIdForDeck(), purpose: config.ppt.purpose, exampleOutputMode: config.ppt.exampleOutputMode, contentDensity: config.ppt.contentDensity });
    const blocking = validateDeck(state.deck).filter((issue) => issue.level === "error");
    if (blocking.length) {
      const badPages = new Set(blocking.filter((issue) => issue.slide).map((issue) => issue.slide - 1));
      state.deck.slides = state.deck.slides.map((slide, index) => badPages.has(index) && fallbackDeck.slides[index] ? clone(fallbackDeck.slides[index]) : slide);
      state.deck.illustrative_dataset = state.deck.illustrative_dataset || fallbackDeck.illustrative_dataset;
      state.deck.illustrative_dataset_id = state.deck.illustrative_dataset_id || fallbackDeck.illustrative_dataset_id;
    }
    state.selectedSlideId = state.deck.slides[0]?.id || "";
    state.history = [];
    pushHistory("初始生成");
    emitProgress(options, 5, "PPT \u65b9\u6848\u5df2\u751f\u6210\uff0c\u53ef\u5bfc\u51fa PPT\u3002");
    setStatus("5/5 生成完成，可逐页编辑并导出");
    state.generating = false;
    renderAll();
    return state.deck;
  }

  function applyInspectorChanges(push = true) {
    const slide = selectedSlide();
    if (!slide || slide.locked) return;
    if (push) pushHistory("编辑前快照");
    slide.title = cleanText(document.querySelector("#proposalSlideTitle").value, 38) || "待完善页面";
    slide.key_message = cleanText(document.querySelector("#proposalSlideMessage").value, 65);
    slide.visual_type = repairVisualType(document.querySelector("#proposalSlideVisual").value);
    slide.content_density = document.querySelector("#proposalSlideDensity")?.value || slide.content_density;
    slide.slide_type = slide.slide_type || SLIDE_TYPE_BY_VISUAL[slide.visual_type];
    slide.content = document.querySelector("#proposalSlideContent").value.split(/\n+/).map((line, index) => {
      const [headline, ...rest] = line.split(/[｜|]/);
      return normalizeItem({ headline, description: rest.join("｜"), source_type: "user_edit" }, index);
    }).filter((entry) => entry.headline && entry.headline !== "待完善");
    renderAll();
  }

  function applyDatasetEdit() {
    if (!state.deck) return;
    try {
      const parsed = JSON.parse(document.querySelector("#proposalSlideDataset").value);
      pushHistory("编辑示例数据前");
      state.deck.illustrative_dataset = { ...parsed, data_status: "illustrative", usable_for_decision: false };
      state.deck.illustrative_dataset_id = parsed.dataset_id || state.deck.illustrative_dataset_id;
      state.deck.example_output_mode = "illustrative";
      state.deck.slides.filter((slide) => slide.example_output).forEach((slide) => { slide.data_status = "illustrative"; });
      renderAll();
    } catch (error) { setStatus(`示例数据JSON无效：${error.message}`, true); }
  }

  function resetDataset() {
    if (!state.deck) return;
    pushHistory("重置示例数据前");
    state.deck.illustrative_dataset = generateIllustrativeDataset(configFromPage());
    state.deck.illustrative_dataset_id = state.deck.illustrative_dataset.dataset_id;
    state.deck.example_output_mode = "illustrative";
    state.deck.slides.filter((slide) => slide.example_output).forEach((slide) => { slide.data_status = "illustrative"; });
    renderAll();
  }

  function switchDatasetFramework() {
    if (!state.deck) return;
    pushHistory("切换纯框架前");
    state.deck.example_output_mode = "framework_only";
    state.deck.illustrative_dataset = null;
    state.deck.slides.filter((slide) => slide.example_output).forEach((slide) => { slide.data_status = "framework_only"; });
    renderAll();
  }

  function moveSlide(delta) {
    const index = state.deck?.slides.findIndex((slide) => slide.id === state.selectedSlideId) ?? -1;
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.deck.slides.length) return;
    pushHistory("调整顺序前");
    [state.deck.slides[index], state.deck.slides[target]] = [state.deck.slides[target], state.deck.slides[index]];
    state.deck.slides.forEach((slide, position) => { slide.order = position + 1; });
    renderAll();
  }

  function deleteSlide() {
    const slide = selectedSlide();
    if (!slide || slide.locked || state.deck.slides.length <= 1) return;
    pushHistory("删除页面前");
    const index = state.deck.slides.findIndex((entry) => entry.id === slide.id);
    state.deck.slides.splice(index, 1);
    state.deck.slides.forEach((entry, position) => { entry.order = position + 1; });
    state.deck.page_size = state.deck.slides.length;
    state.selectedSlideId = state.deck.slides[Math.min(index, state.deck.slides.length - 1)].id;
    renderAll();
  }

  function replaceSlidePreservingLocks(deck, slideId, rawSlide) {
    const nextDeck = clone(deck);
    const index = nextDeck.slides.findIndex((entry) => entry.id === slideId);
    if (index < 0 || nextDeck.slides[index].locked) return nextDeck;
    const replacement = normalizeSlide(rawSlide, index);
    replacement.id = slideId;
    replacement.locked = false;
    nextDeck.slides[index] = replacement;
    nextDeck.slides.forEach((entry, position) => { entry.order = position + 1; });
    nextDeck.page_size = nextDeck.slides.length;
    return nextDeck;
  }

  async function regenerateSlide() {
    const slide = selectedSlide();
    if (!slide) return;
    if (slide.locked) {
      setStatus("当前页已锁定，解除锁定后才能重新生成。", true);
      return;
    }
    pushHistory("单页重生成前");
    const lockedSnapshot = state.deck.slides.filter((entry) => entry.locked).map((entry) => clone(entry));
    try {
      setStatus("正在重新生成当前页，其他页面保持不变");
      const settings = loadAiSettings();
      const output = await callAiChatCompletion(settings, [{ role: "system", content: "只输出一个严格JSON页面对象，不输出坐标或代码。保留故事线关系、数据状态和图表定义。illustrative数据只能引用现有dataset_id，不得重新生成整套数据。" }, { role: "user", content: `重写当前页面，保持slide_type和visual_type，补足专业细节并避免与其他页重复。当前页：${JSON.stringify(slide)}。现有illustrative_dataset_id：${state.deck.illustrative_dataset_id || "无"}。整套故事线：${state.deck.slides.map((entry) => entry.slide_question).join(" → ")}` }], { responseFormat: "json_object", maxTokens: 3600, temperature: 0.25 });
      state.deck = replaceSlidePreservingLocks(state.deck, slide.id, parseJsonCandidate(output));
      lockedSnapshot.forEach((locked) => {
        const index = state.deck.slides.findIndex((entry) => entry.id === locked.id);
        if (index >= 0) state.deck.slides[index] = locked;
      });
      setStatus("当前页已重新生成");
    } catch (error) {
      setStatus(`当前页重新生成失败：${error.message}`, true);
    }
    renderAll();
  }

  function saveToProject() {
    if (!state.deck) return;
    try {
      const project = loadWorkspaceProject() || getWorkspaceFormProject();
      const decks = Array.isArray(project.proposalDecks) ? clone(project.proposalDecks) : [];
      let record = decks.find((entry) => entry.deckId === state.deck.deck_id);
      if (!record) {
        record = { deckId: state.deck.deck_id, title: state.deck.title, versions: [] };
        decks.unshift(record);
      }
      record.title = state.deck.title;
      record.updatedAt = new Date().toISOString();
      record.versions.unshift({ id: uid("version"), createdAt: record.updatedAt, deck: clone(state.deck) });
      record.versions = record.versions.slice(0, 20);
      upsertWorkspaceProject({ ...project, proposalDecks: decks.slice(0, 20) }, "保存 AI 调研方案 PPT 版本");
      pushHistory("保存到项目档案");
      setStatus("已保存到当前项目档案，可继续编辑或恢复历史版本");
    } catch (error) {
      setStatus(`保存项目档案失败：${error.message}`, true);
    }
  }

  function restoreVersion() {
    const id = document.querySelector("#proposalDeckVersionSelect")?.value;
    const entry = state.history.find((version) => version.id === id);
    if (!entry) return;
    state.deck = clone(entry.deck);
    state.selectedSlideId = state.deck.slides[0]?.id || "";
    renderAll();
    setStatus(`已恢复版本：${entry.label}`);
  }

  function showDeckDiff() {
    const baseline = state.history[state.history.length - 1]?.deck;
    if (!baseline || !state.deck) { setStatus("暂无可比较的历史版本", true); return; }
    const previous = new Map(baseline.slides.map((slide) => [slide.id, slide]));
    const changed = state.deck.slides.filter((slide) => JSON.stringify(slide) !== JSON.stringify(previous.get(slide.id))).map((slide) => slide.order);
    const added = state.deck.slides.filter((slide) => !previous.has(slide.id)).length;
    const removed = baseline.slides.filter((slide) => !state.deck.slides.some((entry) => entry.id === slide.id)).length;
    setStatus(changed.length || added || removed ? `与初始版本相比：修改页面 ${changed.join("、") || "无"}；新增 ${added} 页；删除 ${removed} 页。` : "当前内容与初始版本一致");
  }

  async function exportPptx() {
    if (!state.deck) return;
    applyInspectorChanges(false);
    const errors = validateDeck(state.deck).filter((issue) => issue.level === "error");
    if (errors.length) {
      setStatus(`导出前检查未通过：${errors.map((issue) => issue.message).join("；")}`, true);
      return;
    }
    const button = document.querySelector("#exportAiPlanPpt");
    if (button) { button.disabled = true; button.textContent = "正在生成 PPT"; }
    try {
      setStatus("正在生成可编辑 PPT");
      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch("/pptx-api/proposal-deck", { method: "POST", headers: { "Content-Type": "application/json", "X-Project-Id": state.deck.project_id }, body: JSON.stringify(state.deck) });
        if (response.ok || response.status < 500) break;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || `PPT 导出服务返回 ${response.status}`);
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error("PPT 文件生成为空。");
      downloadBlob(`${state.deck.title || "AI调研方案"}.pptx`, blob);
      setStatus("PPT 生成完成并已下载");
    } catch (error) {
      setStatus(`PPT 导出失败：${error.message}。请检查本地/线上 PPT 服务后重试。`, true);
    } finally {
      if (button) { button.disabled = false; button.textContent = "导出 PPT"; }
    }
  }

  function syncMode() {
    const mode = document.querySelector("#aiPlanMode")?.value || "word";
    const settings = document.querySelector("#aiPlanPptSettings");
    if (settings) settings.hidden = mode === "word";
    const wordButtons = ["#exportAiPlanWord", "#exportAiPlanMd", "#copyAiPlan"];
    wordButtons.forEach((selector) => {
      const button = document.querySelector(selector);
      if (button) button.hidden = mode === "ppt";
    });
  }

  function init() {
    const visualSelect = document.querySelector("#proposalSlideVisual");
    if (!visualSelect) return;
    visualSelect.innerHTML = Object.entries(VISUAL_TYPES).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    document.querySelector("#aiPlanMode")?.addEventListener("change", syncMode);
    ["#proposalSlideTitle", "#proposalSlideMessage", "#proposalSlideContent", "#proposalSlideVisual", "#proposalSlideDensity"].forEach((selector) => {
      document.querySelector(selector)?.addEventListener("change", () => applyInspectorChanges(true));
    });
    document.querySelector("#proposalSlideLocked")?.addEventListener("change", (event) => {
      const slide = selectedSlide(); if (!slide) return;
      pushHistory("锁定状态变更前"); slide.locked = event.target.checked; renderAll();
    });
    document.querySelector("#proposalSlideUp")?.addEventListener("click", () => moveSlide(-1));
    document.querySelector("#proposalSlideDown")?.addEventListener("click", () => moveSlide(1));
    document.querySelector("#proposalSlideDelete")?.addEventListener("click", deleteSlide);
    document.querySelector("#proposalSlideRegenerate")?.addEventListener("click", regenerateSlide);
    document.querySelector("#proposalDeckSave")?.addEventListener("click", saveToProject);
    document.querySelector("#proposalDeckRestore")?.addEventListener("click", restoreVersion);
    document.querySelector("#proposalDeckDiff")?.addEventListener("click", showDeckDiff);
    document.querySelector("#proposalSlideDataset")?.addEventListener("change", applyDatasetEdit);
    document.querySelector("#proposalDatasetReset")?.addEventListener("click", resetDataset);
    document.querySelector("#proposalDatasetFramework")?.addEventListener("click", switchDatasetFramework);
    document.querySelector("#exportAiPlanPpt")?.addEventListener("click", exportPptx);
    syncMode();
  }

  window.ProposalDeck = {
    VISUAL_TYPES,
    state,
    parseJsonCandidate,
    normalizeDeck,
    validateDeck,
    buildLocalStory,
    buildLocalDeck,
    generateIllustrativeDataset,
    resetDataset,
    renderCanvas,
    replaceSlidePreservingLocks,
    generate,
    regenerateSlide,
    exportPptx,
    init
  };

  init();
})();
