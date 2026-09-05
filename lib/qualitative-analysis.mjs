import { researchQueryTerms } from "./project-memory.mjs";
import { ToolInputError } from "./tools/errors.mjs";
import { preferredTranscriptSegments } from "./transcript-correction.mjs";

const INTERVIEW_TYPES = new Set(["expert", "consumer", "internal", "other"]);
const SPEAKER_PATTERN = /^(访谈员|主持人|研究员|提问者|问|受访者|消费者|专家|嘉宾|回答者|答|interviewer|moderator|respondent|participant|expert|q|a)\s*[：:]\s*(.*)$/i;

function text(value) { return String(value ?? "").trim(); }
function parsed(value, fallback = {}) { if (value && typeof value === "object") return value; try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function integer(value, fallback, minimum, maximum) { const number = Number(value); return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback; }
function normalized(value) { return String(value ?? "").normalize("NFKC").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }
function unique(values) { return [...new Set(values)]; }
function fingerprint(file) { return `${file.id}:${file.updated_at || file.created_at || ""}:${String(file.parsed_text || "").length}`; }

export const qualitativeAnalysisWorkflowStages = Object.freeze([
  { id: "understanding", label: "正在理解研究问题" },
  { id: "scope", label: "正在确定访谈范围" },
  { id: "transcript_index", label: "正在读取访谈结构与缓存" },
  { id: "coding", label: "正在进行问题驱动编码" },
  { id: "themes", label: "正在聚类跨访谈主题" },
  { id: "comparison", label: "正在识别共识、差异与反例" },
  { id: "evidence", label: "正在回查关键原声" },
  { id: "insight", label: "正在形成研究洞察" },
  { id: "artifact", label: "正在生成定性分析成果" },
]);

export function isQualitativeAnalysisWorkflow(taskType, artifact = null) {
  return taskType === "qualitative_analysis" || (taskType === "artifact_revision" && artifact?.type === "qualitative_analysis");
}

export function inferInterviewType(fileName) {
  const value = text(fileName);
  if (/专家|经销商|零售|店长|行业|expert/i.test(value)) return "expert";
  if (/消费者|用户|顾客|consumer|respondent/i.test(value)) return "consumer";
  if (/内部|员工|internal/i.test(value)) return "internal";
  return "other";
}

function isHeading(line) {
  return /^(?:#{1,6}\s+|第.{1,16}[章节部分]|[一二三四五六七八九十]+[、.．]|\d+(?:\.\d+)*[、.．\s])/.test(line) || (line.length <= 42 && /[:：]$/.test(line));
}

export function segmentTranscriptText(source, options = {}) {
  const original = String(source ?? "").replace(/\r/g, "");
  if (!original.trim()) return [];
  const targetChars = integer(options.targetChars, 1_200, 300, 2_400);
  const lines = original.split("\n");
  const segments = [];
  let cursor = 0;
  let heading = "";
  let active = null;
  const push = () => {
    if (!active?.content?.trim()) { active = null; return; }
    const content = active.content.trim();
    segments.push({
      id: active.id || crypto.randomUUID(),
      sequence: segments.length,
      speaker: active.speaker || "unknown",
      content,
      start_offset: active.start,
      end_offset: Math.max(active.start, active.end),
      metadata: { ...(heading ? { heading } : {}), segmentation: active.segmentation || "paragraph" },
    });
    active = null;
  };
  for (const rawLine of lines) {
    const lineStart = cursor;
    cursor += rawLine.length + 1;
    const line = rawLine.trim();
    if (!line) { if (active?.content) push(); continue; }
    if (isHeading(line)) { push(); heading = line.slice(0, 200); active = { speaker: "unknown", content: line, start: lineStart, end: lineStart + rawLine.length, segmentation: "heading" }; push(); continue; }
    const speakerMatch = line.match(SPEAKER_PATTERN);
    const speaker = speakerMatch ? speakerMatch[1] : active?.speaker || "unknown";
    const content = speakerMatch ? speakerMatch[2].trim() : line;
    if (!content) continue;
    if (!active || (speakerMatch && active.speaker !== speaker) || active.content.length + content.length + 1 > targetChars) {
      push(); active = { speaker, content: "", start: lineStart, end: lineStart + rawLine.length, segmentation: speakerMatch ? "speaker_turn" : "paragraph" };
    }
    active.content += `${active.content ? "\n" : ""}${content}`;
    active.end = lineStart + rawLine.length;
  }
  push();
  return segments;
}

function transcriptSummary(segments) {
  const speakers = unique(segments.map((item) => item.speaker).filter((item) => item && item !== "unknown"));
  const headings = unique(segments.map((item) => item.metadata?.heading).filter(Boolean)).slice(0, 12);
  const turns = segments.filter((item) => item.metadata?.segmentation === "speaker_turn").length;
  return [speakers.length ? `说话人：${speakers.join("、")}` : "说话人：未识别", headings.length ? `主要章节：${headings.join("、")}` : "", `结构索引：${segments.length} 个 Segment，${turns} 个说话轮次。`].filter(Boolean).join("\n").slice(0, 4_000);
}

function summarySource(segments, maximumChars) {
  const available = (segments || []).filter((item) => text(item?.content));
  const maximum = integer(maximumChars, 120_000, 12_000, 240_000);
  const render = (item) => `[segment:${item.id}] ${item.speaker || "unknown"}\n${text(item.content)}`;
  const full = available.map(render).join("\n\n");
  if (full.length <= maximum) return { content: full, included: available.length, total: available.length, complete: true };

  const chosen = [];
  const targetCount = Math.max(12, Math.min(available.length, Math.floor(maximum / 1_200)));
  const indexes = unique(Array.from({ length: targetCount }, (_, index) => Math.round(index * (available.length - 1) / Math.max(1, targetCount - 1))));
  let used = 0;
  for (const index of indexes) {
    const item = available[index]; const rendered = render(item);
    if (used + rendered.length + 2 > maximum && chosen.length) break;
    chosen.push(rendered.slice(0, Math.max(300, maximum - used - 2))); used += chosen.at(-1).length + 2;
  }
  return { content: chosen.join("\n\n"), included: chosen.length, total: available.length, complete: chosen.length === available.length };
}

export function buildTranscriptDeepSummaryPrompt({ transcript, segments = [], maxSourceChars = 120_000, targetChars = 4_000 }) {
  const source = summarySource(segments, maxSourceChars);
  const target = integer(targetChars, 4_000, 1_200, 8_000);
  return [
    "你是 SurveyKit 的单访谈深度摘要器。请只根据下方带 Segment ID 的访谈内容，生成中文 Markdown 导航摘要。",
    "这份摘要将被缓存，用于后续跨访谈分析的理解与召回；它不是最终证据，也不能替代原文回查。",
    "",
    "【硬性要求】",
    `1. 目标长度约 ${target} 个中文字符；信息充分但不要逐段复述。`,
    "2. 明确区分受访者陈述、研究者归纳与尚待验证的推断，不添加原文没有的事实。",
    "3. 不输出带引号的逐字原声；重要观点只记录对应的真实 Segment ID，后续直接引用必须回到 Segment 校验。",
    "4. 需要覆盖：受访者背景与情境、核心观点、主要问题/需求、关键态度与情绪、行为与决策机制、典型案例、矛盾/反例、与研究目标的潜在关联、重要 Segment 索引、证据边界。",
    `5. 本次输入覆盖 ${source.included}/${source.total} 个 Segment${source.complete ? "（完整覆盖）" : "（均匀抽样，须在证据边界中说明）"}。`,
    "6. 仅输出摘要正文，不解释生成过程，不调用工具。",
    "",
    "【访谈 Metadata】",
    `Transcript ID：${transcript.id}`,
    `名称：${transcript.title}`,
    `类型：${transcript.interview_type}`,
    `受访者：${transcript.respondent_label || "未标注"}`,
    `Metadata：${JSON.stringify(parsed(transcript.respondent_metadata, {}))}`,
    "",
    "【访谈内容】",
    source.content,
  ].join("\n");
}

function normalizeDeepSummary(reply, maximumChars) {
  const value = String(reply || "").trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (value.length < 200) throw Object.assign(new Error("TRANSCRIPT_SUMMARY_INVALID"), { code: "TRANSCRIPT_SUMMARY_INVALID" });
  return value.slice(0, integer(maximumChars, 20_000, 2_000, 40_000));
}

export async function generateTranscriptDeepSummary({ store, projectId, transcriptId, generate, model = "", maxSourceChars = 120_000, maxSummaryChars = 20_000, targetChars = 4_000, force = false }) {
  if (!store || typeof generate !== "function") throw new TypeError("Transcript summary generator is required.");
  let transcript = await store.getTranscript(projectId, transcriptId);
  if (!transcript || transcript.status !== "ready") throw Object.assign(new Error("TRANSCRIPT_NOT_FOUND"), { code: "TRANSCRIPT_NOT_FOUND" });
  if (!force && transcript.summary_status === "ready" && transcript.deep_summary && transcript.summary_source_fingerprint === transcript.source_fingerprint) return { transcript, cached: true, busy: false };
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  const claimed = typeof store.claimTranscriptSummary === "function"
    ? await store.claimTranscriptSummary(projectId, transcript.id, { force, staleBefore })
    : await store.updateTranscript(projectId, transcript.id, { summary_status: "processing", summary_error: "" });
  if (!claimed) {
    transcript = await store.getTranscript(projectId, transcript.id);
    return { transcript, cached: transcript?.summary_status === "ready", busy: transcript?.summary_status === "processing" };
  }
  const sourceFingerprint = claimed.source_fingerprint;
  try {
    const segments = await store.listTranscriptSegments(projectId, claimed.id);
    const prompt = buildTranscriptDeepSummaryPrompt({ transcript: claimed, segments, maxSourceChars, targetChars });
    const reply = normalizeDeepSummary(await generate(prompt, claimed), maxSummaryChars);
    const patch = { deep_summary: reply, summary_status: "ready", summary_model: model, summary_source_fingerprint: sourceFingerprint, summary_generated_at: new Date().toISOString(), summary_error: "" };
    transcript = typeof store.completeTranscriptSummary === "function"
      ? await store.completeTranscriptSummary(projectId, claimed.id, sourceFingerprint, patch)
      : await store.updateTranscript(projectId, claimed.id, patch);
    return { transcript, cached: false, busy: false };
  } catch (error) {
    const patch = { summary_status: "failed", summary_error: text(error?.code || error?.message || "深度摘要生成失败").slice(0, 2_000) };
    if (typeof store.completeTranscriptSummary === "function") await store.completeTranscriptSummary(projectId, claimed.id, sourceFingerprint, patch);
    else await store.updateTranscript(projectId, claimed.id, patch);
    throw error;
  }
}

export async function syncTranscriptFromFile({ store, projectId, file }) {
  if (!file || file.project_id !== projectId || file.category !== "interview") return null;
  const current = await store.getTranscriptByFile(projectId, file.id);
  const sourceFingerprint = fingerprint(file);
  const sameSource = current?.source_fingerprint === sourceFingerprint;
  if (current?.source_fingerprint === sourceFingerprint && current.status === "ready") return current;
  if (file.parse_status !== "completed" || !text(file.parsed_text)) {
    return store.upsertTranscript(projectId, {
      file_id: file.id, title: file.file_name, interview_type: current?.interview_type || inferInterviewType(file.file_name), respondent_label: current?.respondent_label || file.file_name.replace(/\.[^.]+$/, ""), respondent_metadata: parsed(current?.respondent_metadata, {}), status: file.parse_status === "failed" ? "failed" : "processing", word_count: 0, segment_count: 0, summary: sameSource ? current?.summary || "" : "", source_fingerprint: sourceFingerprint, deep_summary: sameSource ? current?.deep_summary || "" : "", summary_status: sameSource ? current?.summary_status || "pending" : "pending", summary_model: sameSource ? current?.summary_model || "" : "", summary_source_fingerprint: sameSource ? current?.summary_source_fingerprint || "" : "", summary_generated_at: sameSource ? current?.summary_generated_at || "" : "", summary_error: sameSource ? current?.summary_error || "" : "",
    });
  }
  const segments = segmentTranscriptText(file.parsed_text);
  const transcript = await store.upsertTranscript(projectId, {
    file_id: file.id, title: file.file_name, interview_type: current?.interview_type || inferInterviewType(file.file_name), respondent_label: current?.respondent_label || file.file_name.replace(/\.[^.]+$/, ""), respondent_metadata: parsed(current?.respondent_metadata, {}), status: "ready", word_count: text(file.parsed_text).length, segment_count: segments.length, summary: sameSource ? current?.summary || transcriptSummary(segments) : transcriptSummary(segments), source_fingerprint: sourceFingerprint, deep_summary: sameSource ? current?.deep_summary || "" : "", summary_status: sameSource ? current?.summary_status || "pending" : "pending", summary_model: sameSource ? current?.summary_model || "" : "", summary_source_fingerprint: sameSource ? current?.summary_source_fingerprint || "" : "", summary_generated_at: sameSource ? current?.summary_generated_at || "" : "", summary_error: sameSource ? current?.summary_error || "" : "",
  });
  await store.replaceTranscriptSegments(projectId, transcript.id, segments);
  return store.getTranscript(projectId, transcript.id);
}

function metadataMatches(transcript, filters = {}) {
  const metadata = parsed(transcript.respondent_metadata, {});
  return Object.entries(filters || {}).every(([key, expected]) => {
    if (expected == null || expected === "") return true;
    const actual = key === "interview_type" ? transcript.interview_type : key === "respondent_label" ? transcript.respondent_label : metadata[key];
    const allowed = (Array.isArray(expected) ? expected : [expected]).map((item) => normalized(item).toLowerCase()).filter(Boolean);
    return allowed.some((item) => normalized(actual).toLowerCase() === item);
  });
}

function excerptFor(content, terms, maximum = 600) {
  const source = normalized(content);
  const lower = source.toLowerCase();
  const offsets = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((index) => index >= 0);
  const center = offsets.length ? Math.min(...offsets) : 0;
  const start = Math.max(0, Math.min(center - Math.floor(maximum / 3), source.length - maximum));
  const excerpt = source.slice(start, start + maximum);
  return `${start > 0 ? "…" : ""}${excerpt}${start + maximum < source.length ? "…" : ""}`;
}

export async function transcriptSearch({ store, projectId, query, filters = {}, transcriptIds = [], limit = 12 }) {
  const terms = researchQueryTerms(query);
  if (!terms.length) throw new ToolInputError("请输入访谈检索词。", "TRANSCRIPT_QUERY_REQUIRED");
  const allowedIds = new Set((transcriptIds || []).map(text).filter(Boolean));
  const transcripts = (await store.listTranscripts(projectId)).filter((item) => item.status === "ready" && (!allowedIds.size || allowedIds.has(item.id)) && metadataMatches(item, filters));
  const transcriptMap = new Map(transcripts.map((item) => [item.id, item]));
  const candidates = [];
  for (const transcript of transcripts) {
    const preferred = await preferredTranscriptSegments({ store, projectId, transcriptId: transcript.id });
    for (const segment of preferred.segments) {
      const haystack = `${segment.content}\n${segment.speaker}\n${transcript.title}\n${JSON.stringify(parsed(transcript.respondent_metadata, {}))}`.toLowerCase();
      let score = 0; let matched = 0;
      for (const term of terms) if (haystack.includes(term.toLowerCase())) { matched += 1; score += Math.max(2, Math.min(10, term.length)); }
      if (!matched) continue;
      score += matched / terms.length * 12;
      candidates.push({ transcript_id: transcript.id, transcript_title: transcript.title, interview_type: transcript.interview_type, respondent_label: transcript.respondent_label, respondent_metadata: parsed(transcript.respondent_metadata, {}), segment_id: segment.id, raw_source_id: segment.raw_segment_id || segment.id, quote_source_version: preferred.source, source_version_id: preferred.version?.id || null, sequence: segment.sequence, speaker: segment.speaker || "unknown", excerpt: excerptFor(segment.content, terms), score: Math.round(score * 100) / 100, matched_terms: matched });
    }
  }
  const bounded = integer(limit, 12, 1, 20);
  return { query: text(query), filters, transcript_count: transcriptMap.size, matches: candidates.sort((a, b) => b.score - a.score || a.sequence - b.sequence).slice(0, bounded), limit: bounded, truncated: candidates.length > bounded };
}

export async function transcriptRead({ store, projectId, transcriptId, segmentId, contextBefore = 2, contextAfter = 2 }) {
  const transcript = await store.getTranscript(projectId, text(transcriptId));
  if (!transcript || transcript.status !== "ready") throw new ToolInputError("访谈不存在或不可读取。", "TRANSCRIPT_NOT_FOUND");
  const preferred = await preferredTranscriptSegments({ store, projectId, transcriptId: transcript.id });
  const segments = preferred.segments;
  const index = segments.findIndex((item) => item.id === text(segmentId) || item.raw_segment_id === text(segmentId));
  if (index < 0) throw new ToolInputError("访谈片段不存在。", "TRANSCRIPT_SEGMENT_NOT_FOUND");
  const before = integer(contextBefore, 2, 0, 5); const after = integer(contextAfter, 2, 0, 5);
  const rawSource = preferred.version?.parent_version_id && typeof store.listTranscriptVersionSegments === "function" ? await store.listTranscriptVersionSegments(projectId, preferred.version.parent_version_id) : await store.listTranscriptSegments(projectId, transcript.id);
  const rawSegments = new Map(rawSource.map((item) => [item.raw_segment_id || item.id, item]));
  const selected = segments.slice(Math.max(0, index - before), Math.min(segments.length, index + after + 1)).map((item) => { const raw = rawSegments.get(item.raw_segment_id || item.id); return { id: item.id, raw_source_id: raw?.id || item.id, sequence: item.sequence, speaker: item.speaker || "unknown", content: item.content, raw_content: raw?.content || item.content, is_target: item.id === segments[index].id, metadata: parsed(item.metadata, {}) }; });
  return { transcript: { id: transcript.id, title: transcript.title, interview_type: transcript.interview_type, respondent_label: transcript.respondent_label, respondent_metadata: parsed(transcript.respondent_metadata, {}) }, target_segment_id: segments[index].id, quote_source_version: preferred.source, source_version_id: preferred.version?.id || null, warning: preferred.warning, context_before: before, context_after: after, segments: selected };
}

export function createTranscriptToolExecutor({ store }) {
  if (!store) throw new Error("TRANSCRIPT_STORE_REQUIRED");
  return async ({ agentToolId, args = {}, scope }) => {
    const projectId = scope?.project?.id;
    if (!projectId || !scope?.user_id) throw new ToolInputError("访谈工具缺少项目上下文。", "INVALID_AGENT_CONTEXT");
    if (agentToolId === "transcript_search") {
      const result = await transcriptSearch({ store, projectId, query: args.query, filters: args.filters, transcriptIds: args.transcript_ids, limit: args.limit });
      return { gatewayId: "transcript-search", input: { query: text(args.query), filters: args.filters || {}, transcript_ids: args.transcript_ids || [], limit: result.limit }, result, compact: result };
    }
    if (agentToolId === "transcript_read") {
      const result = await transcriptRead({ store, projectId, transcriptId: args.transcript_id, segmentId: args.segment_id, contextBefore: args.context_before, contextAfter: args.context_after });
      return { gatewayId: "transcript-read", input: { transcript_id: result.transcript.id, segment_id: result.target_segment_id, context_before: result.context_before, context_after: result.context_after }, result, compact: result };
    }
    throw new ToolInputError("该访谈工具未开放。", "AGENT_TOOL_NOT_ALLOWED");
  };
}

export function enhanceQualitativeAnalysisPrompt({ basePrompt, message, transcripts = [], failedFiles = [], maxChars = 80_000, findQuotesOnly = false, interviewSummaryOnly = false }) {
  const toolBudgetRule = findQuotesOnly
    ? "工具预算硬约束：最多调用 2 次 transcript_search、5 次 transcript_read。每次检索必须覆盖全部授权 Transcript，禁止按受访者逐份检索；拿到候选 Segment 后立即转入 transcript_read。"
    : interviewSummaryOnly
      ? "工具预算硬约束：最多调用 2 次 transcript_search、4 次 transcript_read。使用组合关键词一次覆盖主要主题，禁止把同义词拆成多次检索；拿到候选 Segment 后立即回查。"
      : "工具预算硬约束：最多调用 3 次 transcript_search、5 次 transcript_read，总计不超过 8 次。每次检索必须覆盖全部授权 Transcript，并在一个 query 中合并同一分析维度的同义词；禁止按受访者逐份检索、禁止把同义词拆成并行调用。第 3 次检索后必须停止搜索，使用已有候选 Segment 进入 transcript_read 并完成报告。";
  const rules = findQuotesOnly
    ? `本轮只执行“找原声”：先调用 transcript_search，再对候选调用 transcript_read 回查上下文。${toolBudgetRule} 返回 3～5 条最相关直接原声、访谈名称、受访者和 Segment ID，并用简短一句说明相关性；不要生成完整 Insight 或报告。直接引用必须严格使用格式：> “原文逐字引用” [segment:真实Segment ID]。`
    : interviewSummaryOnly
      ? `本轮只分析这一份访谈，生成 interview_summary。先调用 transcript_search 定位核心观点与案例，再调用 transcript_read 回查准备引用的原声。${toolBudgetRule} 结构包含：受访者背景、核心观点、关键事实、主要判断、典型案例、代表性原声、与本项目的关联。不要机械逐段摘要；任何 Direct Quote 必须严格使用格式：> “原文逐字引用” [segment:真实Segment ID]。`
      : `这是正式 qualitative_analysis Research Workflow。必须由研究问题驱动，先调用 transcript_search 检索，再用 transcript_read 回查准备引用的原声上下文；不得要求全部访谈全文。${toolBudgetRule} 分析需区分 Evidence、Interpretation、Hypothesis，并识别共识、群体差异、关键少数与反例。任何带引号的 Direct Quote 必须逐字来自 transcript_read 返回的 Segment，严格使用格式：> “原文逐字引用” [segment:真实Segment ID]。无法回查的内容只能作为 Paraphrase，禁止加引号。输出定性分析成果正文，不生成 PPT。建议结构：分析目标与材料范围、受访者构成、核心结论、关键主题、分群差异、典型原声、反例与边界、待验证假设、后续启示。`;
  const maximum = Math.max(8_000, Number(maxChars) || 80_000);
  const base = String(basePrompt || "").slice(0, Math.max(4_000, Math.floor(maximum * 0.45)));
  const selected = transcripts.slice(0, 20);
  const header = "【访谈材料索引（仅 Metadata + 两层缓存摘要，不含全文）】\n";
  const suffix = `\n\n注意：结构摘要和深度摘要都只是检索导航，不构成直接证据；任何最终洞察与直接引语仍必须通过 transcript_search / transcript_read 回查当前证据 Segment。系统优先使用已确认校正版，并保留 Raw 原文回看与 raw_source_id；没有已确认校正版时使用 Raw。\n\n【解析失败、未纳入材料】\n${failedFiles.map((file) => file.file_name).join("、") || "无"}\n\n【强制检索与证据规则】\n${rules}\n\n【当前研究问题】\n${text(message)}`;
  const profileBudget = Math.max(1_000, maximum - base.length - header.length - suffix.length - 4);
  const deepSummaryChars = selected.length ? Math.max(400, Math.min(4_000, Math.floor(profileBudget / selected.length) - 1_800)) : 400;
  const profiles = selected.map((item) => [
    `Transcript ID: ${item.id}`,
    `名称：${String(item.title || "").slice(0, 300)}`,
    `类型：${item.interview_type}`,
    `受访者：${String(item.respondent_label || "未标注").slice(0, 300)}`,
    `Metadata：${JSON.stringify(parsed(item.respondent_metadata, {})).slice(0, 800)}`,
    `规模：${item.word_count || 0} 字 / ${item.segment_count || 0} 段`,
    item.summary ? `缓存结构导航摘要：${String(item.summary).slice(0, 700)}` : "缓存结构导航摘要：暂无",
    item.summary_status === "ready" && item.deep_summary && item.summary_source_fingerprint === item.source_fingerprint
      ? `缓存单访谈深度摘要（仅用于导航与理解，不是最终证据）：${String(item.deep_summary).slice(0, deepSummaryChars)}`
      : `缓存单访谈深度摘要：${item.summary_status === "processing" ? "生成中" : item.summary_status === "failed" ? "生成失败，当前回退到结构摘要" : "尚未生成，当前回退到结构摘要"}`,
  ].join("\n")).join("\n\n").slice(0, profileBudget);
  return `${base}\n\n${header}${profiles || "没有可用访谈"}${suffix}`;
}

function normalizeQuote(value) { return String(value ?? "").trim().replace(/^[“”"']+|[“”"']+$/g, "").trim(); }
function firstStatement(block) { return block.split(/\n{2,}/).map((part) => part.replace(/^#+\s*/, "").trim()).find((part) => part && !part.startsWith(">"))?.slice(0, 1_200) || "定性分析发现"; }

export async function validateQualitativeQuotes({ store, projectId, reply, transcripts = [] }) {
  const segmentMap = new Map();
  for (const transcript of transcripts) {
    const preferred = await preferredTranscriptSegments({ store, projectId, transcriptId: transcript.id });
    for (const segment of preferred.segments) segmentMap.set(segment.id, { segment, transcript, preferred });
  }
  const citations = [];
  let invalidQuotes = 0;
  const citationPattern = /^[ \t]*>[ \t]*[“"]([^\n“”"]+)[”"][ \t]*\[segment:([^\]\s]+)\][ \t]*$/gm;
  const content = String(reply || "").replace(citationPattern, (whole, rawQuote, segmentId, offset) => {
    const found = segmentMap.get(segmentId); const quote = normalizeQuote(rawQuote);
    if (rawQuote.length > 8000 || !found || !normalized(found.segment.content).includes(normalized(quote))) { invalidQuotes += 1; return "（直接引用未通过原文逐字校验，已移除；请按 Paraphrase 理解。）"; }
    citations.push({ quote, quote_text: quote, segment_id: segmentId, raw_source_id: found.segment.raw_segment_id || found.segment.id, quote_source_version: found.preferred.source, source_version_id: found.preferred.version?.id || null, transcript_id: found.transcript.id, transcript_title: found.transcript.title, respondent_label: found.transcript.respondent_label || "", offset });
    return `> “${quote}” [segment:${segmentId}]`;
  });
  return { content, citations, invalidQuotes };
}

export async function finalizeQuoteSearch({ store, projectId, reply, transcripts = [] }) {
  const validated = await validateQualitativeQuotes({ store, projectId, reply, transcripts });
  const evidence = [];
  for (const citation of validated.citations) evidence.push(await store.createEvidence(projectId, { type: "transcript_quote", claim: "找原声结果", value: { ...citation, direct_quote: true, find_quotes: true }, source_type: "transcript_segment", source_id: citation.raw_source_id || citation.segment_id, strength: "weak" }));
  return { ...validated, evidence, quality: { verified_quote_count: validated.citations.length, invalid_quote_count: validated.invalidQuotes, transcript_count: transcripts.length, raw_transcript_chars_in_prompt: 0 } };
}

export async function finalizeInterviewSummary({ store, projectId, projectTitle, reply, parentArtifactId = null, transcript }) {
  const validated = await validateQualitativeQuotes({ store, projectId, reply, transcripts: [transcript] });
  const content = `${validated.content.trim()}\n\n## 证据校验\n\n本小结基于《${transcript.title}》的 ${transcript.segment_count || 0} 个可回溯 Segment；已校验 ${validated.citations.length} 条逐字原声${validated.invalidQuotes ? `，移除 ${validated.invalidQuotes} 条无法回溯的直接引用` : ""}。`;
  const artifact = await store.createArtifact(projectId, { type: "interview_summary", title: `${transcript.respondent_label || transcript.title || projectTitle || "访谈"}——单篇访谈小结`, content, parent_artifact_id: parentArtifactId || undefined });
  const evidence = [];
  for (const citation of validated.citations) evidence.push(await store.createEvidence(projectId, { type: "transcript_quote", claim: "单篇访谈小结逐字原声", value: { ...citation, direct_quote: true, artifact_id: artifact.id }, source_type: "transcript_segment", source_id: citation.raw_source_id || citation.segment_id, strength: "weak" }));
  return { artifact, evidence, quality: { transcript_count: 1, verified_quote_count: validated.citations.length, invalid_quote_count: validated.invalidQuotes, raw_transcript_chars_in_prompt: 0 } };
}

export async function finalizeQualitativeAnalysis({ store, projectId, projectTitle, reply, parentArtifactId = null, transcripts = [], failedFiles = [] }) {
  const { content, citations, invalidQuotes } = await validateQualitativeQuotes({ store, projectId, reply, transcripts });
  const scopeNote = `\n\n## 材料与证据校验\n\n本次纳入 ${transcripts.length} 份有效访谈${failedFiles.length ? `；${failedFiles.length} 份解析失败未纳入：${failedFiles.map((file) => file.file_name).join("、")}` : ""}。已校验 ${citations.length} 条逐字原声${invalidQuotes ? `；移除 ${invalidQuotes} 条无法回溯的直接引用` : ""}。定性材料不代表总体，频次仅表示当前样本覆盖。`;
  const artifact = await store.createArtifact(projectId, { type: "qualitative_analysis", title: `${projectTitle || "项目"}——访谈定性分析`, content: `${content.trim()}${scopeNote}`, parent_artifact_id: parentArtifactId || undefined });
  const evidence = [];
  for (const citation of citations) evidence.push(await store.createEvidence(projectId, { type: "transcript_quote", claim: "定性分析逐字原声", value: { ...citation, direct_quote: true, artifact_id: artifact.id }, source_type: "transcript_segment", source_id: citation.raw_source_id || citation.segment_id, strength: "weak" }));

  const blocks = [...content.matchAll(/^###\s+(.+)$/gm)].map((match, index, matches) => ({ title: match[1].trim(), start: match.index, end: matches[index + 1]?.index ?? content.length }));
  const drafts = blocks.length ? blocks : [{ title: "核心定性发现", start: 0, end: content.length }];
  const insights = [];
  for (const draft of drafts.slice(0, 20)) {
    const block = content.slice(draft.start, draft.end); const linked = evidence.filter((item, index) => { const citation = citations[index]; return citation && citation.offset >= draft.start && citation.offset < draft.end; });
    if (!linked.length) continue;
    const code = await store.createQualitativeCode(projectId, { name: draft.title, description: firstStatement(block) });
    const theme = await store.createQualitativeTheme(projectId, { name: draft.title, description: firstStatement(block), code_ids: [code.id], frequency: linked.length, coverage: unique(linked.map((item) => parsed(item.value, {}).transcript_id)).length, metadata: { artifact_id: artifact.id } });
    const insight = await store.createResearchInsight(projectId, { title: draft.title, statement: firstStatement(block), interpretation: block.slice(0, 5_000), business_implication: "", confidence: linked.length >= 2 ? "medium" : linked.length === 1 ? "low" : "insufficient", level: "finding", status: linked.length ? "validated" : "needs_evidence", theme_id: theme.id, artifact_id: artifact.id });
    for (const item of linked) await store.linkInsightEvidence(projectId, insight.id, item.id);
    insights.push(insight);
  }
  const quality = { passed: citations.length > 0 && invalidQuotes === 0, transcript_count: transcripts.length, failed_file_count: failedFiles.length, verified_quote_count: citations.length, invalid_quote_count: invalidQuotes, insight_count: insights.length, raw_transcript_chars_in_prompt: 0 };
  const refreshed = await store.updateArtifact(projectId, artifact.id, { content: artifact.content });
  return { artifact: refreshed || artifact, evidence, insights, quality };
}

export function summarizeQualitativeAnalysisResult({ artifact, quality }) {
  return `定性分析已完成并保存为《${artifact.title}》V${artifact.version}。本次纳入 ${quality.transcript_count} 份有效访谈，形成 ${quality.insight_count} 条可保存洞察，并逐字校验 ${quality.verified_quote_count} 条原声${quality.invalid_quote_count ? `；${quality.invalid_quote_count} 条未通过校验的引用已移除` : ""}。可在项目成果中查看完整分析和原文证据。`;
}

export const qualitativeAnalysisInternals = { metadataMatches, normalizeQuote, transcriptSummary };
