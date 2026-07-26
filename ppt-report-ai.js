(function initPptReportAi(root) {
  "use strict";

  const DEFAULT_BATCH_SIZE = 4;
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
    "默认规划 4–6 章，硬性限制 3–8 章。每章都必须包含 chapter_id、title、purpose、key_question。",
    "storyline_type 只能是 problem_solution、user_journey、funnel、diagnosis、opportunity 之一。",
    "不得编造 DataFact 中不存在的数字或结论；confidence 必须在 0 到 1 之间。",
    "只返回 JSON：{\"report_title\":\"\",\"central_thesis\":\"\",\"storyline_type\":\"diagnosis\",\"chapters\":[{\"chapter_id\":\"chapter_01\",\"title\":\"\",\"purpose\":\"\",\"key_question\":\"\"}],\"key_questions\":[],\"ending_message\":\"\",\"confidence\":0.9}。",
  ].join("\n");

  const SLIDE_BRIEF_SYSTEM_PROMPT = [
    "你是资深市场研究报告总监。请在给定 Report Narrative 下，为每页生成 SlideBrief 文案。",
    "每页输入都包含 central_thesis、chapter_context、previous_chapter、next_chapter；标题和正文必须服务于本章目的，并与前后章节连续。",
    "只允许使用该页 questions、DataFact、evidence_fact_ids、evidence_question_ids 中的证据，不得重新计算或编造数字。",
    "标题直接表达唯一结论；正文采用观察+数据证据+解释；相邻页面不得重复完全相同的结论。",
    "只返回 JSON：{\"pages\":[{\"page_idx\":1,\"title\":\"\",\"claim\":\"\",\"bullets\":[\"\",\"\"],\"business_implication\":\"\",\"evidence_fact_ids\":[],\"evidence_question_ids\":[]}]}。",
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
    const size = Math.max(3, Math.min(5, Number(requestedSize) || DEFAULT_BATCH_SIZE));
    const result = [];
    for (let index = 0; index < (pages || []).length; index += size) {
      result.push(pages.slice(index, index + size));
    }
    return result;
  }

  function pageQuestionIds(page) {
    return uniqueStrings((page?.questions || []).map((question) => question.code));
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
      data_facts: (context?.data_facts || []).map((fact) => ({ ...fact })),
      insights: (context?.global_findings || []).map((finding) => ({ ...finding })),
      current_report_structure: chapters,
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
    const chapters = rawChapters.map((chapter, index) => {
      const normalized = {
        chapter_id: String(chapter?.chapter_id || `chapter_${String(index + 1).padStart(2, "0")}`).trim(),
        title: String(chapter?.title || "").trim(),
        purpose: String(chapter?.purpose || "").trim(),
        key_question: String(chapter?.key_question || "").trim(),
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
    const pageChapter = String(page?.chapter || "");
    const pageChapterId = String(page?.chapter_id || "");
    let index = chapters.findIndex((chapter) =>
      (pageChapterId && String(chapter.chapter_id || "") === pageChapterId)
      || (pageChapter && String(chapter.title || "") === pageChapter)
    );
    if (index < 0) {
      const pageChapterOrder = uniqueStrings((allPages || []).map((item) => item.chapter || "其他研究"));
      index = Math.min(Math.max(0, pageChapterOrder.indexOf(pageChapter)), chapters.length - 1);
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
    const pageIds = new Set((batch || []).map((page) => Number(page.page_idx)));
    const pageContexts = (batch || []).map((page) => ({
      page_idx: Number(page.page_idx),
      ...buildPageNarrativeContext(page, reportNarrative, allPages || batch),
    }));
    return {
      report_narrative: reportNarrative?.central_thesis ? reportNarrative : null,
      central_thesis: String(reportNarrative?.central_thesis || ""),
      fallback_mode: reportNarrative?.central_thesis ? null : "data_fact_to_slide_brief",
      narrative: {
        findings: reportNarrative?.findings || [],
        storyline: (reportNarrative?.storyline || []).filter((item) => pageIds.has(Number(item.page_idx))),
      },
      previous_page: previousPage ? {
        page_idx: Number(previousPage.page_idx),
        title: previousPage.title,
        business_implication: previousPage.business_implication,
      } : null,
      page_contexts: pageContexts,
      pages: (batch || []).map((page, index) => ({
        ...page,
        narrative_context: pageContexts[index],
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

  function validatePageOutput(payload, batch) {
    const allowedPages = new Map((batch || []).map((page) => [Number(page.page_idx), page]));
    return (Array.isArray(payload?.pages) ? payload.pages : []).map((suggestion) => {
      const pageIdx = Number(suggestion.page_idx);
      const page = allowedPages.get(pageIdx);
      if (!page) return null;
      const allowedFacts = new Set(uniqueStrings(page.evidence_fact_ids));
      const allowedQuestions = new Set(pageQuestionIds(page));
      let evidenceFactIds = uniqueStrings(suggestion.evidence_fact_ids).filter((id) => allowedFacts.has(id));
      let evidenceQuestionIds = uniqueStrings(suggestion.evidence_question_ids).filter((id) => allowedQuestions.has(id));
      if (!evidenceFactIds.length) evidenceFactIds = Array.from(allowedFacts).slice(0, 6);
      if (!evidenceQuestionIds.length) evidenceQuestionIds = Array.from(allowedQuestions);
      return {
        page_idx: pageIdx,
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
    REPORT_NARRATIVE_SYSTEM_PROMPT,
    REPORT_STORYLINE_TYPES,
    SLIDE_BRIEF_SYSTEM_PROMPT,
    buildFallbackSlideBriefInput,
    buildNarrativeInput,
    buildPageBatchInput,
    buildPageNarrativeContext,
    buildReportNarrativeInput,
    chunkPages,
    fallbackNarrative,
    generateReportNarrativeOrFallback,
    mergeSlideBriefSuggestion,
    parseJsonObject,
    validateNarrative,
    validatePageOutput,
    validateReportNarrative,
  };
})(typeof window !== "undefined" ? window : globalThis);