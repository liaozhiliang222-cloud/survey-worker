(function initPptReportAi(root) {
  "use strict";

  const DEFAULT_BATCH_SIZE = 4;

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

  function buildPageBatchInput(batch, narrative, previousPage = null) {
    const pageIds = new Set((batch || []).map((page) => Number(page.page_idx)));
    return {
      narrative: {
        findings: narrative?.findings || [],
        storyline: (narrative?.storyline || []).filter((item) => pageIds.has(Number(item.page_idx))),
      },
      previous_page: previousPage ? {
        page_idx: Number(previousPage.page_idx),
        title: previousPage.title,
        business_implication: previousPage.business_implication,
      } : null,
      pages: batch || [],
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
        bullets: fitBullets(suggestion.bullets),
        business_implication: String(suggestion.business_implication || "").trim(),
        evidence_fact_ids: evidenceFactIds,
        evidence_question_ids: evidenceQuestionIds,
      };
    }).filter((page) => page && page.title && page.evidence_fact_ids.length);
  }

  root.PptReportAi = {
    DEFAULT_BATCH_SIZE,
    buildNarrativeInput,
    buildPageBatchInput,
    chunkPages,
    fallbackNarrative,
    parseJsonObject,
    validateNarrative,
    validatePageOutput,
  };
})(typeof window !== "undefined" ? window : globalThis);