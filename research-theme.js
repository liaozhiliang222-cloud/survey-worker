(function initResearchThemeClassifier(root) {
  "use strict";

  const MAX_THEME_COUNT = 8;

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).map(function (value) {
      return String(value || "").trim();
    }).filter(Boolean)));
  }

  function normalizeThemeId(value) {
    const themeId = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return /^[a-z][a-z0-9_]{1,63}$/.test(themeId) ? themeId : "";
  }

  function normalizeTheme(theme, index) {
    if (!theme || typeof theme !== "object") return null;
    const themeId = normalizeThemeId(theme.theme_id || theme.id);
    const name = String(theme.name || "").trim();
    const description = String(theme.description || "").trim();
    const decisionArea = String(theme.decision_area || "").trim();
    const allowedChapters = uniqueStrings(theme.allowed_chapters);
    if (!themeId || !name || !description || !decisionArea || !allowedChapters.length) return null;
    return {
      theme_id: themeId,
      name: name,
      description: description,
      decision_area: decisionArea,
      allowed_chapters: allowedChapters,
      keywords: uniqueStrings(theme.keywords),
      priority: Number.isFinite(Number(theme.priority)) ? Number(theme.priority) : index + 1,
    };
  }

  function pageUnits(context) {
    return (context.pages || []).map(function (page, index) {
      return {
        classification_id: "page:" + (Number(page.page_idx) || index + 1),
        unit_type: "page",
        page_idx: Number(page.page_idx) || index + 1,
        question_ids: uniqueStrings((page.questions || []).map(function (question) {
          return question && question.code;
        })),
        question_titles: uniqueStrings((page.questions || []).map(function (question) {
          return question && question.title;
        })),
        title: String(page.current_title || page.title || "").trim(),
        source_chapter: String(page.source_chapter || page.chapter || "").trim(),
        current_chapter: String(page.chapter || "").trim(),
        analysis_module: String(page.analysis_module || page.module || "").trim(),
        research_role: String(page.research_role || "").trim(),
        page_type: String(page.page_type || page.slide_type || page.type || "").trim(),
        analysis_model: uniqueStrings((page.questions || []).map(function (question) {
          return question && question.model_semantics && question.model_semantics.analysis_model;
        })).join(","),
      };
    });
  }

  function findingUnits(context) {
    return (context.global_findings || []).map(function (finding, index) {
      return {
        classification_id: "finding:" + (index + 1),
        unit_type: "finding",
        finding_idx: index,
        question_ids: uniqueStrings(finding.evidence_question_ids),
        title: String(finding.title || "").trim(),
        description: String(finding.description || "").trim(),
        analysis_module: String(finding.analysis_module || "").trim(),
      };
    });
  }

  function buildResearchIntentHints(context) {
    const pages = pageUnits(context);
    const pageTypeCounts = {};
    pages.forEach(function (page) {
      const pageType = page.page_type || "unknown";
      pageTypeCounts[pageType] = (pageTypeCounts[pageType] || 0) + 1;
    });
    return {
      research_objective: String(context.research_objective || "").trim().slice(0, 500),
      research_archetype: String(context.research_archetype || "").trim(),
      core_research_module: String(context.core_research_module || "").trim(),
      research_modules: (context.research_modules || []).map(function (module) {
        return {
          name: String(module && (module.name || module.title || module.id) || "").trim(),
          description: String(module && module.description || "").trim().slice(0, 180),
        };
      }).filter(function (module) { return module.name; }),
      page_count: pages.length,
      question_count: uniqueStrings(pages.reduce(function (all, page) {
        return all.concat(page.question_ids || []);
      }, [])).length,
      source_chapters: uniqueStrings(pages.map(function (page) { return page.source_chapter; })).slice(0, 20),
      research_roles: uniqueStrings(pages.map(function (page) { return page.research_role; })).slice(0, 12),
      page_type_counts: pageTypeCounts,
      guidance: [
        "Classify each page by the research purpose it serves before choosing a chapter; do not classify by surface keywords.",
        "Create project-specific themes from the research objective; do not use a fixed taxonomy.",
        "Use page_catalog for page-level evidence and assignments; this object only summarizes project intent.",
      ],
    };
  }

  function themeDetails(classification, themeId) {
    const theme = (classification && classification.themes || []).find(function (item) {
      return item.theme_id === themeId;
    });
    if (!theme) return null;
    return {
      research_theme: theme.theme_id,
      theme_name: theme.name,
      decision_area: theme.decision_area,
      allowed_chapters: Array.from(theme.allowed_chapters || []),
    };
  }

  function baseUnits(context) {
    return pageUnits(context).concat(findingUnits(context));
  }

  function normalizeAssignment(item, unit, classification, source) {
    const themeId = normalizeThemeId(item && (item.theme_id || item.research_theme));
    const details = themeDetails(classification, themeId);
    if (!unit || !details) return null;
    return Object.assign({}, unit, details, {
      source: source || "narrative",
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.75)),
      chapter_reason: String(item.chapter_reason || "该发现按研究目的归入该主题。").trim(),
    });
  }

  function parseNarrativeThemeClassification(payload, context) {
    const source = payload && typeof payload === "object"
      ? (payload.research_theme_classification || payload)
      : {};
    const rawThemes = source.research_themes || source.themes || [];
    const themes = (Array.isArray(rawThemes) ? rawThemes : []).map(normalizeTheme).filter(Boolean);
    const ids = new Set();
    const uniqueThemes = themes.filter(function (theme) {
      if (ids.has(theme.theme_id)) return false;
      ids.add(theme.theme_id);
      return true;
    }).slice(0, MAX_THEME_COUNT);
    if (!uniqueThemes.length) return null;

    const classification = {
      version: "research_theme_dynamic_v1",
      themes: uniqueThemes,
      chapter_rules: [],
      assignments: [],
      unresolved: [],
      status: "partial",
      fallback_used: false,
      error: "",
    };
    const rawRules = source.chapter_rules || [];
    const chapterRules = (Array.isArray(rawRules) ? rawRules : []).map(function (rule) {
      const chapter = String(rule && rule.chapter || "").trim();
      const allowedThemes = uniqueStrings(rule && rule.allowed_themes)
        .map(normalizeThemeId)
        .filter(function (themeId) { return ids.has(themeId); });
      return chapter && allowedThemes.length ? { chapter: chapter, allowed_themes: allowedThemes } : null;
    }).filter(Boolean);
    uniqueThemes.forEach(function (theme) {
      theme.allowed_chapters.forEach(function (chapter) {
        let rule = chapterRules.find(function (item) { return item.chapter === chapter; });
        if (!rule) {
          rule = { chapter: chapter, allowed_themes: [] };
          chapterRules.push(rule);
        }
        if (!rule.allowed_themes.includes(theme.theme_id)) rule.allowed_themes.push(theme.theme_id);
      });
    });
    classification.chapter_rules = chapterRules;

    const units = baseUnits(context);
    const unitById = new Map(units.map(function (unit) { return [unit.classification_id, unit]; }));
    const pageUnitByIndex = new Map(pageUnits(context).map(function (unit) { return [Number(unit.page_idx), unit]; }));
    const rawAssignments = source.research_theme_assignments || source.page_theme_assignments || source.assignments || [];
    (Array.isArray(rawAssignments) ? rawAssignments : []).forEach(function (item) {
      const classificationId = String(item && item.classification_id || "").trim();
      const unit = unitById.get(classificationId) || pageUnitByIndex.get(Number(item && item.page_idx));
      const assignment = normalizeAssignment(item, unit, classification, "narrative");
      if (!assignment || classification.assignments.some(function (current) {
        return current.classification_id === assignment.classification_id;
      })) return;
      classification.assignments.push(assignment);
      unitById.delete(assignment.classification_id);
    });

    const pageAssignmentByQuestion = new Map();
    classification.assignments.filter(function (assignment) {
      return assignment.unit_type === "page";
    }).forEach(function (assignment) {
      (assignment.question_ids || []).forEach(function (questionId) {
        if (!pageAssignmentByQuestion.has(questionId)) pageAssignmentByQuestion.set(questionId, assignment);
      });
    });
    findingUnits(context).forEach(function (finding) {
      if (!unitById.has(finding.classification_id)) return;
      const inherited = (finding.question_ids || []).map(function (questionId) {
        return pageAssignmentByQuestion.get(questionId);
      }).find(Boolean);
      if (!inherited) return;
      const details = themeDetails(classification, inherited.research_theme);
      classification.assignments.push(Object.assign({}, finding, details, {
        source: "evidence_link",
        confidence: inherited.confidence,
        chapter_reason: inherited.chapter_reason,
      }));
      unitById.delete(finding.classification_id);
    });

    classification.unresolved = Array.from(unitById.values());
    classification.status = classification.unresolved.length ? "partial" : "complete";
    return classification;
  }

  function assignmentForPage(classification, page) {
    if (!classification || !classification.assignments) return null;
    const questionIds = new Set(uniqueStrings(page && (page.question_ids || (page.questions || []).map(function (question) {
      return question && question.code;
    }))));
    const byQuestions = classification.assignments.find(function (assignment) {
      return assignment.unit_type === "page"
        && questionIds.size
        && (assignment.question_ids || []).some(function (questionId) { return questionIds.has(questionId); });
    });
    if (byQuestions) return byQuestions;
    const pageIdx = Number(page && page.page_idx);
    return classification.assignments.find(function (assignment) {
      return assignment.unit_type === "page" && Number(assignment.page_idx) === pageIdx;
    }) || null;
  }

  function assignmentForFinding(classification, finding, findingIndex) {
    if (!classification || !classification.assignments) return null;
    const classificationId = Number.isInteger(findingIndex) ? "finding:" + (findingIndex + 1) : "";
    const direct = classification.assignments.find(function (assignment) {
      return classificationId && assignment.classification_id === classificationId;
    });
    if (direct) return direct;
    const questionIds = new Set(uniqueStrings(finding && finding.evidence_question_ids));
    return classification.assignments.find(function (assignment) {
      return assignment.unit_type === "finding"
        && (assignment.question_ids || []).some(function (questionId) { return questionIds.has(questionId); });
    }) || null;
  }

  function inferChapterAllowedThemes(chapter, classification) {
    const themeIds = new Set((classification && classification.themes || []).map(function (theme) {
      return theme.theme_id;
    }));
    const explicit = uniqueStrings(chapter && chapter.allowed_themes)
      .map(normalizeThemeId)
      .filter(function (themeId) { return themeIds.has(themeId); });
    if (explicit.length) return explicit;
    const title = String(chapter && chapter.title || "").trim();
    const rule = (classification && classification.chapter_rules || []).find(function (item) {
      return item.chapter === title;
    });
    if (rule) return Array.from(rule.allowed_themes || []);
    return (classification && classification.themes || []).filter(function (theme) {
      return (theme.allowed_chapters || []).includes(title);
    }).map(function (theme) { return theme.theme_id; });
  }

  function themeAllowsChapter(themeId, chapter, classification) {
    if (!classification) return true;
    const allowedThemes = inferChapterAllowedThemes(chapter, classification);
    return !allowedThemes.length || allowedThemes.includes(themeId);
  }

  function chapterForTheme(chapters, themeId, classification) {
    return (chapters || []).find(function (chapter) {
      const allowed = inferChapterAllowedThemes(chapter, classification);
      return allowed.length && allowed.includes(themeId);
    }) || null;
  }

  function reconcileNarrativeThemes(chapters, classification, context) {
    if (!classification || !classification.themes.length) {
      return { chapters: chapters, classification: null, warnings: [] };
    }
    const normalizedChapters = (chapters || []).map(function (chapter) {
      const allowedThemes = inferChapterAllowedThemes(chapter, classification);
      return Object.assign({}, chapter, { allowed_themes: allowedThemes });
    });
    const pageAssignments = classification.assignments.filter(function (assignment) {
      return assignment.unit_type === "page";
    });
    const assignedPages = new Set(pageAssignments.map(function (assignment) {
      return Number(assignment.page_idx);
    }));

    normalizedChapters.forEach(function (chapter) {
      const allowedThemes = chapter.allowed_themes || [];
      if (allowedThemes.length !== 1) return;
      (chapter.page_idxs || []).forEach(function (pageIdx) {
        if (assignedPages.has(Number(pageIdx))) return;
        const page = (context.pages || []).find(function (item) {
          return Number(item.page_idx) === Number(pageIdx);
        });
        if (!page) return;
        const details = themeDetails(classification, allowedThemes[0]);
        classification.assignments.push(Object.assign({}, pageUnits({ pages: [page] })[0], details, {
          source: "chapter_rule",
          confidence: 0.7,
          chapter_reason: "该页继承本章唯一允许的研究主题。",
        }));
        assignedPages.add(Number(pageIdx));
      });
    });

    normalizedChapters.forEach(function (chapter) {
      if ((chapter.allowed_themes || []).length) return;
      const themesInChapter = uniqueStrings((chapter.page_idxs || []).map(function (pageIdx) {
        const assignment = classification.assignments.find(function (item) {
          return item.unit_type === "page" && Number(item.page_idx) === Number(pageIdx);
        });
        return assignment && assignment.research_theme;
      }));
      chapter.allowed_themes = themesInChapter;
    });

    const warnings = [];
    pageAssignments.concat(classification.assignments.filter(function (assignment) {
      return assignment.source === "chapter_rule";
    })).forEach(function (assignment) {
      const currentChapter = normalizedChapters.find(function (chapter) {
        return (chapter.page_idxs || []).map(Number).includes(Number(assignment.page_idx));
      });
      if (!currentChapter || themeAllowsChapter(assignment.research_theme, currentChapter, classification)) return;
      const targetChapter = chapterForTheme(normalizedChapters, assignment.research_theme, classification);
      const warning = {
        level: "warning",
        code: "research_theme_chapter_mismatch",
        page_idx: Number(assignment.page_idx),
        research_theme: assignment.research_theme,
        decision_area: assignment.decision_area,
        chapter: String(currentChapter.title || ""),
        suggested_chapters: Array.from(assignment.allowed_chapters || []),
        corrected: Boolean(targetChapter),
        message: "",
      };
      if (targetChapter) {
        currentChapter.page_idxs = (currentChapter.page_idxs || []).filter(function (pageIdx) {
          return Number(pageIdx) !== Number(assignment.page_idx);
        });
        if (!(targetChapter.page_idxs || []).map(Number).includes(Number(assignment.page_idx))) {
          targetChapter.page_idxs = (targetChapter.page_idxs || []).concat(Number(assignment.page_idx));
        }
        warning.message = "该页面已按研究主题从“" + currentChapter.title + "”调整到“" + targetChapter.title + "”。";
      } else {
        warning.message = "该页面主题为 " + assignment.research_theme + "，当前章节可能不匹配，且未找到可安全调整的目标章节。";
      }
      warnings.push(warning);
    });

    const unresolvedMismatch = warnings.some(function (warning) { return !warning.corrected; });
    if (unresolvedMismatch) {
      return {
        chapters: chapters,
        classification: null,
        warnings: warnings.map(function (warning) {
          return Object.assign({}, warning, { fallback_used: true });
        }),
      };
    }
    classification.unresolved = baseUnits(context).filter(function (unit) {
      return !classification.assignments.some(function (assignment) {
        return assignment.classification_id === unit.classification_id;
      });
    });
    classification.status = classification.unresolved.length ? "partial" : "complete";
    return { chapters: normalizedChapters, classification: classification, warnings: warnings };
  }

  function findNarrativeThemeWarnings(reportNarrative, classification) {
    if (!classification) return [];
    const warnings = [];
    (reportNarrative.chapters || []).forEach(function (chapter) {
      (chapter.page_idxs || []).forEach(function (pageIdx) {
        const assignment = (classification.assignments || []).find(function (item) {
          return item.unit_type === "page" && Number(item.page_idx) === Number(pageIdx);
        });
        if (!assignment || themeAllowsChapter(assignment.research_theme, chapter, classification)) return;
        warnings.push({
          level: "warning",
          code: "research_theme_chapter_mismatch",
          page_idx: Number(pageIdx),
          research_theme: assignment.research_theme,
          decision_area: assignment.decision_area,
          chapter: String(chapter.title || ""),
          suggested_chapters: Array.from(assignment.allowed_chapters || []),
          corrected: false,
          message: "该页面主题为 " + assignment.research_theme + "，当前章节可能不匹配。",
        });
      });
    });
    return warnings;
  }

  function findBlueprintThemeWarnings(pages, reportNarrative) {
    const classification = reportNarrative && reportNarrative.research_theme_classification;
    if (!classification) return [];
    return (pages || []).flatMap(function (page) {
      const assignment = assignmentForPage(classification, page);
      const chapter = (reportNarrative.chapters || []).find(function (item) {
        return String(item.chapter_id || "") === String(page.chapter_id || (page.slide_brief && page.slide_brief.chapter_id) || "")
          || String(item.title || "") === String(page.chapter || "");
      });
      if (!assignment || !chapter || themeAllowsChapter(assignment.research_theme, chapter, classification)) return [];
      return [{
        level: "warning",
        code: "research_theme_chapter_mismatch",
        slide_id: String(page.slide_id || (page.slide_brief && page.slide_brief.slide_id) || ""),
        page_idx: Number(page.page_idx),
        slide_title: String(page.title || (page.slide_brief && page.slide_brief.title) || ""),
        research_theme: assignment.research_theme,
        decision_area: assignment.decision_area,
        chapter: String(chapter.title || ""),
        suggested_chapters: Array.from(assignment.allowed_chapters || []),
        corrected: false,
        message: "该页面主题为 " + assignment.research_theme + "，当前章节可能不匹配，建议调整章节归属。",
      }];
    });
  }

  root.ResearchThemeClassifier = {
    MAX_THEME_COUNT: MAX_THEME_COUNT,
    assignmentForFinding: assignmentForFinding,
    assignmentForPage: assignmentForPage,
    buildResearchIntentHints: buildResearchIntentHints,
    chapterForTheme: chapterForTheme,
    findBlueprintThemeWarnings: findBlueprintThemeWarnings,
    findNarrativeThemeWarnings: findNarrativeThemeWarnings,
    inferChapterAllowedThemes: inferChapterAllowedThemes,
    parseNarrativeThemeClassification: parseNarrativeThemeClassification,
    reconcileNarrativeThemes: reconcileNarrativeThemes,
    themeAllowsChapter: themeAllowsChapter,
    themeDetails: themeDetails,
  };
})(typeof window !== "undefined" ? window : globalThis);