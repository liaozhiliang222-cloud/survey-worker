import crypto from "node:crypto";

export const pptScriptWorkflowStages = Object.freeze([
  { id: "outline", label: "正在读取报告大纲" },
  { id: "page_planning", label: "正在拆解页面结构" },
  { id: "evidence_mapping", label: "正在匹配页面证据" },
  { id: "script", label: "正在生成页面脚本" },
  { id: "density", label: "正在检查页面信息密度" },
  { id: "continuity", label: "正在检查 Storyline 连续性" },
  { id: "artifact", label: "正在保存 PPT 脚本" },
]);

const PAGE_TYPES = new Set(["cover", "navigation", "qualitative_summary", "qualitative_insight", "quote_evidence", "theme_summary", "segment_comparison", "competitor_comparison", "case_study", "journey", "framework", "research_framework", "segmentation_map", "persona", "evidence_diagnostic", "concept_definition", "needs_pyramid", "priority_matrix", "matrix", "problem_reason", "recommendation", "executive_summary", "section_intro", "data_insight", "comparison", "summary", "appendix"]);
const VISUAL_TYPES = new Set(["bar_chart", "line_chart", "stacked_bar", "matrix", "journey", "funnel", "table", "quote", "comparison", "process", "framework", "timeline", "pyramid", "text_summary", "none"]);
const CHART_TYPES = new Set(["bar_chart", "line_chart", "stacked_bar", "funnel"]);
const NO_EVIDENCE_PAGE_TYPES = new Set(["cover", "navigation", "section_intro"]);
const TOPIC_TITLE = /(?:分析|情况|介绍|概览)$/;
const EMPTY_ADVICE = /^(?:提升用户体验|加强品牌建设|持续优化服务|关注用户需求|构建闭环)[。！!]?$/;

function text(value, max = 20_000) { return String(value ?? "").trim().slice(0, max); }
function object(value, fallback = {}) { if (value == null || value === "") return fallback; if (value && typeof value === "object" && !Array.isArray(value)) return value; try { const parsed = JSON.parse(String(value)); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; } }
function array(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(array(values).map((value) => text(value, 128)).filter(Boolean))]; }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function bool(value) { return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true"; }
function numericTokens(value) { return text(value, 50_000).match(/-?\d+(?:\.\d+)?%?/g) || []; }
function compactJson(value, max) { const raw = JSON.stringify(value); return raw.length <= max ? raw : JSON.stringify({ truncated: true, summary: text(raw, Math.max(500, max - 100)) }); }

function outlineEvidenceIds(outline) {
  const ids = new Set();
  const visit = (value) => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (key === "evidence_ids" && Array.isArray(child)) unique(child).forEach((item) => ids.add(item)); else visit(child); } };
  visit(outline); return [...ids];
}

function evidenceValue(item) { return object(item?.value); }
function evidenceType(item) { return text(item?.type || (item?.source_type === "crosstab" ? "quantitative" : item?.source_type === "transcript_segment" ? "transcript_quote" : "artifact"), 64); }
function sanitizedEvidenceValue(value, depth = 0) {
  if (depth > 3) return "[bounded]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizedEvidenceValue(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? text(value, 2_000) : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !["raw_rows", "rows", "transcript", "full_text", "content"].includes(key)).slice(0, 30).map(([key, child]) => [key, sanitizedEvidenceValue(child, depth + 1)]));
}
function evidencePublic(item) {
  const value = evidenceValue(item); const type = evidenceType(item);
  const safeValue = type === "transcript_quote"
    ? { quote: String(value.quote || "").trim(), transcript_title: text(value.transcript_title, 300), respondent_label: text(value.respondent_label, 200), transcript_id: text(value.transcript_id, 128), segment_id: text(value.segment_id || item.source_id, 128), metadata: sanitizedEvidenceValue(value.metadata || {}) }
    : sanitizedEvidenceValue(value);
  return { id: text(item.id, 128), type, claim: text(item.claim, 2_000), strength: text(item.strength, 16) || "medium", theme: text(item.theme, 200), source_type: text(item.source_type, 64), source_id: text(item.source_id, 128), value: safeValue };
}

function evidenceStatus(ids, map, pageType) {
  if (NO_EVIDENCE_PAGE_TYPES.has(pageType)) return "not_required";
  const linked = ids.map((item) => map.get(item)).filter(Boolean);
  if (!linked.length) return "needs_supplement";
  if (linked.some((item) => item.strength === "strong") || linked.length >= 2) return "sufficient";
  return "limited";
}

function coverage(ids, map) {
  const types = unique(ids.map((item) => map.get(item)?.type));
  return { evidence_count: ids.length, quantitative: types.includes("quantitative"), qualitative: types.some((item) => ["qualitative", "transcript_quote"].includes(item)), transcript_quote: types.includes("transcript_quote"), tool_result: types.includes("tool_result"), types };
}

function titleFor(page, index) {
  const title = text(page.title, 180); const message = text(page.key_message, 180);
  if (title && title.length >= 8 && !TOPIC_TITLE.test(title) && !EMPTY_ADVICE.test(title)) return title;
  return message || title || `第 ${index + 1} 页结论仍需补充`;
}

function pageText(page) { return [page.subtitle, page.purpose, page.key_message, ...array(page.content_structure).flatMap((block) => [block.title, block.body, ...array(block.items)]), ...array(page.supporting_points)].map((item) => text(item, 5_000)).join(""); }
function tokens(value) { const normalized = text(value, 2_000).toLowerCase().replace(/[的了与和及是为在对将已正更较很一二三四五六七八九十\s，。；：、“”‘’（）()【】\[\]!?！？\-_/]/g, ""); const result = new Set(); for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2)); return result; }
function similarity(left, right) { const a = tokens(`${left.title}${left.key_message}`); const b = tokens(`${right.title}${right.key_message}`); if (!a.size || !b.size) return 0; return [...a].filter((item) => b.has(item)).length / Math.min(a.size, b.size); }
function uniqueObjects(values, key) { const seen = new Set(); return array(values).filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }

function applyPageMetrics(page, evidenceMap) {
  page.evidence_status = evidenceStatus(page.evidence_ids, evidenceMap, page.page_type);
  page.evidence_coverage = coverage(page.evidence_ids, evidenceMap);
  const characterCount = pageText(page).length; const moduleCount = page.content_structure.length + page.supporting_points.length + (page.quotes.length ? 1 : 0) + (page.data_points.length ? 1 : 0);
  page.density = { character_count: characterCount, module_count: moduleCount, title_length: page.title.length, status: page.title.length > 45 || characterCount > 700 || moduleCount > 5 ? "overloaded" : characterCount > 500 || moduleCount > 4 ? "dense" : "balanced", recommendation: page.title.length > 45 || characterCount > 700 || moduleCount > 5 ? "建议拆页或压缩到 1 个结论与 2～4 个支撑信息。" : "" };
  return page;
}

function exactQuote(evidence) { return String(evidenceValue(evidence).quote || "").trim(); }
function verifiedQuote(quote, evidenceMap) {
  const evidence = evidenceMap.get(text(quote.evidence_id, 128));
  const actual = evidence && evidence.type === "transcript_quote" ? exactQuote(evidence) : "";
  const candidate = String(quote.text || quote.quote || "").trim();
  if (!actual || !candidate || !actual.includes(candidate)) return null;
  const value = evidenceValue(evidence);
  return { text: candidate, quote_start: actual.indexOf(candidate), quote_end: actual.indexOf(candidate) + candidate.length, evidence_id: evidence.id, source_label: text(quote.source_label || value.transcript_title || value.respondent_label, 300), respondent_label: text(value.respondent_label, 300), transcript_id: text(value.transcript_id, 128), segment_id: text(value.segment_id || evidence.source_id, 128), metadata: sanitizedEvidenceValue(value.metadata || {}) };
}

function sanitizeQuotedText(value, validQuotes, issues, pageId) {
  return text(value, 10_000).replace(/[“"]([^”"]{2,})[”"]/g, (full, inner) => {
    if (validQuotes.has(inner) || validQuotes.has(full.slice(1, -1))) return full;
    issues.push({ type: "unverified_quote", page_id: pageId, message: `已移除无法回溯 Transcript Evidence 的引号：${text(inner, 80)}` });
    return inner;
  });
}

function normalizedStringList(value, maxItems = 12, maxChars = 500) {
  return array(value).slice(0, maxItems).map((item) => text(typeof item === "object" ? item.text || item.title || item.label : item, maxChars)).filter(Boolean);
}

function normalizedNamedItems(value, fields, maxItems = 12) {
  return array(value).slice(0, maxItems).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => Object.fromEntries(fields.map(([key, limit]) => [key, typeof limit === "number" ? text(item[key], limit) : item[key]]).filter(([, entry]) => entry !== "" && entry != null)));
}

function normalizedAttributes(value) {
  return Object.fromEntries(Object.entries(object(value)).slice(0, 8).map(([key, entry]) => [text(key, 50), text(entry, 120)]).filter(([key, entry]) => key && entry));
}

function normalizeDataPoint(point, evidenceMap, issues, pageId) {
  const evidence = evidenceMap.get(text(point.evidence_id, 128));
  if (!evidence || evidence.type === "transcript_quote") { issues.push({ type: "unsupported_data", page_id: pageId, message: `数据点“${text(point.label, 80)}”没有有效的定量 Evidence。` }); return null; }
  const value = text(point.value, 100);
  const field = text(point.value_field || "value", 32);
  const allowed = ["value", "total", "overall", "base", "total_base", "mean", "nps", "percent"];
  const actual = allowed.includes(field) ? evidence.value[field] : undefined;
  const number = (v) => typeof v === "number" ? v : typeof v === "string" && /^-?\d+(?:\.\d+)?%?$/.test(v.trim()) ? Number(v.trim().replace(/%$/, "")) : null;
  const matches = actual != null && value !== "" && (number(actual) != null && number(value) != null ? number(actual) === number(value) : String(actual) === value);
  if (!['quantitative','tool_result'].includes(evidence.type) || !matches) { issues.push({ type: "unsupported_data", page_id: pageId, message: `数据点“${text(point.label,80)}=${value}”与关联 Evidence 的 ${field} 不一致。` }); return null; }
  if (!text(evidence.source_id, 128)) { issues.push({ type: "invalid_data_source", page_id: pageId, message: "关联 Evidence 缺少可回溯的数据来源。" }); return null; }
  const sourceId = text(point.data_source_id || evidence.source_id, 128);
  if (sourceId && sourceId !== evidence.source_id) { issues.push({ type: "invalid_data_source", page_id: pageId, message: "图表 data_source_id 与 Evidence 来源不一致。" }); return null; }
  return { label: text(point.label, 200), value, value_field: field, unit: text(point.unit, 40), evidence_id: evidence.id, data_source_id: evidence.source_id };
}

function normalizePage(page, index, evidenceMap, issues) {
  const timestamp = new Date().toISOString();
  const pageId = text(page.id || page.page_id, 128) || id("page");
  const evidenceIds = unique(page.evidence_ids).filter((item) => evidenceMap.has(item));
  const quotes = array(page.quotes).map((item) => verifiedQuote(item, evidenceMap)).filter(Boolean);
  if (quotes.length < array(page.quotes).length) issues.push({ type: "unverified_quote", page_id: pageId, message: "已移除无法逐字回溯的原声。" });
  const validQuoteTexts = new Set(quotes.map((item) => item.text.replace(/^[“"]|[”"]$/g, "")));
  const pageType = PAGE_TYPES.has(page.page_type) ? page.page_type : "data_insight";
  const contentStructure = array(page.content_structure || page.content).slice(0, 12).map((block) => ({
    region: text(block.region || block.position, 80), width: text(block.width, 40), title: sanitizeQuotedText(block.title, validQuoteTexts, issues, pageId),
    body: sanitizeQuotedText(block.body || block.text, validQuoteTexts, issues, pageId), items: array(block.items).slice(0, 10).map((item) => sanitizeQuotedText(item, validQuoteTexts, issues, pageId)),
  }));
  const dataPoints = array(page.data_points).map((item) => normalizeDataPoint(item, evidenceMap, issues, pageId)).filter(Boolean);
  const supportingFindings = array(page.supporting_findings || page.supporting_points).slice(0, 8).map((item) => typeof item === "object" ? {
    id: text(item.id, 128),
    text: sanitizeQuotedText(item.text || item.finding || item.title, validQuoteTexts, issues, pageId),
    insight_id: text(item.insight_id, 128),
    evidence_ids: unique(item.evidence_ids).filter((value) => evidenceMap.has(value)),
  } : { id: "", text: sanitizeQuotedText(item, validQuoteTexts, issues, pageId), insight_id: "", evidence_ids: [] });
  const supportingEvidenceIds = unique(supportingFindings.flatMap((item) => item.evidence_ids));
  const visualRaw = object(page.visual_spec || (typeof page.visual === "object" ? page.visual : { type: page.visual }));
  const visualType = VISUAL_TYPES.has(visualRaw.type) ? visualRaw.type : "text_summary";
  const visualEvidenceIds = unique([...(visualRaw.evidence_ids || []), ...evidenceIds]).filter((item) => evidenceMap.has(item));
  if (CHART_TYPES.has(visualType) && !dataPoints.length) issues.push({ type: "chart_data_gap", page_id: pageId, message: "该图表缺少可验证的完整数据点，应缩小表达范围或补充数据。" });
  const normalized = {
    id: pageId, page_number: index + 1, chapter: text(page.chapter, 240), page_type: pageType,
    layout_variant: text(page.layout_variant || page.variant || object(page.layout_spec).variant, 80),
    density_hint: ["low", "medium", "high"].includes(page.density_hint) ? page.density_hint : "medium",
    title: titleFor(page, index), subtitle: sanitizeQuotedText(page.subtitle, validQuoteTexts, issues, pageId),
    purpose: sanitizeQuotedText(page.purpose, validQuoteTexts, issues, pageId), key_message: sanitizeQuotedText(page.key_message, validQuoteTexts, issues, pageId),
    outcome_label: sanitizeQuotedText(page.outcome_label, validQuoteTexts, issues, pageId),
    insight_id: text(page.insight_id, 128), theme_ids: unique(page.theme_ids),
    supporting_points: supportingFindings.map((item) => item.text),
    supporting_findings: supportingFindings,
    content_structure: contentStructure, data_points: dataPoints, quotes,
    visual_spec: { type: visualType, description: text(visualRaw.description, 2_000), evidence_ids: visualEvidenceIds, data_source_ids: unique(dataPoints.map((item) => item.data_source_id)) },
    layout_spec: { composition: text(object(page.layout_spec || page.layout).composition || page.layout, 1_000), variant: text(page.layout_variant || page.variant || object(page.layout_spec).variant, 80), regions: array(object(page.layout_spec || page.layout).regions).slice(0, 8) },
    evidence_label: text(page.evidence_label, 60),
    hypothesis: sanitizeQuotedText(page.hypothesis, validQuoteTexts, issues, pageId), verdict: sanitizeQuotedText(page.verdict, validQuoteTexts, issues, pageId), recommendation: sanitizeQuotedText(page.recommendation, validQuoteTexts, issues, pageId),
    profile: { name: text(object(page.profile).name, 80), archetype: text(object(page.profile).archetype, 120), attributes: normalizedAttributes(object(page.profile).attributes), motto: sanitizeQuotedText(object(page.profile).motto, validQuoteTexts, issues, pageId) },
    traits: normalizedStringList(page.traits, 16, 500), behaviors: normalizedStringList(page.behaviors, 16, 500),
    segments: array(page.segments).slice(0, 16).filter((item) => item && typeof item === "object").map((item) => ({ title: text(item.title || item.label, 100), parent: text(item.parent, 100), summary: sanitizeQuotedText(item.summary || item.body, validQuoteTexts, issues, pageId), x: Number.isFinite(Number(item.x)) ? Number(item.x) : 50, y: Number.isFinite(Number(item.y)) ? Number(item.y) : 50 })),
    axes: { x: text(object(page.axes).x, 80), y: text(object(page.axes).y, 80), x_low: text(object(page.axes).x_low, 80), x_high: text(object(page.axes).x_high, 80), y_low: text(object(page.axes).y_low, 80), y_high: text(object(page.axes).y_high, 80) },
    quadrant_labels: normalizedStringList(page.quadrant_labels, 4, 80), focus_stages: array(page.focus_stages).slice(0, 12).map((value) => Number(value)).filter(Number.isFinite),
    definition_layers: normalizedNamedItems(page.definition_layers, [["title", 120], ["body", 600], ["short", 160]], 8),
    boundary_rules: normalizedNamedItems(page.boundary_rules, [["title", 120], ["body", 600], ["statement", 600]], 12),
    levels: normalizedNamedItems(page.levels, [["title", 120], ["body", 600], ["statement", 600]], 8),
    segment_mapping: normalizedNamedItems(page.segment_mapping, [["segment", 120], ["level", 120]], 12),
    items: array(page.items).slice(0, 20).filter((item) => item && typeof item === "object").map((item) => ({ label: text(item.label || item.title, 100), title: text(item.title || item.label, 100), x: Number.isFinite(Number(item.x)) ? Number(item.x) : 50, y: Number.isFinite(Number(item.y)) ? Number(item.y) : 50, weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0, priority: text(item.priority, 40) })),
    evidence_ids: unique([...evidenceIds, ...supportingEvidenceIds, ...quotes.map((item) => item.evidence_id), ...dataPoints.map((item) => item.evidence_id)]),
    transcript_segment_ids: unique(quotes.map((item) => item.segment_id)),
    source_notes: text(page.source_notes, 2_000), transition_from_previous: text(page.transition_from_previous, 1_000), transition_to_next: text(page.transition_to_next || page.transition, 1_000), transition: text(page.transition_to_next || page.transition, 1_000),
    finding_refs: unique(page.finding_refs), recommendation_priority: ["P0", "P1", "P2"].includes(page.recommendation_priority) ? page.recommendation_priority : "",
    created_at: text(page.created_at, 64) || timestamp, updated_at: text(page.updated_at, 64) || timestamp,
  };
  return applyPageMetrics(normalized, evidenceMap);
}

function deduplicatePages(pages, issues) {
  const result = [];
  for (const page of pages) {
    const duplicate = result.find((candidate) => !NO_EVIDENCE_PAGE_TYPES.has(page.page_type) && similarity(candidate, page) >= 0.72);
    if (!duplicate) { result.push(page); continue; }
    duplicate.evidence_ids = unique([...duplicate.evidence_ids, ...page.evidence_ids]);
    duplicate.visual_spec.evidence_ids = unique([...duplicate.visual_spec.evidence_ids, ...page.visual_spec.evidence_ids]);
    duplicate.supporting_points = unique([...duplicate.supporting_points, ...page.supporting_points]).slice(0, 8);
    duplicate.supporting_findings = uniqueObjects([...duplicate.supporting_findings, ...page.supporting_findings], (item) => `${item.id}|${item.text}`).slice(0, 8);
    duplicate.content_structure = uniqueObjects([...duplicate.content_structure, ...page.content_structure], (item) => `${item.region}|${item.title}|${item.body}`).slice(0, 12);
    duplicate.data_points = uniqueObjects([...duplicate.data_points, ...page.data_points], (item) => `${item.evidence_id}|${item.label}|${item.value}`).slice(0, 30);
    duplicate.quotes = uniqueObjects([...duplicate.quotes, ...page.quotes], (item) => `${item.evidence_id}|${item.text}`).slice(0, 8);
    duplicate.transcript_segment_ids = unique([...duplicate.transcript_segment_ids, ...page.transcript_segment_ids]);
    duplicate.merged_from_page_ids = unique([...(duplicate.merged_from_page_ids || []), page.id]);
    issues.push({ type: "duplicate_page", page_id: duplicate.id, message: `已合并重复页面“${page.title}”。` });
  }
  return result.map((page, index) => ({ ...page, page_number: index + 1 }));
}

function continuityCheck(pages) {
  const issues = [];
  for (const [index, page] of pages.entries()) {
    if (!page.purpose) issues.push({ type: "missing_purpose", page_id: page.id, message: `P${index + 1} 缺少 Page Purpose。` });
    if (!page.key_message && !NO_EVIDENCE_PAGE_TYPES.has(page.page_type)) issues.push({ type: "missing_key_message", page_id: page.id, message: `P${index + 1} 缺少 Key Message。` });
    if (index > 0 && !page.transition_from_previous && !pages[index - 1].transition_to_next) issues.push({ type: "missing_transition", page_id: page.id, message: `P${index} → P${index + 1} 缺少过渡说明。` });
    if (page.page_type === "recommendation" && !page.finding_refs.length && !page.evidence_ids.length) issues.push({ type: "unlinked_recommendation", page_id: page.id, message: "建议页没有绑定前置 Finding 或 Evidence。" });
  }
  return issues;
}

export function buildPptScriptEvidenceContext({ outlineArtifact, scriptArtifact = null, targetPageId = "", evidence = [], insights = [], maxChars = 48_000 } = {}) {
  const outline = object(outlineArtifact?.content); const script = object(scriptArtifact?.content, null);
  const targetPage = targetPageId && script ? array(script.pages).find((item) => item.id === targetPageId) : null;
  const referencedIds = new Set(targetPage ? unique(targetPage.evidence_ids) : outlineEvidenceIds(script || outline));
  let selected = evidence.filter((item) => referencedIds.has(item.id) && !bool(item.excluded)).map(evidencePublic);
  const selectedIds = new Set(selected.map((item) => item.id));
  let compactInsights = insights.filter((item) => array(item.evidence_ids).some((evidenceId) => selectedIds.has(evidenceId))).slice(0, 30).map((item) => ({ id: item.id, title: item.title, statement: item.statement, business_implication: item.business_implication, evidence_ids: unique(item.evidence_ids).filter((evidenceId) => selectedIds.has(evidenceId)) }));
  const make = () => ({ evidence: selected, insights: compactInsights, counts: { evidence: selected.length, quantitative: selected.filter((item) => item.type === "quantitative").length, qualitative: selected.filter((item) => ["qualitative", "transcript_quote"].includes(item.type)).length }, raw_transcript_chars: 0, raw_dataset_rows: 0 });
  let payload = make(); let serialized = JSON.stringify(payload);
  while (serialized.length > maxChars && compactInsights.length) { compactInsights.pop(); payload = make(); serialized = JSON.stringify(payload); }
  while (serialized.length > maxChars && selected.length > 1) { selected.pop(); payload = make(); serialized = JSON.stringify(payload); }
  return { ...payload, serialized, included_evidence_ids: selected.map((item) => item.id), target_page: targetPage || null };
}

function promptSchema(pageOnly = false) {
  const page = { id: "existing id for revision, otherwise blank", chapter: "chapter", page_type: "navigation|section_intro|executive_summary|qualitative_summary|qualitative_insight|quote_evidence|theme_summary|research_framework|segmentation_map|persona|journey|comparison|segment_comparison|competitor_comparison|evidence_diagnostic|concept_definition|needs_pyramid|priority_matrix|case_study|matrix|problem_reason|recommendation", layout_variant: "supported variant for the page type", density_hint: "low|medium|high", title: "结论标题", subtitle: "optional", purpose: "why this page exists", key_message: "one conclusion", outcome_label: "optional concise 8-18 character label for a fishbone outcome head; full conclusion stays in key_message/verdict", insight_id: "persisted insight id", theme_ids: ["theme id"], supporting_findings: [{ id: "finding id", text: "specific finding", insight_id: "insight id", evidence_ids: ["evidence id"] }], content_structure: [{ region: "left/right/top/bottom", width: "55%", title: "specific block title", body: "specific copy", items: ["specific copy"] }], data_points: [{ label: "only when quantitative evidence is already available", value: "18", value_field: "value|total|base", unit: "NPS", evidence_id: "project evidence id", data_source_id: "source id from that evidence" }], quotes: [{ text: "exact quote copied from transcript Evidence", evidence_id: "transcript evidence id", source_label: "interview", respondent_label: "respondent", transcript_id: "transcript id", segment_id: "segment id", metadata: {} }], profile: { name: "persona name", archetype: "archetype", attributes: {}, motto: "paraphrased persona proposition, not a quote" }, traits: ["trait"], behaviors: ["behaviour"], segments: [{ title: "segment", parent: "parent", summary: "meaning", x: 50, y: 50 }], axes: { x: "x axis", y: "y axis" }, quadrant_labels: ["four labels"], focus_stages: [1], definition_layers: [{ title: "layer", body: "definition", short: "short label" }], boundary_rules: [{ title: "rule", body: "test" }], levels: [{ title: "need level", body: "meaning" }], segment_mapping: [{ segment: "segment", level: "level" }], items: [{ label: "matrix point", x: 50, y: 50, weight: 30, priority: "high|medium|low" }], hypothesis: "hypothesis", verdict: "bounded verdict", recommendation: "specific action", visual_spec: { type: "matrix|journey|table|quote|comparison|process|framework|timeline|pyramid|text_summary|none", description: "what to show and highlight", evidence_ids: ["evidence id"] }, layout_spec: { composition: "native editable shape/text composition", variant: "same as layout_variant", regions: [] }, evidence_ids: ["evidence id"], evidence_label: "reader-facing evidence label", source_notes: "consumer interviews / expert interviews", transition_from_previous: "from previous", transition_to_next: "to next", finding_refs: ["prior page/insight id"], recommendation_priority: "P0|P1|P2 or blank" };
  return pageOnly ? page : { title: "项目 PPT 脚本", status: "draft", style_profile: { id: "qualitative_tech_blue_v2", aspect_ratio: "16:9", background: "ice_white", primary_color: "technology_blue", body_color: "deep_text", decoration: "restrained", icon_usage: "limited", title_style: "conclusion", preferred_font: "微软雅黑", forbid_left_vertical_bar: true }, pages: [page], evidence_gaps: [{ page_ref: "page id or planned page", claim: "unsupported claim", reason: "missing evidence", recommendation: "what to add" }] };
}

export function buildPptScriptPrompt({ project, message, outlineArtifact, scriptArtifact = null, evidenceContext, targetPageId = "", maxChars = 70_000 } = {}) {
  const outline = object(outlineArtifact?.content); const script = object(scriptArtifact?.content, null); const pageOnly = Boolean(targetPageId && script && evidenceContext?.target_page);
  const prompt = [
    "你正在运行 SurveyKit ppt_script Workflow。只生成结构化页面脚本，不生成 PowerPoint 文件、图片、HTML、演讲稿或内部思维链。",
    pageOnly ? "这是单页 Revision：只重写给定目标页，其他页面、顺序与 Evidence 关系必须保持不变。输出一个页面 JSON 对象。" : "基于 Report Outline 规划逐页 PPT Script。页面数服从 Storyline，不强行压缩，也不通过重复弱结论扩页。输出一个完整脚本 JSON 对象。",
    "本轮优先生成定性研究报告脚本。Page Type 优先使用 navigation、section_intro、executive_summary、qualitative_insight、quote_evidence、theme_summary、research_framework、segmentation_map、persona、journey、comparison、evidence_diagnostic、concept_definition、needs_pyramid、priority_matrix、case_study、problem_reason、recommendation；不要为了视觉丰富新增复杂定量图表。",
    "每页必须有 Purpose、单一 Key Message、结论型标题、具体 Content Structure、Visual Spec、Layout Spec、Evidence、Source Notes 与前后 Transition。正文默认 1 个结论加 2～4 个 Supporting Finding、0～3 条真实原声。",
    "禁止使用‘用户分析/直播分析/情况介绍’等主题标题，也禁止‘提升体验/加强品牌/持续优化/构建闭环’等无对象、无证据结论。",
    "所有 evidence_id 与 data_source_id 只能来自 Evidence Context。图表数据必须逐点绑定定量 Evidence，禁止补齐缺失分组或虚构数字；数据不足时缩小视觉范围并建立 Evidence Gap。",
    "带引号的消费者原声只能逐字复制 transcript_quote Evidence 的 value.quote，并同时填写 evidence_id 与 segment_id。不得把总结加引号伪装原声。",
    "视觉服从内容，默认 qualitative_tech_blue_v2：16:9、科技蓝、浅色内容页与深色章节页、无左侧竖条、少图标少装饰。通过 layout_variant 选择与语义匹配的原生 OfficeCLI 版式；执行摘要优先 editorial_overview，旅程优先 journey_curve，根因诊断优先 fishbone，建议优先 action_roadmap。比较页必须有明确维度；矩阵必须有显式坐标；金字塔必须有真实层级；案例页必须回答做法、机制、运行、价值、差异和启示；建议页必须绑定问题/原因/动作。",
    "完成前自行检查页面重复、Storyline 连续性、无铺垫结论、Evidence 缺口、建议与 Finding 的关系，以及页面密度。不要输出检查过程。",
    `【项目】${text(project?.title, 300)}\n研究目标：${text(project?.research_goal, 3_000)}`,
    `【用户要求】${text(message, 5_000)}`,
    pageOnly ? `【目标页面】${compactJson(evidenceContext.target_page, 15_000)}` : script ? `【当前 PPT Script】${compactJson(script, 30_000)}` : `【Report Outline】${compactJson(outline, 30_000)}`,
    `【Evidence Context（仅大纲/目标页已关联证据；无完整逐字稿和原始数据行）】${text(evidenceContext?.serialized, 48_000)}`,
    `【严格输出 Schema】${JSON.stringify(promptSchema(pageOnly))}`,
    "只输出 JSON，不要 Markdown 代码围栏。",
  ].join("\n\n");
  return { prompt: prompt.slice(0, maxChars), context: { task_type: "ppt_script", workflow_type: "ppt_script", mode: pageOnly ? "page_revision" : script ? "script_revision" : "initial", source_report_outline_id: outlineArtifact?.id || "", source_report_outline_version: outlineArtifact?.version || null, current_script_id: scriptArtifact?.id || "", target_page_id: pageOnly ? targetPageId : "", included_evidence_ids: evidenceContext?.included_evidence_ids || [], evidence_count: evidenceContext?.counts?.evidence || 0, raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0, selected_files: [], retrieved_chunks: [], direct_reply_only: true, max_chars: maxChars } };
}

function extractJson(reply) { const raw = text(reply, 2_000_000); const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]; const source = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1); try { return JSON.parse(source); } catch { const error = new Error("PPT_SCRIPT_INVALID_JSON"); error.code = "PPT_SCRIPT_INVALID_JSON"; throw error; } }

export function normalizePptScript(raw, { projectTitle = "研究项目", outlineArtifact, evidence = [], existingScript = null, targetPageId = "" } = {}) {
  const usable = evidence.filter((item) => !bool(item.excluded)).map((item) => ({ ...item, type: evidenceType(item), value: evidenceValue(item) }));
  const evidenceMap = new Map(usable.map((item) => [item.id, item])); const issues = [];
  let pageDrafts;
  if (targetPageId && existingScript) {
    const replacement = raw.page || raw;
    pageDrafts = array(existingScript.pages).map((page) => page.id === targetPageId ? { ...page, ...replacement, id: page.id, page_number: page.page_number, updated_at: new Date().toISOString() } : page);
    if (!array(existingScript.pages).some((page) => page.id === targetPageId)) { const error = new Error("PPT_SCRIPT_PAGE_NOT_FOUND"); error.code = "PPT_SCRIPT_PAGE_NOT_FOUND"; throw error; }
  } else pageDrafts = array(raw.pages);
  let pages = pageDrafts.slice(0, 80).map((page, index) => normalizePage(page, index, evidenceMap, issues));
  pages = deduplicatePages(pages, issues);
  pages = pages.map((page) => applyPageMetrics(page, evidenceMap));
  const gaps = array(raw.evidence_gaps || existingScript?.evidence_gaps).map((gap) => ({ id: text(gap.id, 128) || id("gap"), page_ref: text(gap.page_ref, 128), claim: text(gap.claim, 2_000), reason: text(gap.reason, 2_000), recommendation: text(gap.recommendation, 2_000), status: "open" }));
  for (const page of pages) {
    if (page.evidence_status === "needs_supplement") gaps.push({ id: id("gap"), page_ref: page.id, claim: page.key_message || page.title, reason: "该页面没有可追溯的项目 Evidence。", recommendation: "补充相应定量结果、访谈原声或项目证据后再制作。", status: "open" });
    if (page.visual_spec.type && CHART_TYPES.has(page.visual_spec.type) && !page.data_points.length) gaps.push({ id: id("gap"), page_ref: page.id, claim: page.key_message || page.title, reason: "图表缺少可验证的完整数据点。", recommendation: "缩小图表表达范围，或补充所需分组数据。", status: "open" });
  }
  const continuityIssues = continuityCheck(pages); issues.push(...continuityIssues);
  const style = { id: "qualitative_tech_blue_v2", aspect_ratio: "16:9", background: "ice_white", primary_color: "technology_blue", body_color: "deep_text", decoration: "restrained", icon_usage: "limited", title_style: "conclusion", preferred_font: "微软雅黑", forbid_left_vertical_bar: true, ...object(existingScript?.style_profile), ...object(raw.style_profile) };
  return { schema_version: "surveykit.ppt_script.v1", title: text(raw.title || existingScript?.title, 300) || `${projectTitle}报告 PPT 脚本`, status: ["draft", "reviewed", "approved"].includes(raw.status) ? raw.status : existingScript?.status || "draft", source_report_outline_id: outlineArtifact?.id || existingScript?.source_report_outline_id || "", source_report_outline_version: outlineArtifact?.version || existingScript?.source_report_outline_version || null, style_profile: style, pages, evidence_gaps: gaps.filter((gap, index, list) => gap.claim && list.findIndex((item) => item.page_ref === gap.page_ref && item.claim === gap.claim) === index), quality: evaluatePptScript({ pages, issues, evidence_gaps: gaps }), validation_issues: issues, revision: existingScript ? { mode: targetPageId ? "page_only" : "full_script", target_page_id: targetPageId || "" } : null, created_from_outline_at: existingScript?.created_from_outline_at || new Date().toISOString() };
}

export function evaluatePptScript(script) {
  const pages = array(script?.pages); const issues = array(script?.issues || script?.validation_issues);
  const evidencePages = pages.filter((page) => !NO_EVIDENCE_PAGE_TYPES.has(page.page_type));
  return { passed: pages.length > 0 && pages.every((page) => page.title && page.purpose) && evidencePages.every((page) => page.evidence_ids.length || page.evidence_status === "needs_supplement"), page_count: pages.length, evidence_sufficient_count: pages.filter((page) => page.evidence_status === "sufficient").length, evidence_limited_count: pages.filter((page) => page.evidence_status === "limited").length, evidence_gap_count: pages.filter((page) => page.evidence_status === "needs_supplement").length, overloaded_page_count: pages.filter((page) => page.density?.status === "overloaded").length, dense_page_count: pages.filter((page) => page.density?.status === "dense").length, duplicate_page_count: issues.filter((item) => item.type === "duplicate_page").length, continuity_issue_count: issues.filter((item) => ["missing_purpose", "missing_key_message", "missing_transition", "unlinked_recommendation"].includes(item.type)).length, invalid_data_count: issues.filter((item) => ["unsupported_data", "invalid_data_source"].includes(item.type)).length, unverified_quote_count: issues.filter((item) => item.type === "unverified_quote").length, raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0 };
}

export function validatePptScriptEvidenceScope(content, evidence = []) {
  const script = typeof content === "string" ? object(content, null) : object(content, null);
  if (!script) return { valid: false, reason: "invalid_json", invalid_ids: [], unverified_quotes: [], source_report_outline_id: "" };
  const usable = evidence.filter((item) => !bool(item.excluded)).map((item) => ({ ...item, type: evidenceType(item), value: evidenceValue(item) })); const map = new Map(usable.map((item) => [item.id, item]));
  const ids = new Set(); const quotes = []; const dataIssues = [];
  const visit = (value) => { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (key === "evidence_ids" && Array.isArray(child)) unique(child).forEach((item) => ids.add(item)); else if (key === "evidence_id") ids.add(text(child, 128)); else visit(child); } };
  visit(script); for (const page of array(script.pages)) {
    for (const quote of array(page.quotes)) if (!verifiedQuote(quote, map)) quotes.push(text(quote.text || quote.quote, 200));
    for (const point of array(page.data_points)) normalizeDataPoint(point, map, dataIssues, text(page.id, 128));
  }
  const invalidIds = [...ids].filter((item) => item && !map.has(item));
  return { valid: invalidIds.length === 0 && quotes.length === 0 && dataIssues.length === 0, reason: invalidIds.length ? "out_of_project_or_excluded" : quotes.length ? "unverified_quote" : dataIssues.length ? "unsupported_data" : "", invalid_ids: invalidIds, unverified_quotes: quotes, invalid_data: dataIssues, source_report_outline_id: text(script.source_report_outline_id, 128) };
}

export async function finalizePptScript({ store, projectId, projectTitle, reply, outlineArtifact, evidence = [], currentScriptArtifact = null, targetPageId = "" } = {}) {
  const existingScript = currentScriptArtifact ? object(currentScriptArtifact.content) : null;
  const script = normalizePptScript(extractJson(reply), { projectTitle, outlineArtifact, evidence, existingScript, targetPageId });
  const artifact = await store.createArtifact(projectId, { type: "ppt_script", title: script.title, content: JSON.stringify(script, null, 2), parent_artifact_id: currentScriptArtifact?.id || undefined });
  return { artifact, script, quality: script.quality };
}

export function summarizePptScriptResult({ artifact, quality }) { return `PPT 脚本已完成并保存为《${artifact.title}》V${artifact.version}。共规划 ${quality.page_count} 页，其中 ${quality.evidence_sufficient_count} 页证据充分、${quality.evidence_limited_count} 页证据一般、${quality.evidence_gap_count} 页需要补充证据；${quality.overloaded_page_count} 页建议进一步拆分或压缩。可查看逐页脚本或继续修改单页。`; }
export function isPptScriptWorkflow(taskType, artifact = null) { return taskType === "ppt_script" || (taskType === "artifact_revision" && artifact?.type === "ppt_script"); }
