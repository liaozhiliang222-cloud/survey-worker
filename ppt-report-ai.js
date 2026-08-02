(function initPptReportAi(root) {
  "use strict";

  const DEFAULT_BATCH_SIZE = 4;
  const REPAIR_BATCH_SIZE = 2;
  const SLIDE_BRIEF_CONCURRENCY = 3;
  const SLIDE_BRIEF_TIMEOUT_MS = 150000;
  const SLIDE_BRIEF_REPAIR_TIMEOUT_MS = 90000;
  const REPORT_STORYLINE_TYPES = [
    "problem_solution",
    "user_journey",
    "funnel",
    "diagnosis",
    "opportunity",
  ];
  function normalizeStorylineType(value, chapters = []) {
    const raw = String(value || "").trim().toLowerCase();
    const normalized = raw.replace(/[\s-]+/g, "_");
    if (REPORT_STORYLINE_TYPES.includes(normalized)) return normalized;
    if (/(?:problem.*solution|问题.*解决|问题.*方案|痛点.*方案|挑战.*对策)/i.test(raw)) return "problem_solution";
    if (/(?:user.*journey|customer.*journey|用户旅程|客户旅程|触点旅程)/i.test(raw)) return "user_journey";
    if (/(?:funnel|漏斗|转化链路|转化路径)/i.test(raw)) return "funnel";
    if (/(?:opportunit|growth|机会|增长空间|潜力)/i.test(raw)) return "opportunity";
    if (/(?:diagnos|analysis|insight|诊断|归因|洞察|分析)/i.test(raw)) return "diagnosis";
    const chapterText = (chapters || []).flatMap((chapter) => [
      chapter?.title, chapter?.purpose, chapter?.key_question,
    ]).filter(Boolean).join(" ").toLowerCase();
    const text = `${raw} ${chapterText}`;
    if (/(?:problem.*solution|问题.*解决|问题.*方案|痛点.*方案|挑战.*对策)/i.test(text)) return "problem_solution";
    if (/(?:user.*journey|customer.*journey|用户旅程|客户旅程|触点旅程)/i.test(text)) return "user_journey";
    if (/(?:funnel|漏斗|转化链路|转化路径)/i.test(text)) return "funnel";
    if (/(?:opportunit|growth|机会|增长空间|潜力)/i.test(text)) return "opportunity";
    if (/(?:diagnos|analysis|insight|诊断|归因|洞察|分析)/i.test(text)) return "diagnosis";
    return "diagnosis";
  }

  const REPORT_NARRATIVE_SYSTEM_PROMPT = [
    "先读取 research_intent_hints，根据本项目研究目的动态建立 1–8 个 Research Theme；不要套用固定 taxonomy，也不要照抄 current_report_structure。",
    "同一次返回中必须包含 research_themes、chapter_rules 和 research_theme_assignments。逐页 assignment 只能引用本次创建的 theme_id。",
    "章节必须对应 research_themes.allowed_chapters；每章输出 allowed_themes，且 page_idxs 中每页的 research_theme 必须被该章允许。",
    "先判断发现服务哪个研究问题，再决定章节；不得仅因出现功能、需求、购买等词改变研究主题。",
    "你是资深市场研究顾问。请根据 DataFact、Insight 列表和研究目标，先设计整份报告的 Report Narrative。",
    "先形成一个中心论点，不要简单罗列发现。central_thesis 必须是一个完整判断，不是主题描述或报告标题。",
    "必须先读取 research_archetype、core_research_module、priority_instructions 和 priority_page_idxs，并确保优先研究问题进入中心论点且在正文中得到充分回答。",
    "core_research_module 是用户确认的最高优先级，但不等于第一章；章节位置必须服从整份报告的连续故事线。",
    "当 research_archetype=concept_test 时，central_thesis 必须判断概念/产品的整体表现（如购买可能、喜好、吸引力、差异化或转化潜力），并在最合适的章节纳入 priority_page_idxs 中的页面。",
    "用户画像、需求和障碍用于解释概念表现与优化方向；可按论证需要前置，但不得取代概念测试结果成为中心结论。",
    "章节必须形成连续论证，例如用户是谁→为什么购买→为什么流失→如何提升；禁止按满意度、购买因素、会员等指标机械分章。",
    "默认规划 4–6 章，硬性限制 3–8 章。每章都必须包含 chapter_id、title、purpose、key_question、page_idxs、analysis_strategy。",
    "page_idxs 必须把输入 page_catalog 中的全部页面分配到新章节，且每个页面只能出现一次；章节顺序和 page_idxs 顺序就是最终报告顺序。",
    "必须先读取 dimension_catalog，再为每章推荐分析维度。analysis_strategy 只包含 baseline_dimension、primary_dimensions、supporting_dimensions、rationale；只能使用 dimension_catalog 中存在的维度，最终由用户确认。",
    "总体是默认基准；每章最多 1 个主维度和 1 个辅助维度。不要为了使用维度而强行分群，章节不适合对比时使用总体；不要输出逐页维度计划。",
    "storyline_type 只能是 problem_solution、user_journey、funnel、diagnosis、opportunity 之一。",
    "不得编造 DataFact 中不存在的数字或结论；confidence 必须在 0 到 1 之间。",
    "只返回 JSON：{\"report_title\":\"\",\"central_thesis\":\"\",\"storyline_type\":\"diagnosis\",\"research_themes\":[{\"theme_id\":\"project_theme\",\"name\":\"\",\"description\":\"\",\"decision_area\":\"\",\"allowed_chapters\":[\"\"],\"keywords\":[],\"priority\":1}],\"chapter_rules\":[{\"chapter\":\"\",\"allowed_themes\":[\"project_theme\"]}],\"research_theme_assignments\":[{\"classification_id\":\"page:1\",\"page_idx\":1,\"theme_id\":\"project_theme\",\"chapter_reason\":\"\",\"confidence\":0.9}],\"chapters\":[{\"chapter_id\":\"chapter_01\",\"title\":\"\",\"purpose\":\"\",\"key_question\":\"\",\"allowed_themes\":[\"project_theme\"],\"page_idxs\":[1,2],\"analysis_strategy\":{\"baseline_dimension\":\"总体\",\"primary_dimensions\":[\"用户类型\"],\"supporting_dimensions\":[],\"rationale\":\"\"}}],\"key_questions\":[],\"ending_message\":\"\",\"confidence\":0.9}。",
  ].join("\n");

  const PAGE_BLUEPRINT_SYSTEM_PROMPT = [
    "你是市场研究报告的信息架构师。请根据已经确定的 Report Narrative 和逐题目录，规划最终分析页的题目组合。",
    "不要照抄 current_report_structure；page_blueprint 必须按章节论证顺序重新组合题目。",
    "每个规划页包含 page_id、chapter_id、title、purpose、question_ids；chapter_id 必须来自 chapters。",
    "question_ids 必须完整覆盖 question_catalog 中的全部题目，每题只出现一次，每页 1–6 题。",
    "只把共同回答一个分析问题、构成因果、对比或递进关系的题放在同页；主题无关的题必须拆开。",
    "短选项题且高度相关时可合并 5–6 题；长选项、矩阵题、系列较多或复杂研究模型应减少同页题数。",
    "不同样本口径或不兼容研究模型不得强行组合。页面顺序必须服务于 central_thesis 和章节 key_question。",
    "只返回 JSON：{\"page_blueprint\":[{\"page_id\":\"page_01\",\"chapter_id\":\"chapter_01\",\"title\":\"\",\"purpose\":\"\",\"question_ids\":[\"Q1\",\"Q2\"]}]}。",
  ].join("\n");

  const SLIDE_BRIEF_SYSTEM_PROMPT = [
    "输入页面若包含 research_theme、decision_area 和 chapter_reason，标题、claim 与 business_implication 必须服务该研究目的。",
    "不得把页面改写成其他主题；research_theme 和 decision_area 由系统确定，模型只负责在该约束下写作。",
    "你是资深市场研究报告总监。请在给定 Report Narrative 下，为每页生成 SlideBrief 文案。",
    "每批输入包含 central_thesis、chapter_context、previous_chapter、next_chapter；标题和正文必须服务于本章目的，并与前后章节连续。",
    "chapter_context.analysis_strategy 定义本章分析维度；每页 dimensions 是本页实际图表维度。标题、claim 和 bullets 必须解释当前 dimensions 下的证据，不得沿用其他维度结论。",
    "只允许使用该页 questions、DataFact、evidence_fact_ids、evidence_question_ids 中的证据，不得重新计算或编造数字。",
    "model_semantics 是指标的强约束定义：PSM 单条累计曲线不得解释为购买接受率、峰值或价格上下限，交点指标只能引用系统已计算结果。",
    "如果 data_quality_warnings 非空，不得引用被修复前的值；所有数字、选项和人群必须能在同一行证据中对应，不能只校验数字是否在本页出现。",
    "正文、标题、claim 和 business_implication 均不得出现百分比；百分比证据只保留在图表、数据标签或独立指标组件中，不要改写进正文。",
    "必须原样返回每页 slide_id；slide_id 是写回蓝图的唯一主键，page_idx 只用于展示顺序。",
    "标题和 claim 必须先给判断，不得包含百分比。",
    "每页正文按固定职责输出：bullets[0] 写关系、机制、障碍或模式判断；bullets[1] 写新增解释、适用范围或关键差异；bullets[2] 仅在有新的分析价值时使用。所有 bullets 均不得出现百分比或逐项排名。",
    "business_implication 只写决策含义、优先级或下一步动作，不得出现百分比。若证据不足以解释原因，使用集中、分化、断层、趋同、转折等中性模式判断，不要把选项占比改写成句子。",
    "页面包含多道题时，标题必须概括这些题之间的共同关系，不能只用其中一张图的选项替代整页主题；若无法综合，使用中性的组合标题。",
    "子样本题、特定车型或特定用户题必须在标题或正文中保留适用范围；不得把自行车、摩托车、已安装用户等子样本结论泛化为全部两轮车用户。",
    "正文不得引用百分比，不得逐项复述图表；需要查看的具体比例由页面图表和数据标签承担。",
    "允许使用‘反映’‘提示’‘可能与…有关’进行谨慎解释，但不得把推测写成已证实事实；相邻页面不得重复完全相同的结论。",
    "只返回 JSON：{\"pages\":[{\"slide_id\":\"finding_001\",\"page_idx\":1,\"title\":\"\",\"claim\":\"\",\"bullets\":[\"\",\"\"],\"business_implication\":\"\"}]}。证据 ID 由系统按页面确定性回填。",
  ].join("\n");

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
  }

  function researchThemeApi() {
    return root.ResearchThemeClassifier || null;
  }

  function researchThemeClassification(context = {}) {
    return context?.research_theme_classification || null;
  }

  function compactResearchThemeClassification(classification = null) {
    if (!classification?.themes?.length) return null;
    return {
      version: String(classification.version || "research_theme_dynamic_v1"),
      themes: (classification.themes || []).map((theme) => ({
        theme_id: String(theme?.theme_id || ""),
        name: String(theme?.name || ""),
        description: String(theme?.description || ""),
        decision_area: String(theme?.decision_area || ""),
        allowed_chapters: uniqueStrings(theme?.allowed_chapters),
        keywords: uniqueStrings(theme?.keywords),
        priority: Number(theme?.priority) || 0,
      })),
      chapter_rules: (classification.chapter_rules || []).map((rule) => ({
        chapter: String(rule?.chapter || ""),
        allowed_themes: uniqueStrings(rule?.allowed_themes),
      })),
      assignments: (classification.assignments || []).map((assignment) => ({
        classification_id: String(assignment?.classification_id || ""),
        unit_type: String(assignment?.unit_type || ""),
        page_idx: Number(assignment?.page_idx),
        finding_idx: Number(assignment?.finding_idx),
        question_ids: uniqueStrings(assignment?.question_ids),
        research_theme: String(assignment?.research_theme || ""),
        theme_name: String(assignment?.theme_name || ""),
        decision_area: String(assignment?.decision_area || ""),
        allowed_chapters: uniqueStrings(assignment?.allowed_chapters),
        chapter_reason: String(assignment?.chapter_reason || ""),
        source: String(assignment?.source || ""),
        confidence: Number(assignment?.confidence) || 0,
      })),
      unresolved: Array.from(classification.unresolved || []),
      status: String(classification.status || ""),
      fallback_used: Boolean(classification.fallback_used),
      error: String(classification.error || ""),
    };
  }
  const CONCEPT_CHAPTER_PATTERN = /\u6982\u5ff5(?:\u6d4b\u8bd5|\u8bc4\u4ef7|\u9a8c\u8bc1)/;
  const CONCEPT_PRIMARY_OUTCOME_PATTERN = /(?:\u4e86\u89e3.*\u6982\u5ff5.*\u8d2d\u4e70.*\u53ef\u80fd|\u8d2d\u4e70\u53ef\u80fd\u6027|\u6574\u4f53.*\u8d2d\u4e70\u610f\u5411|\u8d2d\u4e70\u610f\u5411.*\u591a\u5927)/;
  const CONCEPT_OUTCOME_PATTERN = /\u8d2d\u4e70(?:\u610f\u5411|\u53ef\u80fd|\u613f\u610f)|\u559c\u597d|\u559c\u6b22|\u5438\u5f15|\u72ec\u7279|\u5dee\u5f02\u5316|\u63a5\u53d7|\u8f6c\u5316\u6f5c\u529b/;

  function pageResearchText(page) {
    return [
      page?.source_chapter, page?.research_role, page?.chapter, page?.current_title, page?.title,
      ...(page?.questions || []).flatMap((question) => [question?.code, question?.title]),
    ].filter(Boolean).join(" ");
  }

  function detectResearchArchetype(context = {}) {
    const pages = context?.pages || [];
    const conceptPages = pages.filter((page) => CONCEPT_CHAPTER_PATTERN.test(pageResearchText(page)));
    return conceptPages.length ? "concept_test" : "general";
  }

  function conceptPriorityPageIndexes(context = {}) {
    const conceptPages = (context?.pages || []).filter((page) =>
      CONCEPT_CHAPTER_PATTERN.test(pageResearchText(page))
    );
    const primaryPages = conceptPages.filter((page) =>
      CONCEPT_PRIMARY_OUTCOME_PATTERN.test(pageResearchText(page))
    );
    const outcomePages = conceptPages.filter((page) =>
      CONCEPT_OUTCOME_PATTERN.test(pageResearchText(page))
    );
    const prioritized = primaryPages.length ? primaryPages : (outcomePages.length ? outcomePages : conceptPages);
    return uniqueStrings(prioritized.map((page) =>
      String(Number(page.page_idx))
    )).map(Number).filter(Number.isFinite);
  }

  function selectedCoreResearchModule(context = {}) {
    return String(context?.core_research_module || "").trim();
  }

  function coreResearchPageIndexes(context = {}, moduleName = selectedCoreResearchModule(context)) {
    const selected = String(moduleName || "").trim();
    if (!selected) return [];
    return uniqueStrings((context?.pages || [])
      .filter((page) => page?.research_role === "core"
        || String(page?.source_chapter || page?.chapter || "").trim() === selected)
      .map((page) => String(Number(page.page_idx))))
      .map(Number).filter(Number.isFinite);
  }

  function chapterAnalysisDimensions(strategy = {}) {
    const comparisonDimensions = uniqueStrings([
      ...(strategy.primary_dimensions || []),
      ...(strategy.supporting_dimensions || []),
    ]).filter((dimension) => dimension !== "总体").slice(0, 2);
    return comparisonDimensions.length
      ? comparisonDimensions
      : uniqueStrings([strategy.baseline_dimension || "总体"]).slice(0, 1);
  }

  function parseJsonObject(output) {
    const raw = String(output || "").replace(/^\uFEFF/, "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
    const text = fenced || raw;
    for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let endIdx = -1;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            endIdx = index;
            break;
          }
        }
      }
      // 完整闭合的 JSON：直接解析
      if (endIdx >= 0) {
        const candidate = text.slice(start, endIdx + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          continue; // 解析失败时尝试下一个 { 起点（之前是 break，会漏掉后续有效 JSON）
        }
      }
      // 截断的 JSON（depth > 0 且未找到闭合）：尝试补全未闭合的括号与字符串
      if (depth > 0) {
        const truncated = text.slice(start);
        const repaired = repairTruncatedJson(truncated);
        if (repaired) {
          try {
            return JSON.parse(repaired);
          } catch {
            // 修复失败则继续找下一个 { 起点
          }
        }
      }
    }
    throw new Error("模型未返回可解析的 JSON 对象");
  }

  // 修复被 maxTokens 截断的 JSON：补全未闭合的字符串和括号
  function repairTruncatedJson(text) {
    if (!text || text[0] !== "{") return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let lastValidPos = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      // 记录最后一个完整键值对后的逗号或括号位置
      if (char === "," || char === "{" || char === "}") lastValidPos = i;
    }
    // 字符串未闭合：补上闭合引号
    let repaired = text;
    if (inString) repaired += '"';
    // 从 lastValidPos 之后截断未完成的键值对，再补全括号
    if (lastValidPos > 0 && lastValidPos < repaired.length - 1) {
      // 如果最后一个有效字符是逗号，保留到逗号前
      if (repaired[lastValidPos] === ",") {
        repaired = repaired.slice(0, lastValidPos);
      }
    }
    // 移除末尾可能的孤立冒号或不完整的键
    repaired = repaired.replace(/,[\s\n]*$/, "").replace(/:\s*$/, "");
    // 补全未闭合的 }
    let openBraces = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < repaired.length; i += 1) {
      const c = repaired[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") openBraces += 1;
      else if (c === "}") openBraces -= 1;
    }
    while (openBraces > 0) {
      repaired += "}";
      openBraces -= 1;
    }
    return repaired;
  }

  function chunkPages(pages, requestedSize = DEFAULT_BATCH_SIZE) {
    const size = Math.max(3, Math.min(6, Number(requestedSize) || DEFAULT_BATCH_SIZE));
    const result = [];
    for (let index = 0; index < (pages || []).length; index += size) {
      result.push(pages.slice(index, index + size));
    }
    return result;
  }

  function chunkPagesByChapter(pages, requestedSize = DEFAULT_BATCH_SIZE) {
    const size = Math.max(2, Math.min(4, Number(requestedSize) || DEFAULT_BATCH_SIZE));
    const result = [];
    let current = [];
    let chapter = "";
    (pages || []).forEach((page) => {
      const pageChapter = String(page?.chapter || "其他研究");
      if (current.length && (current.length >= size || pageChapter !== chapter)) {
        result.push(current);
        current = [];
      }
      chapter = pageChapter;
      current.push(page);
    });
    if (current.length) result.push(current);
    return result;
  }

  function chunkRepairPages(pages, requestedSize = REPAIR_BATCH_SIZE) {
    const size = Math.max(1, Math.min(2, Number(requestedSize) || REPAIR_BATCH_SIZE));
    const result = [];
    for (let index = 0; index < (pages || []).length; index += size) {
      result.push(pages.slice(index, index + size));
    }
    return result;
  }
  function filterWritablePages(pages) {
    return (pages || []).filter((page) => {
      const brief = page?.slide_brief || {};
      return !brief.locked && !brief.user_modified;
    });
  }

  async function mapWithConcurrency(items, requestedConcurrency, worker, onProgress) {
    const values = Array.from(items || []);
    if (!values.length) return [];
    const concurrency = Math.max(1, Math.min(values.length, Number(requestedConcurrency) || 1));
    const results = new Array(values.length);
    let cursor = 0;
    let completed = 0;
    let firstError = null;
    async function runWorker() {
      while (!firstError) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        try {
          results[index] = await worker(values[index], index);
          completed += 1;
          if (typeof onProgress === "function") onProgress(completed, values.length, index);
        } catch (error) {
          firstError = error;
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
    if (firstError) throw firstError;
    return results;
  }
  function pageQuestionIds(page) {
    return uniqueStrings((page?.questions || []).map((question) => question.code));
  }


  function compactFact(fact) {
    const result = {};
    [
      "fact_id", "question_id", "fact_type", "metric_name", "segment", "category", "value",
      "benchmark_value", "gap_pp", "rank", "base", "significant", "confidence",
    ].forEach((key) => {
      const value = fact?.[key];
      if (value !== null && value !== undefined && value !== "") result[key] = value;
    });
    return result;
  }

  function compactQuestion(question, evidenceFactIds = []) {
    const evidenceSet = new Set(uniqueStrings(evidenceFactIds));
    const allFacts = Array.isArray(question?.facts) ? question.facts : [];
    const matchedFacts = evidenceSet.size
      ? allFacts.filter((fact) => evidenceSet.has(String(fact?.fact_id || "")))
      : [];
    const selectedFacts = (matchedFacts.length ? matchedFacts : allFacts.slice(0, 10));
    const evidenceLabels = new Set(selectedFacts.flatMap((fact) => [
      String(fact?.category || "").trim(),
      String(fact?.metric_name || "").trim(),
    ]).filter(Boolean));
    const allRows = Array.isArray(question?.rows) ? question.rows : [];
    const matchedRows = evidenceLabels.size
      ? allRows.filter((row) => evidenceLabels.has(String(row?.option || "").trim()))
      : [];
    const selectedRows = (matchedRows.length ? matchedRows : allRows).slice(0, 12);
    return {
      code: String(question?.code || ""),
      title: String(question?.title || ""),
      data_kind: String(question?.data_kind || ""),
      model_semantics: question?.model_semantics || {},
      data_quality_warnings: question?.data_quality_warnings || [],
      base: question?.base || {},
      rows: selectedRows.map((row) => ({
        option: String(row?.option || ""),
        values: row?.values || {},
      })),
      facts: selectedFacts.map(compactFact),
    };
  }

  function buildNarrativeInput(context) {
    return {
      source: String(context?.source || ""),
      global_findings: (context?.global_findings || []).map((finding) => ({
        title: finding.title,
        description: finding.description,
        evidence_fact_ids: uniqueStrings(finding.evidence_fact_ids),
        evidence_question_ids: uniqueStrings(finding.evidence_question_ids),
        action_implication: finding.action_implication,
        importance: finding.importance,
      })),
      pages: (context?.pages || []).map((page) => ({
        page_idx: Number(page.page_idx),
        chapter: page.chapter,
        current_title: page.current_title,
        slide_brief: page.slide_brief || {},
        evidence_fact_ids: uniqueStrings(page.evidence_fact_ids),
        evidence_question_ids: pageQuestionIds(page),
        source_references: uniqueStrings(page.source_references),
      })),
    };
  }

  function reportQuestionCatalog(context = {}) {
    const seen = new Set();
    return (context?.pages || []).flatMap((page) => (page.questions || []).map((question) => {
      const questionId = String(question?.code || "").trim();
      if (!questionId || seen.has(questionId)) return null;
      seen.add(questionId);
      return {
        question_id: questionId,
        title: String(question?.title || questionId).trim(),
        source_chapter: String(page.source_chapter || page.chapter || "").trim(),
        current_page_idx: Number(page.page_idx),
        data_kind: String(question?.data_kind || "").trim(),
        option_count: Array.isArray(question?.rows) ? question.rows.length : 0,
        series_count: Math.max(0, ...(question?.rows || []).map((row) => Object.keys(row?.values || {}).length)),
        analysis_model: String(question?.model_semantics?.analysis_model || "").trim(),
        sample_scope: String(question?.model_semantics?.sample_scope || question?.base_scope || "").trim(),
      };
    })).filter(Boolean);
  }

  function compactReportFacts(facts, perQuestionLimit = 3, totalLimit = 160) {
    const counts = new Map();
    const selected = [];
    for (const fact of (facts || [])) {
      const questionId = String(fact?.question_id || "").trim();
      const key = questionId || "__global__";
      const count = counts.get(key) || 0;
      if (count >= perQuestionLimit || selected.length >= totalLimit) continue;
      counts.set(key, count + 1);
      selected.push(compactFact(fact));
    }
    return selected;
  }

  function buildReportNarrativeInput(context, researchObjective = "") {
    const pages = context?.pages || [];
    const chapters = [];
    pages.forEach((page) => {
      const title = String(page.chapter || "其他研究");
      let chapter = chapters.find((item) => item.title === title);
      if (!chapter) {
        chapter = { title, page_idxs: [], question_ids: [] };
        chapters.push(chapter);
      }
      chapter.page_idxs.push(Number(page.page_idx));
      chapter.question_ids.push(...pageQuestionIds(page));
      chapter.question_ids = uniqueStrings(chapter.question_ids);
    });
    const researchArchetype = detectResearchArchetype(context);
    const coreResearchModule = selectedCoreResearchModule(context);
    const priorityPageIndexes = coreResearchModule
      ? coreResearchPageIndexes(context, coreResearchModule)
      : (researchArchetype === "concept_test" ? conceptPriorityPageIndexes(context) : []);
    const classifier = researchThemeApi();
    const classification = compactResearchThemeClassification(researchThemeClassification(context));
    const assignmentByQuestion = new Map();
    (classification?.assignments || []).filter((assignment) => assignment.unit_type === "page")
      .forEach((assignment) => (assignment.question_ids || []).forEach((questionId) => {
        if (!assignmentByQuestion.has(questionId)) assignmentByQuestion.set(questionId, assignment);
      }));
    const assignmentForPage = (page) => classifier?.assignmentForPage?.(classification, page) || null;
    const assignmentForFinding = (finding, index) =>
      classifier?.assignmentForFinding?.(classification, finding, index) || null;
    const withTheme = (target, assignment) => assignment ? {
      ...target,
      research_theme: assignment.research_theme,
      decision_area: assignment.decision_area,
      chapter_reason: assignment.chapter_reason,
    } : target;
    return {
      report_title: String(researchObjective || context?.research_objective || context?.source || "调研报告"),
      research_archetype: researchArchetype,
      core_research_module: coreResearchModule,
      priority_page_idxs: priorityPageIndexes,
      priority_instructions: coreResearchModule ? [
        "用户确认的核心研究模块是“" + coreResearchModule + "”。",
        "中心论点必须回答该模块，正文必须完整覆盖 priority_page_idxs 中的页面。",
        "不要因核心模块而强制调整到第一章；章节位置与先后顺序应服从完整故事线。",
      ] : researchArchetype === "concept_test" ? [
        "先回答概念/产品整体表现，再解释目标人群、需求、障碍和优化方向。",
        "中心论点必须包含概念表现的判断，不能只写高意向用户画像。",
        "正文必须覆盖 priority_page_idxs 中的页面，但不强制放在第一章。",
      ] : [],
      research_objective: String(researchObjective || context?.research_objective || ""),
      research_intent_hints: context?.research_intent_hints || null,
      research_themes: classification?.themes || [],
      chapter_rules: classification?.chapter_rules || [],
      research_theme_assignments: classification?.assignments || [],
      research_theme_status: classification?.status || "unavailable",
      dimension_catalog: (context?.available_dimensions || []).map((dimension) => ({
        key: String(dimension?.key || "").trim(),
        label: String(dimension?.label || dimension?.key || "").trim(),
        segments: uniqueStrings(dimension?.segments),
      })).filter((dimension) => dimension.key),
      data_facts: compactReportFacts(context?.data_facts || []).map((fact) =>
        withTheme(fact, assignmentByQuestion.get(String(fact?.question_id || "")))
      ),
      insights: (context?.global_findings || []).slice(0, 24).map((finding, index) => withTheme({
        title: String(finding?.title || "").trim(),
        description: String(finding?.description || "").trim(),
        evidence_fact_ids: uniqueStrings(finding?.evidence_fact_ids).slice(0, 6),
        evidence_question_ids: uniqueStrings(finding?.evidence_question_ids).slice(0, 6),
        action_implication: String(finding?.action_implication || "").trim(),
      }, assignmentForFinding(finding, index))),
      current_report_structure: chapters,
      require_page_blueprint: true,
      question_catalog: reportQuestionCatalog(context),
      page_catalog: pages.map((page) => {
        const assignment = assignmentForPage(page);
        return withTheme({
          page_idx: Number(page.page_idx),
          source_chapter: String(page.source_chapter || page.chapter || ""),
          research_role: String(page.research_role || ""),
          page_type: String(page.page_type || page.slide_type || page.type || ""),
          current_chapter: String(page.chapter || "其他研究"),
          current_title: String(page.current_title || page.title || ""),
          question_ids: pageQuestionIds(page),
          current_dimensions: uniqueStrings(page.dimensions),
          question_titles: uniqueStrings((page.questions || []).map((question) => question.title)),
        }, assignment);
      }),
    };
  }  function buildReportFrameworkInput(narrativeInput = {}) {
    const clip = (value, limit) => String(value || "").trim().slice(0, limit);
    return {
      report_title: clip(narrativeInput.report_title, 120),
      research_objective: clip(narrativeInput.research_objective, 240),
      research_archetype: String(narrativeInput.research_archetype || ""),
      core_research_module: String(narrativeInput.core_research_module || ""),
      priority_page_idxs: Array.from(narrativeInput.priority_page_idxs || []),
      priority_instructions: Array.from(narrativeInput.priority_instructions || []),
      research_intent_hints: narrativeInput.research_intent_hints || null,
      research_themes: (narrativeInput.research_themes || []).map((theme) => ({
        theme_id: String(theme?.theme_id || ""),
        name: clip(theme?.name, 80),
        description: clip(theme?.description, 180),
        decision_area: clip(theme?.decision_area, 120),
        allowed_chapters: uniqueStrings(theme?.allowed_chapters),
        priority: Number(theme?.priority) || 0,
      })),
      chapter_rules: (narrativeInput.chapter_rules || []).map((rule) => ({
        chapter: clip(rule?.chapter, 100),
        allowed_themes: uniqueStrings(rule?.allowed_themes),
      })),
      research_theme_assignments: (narrativeInput.research_theme_assignments || []).map((assignment) => ({
        page_idx: Number(assignment?.page_idx),
        question_ids: uniqueStrings(assignment?.question_ids),
        research_theme: String(assignment?.research_theme || ""),
        decision_area: clip(assignment?.decision_area, 120),
        chapter_reason: clip(assignment?.chapter_reason, 180),
      })).filter((assignment) => Number.isFinite(assignment.page_idx) && assignment.research_theme),
      dimension_catalog: (narrativeInput.dimension_catalog || []).map((dimension) => ({
        key: String(dimension?.key || "").trim(),
        label: String(dimension?.label || dimension?.key || "").trim(),
      })).filter((dimension) => dimension.key),
      insights: (narrativeInput.insights || []).slice(0, 12).map((finding) => ({
        title: clip(finding?.title, 100),
        description: clip(finding?.description, 180),
        evidence_question_ids: uniqueStrings(finding?.evidence_question_ids).slice(0, 5),
        action_implication: clip(finding?.action_implication, 120),
      })),
      current_report_structure: (narrativeInput.current_report_structure || []).map((chapter) => ({
        title: clip(chapter?.title, 80),
        page_idxs: Array.from(chapter?.page_idxs || []).map(Number).filter(Number.isFinite),
        question_ids: uniqueStrings(chapter?.question_ids),
      })),
      page_catalog: (narrativeInput.page_catalog || []).map((page) => ({
        page_idx: Number(page?.page_idx),
        source_chapter: clip(page?.source_chapter || page?.current_chapter, 80),
        research_role: clip(page?.research_role, 80),
        current_title: clip(page?.current_title, 100),
        question_ids: uniqueStrings(page?.question_ids),
        research_theme: String(page?.research_theme || ""),
        decision_area: clip(page?.decision_area, 120),
        chapter_reason: clip(page?.chapter_reason, 180),
      })),
    };
  }
  function compactReportNarrativeForRevision(narrative = {}) {
    const clip = (value, limit) => String(value || "").trim().slice(0, limit);
    const classification = narrative?.research_theme_classification || {};
    const themes = narrative?.research_themes || classification.themes || [];
    const chapterRules = narrative?.chapter_rules || classification.chapter_rules || [];
    const assignments = narrative?.research_theme_assignments || classification.assignments || [];
    return {
      report_title: clip(narrative.report_title, 120),
      central_thesis: clip(narrative.central_thesis, 500),
      storyline_type: String(narrative.storyline_type || ""),
      ending_message: clip(narrative.ending_message, 500),
      key_questions: uniqueStrings(narrative.key_questions).slice(0, 12),
      research_themes: themes.map((theme) => ({
        theme_id: String(theme?.theme_id || ""),
        name: clip(theme?.name, 100),
        description: clip(theme?.description, 240),
        decision_area: clip(theme?.decision_area, 140),
        allowed_chapters: uniqueStrings(theme?.allowed_chapters),
        keywords: uniqueStrings(theme?.keywords),
        priority: Number(theme?.priority) || 0,
      })),
      chapter_rules: chapterRules.map((rule) => ({
        chapter: clip(rule?.chapter, 120),
        allowed_themes: uniqueStrings(rule?.allowed_themes),
      })),
      research_theme_assignments: assignments.map((assignment) => ({
        classification_id: String(assignment?.classification_id || ""),
        page_idx: Number(assignment?.page_idx),
        question_ids: uniqueStrings(assignment?.question_ids),
        research_theme: String(assignment?.research_theme || assignment?.theme_id || ""),
        decision_area: clip(assignment?.decision_area, 140),
        chapter_reason: clip(assignment?.chapter_reason, 220),
      })).filter((assignment) => Number.isFinite(assignment.page_idx)),
      chapters: (narrative.chapters || []).map((chapter) => ({
        chapter_id: String(chapter?.chapter_id || ""),
        title: clip(chapter?.title, 120),
        purpose: clip(chapter?.purpose, 260),
        key_question: clip(chapter?.key_question, 260),
        allowed_themes: uniqueStrings(chapter?.allowed_themes),
        page_idxs: Array.from(chapter?.page_idxs || []).map(Number).filter(Number.isFinite),
        analysis_strategy: {
          baseline_dimension: String(chapter?.analysis_strategy?.baseline_dimension || ""),
          primary_dimensions: uniqueStrings(chapter?.analysis_strategy?.primary_dimensions).slice(0, 1),
          supporting_dimensions: uniqueStrings(chapter?.analysis_strategy?.supporting_dimensions).slice(0, 1),
          rationale: clip(chapter?.analysis_strategy?.rationale, 220),
        },
      })),
    };
  }
  function buildReportNarrativeRevisionInput(
    narrative = {},
    context = {},
    feedback = "",
    researchObjective = "",
  ) {
    const baseInput = buildReportNarrativeInput(context, researchObjective);
    return {
      ...buildReportFrameworkInput(baseInput),
      revision_feedback: String(feedback || "").trim().slice(0, 1200),
      current_narrative: compactReportNarrativeForRevision(narrative),
      require_page_blueprint: false,
    };
  }
  function classifyReportPageRole(page, archetype, coreModule) {
    const text = pageResearchText(page).toLowerCase();
    const sourceChapter = String(page?.source_chapter || page?.chapter || "").trim();
    if (page?.research_role === "core" || (coreModule && sourceChapter === coreModule)) return "outcome";
    if (/(?:障碍|痛点|未购买|不购买|不满|流失|风险|问题|阻碍)/i.test(text)) return "barrier";
    if (/(?:优化|改进|期望|机会|优先级|kano|psm|价格|建议|行动)/i.test(text)) return "action";
    if (/(?:画像|人群|用户特征|性别|年龄|城市|收入|家庭|职业|代际)/i.test(text)) return "audience";
    if (/(?:驱动|因素|原因|需求|偏好|动机|价值|卖点|属性)/i.test(text)) return "driver";
    if (/(?:消费行为|购买行为|使用行为|渠道|频率|场景|旅程|触点|决策路径)/i.test(text)) return "behavior";
    if (/(?:概念|产品评价|购买意向|购买可能|总体评价|满意|推荐|nps|接受|吸引|差异化|转化潜力)/i.test(text)) return "outcome";
    if (/(?:专项研究|其他研究|补充研究)/i.test(text)) return "action";
    return archetype === "concept_test" ? "driver" : "behavior";
  }

  function isReportNarrativeTooSimilarToSource(reportNarrative, narrativeInput = {}) {
    const normalize = (value) => String(value || "").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
    const sourceTitles = (narrativeInput.current_report_structure || []).map((chapter) => normalize(chapter?.title)).filter(Boolean);
    const narrativeTitles = (reportNarrative?.chapters || []).map((chapter) => normalize(chapter?.title)).filter(Boolean);
    if (!sourceTitles.length || !narrativeTitles.length) return false;
    const exactPositions = narrativeTitles.filter((title, index) => title === sourceTitles[index]).length;
    const sourceSet = new Set(sourceTitles);
    const sharedTitles = narrativeTitles.filter((title) => sourceSet.has(title)).length;
    return exactPositions / Math.max(sourceTitles.length, narrativeTitles.length) >= 0.6
      || sharedTitles / Math.max(sourceTitles.length, narrativeTitles.length) >= 0.8;
  }

  function buildDynamicThemeFallbackNarrative(context = {}, narrativeInput = {}) {
    const classifier = researchThemeApi();
    const classification = compactResearchThemeClassification(
      researchThemeClassification(context) || narrativeInput.research_theme_classification
    );
    const themes = Array.from(classification?.themes || [])
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    if (!classifier || themes.length < 3) return null;
    const pages = Array.from(context?.pages || []);
    const pageBuckets = new Map(themes.map((theme) => [theme.theme_id, []]));
    const unassigned = [];
    pages.forEach((page) => {
      const assignment = classifier.assignmentForPage(classification, page);
      if (assignment && pageBuckets.has(assignment.research_theme)) {
        pageBuckets.get(assignment.research_theme).push(Number(page.page_idx));
      } else {
        unassigned.push(Number(page.page_idx));
      }
    });
    if (unassigned.length) pageBuckets.get(themes[0].theme_id).push(...unassigned);
    const dimensions = (narrativeInput.dimension_catalog || [])
      .map((dimension) => String(dimension?.key || "").trim())
      .filter((dimension) => dimension && dimension !== "总体");
    const chapters = themes.map((theme, index) => ({
      chapter_id: "chapter_" + String(index + 1).padStart(2, "0"),
      title: String(theme.allowed_chapters?.[0] || theme.name || ("研究主题 " + (index + 1))).trim(),
      purpose: String(theme.description || "").trim(),
      key_question: String(theme.decision_area || theme.name || "").trim(),
      allowed_themes: [theme.theme_id],
      page_idxs: pageBuckets.get(theme.theme_id) || [],
      analysis_strategy: {
        baseline_dimension: "总体",
        primary_dimensions: dimensions[index % Math.max(1, dimensions.length)] ? [dimensions[index % dimensions.length]] : [],
        supporting_dimensions: [],
        rationale: "围绕“" + theme.decision_area + "”识别最有解释力的差异。",
        page_dimension_plan: [],
      },
    }));
    const archetype = String(narrativeInput.research_archetype || detectResearchArchetype(context));
    const objective = String(narrativeInput.research_objective || narrativeInput.report_title || "本次研究").trim();
    const decisionAreas = themes.slice(0, 3).map((theme) => theme.decision_area).filter(Boolean).join("、");
    const centralThesis = archetype === "concept_test"
      ? "产品概念的整体表现与转化潜力，需要结合" + decisionAreas + "形成连续判断，并据此明确产品匹配和优化方向。"
      : objective + "需要围绕" + decisionAreas + "形成连续判断，并据此确定行动优先级。";
    return {
      report_title: String(narrativeInput.report_title || objective || "调研分析报告").trim(),
      central_thesis: centralThesis,
      storyline_type: archetype === "concept_test" ? "problem_solution" : "diagnosis",
      chapters,
      key_questions: chapters.map((chapter) => chapter.key_question),
      ending_message: centralThesis,
      confidence: 0.68,
      research_theme_classification: classification,
      research_theme_warnings: [],
    };
  }
  function buildFallbackReportNarrative(context = {}, narrativeInput = {}) {
    const dynamicFallback = buildDynamicThemeFallbackNarrative(context, narrativeInput);
    if (dynamicFallback) return dynamicFallback;
    const pages = Array.from(context?.pages || []);
    const objective = String(narrativeInput.research_objective || narrativeInput.report_title || "本次研究").trim();
    const archetype = String(narrativeInput.research_archetype || detectResearchArchetype(context));
    const coreModule = String(narrativeInput.core_research_module || selectedCoreResearchModule(context)).trim();
    const conceptTemplates = [
      { key: "outcome", title: "概念表现与转化潜力", purpose: "先判断概念/产品的整体表现及转化基础。", question: "概念/产品是否具备转化潜力，核心表现如何？" },
      { key: "audience", title: "核心人群与需求基础", purpose: "识别核心人群，并解释其需求如何影响概念表现。", question: "哪些人群构成核心机会，他们的需求有何差异？" },
      { key: "decision", title: "决策行为与驱动机制", purpose: "还原购买与使用决策，识别推动选择的关键因素。", question: "用户如何决策，哪些因素真正驱动选择？" },
      { key: "barrier", title: "转化障碍与风险诊断", purpose: "定位阻碍接受、购买和持续使用的关键问题。", question: "转化在哪些环节受阻，核心风险是什么？" },
      { key: "action", title: "产品优化与行动优先级", purpose: "把研究发现转化为产品、沟通和运营行动。", question: "应优先优化什么，如何推动转化？" },
    ];
    const generalTemplates = [
      { key: "outcome", title: "核心表现与现状判断", purpose: "建立整体表现基准，明确最重要的业务判断。", question: "当前整体表现如何，核心矛盾是什么？" },
      { key: "audience", title: "核心人群与使用场景", purpose: "识别关键人群及其典型使用情境。", question: "谁是核心用户，他们在什么场景下产生需求？" },
      { key: "decision", title: "行为路径与决策驱动", purpose: "解释行为路径及影响决策的关键因素。", question: "用户如何行动，哪些因素驱动最终选择？" },
      { key: "barrier", title: "痛点诊断与机会识别", purpose: "定位体验断点、流失风险与未满足需求。", question: "主要痛点在哪里，哪些机会值得优先关注？" },
      { key: "action", title: "优化方向与行动优先级", purpose: "形成可执行的产品、服务和运营建议。", question: "下一步应优先采取哪些行动？" },
    ];
    const templates = archetype === "concept_test" ? conceptTemplates : generalTemplates;
    const buckets = new Map(templates.map((template) => [template.key, []]));
    pages.forEach((page) => {
      const role = classifyReportPageRole(page, archetype, coreModule);
      const bucketKey = role === "behavior" || role === "driver" ? "decision" : role;
      (buckets.get(bucketKey) || buckets.get("decision")).push(Number(page.page_idx));
    });
    let plannedChapters = templates
      .map((template) => ({ ...template, page_idxs: buckets.get(template.key) || [] }))
      .filter((chapter) => chapter.page_idxs.length);
    if (plannedChapters.length < 3) {
      const pageIndexes = pages.map((page) => Number(page.page_idx)).filter(Number.isFinite);
      plannedChapters = [
        { ...templates[0], page_idxs: pageIndexes.filter((_, index) => index % 3 === 0) },
        { ...templates[2], page_idxs: pageIndexes.filter((_, index) => index % 3 === 1) },
        { ...templates[4], page_idxs: pageIndexes.filter((_, index) => index % 3 === 2) },
      ];
    }
    const dimensions = (narrativeInput.dimension_catalog || [])
      .map((dimension) => String(dimension?.key || "").trim())
      .filter((dimension) => dimension && dimension !== "总体");
    const dimensionFor = (chapterKey, excluded = []) => {
      const patterns = {
        outcome: /购买意向|满意|推荐|态度|接受|总体/,
        audience: /人群|年龄|性别|用户|城市|代际/,
        decision: /购买意向|场景|渠道|频率|人群/,
        barrier: /购买意向|人群|满意|障碍/,
        action: /购买意向|人群|满意|价值/,
      };
      return dimensions.find((dimension) => !excluded.includes(dimension) && patterns[chapterKey]?.test(dimension))
        || dimensions.find((dimension) => !excluded.includes(dimension))
        || "";
    };
    const firstInsight = narrativeInput.insights?.[0] || {};
    const insightTitle = String(firstInsight.title || "").replace(/\d+(?:\.\d+)?%/g, "").trim();
    const centralThesis = archetype === "concept_test" || /概念|产品/.test(coreModule)
      ? `概念/产品的转化潜力取决于整体吸引力能否与核心人群需求形成匹配，并通过减少决策障碍转化为购买行动${insightTitle ? `；${insightTitle}` : ""}。`
      : `${coreModule || objective}需要从整体表现、人群场景、决策驱动与痛点机会形成连续判断，并据此确定行动优先级${insightTitle ? `；${insightTitle}` : ""}。`;
    const chapters = plannedChapters.map((chapter, index) => {
      const primaryDimension = dimensionFor(chapter.key);
      const supportingDimension = dimensionFor(chapter.key, primaryDimension ? [primaryDimension] : []);
      return {
        chapter_id: `chapter_${String(index + 1).padStart(2, "0")}`,
        title: chapter.title,
        purpose: chapter.purpose,
        key_question: chapter.question,
        page_idxs: chapter.page_idxs,
        analysis_strategy: {
          baseline_dimension: "总体",
          primary_dimensions: primaryDimension ? [primaryDimension] : [],
          supporting_dimensions: supportingDimension ? [supportingDimension] : [],
          rationale: primaryDimension
            ? `以${primaryDimension}识别关键差异${supportingDimension ? `，并用${supportingDimension}补充解释` : ""}。`
            : "先建立总体基准，再判断是否需要分群。",
          page_dimension_plan: [],
        },
      };
    });
    return {
      report_title: String(narrativeInput.report_title || objective || "调研分析报告").trim(),
      central_thesis: centralThesis,
      storyline_type: archetype === "concept_test" ? "problem_solution" : "diagnosis",
      chapters,
      key_questions: chapters.map((chapter) => chapter.key_question),
      ending_message: centralThesis,
      confidence: 0.65,
    };
  }
  function normalizeReportNarrativePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const wrapperKeys = ["report_narrative", "reportNarrative", "narrative", "result", "data"];
    const wrapped = wrapperKeys
      .map((key) => payload[key])
      .find((value) => value && typeof value === "object" && !Array.isArray(value));
    const source = wrapped || payload;
    return {
      ...source,
      report_title: source.report_title
        || source.reportTitle
        || source.title
        || payload.report_title
        || payload.reportTitle,
      central_thesis: source.central_thesis
        || source.centralThesis
        || source.thesis
        || source.core_thesis
        || source.core_viewpoint
        || source.central_argument
        || payload.central_thesis
        || payload.centralThesis,
      storyline_type: source.storyline_type
        || source.storylineType
        || source.story_type
        || payload.storyline_type
        || payload.storylineType,
      chapters: source.chapters
        || source.sections
        || source.chapter_plan
        || payload.chapters,
      page_blueprint: source.page_blueprint
        || source.pageBlueprint
        || source.slide_blueprint
        || source.page_plan
        || payload.page_blueprint,
      key_questions: source.key_questions
        || source.keyQuestions
        || source.research_questions
        || payload.key_questions,
      ending_message: source.ending_message
        || source.endingMessage
        || source.final_message
        || payload.ending_message,
      research_themes: source.research_themes || source.themes || payload.research_themes || payload.themes,
      chapter_rules: source.chapter_rules || payload.chapter_rules,
      research_theme_assignments: source.research_theme_assignments
        || source.page_theme_assignments
        || payload.research_theme_assignments
        || payload.page_theme_assignments,
      confidence: source.confidence ?? payload.confidence,
    };
  }
  function validateReportNarrative(payload, context = {}) {
    payload = normalizeReportNarrativePayload(payload);
    if (!payload || typeof payload !== "object") throw new Error("Report Narrative 必须是 JSON 对象");
    const centralThesis = String(payload.central_thesis || "").trim();
    if (!centralThesis) throw new Error("Report Narrative 缺少 central_thesis");
    const storylineType = normalizeStorylineType(payload.storyline_type, payload.chapters);
    const classifier = researchThemeApi();
    let classification = compactResearchThemeClassification(context?.research_theme_classification)
      || classifier?.parseNarrativeThemeClassification?.(payload, context)
      || null;
    const themeIds = new Set((classification?.themes || []).map((theme) => theme.theme_id));
    const rawChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
    if (rawChapters.length < 3 || rawChapters.length > 8) throw new Error("Report Narrative 章节数必须在 3–8 章之间");
    const allowedPageIndexes = new Set(
      (context?.pages || []).map((page) => Number(page.page_idx)).filter(Number.isFinite)
    );
    const rawDimensionCatalog = (context?.available_dimensions || []).map((dimension) =>
      String(dimension?.key || dimension || "").trim()
    ).filter(Boolean);
    const hasDimensionCatalog = rawDimensionCatalog.length > 0;
    const allowedDimensions = new Set(["总体", ...rawDimensionCatalog]);
    const normalizeDimensions = (values, limit = 2) => uniqueStrings(values)
      .filter((dimension) => !hasDimensionCatalog || allowedDimensions.has(dimension))
      .slice(0, limit);
    const assignedPageIndexes = new Set();
    let chapters = rawChapters.map((chapter, index) => {
      const pageIndexes = (Array.isArray(chapter?.page_idxs) ? chapter.page_idxs : [])
        .map(Number)
        .filter((pageIdx) => Number.isFinite(pageIdx)
          && (!allowedPageIndexes.size || allowedPageIndexes.has(pageIdx))
          && !assignedPageIndexes.has(pageIdx));
      pageIndexes.forEach((pageIdx) => assignedPageIndexes.add(pageIdx));
      const rawStrategy = chapter?.analysis_strategy && typeof chapter.analysis_strategy === "object"
        ? chapter.analysis_strategy : {};
      const primaryDimensions = normalizeDimensions(rawStrategy.primary_dimensions, 1);
      const supportingDimensions = normalizeDimensions(rawStrategy.supporting_dimensions, 1)
        .filter((dimension) => !primaryDimensions.includes(dimension));
      const pageDimensionPlan = (Array.isArray(rawStrategy.page_dimension_plan)
        ? rawStrategy.page_dimension_plan : []).map((item) => ({
          page_idx: Number(item?.page_idx),
          dimensions: normalizeDimensions(item?.dimensions),
        })).filter((item) => Number.isFinite(item.page_idx)
          && pageIndexes.includes(item.page_idx)
          && item.dimensions.length);
      const baselineDimension = String(rawStrategy.baseline_dimension || "总体").trim();
      const normalized = {
        chapter_id: String(chapter?.chapter_id || `chapter_${String(index + 1).padStart(2, "0")}`).trim(),
        title: String(chapter?.title || "").trim(),
        purpose: String(chapter?.purpose || "").trim(),
        key_question: String(chapter?.key_question || "").trim(),
        allowed_themes: uniqueStrings(chapter?.allowed_themes).filter((themeId) => themeIds.has(themeId)),
        page_idxs: pageIndexes,
        analysis_strategy: {
          baseline_dimension: (!hasDimensionCatalog || allowedDimensions.has(baselineDimension))
            ? baselineDimension : "总体",
          primary_dimensions: primaryDimensions,
          supporting_dimensions: supportingDimensions,
          rationale: String(rawStrategy.rationale || "").trim(),
          page_dimension_plan: pageDimensionPlan,
        },
      };
      if (!normalized.title || !normalized.purpose || !normalized.key_question) {
        throw new Error(`Report Narrative 第 ${index + 1} 章缺少 title、purpose 或 key_question`);
      }
      if (classification?.themes?.length && !normalized.allowed_themes.length) {
        normalized.allowed_themes = classifier?.inferChapterAllowedThemes?.(normalized, classification) || [];
      }
      return normalized;
    });
    const themeReconciliation = classifier?.reconcileNarrativeThemes?.(
      chapters,
      classification,
      context
    ) || { chapters, classification, warnings: [] };
    chapters = themeReconciliation.chapters;
    classification = compactResearchThemeClassification(themeReconciliation.classification);
    const themeWarnings = themeReconciliation.warnings || [];
    const questionCatalog = reportQuestionCatalog(context);
    const allowedQuestionIds = new Set(questionCatalog.map((question) => question.question_id));
    const questionTitles = new Map(questionCatalog.map((question) => [question.question_id, question.title]));
    const chapterIds = new Set(chapters.map((chapter) => chapter.chapter_id));
    const rawPageBlueprint = Array.isArray(payload.page_blueprint) ? payload.page_blueprint : [];
    if (context?.require_page_blueprint && allowedQuestionIds.size && !rawPageBlueprint.length) {
      throw new Error("Report Narrative 缺少 page_blueprint，无法按故事线重组题目");
    }
    const assignedQuestionIds = new Set();
    const seenPageIds = new Set();
    const pageBlueprint = rawPageBlueprint.map((page, index) => {
      const pageId = String(page?.page_id || `page_${String(index + 1).padStart(2, "0")}`).trim();
      const chapterId = String(page?.chapter_id || "").trim();
      const questionIds = uniqueStrings(page?.question_ids);
      if (!pageId || seenPageIds.has(pageId)) throw new Error(`page_blueprint 第 ${index + 1} 页 page_id 重复`);
      if (!chapterIds.has(chapterId)) throw new Error(`page_blueprint 第 ${index + 1} 页 chapter_id 非法`);
      if (!questionIds.length || questionIds.length > 6) throw new Error(`page_blueprint 第 ${index + 1} 页必须包含 1–6 道题`);
      questionIds.forEach((questionId) => {
        if (!allowedQuestionIds.has(questionId)) throw new Error(`page_blueprint 引用了不存在的题目 ${questionId}`);
        if (assignedQuestionIds.has(questionId)) throw new Error(`page_blueprint 重复分配题目 ${questionId}`);
        assignedQuestionIds.add(questionId);
      });
      seenPageIds.add(pageId);
      return {
        page_id: pageId,
        chapter_id: chapterId,
        title: String(page?.title || "").trim(),
        purpose: String(page?.purpose || "").trim(),
        question_ids: questionIds,
        question_titles: questionIds.map((questionId) => questionTitles.get(questionId) || questionId),
      };
    });
    if (pageBlueprint.length && assignedQuestionIds.size !== allowedQuestionIds.size) {
      const missing = Array.from(allowedQuestionIds).filter((questionId) => !assignedQuestionIds.has(questionId));
      throw new Error(`page_blueprint 未覆盖全部题目：${missing.join("、")}`);
    }
    const researchArchetype = detectResearchArchetype(context);
    const coreResearchModule = selectedCoreResearchModule(context);
    if (researchArchetype === "concept_test" && (!coreResearchModule || coreResearchModule === "概念测试")) {
      const thesisHasConceptSubject = /(?:\u6982\u5ff5|\u4ea7\u54c1)/.test(centralThesis);
      const thesisHasResultJudgment = /(?:\u8d2d\u4e70\u610f\u5411|\u8d2d\u4e70\u53ef\u80fd|\u63a5\u53d7|\u5438\u5f15|\u559c\u597d|\u559c\u6b22|\u5dee\u5f02\u5316|\u8f6c\u5316|\u6f5c\u529b)/.test(centralThesis);
      const thesisHasConceptResult = thesisHasConceptSubject && thesisHasResultJudgment;
      if (!thesisHasConceptResult) {
        throw new Error("\u6982\u5ff5\u6d4b\u8bd5\u9879\u76ee\u7684 central_thesis \u5fc5\u987b\u5148\u5224\u65ad\u6982\u5ff5/\u4ea7\u54c1\u7684\u6d4b\u8bd5\u8868\u73b0");
      }
    }
    const keyQuestions = uniqueStrings(payload.key_questions);
    return {
      report_title: String(payload.report_title || context?.research_objective || context?.source || "调研报告").trim(),
      central_thesis: centralThesis,
      storyline_type: storylineType,
      chapters,
      page_blueprint: pageBlueprint,
      key_questions: keyQuestions.length ? keyQuestions : chapters.map((chapter) => chapter.key_question),
      ending_message: String(payload.ending_message || centralThesis).trim(),
      confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0)),
      research_theme_classification: classification,
      research_theme_warnings: themeWarnings,
    };
  }
  function narrativeTextTokens(value) {
    const text = String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    if (!text) return [];
    const tokens = [text];
    for (let index = 0; index + 1 < text.length; index += 1) {
      tokens.push(text.slice(index, index + 2));
    }
    return uniqueStrings(tokens).filter((token) => token.length >= 2);
  }

  function narrativePageText(page) {
    return [
      page?.chapter,
      page?.current_title,
      page?.title,
      page?.insight_override,
      page?.analysis_focus,
      page?.slide_brief?.title,
      page?.slide_brief?.claim,
      page?.slide_brief?.question_answered,
      ...(page?.questions || []).flatMap((question) => [question?.code, question?.title]),
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function scoreNarrativeChapter(page, chapter) {
    const pageText = narrativePageText(page);
    const chapterValues = [chapter?.title, chapter?.purpose, chapter?.key_question].filter(Boolean);
    return chapterValues.reduce((total, value) => total + narrativeTextTokens(value).reduce(
      (subtotal, token) => subtotal + (pageText.includes(token) ? Math.min(8, token.length * 2) : 0),
      0
    ), 0);
  }

  function organizePagesByNarrative(pages, reportNarrative, options = {}) {
    const sourcePages = Array.from(pages || []);
    const chapters = Array.from(reportNarrative?.chapters || []);
    if (!sourcePages.length || !chapters.length) return sourcePages.slice();
    const explicitAssignments = new Map();
    chapters.forEach((chapter, chapterIndex) => {
      (chapter?.page_idxs || []).forEach((pageIdx, withinChapterIndex) => {
        const numericPageIdx = Number(pageIdx);
        if (!explicitAssignments.has(numericPageIdx)) {
          explicitAssignments.set(numericPageIdx, { chapterIndex, withinChapterIndex });
        }
      });
    });
    const records = sourcePages.map((page, originalIndex) => {
      const sourcePageIdx = Number(page?.page_idx);
      const explicit = explicitAssignments.get(sourcePageIdx);
      const scores = chapters.map((chapter) => scoreNarrativeChapter(page, chapter));
      let chapterIndex = explicit?.chapterIndex;
      if (!Number.isInteger(chapterIndex)) {
        const bestScore = Math.max(...scores);
        chapterIndex = bestScore > 0
          ? scores.indexOf(bestScore)
          : Math.min(chapters.length - 1, Math.floor(originalIndex * chapters.length / sourcePages.length));
      }
      return {
        page,
        sourcePageIdx,
        originalIndex,
        chapterIndex,
        withinChapterIndex: explicit?.withinChapterIndex ?? originalIndex,
      };
    });
    if (sourcePages.length >= chapters.length) {
      const counts = chapters.map((_, chapterIndex) =>
        records.filter((record) => record.chapterIndex === chapterIndex).length
      );
      counts.forEach((count, emptyChapterIndex) => {
        if (count > 0) return;
        const targetPosition = (emptyChapterIndex + 0.5) * sourcePages.length / chapters.length;
        const donor = records
          .filter((record) => counts[record.chapterIndex] > 1)
          .sort((left, right) =>
            scoreNarrativeChapter(right.page, chapters[emptyChapterIndex])
              - scoreNarrativeChapter(left.page, chapters[emptyChapterIndex])
            || Math.abs(left.originalIndex - targetPosition)
              - Math.abs(right.originalIndex - targetPosition)
          )[0];
        if (!donor) return;
        counts[donor.chapterIndex] -= 1;
        donor.chapterIndex = emptyChapterIndex;
        donor.withinChapterIndex = donor.originalIndex;
        counts[emptyChapterIndex] += 1;
      });
    }
    records.sort((left, right) => left.chapterIndex - right.chapterIndex
      || left.withinChapterIndex - right.withinChapterIndex
      || left.originalIndex - right.originalIndex);
    const renumber = options.renumber !== false;
    const classifier = researchThemeApi();
    const classification = reportNarrative?.research_theme_classification || null;
    return records.map((record, index) => {
      const chapter = chapters[record.chapterIndex];
      const brief = { ...(record.page?.slide_brief || {}) };
      const assignment = classifier?.assignmentForPage?.(classification, record.page) || null;
      return {
        ...record.page,
        page_idx: renumber ? index + 1 : record.sourcePageIdx,
        chapter: chapter.title,
        chapter_id: chapter.chapter_id,
        research_theme: assignment?.research_theme || record.page?.research_theme || "",
        decision_area: assignment?.decision_area || record.page?.decision_area || "",
        chapter_reason: assignment?.chapter_reason || record.page?.chapter_reason || "",
        slide_brief: {
          ...brief,
          chapter_id: chapter.chapter_id,
          chapter: chapter.title,
          research_theme: assignment?.research_theme || brief.research_theme || "",
          decision_area: assignment?.decision_area || brief.decision_area || "",
          chapter_reason: assignment?.chapter_reason || brief.chapter_reason || "",
          question_answered: brief.user_modified || brief.locked
            ? brief.question_answered
            : (chapter.key_question || brief.question_answered || ""),
          chapter_context: "本章目的：" + chapter.purpose + "；核心问题：" + chapter.key_question,
        },
      };
    });
  }
  function recomposePagesByNarrative(pages, reportNarrative, options = {}) {
    const sourcePages = Array.from(pages || []);
    const blueprint = Array.from(reportNarrative?.page_blueprint || []);
    if (!sourcePages.length || !blueprint.length) {
      return organizePagesByNarrative(sourcePages, reportNarrative, options);
    }
    const hasProtectedPage = sourcePages.some((page) =>
      page?.slide_brief?.locked || page?.slide_brief?.user_modified
    );
    if (hasProtectedPage) return organizePagesByNarrative(sourcePages, reportNarrative, options);

    const chaptersById = new Map((reportNarrative?.chapters || []).map((chapter) => [chapter.chapter_id, chapter]));
    const classifier = researchThemeApi();
    const classification = reportNarrative?.research_theme_classification || null;
    const questionById = new Map();
    const sourcePageByQuestion = new Map();
    sourcePages.forEach((page) => (page.questions || []).forEach((question) => {
      const questionId = String(question?.code || "").trim();
      if (!questionId || questionById.has(questionId)) return;
      questionById.set(questionId, question);
      sourcePageByQuestion.set(questionId, page);
    }));
    const reusedSourcePages = new Set();
    const renumber = options.renumber !== false;
    return blueprint.map((plannedPage, index) => {
      const questions = (plannedPage.question_ids || []).map((questionId) => {
        const question = questionById.get(String(questionId));
        if (!question) throw new Error(`故事线蓝图中的题目 ${questionId} 无法写回页面`);
        return question;
      });
      const donor = (plannedPage.question_ids || [])
        .map((questionId) => sourcePageByQuestion.get(String(questionId)))
        .find(Boolean) || sourcePages[0];
      const reuseIdentity = donor && !reusedSourcePages.has(donor);
      if (reuseIdentity) reusedSourcePages.add(donor);
      const chapter = chaptersById.get(plannedPage.chapter_id) || {};
      const assignment = classifier?.assignmentForPage?.(classification, {
        question_ids: plannedPage.question_ids || [],
        page_idx: donor?.page_idx,
      }) || null;
      const title = String(plannedPage.title || donor?.title || chapter.title || "分析发现").trim();
      const slideId = reuseIdentity
        ? String(donor?.slide_brief?.slide_id || donor?.slide_id || "")
        : "";
      return {
        ...donor,
        page_idx: renumber ? index + 1 : Number(donor?.page_idx || index + 1),
        slide_id: slideId,
        narrative_page_id: String(plannedPage.page_id || ""),
        chapter: String(chapter.title || donor?.chapter || "其他研究"),
        chapter_id: String(plannedPage.chapter_id || chapter.chapter_id || ""),
        research_theme: assignment?.research_theme || "",
        decision_area: assignment?.decision_area || "",
        chapter_reason: assignment?.chapter_reason || "",
        title,
        questions,
        evidence_fact_ids: [],
        evidence_question_ids: (plannedPage.question_ids || []).map(String),
        insight_override: "",
        insight_bullets: [],
        business_implication: "",
        slide_brief: {
          ...(donor?.slide_brief || {}),
          slide_id: slideId,
          chapter_id: String(plannedPage.chapter_id || chapter.chapter_id || ""),
          chapter: String(chapter.title || donor?.chapter || "其他研究"),
          research_theme: assignment?.research_theme || "",
          decision_area: assignment?.decision_area || "",
          chapter_reason: assignment?.chapter_reason || "",
          title,
          claim: title,
          question_answered: String(plannedPage.purpose || chapter.key_question || "").trim(),
          evidence_fact_ids: [],
          evidence_question_ids: (plannedPage.question_ids || []).map(String),
          user_modified: false,
          locked: false,
        },
      };
    });
  }

  function blueprintQuestionWeight(question = {}) {
    const optionCount = Array.isArray(question.rows) ? question.rows.length : 0;
    const seriesCount = Math.max(0, ...(question.rows || []).map((row) => Object.keys(row?.values || {}).length));
    const dataKind = String(question.data_kind || "").toLowerCase();
    const analysisModel = String(question.model_semantics?.analysis_model || "").trim();
    if (/^(?:psm|kano)$/i.test(analysisModel) || /(?:matrix|open|text|矩阵|开放)/i.test(dataKind)) return 6;
    let weight = 1;
    if (optionCount >= 12) weight += 2;
    else if (optionCount >= 7) weight += 1;
    if (seriesCount >= 2 && optionCount >= 5) weight += 1;
    return Math.min(6, weight);
  }

  const BLUEPRINT_FAMILY_TITLES = {
    audience_profile: "核心用户与家庭画像",
    feature_priority: "功能需求与优先级",
    power_mobility: "供电、续航与便携需求",
    appearance_design: "产品外观与硬件偏好",
    ai_companion: "AI 陪伴与学习功能需求",
    care_context: "家庭陪伴与学习场景",
    monitoring_journey: "远程看护需求与现有痛点",
    purchase_decision: "购买意向与决策驱动",
    purchase_barrier: "购买障碍与风险诊断",
    pricing: "价格接受度与付费偏好",
    device_ownership: "既有设备与品类购买基础",
  };

  function blueprintQuestionFamily(question = {}, page = {}) {
    const code = String(question?.code || "").trim().toLowerCase();
    const text = [question?.title, page?.current_title, page?.title]
      .filter(Boolean).join(" ").toLowerCase();
    if (/^b4(?:_|$)/i.test(code) || /^b24$/i.test(code) || /(?:top\s*\d+|功能.*(?:重要|优先|排序)|差异化卖点)/.test(text)) return "feature_priority";
    if (/(?:不愿意购买|仍在犹豫|不考虑购买|拒绝购买|购买障碍|购买顾虑)/.test(text)) return "purchase_barrier";
    if (/(?:购买可能|购买意向|促使.*购买|购买.*(?:原因|驱动))/.test(text)) return "purchase_decision";
    if (/(?:性别|年龄|家庭情况|家庭结构|城市|学历|职业|收入|婚姻|用户类型|用户画像)/.test(text)) return "audience_profile";
    if (/^b2[1-3]$/i.test(code) || /(?:插电|电池|续航|便携|移动|免布线|电源线|wi-?fi|联网方式|联网方案)/i.test(text)) return "power_mobility";
    if (/(?:外观|摄像头.*(?:设计|方案|数量)|硬件设计)/.test(text)) return "appearance_design";
    if (/^b1[1-5]$/i.test(code) || /(?:ai功能|ai伴学|ai对话|语音对话|讲故事|英语口语|互动游戏|诗词|智能聊天|家长端app)/i.test(text)) return "ai_companion";
    if (/^b1[67]$/i.test(code) || /(?:价格|付费|订阅|套餐|包月|月费|年费|支付|psm)/i.test(text)) return "pricing";
    if (/(?:最想了解|了解孩子.*方式|最大困扰|远程监控|远程看护|专注力|哪些情况.*担心)/.test(text)) return "monitoring_journey";
    if (/^s10$/i.test(code) || /(?:谁照看|不在孩子身边|陪伴|学习环境|学习任务|作业.*时长|性格特点|使用场景|放在哪里)/.test(text)) return "care_context";
    if (/^s[89]$/i.test(code) || /(?:正在使用.*设备|购买过.*电子产品|既有设备)/.test(text)) return "device_ownership";
    return `source:${String(page?.source_chapter || page?.chapter || "其他研究").trim()}`;
  }

  function buildFallbackPageBlueprint(context, reportNarrative) {
    const sourcePages = Array.from(context?.pages || []);
    const chapters = Array.from(reportNarrative?.chapters || []);
    const classifier = researchThemeApi();
    const classification = reportNarrative?.research_theme_classification || context?.research_theme_classification || null;
    const pageByIndex = new Map(sourcePages.map((page) => [Number(page.page_idx), page]));
    const chapterByPage = new Map();
    const orderedPages = [];
    const seenPages = new Set();
    chapters.forEach((chapter) => (chapter.page_idxs || []).forEach((pageIdx) => {
      const numericPageIdx = Number(pageIdx);
      chapterByPage.set(numericPageIdx, chapter);
      const page = pageByIndex.get(numericPageIdx);
      if (page && !seenPages.has(page)) {
        seenPages.add(page);
        orderedPages.push(page);
      }
    }));
    sourcePages.forEach((page) => {
      if (!seenPages.has(page)) orderedPages.push(page);
    });

    const assignedQuestions = new Set();
    const groups = [];

    orderedPages.forEach((page) => {
      const sourceNarrativeChapter = chapterByPage.get(Number(page.page_idx)) || chapters[0] || {};
      const sourceChapter = String(page.source_chapter || page.chapter || sourceNarrativeChapter.title || "其他研究").trim();
      const researchRole = String(page.research_role || "").trim();
      (page.questions || []).forEach((question) => {
        const questionId = String(question?.code || "").trim();
        if (!questionId || assignedQuestions.has(questionId)) return;
        assignedQuestions.add(questionId);
        const assignment = classifier?.assignmentForPage?.(classification, {
          page_idx: Number(page.page_idx),
          question_ids: [questionId],
        }) || null;
        const chapter = assignment
          ? (classifier?.chapterForTheme?.(chapters, assignment.research_theme, classification) || sourceNarrativeChapter)
          : sourceNarrativeChapter;
        const sampleScope = String(question?.model_semantics?.sample_scope || question?.base_scope || "").trim();
        const analysisModel = String(question?.model_semantics?.analysis_model || "").trim();
        const complexModel = /^(?:psm|kano)$/i.test(analysisModel) ? analysisModel.toLowerCase() : "";
        const family = blueprintQuestionFamily(question, page);
        const weight = blueprintQuestionWeight(question);
        let target = [...groups].reverse().find((group) =>
          group.chapter_id === String(chapter.chapter_id || "")
          && group.family === family
          && (!group.research_role || !researchRole || group.research_role === researchRole)
          && (!group.sample_scope || !sampleScope || group.sample_scope === sampleScope)
          && (!group.complex_model || !complexModel || group.complex_model === complexModel)
          && group.question_ids.length < 6
          && group.weight + weight <= 6
        );
        if (!target) {
          target = {
            chapter_id: String(chapter.chapter_id || ""),
            chapter_title: String(chapter.title || sourceChapter || "分析章节").trim(),
            key_question: String(chapter.key_question || "呈现关键证据").trim(),
            source_chapter: sourceChapter,
            research_role: researchRole,
            sample_scope: sampleScope,
            complex_model: complexModel,
            family,
            source_titles: [],
            question_ids: [],
            weight: 0,
          };
          groups.push(target);
        }
        target.question_ids.push(questionId);
        target.weight += weight;
        const sourceTitle = String(page.current_title || page.title || "").trim();
        if (sourceTitle && !target.source_titles.includes(sourceTitle)) target.source_titles.push(sourceTitle);
      });
    });
    return groups.map((group, index) => ({
      page_id: `logic_${String(index + 1).padStart(2, "0")}`,
      chapter_id: group.chapter_id,
      title: group.source_titles.length === 1
        ? group.source_titles[0]
        : (BLUEPRINT_FAMILY_TITLES[group.family] || `${group.chapter_title}综合分析`),
      purpose: group.key_question,
      question_ids: group.question_ids,
    }));
  }

  async function generateReportNarrativeOrFallback(generateNarrative, context) {
    try {
      const payload = await generateNarrative();
      return {
        report_narrative: validateReportNarrative(payload, context),
        fallback_used: false,
        error: "",
      };
    } catch (error) {
      return {
        report_narrative: null,
        fallback_used: true,
        error: String(error?.message || error || "Report Narrative 生成失败"),
      };
    }
  }

  function chapterForPage(page, reportNarrative, allPages) {
    const chapters = reportNarrative?.chapters || [];
    if (!chapters.length) return { chapter: null, index: -1 };
    const pages = allPages || [];
    const pageChapterOrder = uniqueStrings(pages.map((item) => item.chapter || "其他研究"));
    const directIndex = (item) => {
      const itemChapter = String(item?.chapter || "");
      const itemChapterId = String(item?.chapter_id || item?.slide_brief?.chapter_id || "");
      const exactIndex = chapters.findIndex((chapter) =>
        (itemChapterId && String(chapter.chapter_id || "") === itemChapterId)
        || (itemChapter && String(chapter.title || "") === itemChapter)
      );
      if (exactIndex >= 0) return exactIndex;
      return Math.min(
        Math.max(0, pageChapterOrder.indexOf(itemChapter)),
        chapters.length - 1,
      );
    };
    const pagePosition = pages.findIndex((item) =>
      item === page || Number(item?.page_idx) === Number(page?.page_idx)
    );
    let index = directIndex(page);
    if (pagePosition >= 0) {
      index = pages.slice(0, pagePosition + 1).reduce(
        (highest, item) => Math.max(highest, directIndex(item)),
        0,
      );
    }
    return { chapter: chapters[index], index };
  }

  function buildPageNarrativeContext(page, reportNarrative, allPages = []) {
    const { chapter, index } = chapterForPage(page, reportNarrative, allPages);
    const chapters = reportNarrative?.chapters || [];
    return {
      central_thesis: String(reportNarrative?.central_thesis || ""),
      chapter_context: chapter ? {
        chapter_id: chapter.chapter_id,
        title: chapter.title,
        purpose: chapter.purpose,
        key_question: chapter.key_question,
        allowed_themes: uniqueStrings(chapter.allowed_themes),
        analysis_strategy: chapter.analysis_strategy || {},
      } : null,
      previous_chapter: index > 0 ? String(chapters[index - 1]?.title || "") : "",
      next_chapter: index >= 0 && index + 1 < chapters.length ? String(chapters[index + 1]?.title || "") : "",
    };
  }

  function fallbackNarrative(context) {
    const findings = (context?.global_findings || []).map((finding, index) => ({
      finding_id: `finding_${String(index + 1).padStart(2, "0")}`,
      headline: String(finding.title || "核心发现"),
      description: String(finding.description || ""),
      fact_ids: uniqueStrings(finding.evidence_fact_ids),
      question_ids: uniqueStrings(finding.evidence_question_ids),
      business_implication: String(finding.action_implication || ""),
      confidence: 1,
    }));
    const storyline = (context?.pages || []).map((page, index, pages) => ({
      page_idx: Number(page.page_idx),
      role: String(page.slide_brief?.question_answered || page.chapter || "数据证据"),
      transition: index === 0
        ? "建立报告起点"
        : String(page.slide_brief?.relationship_to_previous || `承接第 ${Number(pages[index - 1].page_idx)} 页`),
      focus_fact_ids: uniqueStrings(page.evidence_fact_ids).slice(0, 6),
    }));
    return {
      findings,
      storyline,
      executive_summary: findings.slice(0, 3).map((finding) => finding.headline).join("；"),
      source: "deterministic_fallback",
    };
  }

  function validateNarrative(payload, context) {
    const fallback = fallbackNarrative(context);
    if (!payload || typeof payload !== "object") return fallback;
    const allowedFacts = new Set((context?.data_facts || []).map((fact) => String(fact.fact_id || "")));
    const allowedQuestions = new Set((context?.data_facts || []).map((fact) => String(fact.question_id || "")));
    const allowedPages = new Map((context?.pages || []).map((page) => [Number(page.page_idx), page]));
    const findings = (Array.isArray(payload.findings) ? payload.findings : []).map((finding, index) => ({
      finding_id: String(finding.finding_id || `finding_${String(index + 1).padStart(2, "0")}`),
      headline: String(finding.headline || "").trim(),
      description: String(finding.description || "").trim(),
      fact_ids: uniqueStrings(finding.fact_ids).filter((id) => allowedFacts.has(id)),
      question_ids: uniqueStrings(finding.question_ids).filter((id) => allowedQuestions.has(id)),
      business_implication: String(finding.business_implication || "").trim(),
      confidence: Math.max(0, Math.min(1, Number(finding.confidence) || 0)),
    })).filter((finding) => finding.headline && finding.fact_ids.length);
    const proposedStoryline = new Map(
      (Array.isArray(payload.storyline) ? payload.storyline : [])
        .map((item) => [Number(item.page_idx), item])
        .filter(([pageIdx]) => allowedPages.has(pageIdx))
    );
    const storyline = fallback.storyline.map((fallbackItem) => {
      const proposed = proposedStoryline.get(fallbackItem.page_idx) || {};
      const page = allowedPages.get(fallbackItem.page_idx);
      const allowedPageFacts = new Set(uniqueStrings(page?.evidence_fact_ids));
      return {
        page_idx: fallbackItem.page_idx,
        role: String(proposed.role || fallbackItem.role).trim(),
        transition: String(proposed.transition || fallbackItem.transition).trim(),
        focus_fact_ids: uniqueStrings(proposed.focus_fact_ids).filter((id) => allowedPageFacts.has(id)),
      };
    });
    storyline.forEach((item, index) => {
      if (!item.focus_fact_ids.length) item.focus_fact_ids = fallback.storyline[index].focus_fact_ids;
    });
    return {
      findings: findings.length ? findings : fallback.findings,
      storyline,
      executive_summary: String(payload.executive_summary || fallback.executive_summary).trim(),
      source: findings.length ? "ai_validated" : fallback.source,
    };
  }

  function buildPageBatchInput(batch, reportNarrative, previousPage = null, allPages = batch) {
    const pages = batch || [];
    const narrativeContext = buildPageNarrativeContext(
      pages[0] || {}, reportNarrative, allPages || pages
    );
    return {
      central_thesis: String(reportNarrative?.central_thesis || ""),
      storyline_type: String(reportNarrative?.storyline_type || ""),
      fallback_mode: reportNarrative?.central_thesis ? null : "data_fact_to_slide_brief",
      chapter_context: narrativeContext.chapter_context,
      previous_chapter: narrativeContext.previous_chapter,
      next_chapter: narrativeContext.next_chapter,
      previous_page: previousPage ? {
        page_idx: Number(previousPage.page_idx),
        title: previousPage.title || previousPage.current_title,
        business_implication: previousPage.business_implication,
      } : null,
      pages: pages.map((page) => ({
        page_idx: Number(page.page_idx),
        slide_id: String(page.slide_id || page.slide_brief?.slide_id || ""),
        chapter: String(page.chapter || "其他研究"),
        research_theme: String(page.research_theme || page.slide_brief?.research_theme || ""),
        decision_area: String(page.decision_area || page.slide_brief?.decision_area || ""),
        chapter_reason: String(page.chapter_reason || page.slide_brief?.chapter_reason || ""),
        current_title: String(page.current_title || ""),
        chart_type: String(page.chart_type || "auto"),
        dimensions: uniqueStrings(page.dimensions),
        evidence_fact_ids: uniqueStrings(page.evidence_fact_ids),
        evidence_question_ids: pageQuestionIds(page),
        questions: (page.questions || []).map((question) => compactQuestion(question, page.evidence_fact_ids)),
      })),
    };
  }

  function buildFallbackSlideBriefInput(context) {
    return buildPageBatchInput(context?.pages || [], null, null, context?.pages || []);
  }

  function mergeSlideBriefSuggestion(existingBrief, suggestion) {
    const current = { ...(existingBrief || {}) };
    if (current.locked || current.user_modified) return current;
    return {
      ...current,
      ...(suggestion || {}),
      locked: Boolean(current.locked),
      user_modified: false,
    };
  }


  function fitBullets(values) {
    const bullets = uniqueStrings(values);
    if (bullets.length <= 3) return bullets;
    return [bullets[0], bullets[1], bullets.slice(2).join("；")];
  }

  const PERCENTAGE_TOKEN_PATTERN = /(?:[0-9]+(?:[.][0-9]+)?[ \t]*(?:%|％|个百分点|pp)|百分之[ \t]*[0-9]+(?:[.][0-9]+)?)/gi;

  function percentageTokenCount(value) {
    return (String(value || "").match(PERCENTAGE_TOKEN_PATTERN) || []).length;
  }

  function findDataNarrationIssues(pages) {
    const issues = [];
    (pages || []).forEach((page) => {
      const slideId = String(page?.slide_id || page?.page_idx || "unknown");
      const bullets = uniqueStrings(page?.bullets);
      const percentageBullets = bullets.filter((bullet) => percentageTokenCount(bullet) > 0);
      if (percentageBullets.length) issues.push(slideId + ": percentage in body copy");
      if (percentageTokenCount(page?.business_implication) > 0) {
        issues.push(slideId + ": percentage in business implication");
      }
      if (percentageTokenCount(page?.title) + percentageTokenCount(page?.claim) > 0) {
        issues.push(slideId + ": percentage in headline");
      }
    });
    return issues;
  }

  function reduceDataNarrationBullets(values) {
    return fitBullets(values)
      .filter((bullet) => percentageTokenCount(bullet) === 0)
      .slice(0, 3);
  }

  function normalizeEvidenceLabel(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "")
      .replace(/[的了着过都进行相关方面情况用户人群]/g, "");
  }

  function evidenceLabelMatchesClause(clause, label) {
    const haystack = normalizeEvidenceLabel(clause);
    const needle = normalizeEvidenceLabel(label);
    if (!haystack || needle.length < 2) return false;
    if (haystack.includes(needle)) return true;
    let longest = 0;
    for (let start = 0; start < needle.length; start += 1) {
      for (let end = start + 4; end <= needle.length; end += 1) {
        if (haystack.includes(needle.slice(start, end))) {
          longest = Math.max(longest, end - start);
        }
      }
    }
    const threshold = Math.min(6, Math.max(4, Math.ceil(needle.length * 0.45)));
    return longest >= threshold;
  }
  function validatePageOutput(payload, batch, options = {}) {
    const requireSlideId = Boolean(options.requireSlideId);
    const allowedBySlideId = new Map((batch || []).map((page) => [
      String(page.slide_id || page.slide_brief?.slide_id || ""), page,
    ]).filter(([slideId]) => slideId));
    const allowedByPage = new Map((batch || []).map((page) => [Number(page.page_idx), page]));
    return (Array.isArray(payload?.pages) ? payload.pages : []).map((suggestion) => {
      const slideId = String(suggestion.slide_id || "").trim();
      const pageIdx = Number(suggestion.page_idx);
      const page = (slideId && allowedBySlideId.get(slideId))
        || (!requireSlideId ? allowedByPage.get(pageIdx) : null);
      if (!page) return null;
      const allowedFacts = new Set(uniqueStrings(page.evidence_fact_ids));
      const allowedQuestions = new Set(pageQuestionIds(page));
      let evidenceFactIds = uniqueStrings(suggestion.evidence_fact_ids).filter((id) => allowedFacts.has(id));
      let evidenceQuestionIds = uniqueStrings(suggestion.evidence_question_ids).filter((id) => allowedQuestions.has(id));
      // Evidence belongs to the matched stable slide. Do not depend on the
      // model echoing IDs that the system already owns deterministically.
      if (!evidenceFactIds.length) evidenceFactIds = Array.from(allowedFacts).slice(0, 6);
      if (!evidenceQuestionIds.length) evidenceQuestionIds = Array.from(allowedQuestions);
      const sourceTitle = String(page.title || page.slide_brief?.title || "").trim();
      const suggestedTitle = String(suggestion.title || "").trim();
      const suggestedClaim = String(suggestion.claim || suggestion.title || "").trim();
      return {
        slide_id: String(page.slide_id || page.slide_brief?.slide_id || slideId),
        page_idx: Number(page.page_idx),
        title: percentageTokenCount(suggestedTitle) ? sourceTitle : suggestedTitle,
        claim: percentageTokenCount(suggestedClaim) ? sourceTitle : suggestedClaim,
        bullets: reduceDataNarrationBullets(suggestion.bullets),
        business_implication: percentageTokenCount(suggestion.business_implication)
          ? ""
          : String(suggestion.business_implication || "").trim(),
        evidence_fact_ids: evidenceFactIds,
        evidence_question_ids: evidenceQuestionIds,
        research_theme: String(page.research_theme || page.slide_brief?.research_theme || ""),
        decision_area: String(page.decision_area || page.slide_brief?.decision_area || ""),
        chapter_reason: String(page.chapter_reason || page.slide_brief?.chapter_reason || ""),
      };
    }).filter((page) => page && page.title && page.evidence_fact_ids.length);
  }

  root.PptReportAi = {
    DEFAULT_BATCH_SIZE,
    REPAIR_BATCH_SIZE,
    SLIDE_BRIEF_CONCURRENCY,
    SLIDE_BRIEF_TIMEOUT_MS,
    SLIDE_BRIEF_REPAIR_TIMEOUT_MS,
    REPORT_NARRATIVE_SYSTEM_PROMPT,
    PAGE_BLUEPRINT_SYSTEM_PROMPT,
    REPORT_STORYLINE_TYPES,
    SLIDE_BRIEF_SYSTEM_PROMPT,
    findDataNarrationIssues,
    reduceDataNarrationBullets,
    buildFallbackSlideBriefInput,
    buildNarrativeInput,
    buildPageBatchInput,
    buildPageNarrativeContext,
    chapterAnalysisDimensions,
    conceptPriorityPageIndexes,
    coreResearchPageIndexes,
    selectedCoreResearchModule,
    detectResearchArchetype,
    buildReportNarrativeInput,
    buildReportFrameworkInput,
    compactReportNarrativeForRevision,
    buildReportNarrativeRevisionInput,
    buildDynamicThemeFallbackNarrative,
    buildFallbackReportNarrative,
    compactResearchThemeClassification,
    isReportNarrativeTooSimilarToSource,
    buildFallbackPageBlueprint,
    chunkPages,
    chunkPagesByChapter,
    chunkRepairPages,
    filterWritablePages,
    evidenceLabelMatchesClause,
    fallbackNarrative,
    generateReportNarrativeOrFallback,
    mergeSlideBriefSuggestion,
    mapWithConcurrency,
    organizePagesByNarrative,
    recomposePagesByNarrative,
    parseJsonObject,
    validateNarrative,
    validatePageOutput,
    validateReportNarrative,
    normalizeReportNarrativePayload,
  };
})(typeof window !== "undefined" ? window : globalThis);
