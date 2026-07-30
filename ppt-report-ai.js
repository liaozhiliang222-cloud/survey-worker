(function initPptReportAi(root) {
  "use strict";

  const DEFAULT_BATCH_SIZE = 6;
  const SLIDE_BRIEF_CONCURRENCY = 2;
  const REPORT_STORYLINE_TYPES = [
    "problem_solution",
    "user_journey",
    "funnel",
    "diagnosis",
    "opportunity",
  ];

  const REPORT_NARRATIVE_SYSTEM_PROMPT = [
    "你是资深市场研究顾问。请根据 DataFact、Insight 列表和研究目标，先设计整份报告的 Report Narrative。",
    "先形成一个中心论点，不要简单罗列发现。central_thesis 必须是一个完整判断，不是主题描述或报告标题。",
    "章节必须形成连续论证，例如用户是谁→为什么购买→为什么流失→如何提升；禁止按满意度、购买因素、会员等指标机械分章。",
    "默认规划 4–6 章，硬性限制 3–8 章。每章都必须包含 chapter_id、title、purpose、key_question、page_idxs、analysis_strategy。",
    "page_idxs 必须把输入 page_catalog 中的全部页面分配到新章节，且每个页面只能出现一次；章节顺序和 page_idxs 顺序就是最终报告顺序。",
    "必须先读取 dimension_catalog，再为每章推荐分析维度。analysis_strategy 只包含 baseline_dimension、primary_dimensions、supporting_dimensions、rationale；只能使用 dimension_catalog 中存在的维度，最终由用户确认。",
    "总体是默认基准；每章最多 1 个主维度和 1 个辅助维度。不要为了使用维度而强行分群，章节不适合对比时使用总体；不要输出逐页维度计划。",
    "storyline_type 只能是 problem_solution、user_journey、funnel、diagnosis、opportunity 之一。",
    "不得编造 DataFact 中不存在的数字或结论；confidence 必须在 0 到 1 之间。",
    "只返回 JSON：{\"report_title\":\"\",\"central_thesis\":\"\",\"storyline_type\":\"diagnosis\",\"chapters\":[{\"chapter_id\":\"chapter_01\",\"title\":\"\",\"purpose\":\"\",\"key_question\":\"\",\"page_idxs\":[1,2],\"analysis_strategy\":{\"baseline_dimension\":\"总体\",\"primary_dimensions\":[\"用户类型\"],\"supporting_dimensions\":[],\"rationale\":\"\"}}],\"key_questions\":[],\"ending_message\":\"\",\"confidence\":0.9}。",
  ].join("\n");

  const SLIDE_BRIEF_SYSTEM_PROMPT = [
    "你是资深市场研究报告总监。请在给定 Report Narrative 下，为每页生成 SlideBrief 文案。",
    "每批输入包含 central_thesis、chapter_context、previous_chapter、next_chapter；标题和正文必须服务于本章目的，并与前后章节连续。",
    "chapter_context.analysis_strategy 定义本章分析维度；每页 dimensions 是本页实际图表维度。标题、claim 和 bullets 必须解释当前 dimensions 下的证据，不得沿用其他维度结论。",
    "只允许使用该页 questions、DataFact、evidence_fact_ids、evidence_question_ids 中的证据，不得重新计算或编造数字。",
    "model_semantics 是指标的强约束定义：PSM 单条累计曲线不得解释为购买接受率、峰值或价格上下限，交点指标只能引用系统已计算结果。",
    "如果 data_quality_warnings 非空，不得引用被修复前的值；所有数字、选项和人群必须能在同一行证据中对应，不能只校验数字是否在本页出现。",
    "凡正文引用百分比，必须同时原样写出对应选项和人群标签；无法建立一一对应时删去该数字，不得截断小数或省略前导数字。",
    "必须原样返回每页 slide_id；slide_id 是写回蓝图的唯一主键，page_idx 只用于展示顺序。",
    "标题和 claim 必须先给判断；除非数字本身构成关键反差，否则不要把百分比堆进标题。",
    "每页正文 2–3 条：先解释关键关系、差异或障碍，再用 1 组最有解释力的数据作证据锚点，最后给出业务含义；证据不足时不要强行补原因。",
    "页面包含多道题时，标题必须概括这些题之间的共同关系，不能只用其中一张图的选项替代整页主题；若无法综合，使用中性的组合标题。",
    "子样本题、特定车型或特定用户题必须在标题或正文中保留适用范围；不得把自行车、摩托车、已安装用户等子样本结论泛化为全部两轮车用户。",
    "每页最多引用 2 个数字，不得逐项复述图表；同一数字不要在标题、claim 和 bullets 中重复。",
    "允许使用‘反映’‘提示’‘可能与…有关’进行谨慎解释，但不得把推测写成已证实事实；相邻页面不得重复完全相同的结论。",
    "只返回 JSON：{\"pages\":[{\"slide_id\":\"finding_001\",\"page_idx\":1,\"title\":\"\",\"claim\":\"\",\"bullets\":[\"\",\"\"],\"business_implication\":\"\"}]}。证据 ID 由系统按页面确定性回填。",
  ].join("\n");

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)));
  }

  function parseJsonObject(output) {
    const text = String(output || "").trim();
    const jsonText = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
      || text.match(/\{[\s\S]*\}/)?.[0]
      || text;
    return JSON.parse(jsonText.replace(/^\uFEFF/, "").trim());
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
    const size = Math.max(3, Math.min(6, Number(requestedSize) || DEFAULT_BATCH_SIZE));
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
      "fact_id", "fact_type", "metric_name", "segment", "category", "value",
      "benchmark_value", "gap_pp", "rank", "base", "significant",
    ].forEach((key) => {
      const value = fact?.[key];
      if (value !== null && value !== undefined && value !== "") result[key] = value;
    });
    return result;
  }

  function compactQuestion(question) {
    return {
      code: String(question?.code || ""),
      title: String(question?.title || ""),
      data_kind: String(question?.data_kind || ""),
      model_semantics: question?.model_semantics || {},
      data_quality_warnings: question?.data_quality_warnings || [],
      base: question?.base || {},
      rows: (question?.rows || []).map((row) => ({
        option: String(row?.option || ""),
        values: row?.values || {},
      })),
      facts: (question?.facts || []).map(compactFact),
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
    return {
      report_title: String(researchObjective || context?.research_objective || context?.source || "调研报告"),
      research_objective: String(researchObjective || context?.research_objective || ""),
      dimension_catalog: (context?.available_dimensions || []).map((dimension) => ({
        key: String(dimension?.key || "").trim(),
        label: String(dimension?.label || dimension?.key || "").trim(),
        segments: uniqueStrings(dimension?.segments),
      })).filter((dimension) => dimension.key),
      data_facts: (context?.data_facts || []).map((fact) => ({ ...fact })),
      insights: (context?.global_findings || []).map((finding) => ({ ...finding })),
      current_report_structure: chapters,
      page_catalog: pages.map((page) => ({
        page_idx: Number(page.page_idx),
        current_chapter: String(page.chapter || "其他研究"),
        current_title: String(page.current_title || page.title || ""),
        question_ids: pageQuestionIds(page),
        current_dimensions: uniqueStrings(page.dimensions),
        question_titles: uniqueStrings((page.questions || []).map((question) => question.title)),
      })),
    };
  }
  function validateReportNarrative(payload, context = {}) {
    if (!payload || typeof payload !== "object") throw new Error("Report Narrative 必须是 JSON 对象");
    const centralThesis = String(payload.central_thesis || "").trim();
    if (!centralThesis) throw new Error("Report Narrative 缺少 central_thesis");
    const storylineType = String(payload.storyline_type || "").trim();
    if (!REPORT_STORYLINE_TYPES.includes(storylineType)) throw new Error("Report Narrative 的 storyline_type 非法");
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
    const chapters = rawChapters.map((chapter, index) => {
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
      return normalized;
    });
    const keyQuestions = uniqueStrings(payload.key_questions);
    return {
      report_title: String(payload.report_title || context?.research_objective || context?.source || "调研报告").trim(),
      central_thesis: centralThesis,
      storyline_type: storylineType,
      chapters,
      key_questions: keyQuestions.length ? keyQuestions : chapters.map((chapter) => chapter.key_question),
      ending_message: String(payload.ending_message || centralThesis).trim(),
      confidence: Math.max(0, Math.min(1, Number(payload.confidence) || 0)),
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
    return records.map((record, index) => {
      const chapter = chapters[record.chapterIndex];
      const brief = { ...(record.page?.slide_brief || {}) };
      return {
        ...record.page,
        page_idx: renumber ? index + 1 : record.sourcePageIdx,
        chapter: chapter.title,
        chapter_id: chapter.chapter_id,
        slide_brief: {
          ...brief,
          chapter_id: chapter.chapter_id,
          chapter: chapter.title,
          question_answered: brief.user_modified || brief.locked
            ? brief.question_answered
            : (chapter.key_question || brief.question_answered || ""),
          chapter_context: "本章目的：" + chapter.purpose + "；核心问题：" + chapter.key_question,
        },
      };
    });
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
        current_title: String(page.current_title || ""),
        chart_type: String(page.chart_type || "auto"),
        dimensions: uniqueStrings(page.dimensions),
        evidence_fact_ids: uniqueStrings(page.evidence_fact_ids),
        evidence_question_ids: pageQuestionIds(page),
        questions: (page.questions || []).map(compactQuestion),
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
      return {
        slide_id: String(page.slide_id || page.slide_brief?.slide_id || slideId),
        page_idx: Number(page.page_idx),
        title: String(suggestion.title || "").trim(),
        claim: String(suggestion.claim || suggestion.title || "").trim(),
        bullets: fitBullets(suggestion.bullets),
        business_implication: String(suggestion.business_implication || "").trim(),
        evidence_fact_ids: evidenceFactIds,
        evidence_question_ids: evidenceQuestionIds,
      };
    }).filter((page) => page && page.title && page.evidence_fact_ids.length);
  }

  root.PptReportAi = {
    DEFAULT_BATCH_SIZE,
    SLIDE_BRIEF_CONCURRENCY,
    REPORT_NARRATIVE_SYSTEM_PROMPT,
    REPORT_STORYLINE_TYPES,
    SLIDE_BRIEF_SYSTEM_PROMPT,
    buildFallbackSlideBriefInput,
    buildNarrativeInput,
    buildPageBatchInput,
    buildPageNarrativeContext,
    buildReportNarrativeInput,
    chunkPages,
    chunkPagesByChapter,
    filterWritablePages,
    evidenceLabelMatchesClause,
    fallbackNarrative,
    generateReportNarrativeOrFallback,
    mergeSlideBriefSuggestion,
    mapWithConcurrency,
    organizePagesByNarrative,
    parseJsonObject,
    validateNarrative,
    validatePageOutput,
    validateReportNarrative,
  };
})(typeof window !== "undefined" ? window : globalThis);
