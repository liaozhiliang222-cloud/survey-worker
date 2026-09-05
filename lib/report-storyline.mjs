import crypto from "node:crypto";

export const reportStorylineWorkflowStages = Object.freeze([
  { id: "goal", label: "正在明确报告目标" },
  { id: "evidence_index", label: "正在汇总项目证据" },
  { id: "candidate_insights", label: "正在整理候选洞察" },
  { id: "validation", label: "正在合并重复洞察并检查冲突" },
  { id: "core_insights", label: "正在形成核心结论" },
  { id: "storyline", label: "正在设计报告 Storyline" },
  { id: "outline", label: "正在生成报告大纲" },
]);

const EVIDENCE_TYPES = new Set(["quantitative", "qualitative", "transcript_quote", "tool_result", "project_file", "artifact"]);
const STRENGTHS = new Set(["strong", "medium", "weak"]);
const CONFIDENCES = new Set(["high", "medium", "low", "insufficient"]);
const INSIGHT_LEVELS = new Set(["core", "supporting", "finding"]);
const INSIGHT_STATUSES = new Set(["candidate", "validated", "conflicted", "needs_evidence", "excluded"]);
const STORYLINE_TYPES = new Set(["diagnosis", "competitive_benchmark", "user_journey", "topic_based", "custom"]);
const METHOD_ONLY_TITLES = /^(定量|定性|访谈|专家访谈|用户访谈|数据分析|定量分析|定性分析)(研究|分析|结果|发现)?$/;
const EMPTY_ADVICE = /^(提升用户体验|加强品牌建设|持续优化服务|关注用户需求|构建闭环)[。！!]?$/;

function text(value, max = 20_000) { return String(value ?? "").trim().slice(0, max); }
function object(value, fallback = {}) { if (value && typeof value === "object" && !Array.isArray(value)) return value; try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback; } catch { return fallback; } }
function array(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(array(values).map((value) => text(value, 128)).filter(Boolean))]; }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function bool(value) { return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true"; }
function clippedJson(value, max) { const raw = JSON.stringify(value); return raw.length <= max ? raw : `${raw.slice(0, Math.max(0, max - 24))}\n/* 已按上下文预算截断 */`; }
function artifactSummary(content, max = 1_500) { const raw = text(content, 200_000); if (!raw) return ""; const parsed = object(raw, null); if (parsed?.schema_version === "surveykit.report_outline.v1") return text([...(parsed.core_insights || []).map((item) => item.statement), ...(parsed.chapters || []).map((item) => item.core_message)].filter(Boolean).join("；"), max); return raw.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").slice(0, max); }

export function normalizeEvidenceType(item = {}) {
  const explicit = text(item.type, 64).toLowerCase();
  if (EVIDENCE_TYPES.has(explicit)) return explicit;
  const source = text(item.source_type, 64).toLowerCase();
  if (source === "crosstab") return "quantitative";
  if (source === "transcript_segment" || explicit === "direct_quote") return "transcript_quote";
  if (source === "tool_result") return "tool_result";
  if (source === "file") return "project_file";
  if (source === "artifact") return "artifact";
  return explicit.includes("qual") ? "qualitative" : "artifact";
}

export function inferEvidenceStrength(item = {}) {
  const explicit = text(item.strength, 16).toLowerCase();
  if (STRENGTHS.has(explicit)) return explicit;
  const value = object(item.value);
  const type = normalizeEvidenceType(item);
  if (type === "quantitative") return value.significant === false ? "medium" : "strong";
  if (type === "qualitative") return Number(value.coverage || value.transcript_count || 0) >= 2 ? "medium" : "weak";
  if (type === "transcript_quote") return "weak";
  if (type === "tool_result") return "strong";
  return "medium";
}

function publicEvidence(item = {}) {
  const value = object(item.value);
  return {
    id: text(item.id, 128), type: normalizeEvidenceType(item), claim: text(item.claim, 2_000),
    strength: inferEvidenceStrength(item), theme: text(item.theme || value.theme || value.dimension, 200),
    source_type: text(item.source_type, 64), source_id: text(item.source_id, 128), excluded: bool(item.excluded),
    source_scope: text(value.segment || value.group || value.respondent_label || value.transcript_title, 200),
    // Evidence indexes deliberately omit verbatim transcript text. The report
    // workflow reasons over the indexed claim and provenance, not raw rows or
    // full transcript segments.
    value: Object.fromEntries(Object.entries(value).filter(([key]) => ["metric", "value", "total", "difference", "significant", "base", "segment", "group", "transcript_title", "respondent_label", "coverage", "transcript_count", "polarity", "boundary", "artifact_id"].includes(key))),
    created_at: item.created_at || null, updated_at: item.updated_at || item.created_at || null,
  };
}

export function buildEvidenceIndex({ evidence = [], insights = [], artifacts = [], maxEvidence = 160, maxChars = 48_000 } = {}) {
  const allUsableEvidence = evidence.map(publicEvidence).filter((item) => item.id && item.claim && !item.excluded).slice(0, maxEvidence);
  let usableEvidence = [...allUsableEvidence];
  const allEvidenceIds = new Set(usableEvidence.map((item) => item.id));
  const links = new Map();
  for (const link of insights.flatMap((item) => array(item.evidence_ids).map((evidenceId) => ({ insightId: item.id, evidenceId })))) {
    if (!links.has(link.insightId)) links.set(link.insightId, []);
    if (allEvidenceIds.has(link.evidenceId)) links.get(link.insightId).push(link.evidenceId);
  }
  let compactInsights = insights.filter((item) => text(item.status) !== "excluded").slice(0, 80).map((item) => ({
    id: text(item.id, 128), title: text(item.title, 300), statement: text(item.statement, 1_200), interpretation: text(item.interpretation, 1_500),
    business_implication: text(item.business_implication, 1_000), confidence: CONFIDENCES.has(item.confidence) ? item.confidence : "low",
    level: INSIGHT_LEVELS.has(item.level) ? item.level : "finding", status: INSIGHT_STATUSES.has(item.status) ? item.status : "validated",
    is_pinned: bool(item.is_pinned), evidence_ids: unique(item.evidence_ids?.length ? item.evidence_ids : links.get(item.id) || []).filter((evidenceId) => allEvidenceIds.has(evidenceId)),
  }));
  let compactArtifacts = artifacts.filter((item) => item.type !== "report_outline").slice(0, 20).map((item) => ({ id: item.id, type: item.type, title: item.title, version: item.version, summary: artifactSummary(item.content) })).filter((item) => item.summary);
  const makePayload = () => {
    const evidenceIds = new Set(usableEvidence.map((item) => item.id));
    const boundedInsights = compactInsights.map((item) => ({ ...item, evidence_ids: item.evidence_ids.filter((evidenceId) => evidenceIds.has(evidenceId)) }));
    const byType = Object.fromEntries([...EVIDENCE_TYPES].map((type) => [type, usableEvidence.filter((item) => item.type === type).length]));
    return { evidence: usableEvidence, insights: boundedInsights, artifact_summaries: compactArtifacts, counts: { total: usableEvidence.length, ...byType }, truncated: usableEvidence.length < allUsableEvidence.length || compactInsights.length < Math.min(80, insights.length) || compactArtifacts.length < Math.min(20, artifacts.filter((item) => item.type !== "report_outline").length) };
  };
  let payload = makePayload();
  let serialized = JSON.stringify(payload);
  // Keep the index valid JSON. Drop secondary summaries first, then unpinned
  // prior insights, and only then the oldest tail Evidence entries.
  while (serialized.length > maxChars && compactArtifacts.length) { compactArtifacts.pop(); payload = makePayload(); serialized = JSON.stringify(payload); }
  while (serialized.length > maxChars && compactInsights.some((item) => !item.is_pinned)) { const index = compactInsights.findLastIndex((item) => !item.is_pinned); compactInsights.splice(index, 1); payload = makePayload(); serialized = JSON.stringify(payload); }
  while (serialized.length > maxChars && usableEvidence.length > 1) { usableEvidence.pop(); payload = makePayload(); serialized = JSON.stringify(payload); }
  while (serialized.length > maxChars && compactInsights.length) { compactInsights.pop(); payload = makePayload(); serialized = JSON.stringify(payload); }
  const includedEvidenceIds = usableEvidence.map((item) => item.id);
  return { ...payload, serialized, included_evidence_ids: includedEvidenceIds, raw_transcript_chars: 0, raw_dataset_rows: 0 };
}

function tokens(value) {
  const normalized = text(value, 2_000).toLowerCase().replace(/[的了与和及是为在对将已正更较很一二三四五六七八九十\s，。；：、“”‘’（）()【】\[\]!?！？\-_/]/g, "");
  const result = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = tokens(`${left.title || ""}${left.statement || ""}`); const b = tokens(`${right.title || ""}${right.statement || ""}`);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / Math.min(a.size, b.size);
}

export function deduplicateInsights(insights = [], threshold = 0.66) {
  const merged = [];
  for (const candidate of insights) {
    const normalized = { ...candidate, evidence_ids: unique(candidate.evidence_ids), merged_from_ids: unique(candidate.merged_from_ids || [candidate.id]) };
    const existing = merged.find((item) => similarity(item, normalized) >= threshold);
    if (!existing) { merged.push(normalized); continue; }
    existing.evidence_ids = unique([...existing.evidence_ids, ...normalized.evidence_ids]);
    existing.merged_from_ids = unique([...existing.merged_from_ids, ...normalized.merged_from_ids]);
    if (bool(normalized.is_pinned)) existing.is_pinned = true;
    if (text(normalized.interpretation).length > text(existing.interpretation).length) existing.interpretation = normalized.interpretation;
    if (text(normalized.business_implication).length > text(existing.business_implication).length) existing.business_implication = normalized.business_implication;
  }
  return merged;
}

function polarity(item) {
  const value = object(item.value); const explicit = text(value.polarity || item.polarity, 20).toLowerCase();
  if (["positive", "negative", "mixed"].includes(explicit)) return explicit;
  const claim = text(item.claim, 2_000);
  const positive = /较高|更高|满意|认可|优势|提升|增长|支持|有效|喜欢|核心渠道/.test(claim);
  const negative = /较低|偏低|不满|不足|短板|下降|冗长|有限|无效|不喜欢|距离较远|错配/.test(claim);
  return positive && negative ? "mixed" : positive ? "positive" : negative ? "negative" : "neutral";
}

function themeKey(item) { return text(item.theme || object(item.value).theme || object(item.value).dimension || item.claim, 200).replace(/总体|部分|多数|少数|年轻用户|重度用户|用户|群体|渠道|阶段/g, "").replace(/\s+/g, "").slice(0, 40); }

export function detectEvidenceConflicts(evidence = []) {
  const usable = evidence.map(publicEvidence).filter((item) => !item.excluded);
  const groups = new Map();
  for (const item of usable) { const key = themeKey(item); if (!key) continue; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
  const conflicts = [];
  for (const [theme, items] of groups) {
    const positive = items.filter((item) => polarity(item) === "positive"); const negative = items.filter((item) => polarity(item) === "negative");
    if (!positive.length || !negative.length) continue;
    const scopes = unique(items.map((item) => item.source_scope));
    conflicts.push({ id: id("conflict"), theme, evidence_ids: unique(items.map((item) => item.id)), status: scopes.length > 1 ? "segmented" : "unresolved", explanation: scopes.length > 1 ? `证据来自不同人群、渠道或阶段（${scopes.join("、")}），应保留边界条件，避免平均化。` : "同一主题出现方向相反的证据，当前无法仅凭索引解释，需进一步验证。" });
  }
  return conflicts;
}

function coverageFor(evidenceIds, evidenceMap) {
  const types = unique(evidenceIds.map((evidenceId) => evidenceMap.get(evidenceId)?.type));
  return { quantitative: types.includes("quantitative"), qualitative: types.some((type) => ["qualitative", "transcript_quote"].includes(type)), transcript_quote: types.includes("transcript_quote"), tool_result: types.includes("tool_result"), project_file: types.includes("project_file"), artifact: types.includes("artifact"), types };
}

function evidenceStatus(evidenceIds, evidenceMap) {
  const linked = evidenceIds.map((evidenceId) => evidenceMap.get(evidenceId)).filter(Boolean);
  if (!linked.length) return "needs_supplement";
  if (linked.some((item) => item.strength === "strong") || linked.length >= 2) return "sufficient";
  return "limited";
}

function extractJson(reply) {
  const raw = text(reply, 2_000_000);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try { return JSON.parse(source); } catch { const error = new Error("REPORT_STORYLINE_INVALID_JSON"); error.code = "REPORT_STORYLINE_INVALID_JSON"; throw error; }
}

function conclusionTitle(title, keyMessage, fallback) {
  const current = text(title, 180);
  if (current && !METHOD_ONLY_TITLES.test(current) && !EMPTY_ADVICE.test(current) && current.length >= 8) return current;
  return text(keyMessage || fallback || current || "该页面结论仍需补充证据", 180);
}

export function normalizeReportOutline(raw, { validEvidence = [], pinnedInsights = [], projectTitle = "研究项目", existingOutline = null } = {}) {
  const evidenceMap = new Map(validEvidence.map(publicEvidence).filter((item) => !item.excluded).map((item) => [item.id, item]));
  const validIds = new Set(evidenceMap.keys());
  const pinnedById = new Map(pinnedInsights.filter((item) => bool(item.is_pinned)).map((item) => [item.id, item]));
  const proposed = array(raw.core_insights).slice(0, 12).map((item, index) => {
    const evidenceIds = unique(item.evidence_ids).filter((evidenceId) => validIds.has(evidenceId));
    const previous = pinnedById.get(item.id) || [...pinnedById.values()].find((pinned) => similarity(pinned, item) >= 0.66);
    const combinedEvidenceIds = unique([...(previous?.evidence_ids || []), ...evidenceIds]).filter((evidenceId) => validIds.has(evidenceId));
    return {
      id: text(previous?.id || item.id, 128) || id("insight"), title: conclusionTitle(item.title, item.statement, `核心结论 ${index + 1}`),
      statement: text(item.statement || item.title, 2_000), interpretation: text(item.interpretation, 4_000), business_implication: text(item.business_implication, 2_000),
      confidence: !combinedEvidenceIds.length ? "insufficient" : CONFIDENCES.has(item.confidence) ? item.confidence : evidenceStatus(combinedEvidenceIds, evidenceMap) === "sufficient" ? "high" : "medium",
      level: INSIGHT_LEVELS.has(item.level) ? item.level : "core", status: !combinedEvidenceIds.length ? "needs_evidence" : INSIGHT_STATUSES.has(item.status) ? item.status : "validated",
      is_pinned: bool(item.is_pinned) || Boolean(previous), evidence_ids: combinedEvidenceIds,
    };
  });
  for (const pinned of pinnedById.values()) if (!proposed.some((item) => item.id === pinned.id)) proposed.push({ ...pinned, evidence_ids: unique(pinned.evidence_ids).filter((evidenceId) => validIds.has(evidenceId)), is_pinned: true });
  const coreInsights = deduplicateInsights(proposed).slice(0, 7).map((item) => ({ ...item, evidence_coverage: coverageFor(item.evidence_ids, evidenceMap) }));
  const insightIds = new Set(coreInsights.map((item) => item.id));
  const conflicts = [...array(raw.evidence_conflicts), ...detectEvidenceConflicts(validEvidence)].map((item) => ({ id: text(item.id, 128) || id("conflict"), theme: text(item.theme, 200), evidence_ids: unique(item.evidence_ids).filter((evidenceId) => validIds.has(evidenceId)), status: ["resolved", "segmented", "unresolved"].includes(item.status) ? item.status : "unresolved", explanation: text(item.explanation, 2_000) })).filter((item, index, list) => item.evidence_ids.length > 1 && list.findIndex((candidate) => candidate.evidence_ids.sort().join("|") === item.evidence_ids.sort().join("|")) === index);
  const storyline = array(raw.storyline || raw.sections).slice(0, 12).map((section, index) => ({
    section_id: text(section.section_id || section.id, 128) || `section_${index + 1}`, section_title: text(section.section_title || section.title, 240) || `章节 ${index + 1}`,
    section_purpose: text(section.section_purpose || section.purpose, 2_000), core_message: text(section.core_message, 2_000),
    supporting_insight_ids: unique(section.supporting_insight_ids || section.insight_ids).filter((insightId) => insightIds.has(insightId)), evidence_ids: unique(section.evidence_ids).filter((evidenceId) => validIds.has(evidenceId)), transition: text(section.transition, 2_000),
  }));
  const chapters = array(raw.chapters).slice(0, 12).map((chapter, chapterIndex) => ({
    chapter_no: Number(chapter.chapter_no || chapterIndex + 1), title: text(chapter.title || chapter.chapter_title, 240) || `第 ${chapterIndex + 1} 章`, purpose: text(chapter.purpose || chapter.section_purpose, 2_000), core_message: text(chapter.core_message, 2_000), section_ids: unique(chapter.section_ids),
    pages: array(chapter.pages || chapter.page_topics).slice(0, 40).map((page, pageIndex) => {
      const evidenceIds = unique(page.evidence_ids).filter((evidenceId) => validIds.has(evidenceId)); const keyMessage = text(page.key_message || page.message, 2_000);
      return { page_no: Number(page.page_no || pageIndex + 1), page_title: conclusionTitle(page.page_title || page.title, keyMessage, keyMessage), key_message: keyMessage, evidence_ids: evidenceIds, evidence_coverage: coverageFor(evidenceIds, evidenceMap), evidence_status: evidenceStatus(evidenceIds, evidenceMap), suggested_visual: text(page.suggested_visual, 1_000), notes: text(page.notes, 2_000) };
    }),
  }));
  const gaps = array(raw.evidence_gaps).map((gap) => ({ id: text(gap.id, 128) || id("gap"), claim: text(gap.claim, 2_000), reason: text(gap.reason, 2_000), recommendation: text(gap.recommendation || gap.suggestion, 2_000), status: "open", page_refs: unique(gap.page_refs) }));
  for (const insight of coreInsights.filter((item) => !item.evidence_ids.length)) gaps.push({ id: id("gap"), claim: insight.statement, reason: "该核心结论未绑定当前项目内的有效 Evidence。", recommendation: "补充对应交叉表、工具结果、访谈原声或项目文件证据。", status: "open", page_refs: [] });
  for (const chapter of chapters) for (const page of chapter.pages.filter((item) => item.evidence_status === "needs_supplement")) gaps.push({ id: id("gap"), claim: page.key_message || page.page_title, reason: "该页面主题缺少可追溯 Evidence。", recommendation: "补充证据后再进入页面脚本或 PPT 阶段。", status: "open", page_refs: [`${chapter.chapter_no}-${page.page_no}`] });
  const result = {
    schema_version: "surveykit.report_outline.v1", title: text(raw.title, 300) || `${projectTitle}报告大纲`, report_goal: text(raw.report_goal, 2_000),
    report_constraints: object(raw.report_constraints), storyline_type: STORYLINE_TYPES.has(raw.storyline_type) ? raw.storyline_type : "custom",
    rationale: text(raw.rationale || raw.storyline_rationale, 4_000), core_insights: coreInsights, evidence_conflicts: conflicts,
    evidence_gaps: gaps.filter((item, index, list) => item.claim && list.findIndex((candidate) => candidate.claim === item.claim) === index), storyline, chapters,
    evidence_snapshot: { evidence_ids: [...validIds], captured_at: new Date().toISOString(), latest_evidence_at: [...evidenceMap.values()].map((item) => item.updated_at).filter(Boolean).sort().at(-1) || null },
    revision: existingOutline ? { parent_title: existingOutline.title || "", structure_only: true } : null,
  };
  if (result.core_insights.length < 3 && validIds.size >= 3) result.validation_warning = "核心结论少于 3 条，请研究员确认是否需要补充。";
  return result;
}

export function buildReportStorylinePrompt({ project, message, evidenceIndex, currentOutline = null, reportConstraints = {}, maxChars = 60_000 } = {}) {
  const revision = currentOutline?.type === "report_outline";
  const current = revision ? object(currentOutline.content, {}) : null;
  const pinned = array(evidenceIndex?.insights).filter((item) => item.is_pinned);
  const schema = { title: "结论式报告标题", report_goal: "本次报告要支持的业务决策", storyline_type: "diagnosis|competitive_benchmark|user_journey|topic_based|custom", rationale: "为什么按此逻辑组织", core_insights: [{ id: "可复用已有 insight id，否则留空", title: "结论标题", statement: "Evidence 到 Insight 的研究结论", interpretation: "解释（不得伪装为事实）", business_implication: "业务含义", confidence: "high|medium|low|insufficient", level: "core", status: "validated|conflicted|needs_evidence", is_pinned: false, evidence_ids: ["项目内 evidence id"] }], evidence_conflicts: [{ theme: "冲突主题", evidence_ids: ["id1", "id2"], status: "resolved|segmented|unresolved", explanation: "人群/渠道/阶段边界或待验证说明" }], evidence_gaps: [{ claim: "想表达但证据不足的结论", reason: "不足之处", recommendation: "建议补什么", page_refs: [] }], storyline: [{ section_id: "section_1", section_title: "章节", section_purpose: "为什么讲", core_message: "本章核心结论", supporting_insight_ids: ["insight id"], evidence_ids: ["evidence id"], transition: "如何过渡到下一章" }], chapters: [{ chapter_no: 1, title: "章节", purpose: "目的", core_message: "结论", section_ids: ["section_1"], pages: [{ page_no: 1, page_title: "结论标题", key_message: "谁/在哪/发生什么/为什么重要/意味着什么", evidence_ids: ["evidence id"], suggested_visual: "图表/原声组合建议，不生成 PPT", notes: "边界与编辑提示" }] }] };
  const prompt = [
    "你正在运行 SurveyKit report_storyline Workflow。Storyline 只能组织 Research Evidence，不得总结聊天记录，不得补造数据、原声或来源。",
    revision ? "本轮是结构修订：只基于当前 Report Outline、用户修改要求与已锁定洞察调整结构；不得重新运行定量分析、定性分析、逐字稿检索或数据工具。" : "本轮按 Evidence Index → 候选 Insight → 去重/冲突/反例/缺口校验 → 3～7 条 Core Insight → Storyline → 章节与 Page Topic 执行。",
    "Evidence 与 Insight 必须分开：Evidence 是可追溯事实；Insight 是由一个或多个 Evidence 支持的研究结论；Interpretation 是解释。weak Evidence 不得写成确定事实。优先识别定量+定性互证，但不得为追求互证伪造来源。",
    "不得按‘定量分析/定性分析/访谈’简单堆叠章节。可按诊断、竞品、用户旅程、主题或用户指定逻辑组织。每章必须说明 purpose、core_message 和 transition。",
    "Page Topic 必须是结论标题，禁止仅写‘年轻用户分析/直播分析/会员分析’，并禁止‘提升用户体验/加强品牌建设/持续优化服务/关注用户需求/构建闭环’等无对象、无证据的正确废话。",
    "保留反例和少数关键人群；冲突无法用人群、渠道、阶段、总体/细分差异解释时标记 unresolved；证据不足时建立 Evidence Gap，不得硬写。",
    "只可引用 Evidence Index 中存在且未 excluded 的 evidence id。输出必须只有一个 JSON 对象，不要 Markdown、解释、思维链、Prompt 或工具 JSON。",
    `【项目】${text(project?.title, 300)}\n客户：${text(project?.client_name, 300)}\n研究目标：${text(project?.research_goal, 3_000)}\n项目简述：${text(project?.brief, 3_000)}`,
    `【本次要求】${text(message, 5_000)}`,
    `【报告约束】${clippedJson(reportConstraints, 4_000)}`,
    revision ? `【当前 Report Outline】${clippedJson(current, 24_000)}` : "",
    pinned.length ? `【必须尽量保留的锁定 Insight】${clippedJson(pinned, 8_000)}` : "",
    `【Evidence Index（不含原始数据行和完整逐字稿）】${text(evidenceIndex?.serialized, 48_000)}`,
    `【严格输出结构】${JSON.stringify(schema)}`,
  ].filter(Boolean).join("\n\n");
  return { prompt: prompt.slice(0, maxChars), context: { task_type: "report_storyline", workflow_type: "report_storyline", report_outline_revision: revision, evidence_count: evidenceIndex?.counts?.total || 0, evidence_counts: evidenceIndex?.counts || {}, insight_count: evidenceIndex?.insights?.length || 0, included_evidence_ids: evidenceIndex?.included_evidence_ids || [], raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0, selected_files: [], retrieved_chunks: [], artifact: revision ? { id: currentOutline.id, type: currentOutline.type, version: currentOutline.version } : null, max_chars: maxChars, direct_reply_only: true } };
}

export function parseReportStorylineOutcome(reply, options = {}) { return normalizeReportOutline(extractJson(reply), options); }

export function validateReportOutlineEvidenceScope(content, validEvidence = []) {
  const outline = typeof content === "string" ? object(content, null) : object(content, null);
  if (!outline) return { valid: false, invalid_ids: [], reason: "invalid_json" };
  const validIds = new Set(validEvidence.filter((item) => !bool(item.excluded)).map((item) => text(item.id, 128)));
  const referenced = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidence_ids" && Array.isArray(child)) unique(child).forEach((evidenceId) => referenced.add(evidenceId));
      else visit(child);
    }
  };
  visit(outline);
  const invalidIds = [...referenced].filter((evidenceId) => !validIds.has(evidenceId));
  return { valid: invalidIds.length === 0, invalid_ids: invalidIds, reason: invalidIds.length ? "out_of_project_or_excluded" : "" };
}

export function evaluateReportOutline(outline) {
  const pages = array(outline?.chapters).flatMap((chapter) => array(chapter.pages));
  const sufficient = pages.filter((page) => page.evidence_status === "sufficient").length;
  const limited = pages.filter((page) => page.evidence_status === "limited").length;
  const needs = pages.filter((page) => page.evidence_status === "needs_supplement").length;
  const tracedCore = array(outline?.core_insights).filter((item) => array(item.evidence_ids).length).length;
  return { passed: array(outline?.core_insights).length >= 3 && pages.length > 0 && tracedCore === array(outline?.core_insights).length, core_insight_count: array(outline?.core_insights).length, traced_core_insight_count: tracedCore, chapter_count: array(outline?.chapters).length, page_count: pages.length, sufficient_page_count: sufficient, limited_page_count: limited, evidence_gap_page_count: needs, conflict_count: array(outline?.evidence_conflicts).length, evidence_gap_count: array(outline?.evidence_gaps).length, raw_transcript_chars_in_prompt: 0, raw_dataset_rows_in_prompt: 0 };
}

export async function finalizeReportStoryline({ store, projectId, projectTitle, reply, evidence = [], existingInsights = [], parentArtifactId = null, existingOutline = null } = {}) {
  const outline = parseReportStorylineOutcome(reply, { validEvidence: evidence, pinnedInsights: existingInsights, projectTitle, existingOutline });
  const artifact = await store.createArtifact(projectId, { type: "report_outline", title: outline.title || `${projectTitle}报告大纲`, content: JSON.stringify(outline, null, 2), parent_artifact_id: parentArtifactId || undefined });
  const persistedInsights = [];
  const insightIdMap = new Map();
  for (const [index, candidate] of outline.core_insights.entries()) {
    const insight = await store.createResearchInsight(projectId, { ...candidate, artifact_id: artifact.id });
    for (const evidenceId of candidate.evidence_ids) await store.linkInsightEvidence(projectId, insight.id, evidenceId);
    insightIdMap.set(candidate.id, insight.id);
    outline.core_insights[index].id = insight.id;
    persistedInsights.push({ ...insight, evidence_ids: candidate.evidence_ids });
  }
  outline.storyline = outline.storyline.map((section) => ({ ...section, supporting_insight_ids: section.supporting_insight_ids.map((insightId) => insightIdMap.get(insightId) || insightId).filter((insightId) => persistedInsights.some((item) => item.id === insightId)) }));
  const updatedArtifact = await store.updateArtifact(projectId, artifact.id, { content: JSON.stringify(outline, null, 2) });
  const conflicts = [];
  for (const conflict of outline.evidence_conflicts) if (store.createEvidenceConflict) conflicts.push(await store.createEvidenceConflict(projectId, { ...conflict, artifact_id: artifact.id }));
  const gaps = [];
  for (const gap of outline.evidence_gaps) if (store.createEvidenceGap) gaps.push(await store.createEvidenceGap(projectId, { ...gap, artifact_id: artifact.id }));
  const quality = evaluateReportOutline(outline);
  return { artifact: updatedArtifact || artifact, outline, insights: persistedInsights, conflicts, gaps, quality };
}

export function summarizeReportStorylineResult({ artifact, quality }) {
  return `报告大纲已完成并保存为《${artifact.title}》V${artifact.version}。本次形成 ${quality.core_insight_count} 条核心结论，共规划 ${quality.chapter_count} 章、${quality.page_count} 个页面主题；其中 ${quality.sufficient_page_count} 页证据充分，${quality.limited_page_count} 页证据一般，${quality.evidence_gap_page_count} 页需要补充证据。可查看报告大纲或继续修改。`;
}

export function isReportStorylineWorkflow(taskType, artifact = null) { return taskType === "report_storyline" || (taskType === "artifact_revision" && artifact?.type === "report_outline"); }
