const REASONS = new Set(["typo", "asr_error", "proper_noun", "punctuation", "speaker", "duplication", "other"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const MECHANICAL_DUPLICATES = ["觉得", "价格", "然后", "就是", "因为", "所以"];

function text(value) { return String(value ?? "").trim(); }
function parsed(value, fallback = {}) { if (value && typeof value === "object") return value; try { return JSON.parse(String(value || "")); } catch { return fallback; } }
function integer(value, fallback, minimum, maximum) { const number = Number(value); return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function now() { return new Date().toISOString(); }

export const transcriptCorrectionWorkflowStages = Object.freeze([
  { id: "parse", label: "正在确认笔录结构" },
  { id: "correction", label: "正在逐段校正" },
  { id: "consistency", label: "正在检查术语一致性" },
  { id: "complete", label: "正在生成校正版" },
]);

export function extractProjectTerminology(project = {}) {
  const source = [project.title, project.client_name, project.brief, project.research_goal, project.constraints].join("\n");
  const latin = source.match(/\b[A-Z][A-Za-z0-9+._-]{1,30}\b/g) || [];
  const quoted = [...source.matchAll(/[“"《]([^”"》]{2,24})[”"》]/g)].map((match) => match[1]);
  const labels = source.match(/[\u4e00-\u9fffA-Za-z0-9]{2,20}(?:品牌|产品|系列|型号|平台|系统)/g) || [];
  return unique([...latin, ...quoted, ...labels]).slice(0, 80);
}

export function buildTranscriptCorrectionPrompt({ transcript, batch, before = [], after = [], terminology = [], batchIndex = 0, batchCount = 1 }) {
  const render = (segment) => `[segment:${segment.id}] ${segment.speaker || "unknown"}\n${segment.content}`;
  return [
    "你是 SurveyKit 的访谈笔录校正器。只纠正明确的转写错误，不润色、不改写、不总结。仅输出严格 JSON。",
    "允许：错别字、ASR/同音错误、证据明确的品牌/产品名、标点断句、机械重复、明显错误的说话人标签。",
    "禁止：改写口语、整理逻辑、删除矛盾/负面观点/研究性重复、补全缺失观点、改变语气。强调式重复必须保留。",
    "专有名词表只是弱提示；证据不足时不得强行套用，confidence 必须为 medium 或 low，交给人工复核。",
    `当前批次：${batchIndex + 1}/${batchCount}。只返回【待校正 Segments】中的 segment_id；前后文仅用于判断。`,
    "JSON schema：{\"segments\":[{\"segment_id\":\"...\",\"corrected_text\":\"完整校正后段落\",\"corrected_speaker\":\"可选，仅明显标签错误时填写\",\"changes\":[{\"original_text\":\"原片段或原说话人\",\"corrected_text\":\"新片段或新说话人\",\"reason\":\"typo|asr_error|proper_noun|punctuation|speaker|duplication|other\",\"confidence\":\"high|medium|low\",\"note\":\"简短依据\"}]}]}。无修改时 corrected_text 保持原文、changes 为空。",
    "",
    `Transcript：${transcript.title || transcript.id}`,
    `项目术语：${terminology.length ? terminology.join("、") : "无"}`,
    "",
    "【前文上下文】", before.map(render).join("\n\n") || "无",
    "", "【待校正 Segments】", batch.map(render).join("\n\n"),
    "", "【后文上下文】", after.map(render).join("\n\n") || "无",
  ].join("\n");
}

export function parseTranscriptCorrectionReply(reply) {
  const raw = String(reply || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value;
  try { value = JSON.parse(raw); } catch { throw Object.assign(new Error("笔录校正模型返回的 JSON 无法解析。"), { code: "TRANSCRIPT_CORRECTION_JSON_INVALID" }); }
  if (!value || !Array.isArray(value.segments)) throw Object.assign(new Error("笔录校正模型返回结构不完整。"), { code: "TRANSCRIPT_CORRECTION_SCHEMA_INVALID" });
  return value;
}

function editRatio(original, corrected) {
  const left = String(original || ""); const right = String(corrected || "");
  if (left === right) return 0;
  let prefix = 0; while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0; while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix += 1;
  return Math.max(left.length - prefix - suffix, right.length - prefix - suffix) / Math.max(1, left.length);
}

function normalizeChange(change, rawSegment, modelSegment) {
  let original = text(change?.original_text); let corrected = text(change?.corrected_text);
  const requestedReason = REASONS.has(change?.reason) ? change.reason : "other";
  if (requestedReason === "speaker" && !original && text(modelSegment?.corrected_speaker) && text(modelSegment.corrected_speaker) !== text(rawSegment.speaker)) { original = text(rawSegment.speaker); corrected = text(modelSegment.corrected_speaker); }
  if (!original && modelSegment && text(modelSegment.corrected_text) !== text(rawSegment.content)) { original = text(rawSegment.content); corrected = text(modelSegment.corrected_text); }
  if (!original || !corrected || original === corrected || (requestedReason === "speaker" ? text(rawSegment.speaker) !== original : !String(rawSegment.content).includes(original))) return null;
  const reason = requestedReason;
  let confidence = CONFIDENCE.has(change?.confidence) ? change.confidence : "low";
  const wholeRatio = editRatio(rawSegment.content, modelSegment?.corrected_text || rawSegment.content);
  const localRatio = editRatio(original, corrected);
  if (confidence === "high" && reason !== "duplication" && (wholeRatio > 0.25 || localRatio > 1.5 || reason === "other")) confidence = "medium";
  return { original_text: original, corrected_text: corrected, reason, confidence, note: text(change?.note).slice(0, 500) };
}

function deterministicDuplicateChanges(segment) {
  const changes = [];
  for (const token of MECHANICAL_DUPLICATES) {
    const doubled = token + token;
    if (String(segment.content).includes(doubled)) changes.push({ original_text: doubled, corrected_text: token, reason: "duplication", confidence: "high", note: "连续完全重复词，判定为机械转写重复。" });
  }
  return changes;
}

async function applyStoredCorrection({ store, projectId, version, versionSegment, rawSegment, change, batchIndex }) {
  const auto = change.confidence === "high";
  let status = auto ? "auto_applied" : "pending_review";
  if (auto) {
    const current = await store.getTranscriptVersionSegment(projectId, version.id, versionSegment.id);
    const matches = change.reason === "speaker" ? text(current?.speaker) === change.original_text : String(current?.content || "").includes(change.original_text);
    if (!current || !matches) status = "pending_review";
    else if (change.reason === "speaker") await store.updateTranscriptVersionSegment(projectId, version.id, versionSegment.id, { speaker: change.corrected_text });
    else await store.updateTranscriptVersionSegment(projectId, version.id, versionSegment.id, { content: String(current.content).replace(change.original_text, change.corrected_text) });
  }
  return store.createTranscriptCorrection(projectId, {
    transcript_id: version.transcript_id, version_id: version.id, segment_id: versionSegment.id, raw_segment_id: rawSegment.id,
    original_text: change.original_text, corrected_text: change.corrected_text, reason: change.reason,
    confidence: status === "auto_applied" ? "high" : change.confidence === "high" ? "medium" : change.confidence,
    status, batch_index: batchIndex, note: change.note,
  });
}

async function terminologyConsistencyPass({ store, projectId, version, rawSegments }) {
  const corrections = await store.listTranscriptCorrections(projectId, version.id);
  const mappings = new Map();
  for (const item of corrections) if (item.reason === "proper_noun" && item.confidence === "high" && item.status === "auto_applied") mappings.set(item.original_text, item.corrected_text);
  if (!mappings.size) return 0;
  let created = 0;
  for (const raw of rawSegments) {
    const segment = await store.getTranscriptVersionSegmentByRaw(projectId, version.id, raw.id);
    if (!segment) continue;
    for (const [original, corrected] of mappings) {
      if (!String(segment.content).includes(original)) continue;
      if (corrections.some((item) => item.segment_id === segment.id && item.original_text === original && item.corrected_text === corrected)) continue;
      await store.createTranscriptCorrection(projectId, { transcript_id: version.transcript_id, version_id: version.id, segment_id: segment.id, raw_segment_id: raw.id, original_text: original, corrected_text: corrected, reason: "proper_noun", confidence: "medium", status: "pending_review", batch_index: 0, note: "术语一致性检查发现同一疑似误写，需人工确认上下文。" });
      created += 1;
    }
  }
  return created;
}

export async function runTranscriptCorrection({ store, projectId, project, transcriptId, generate, model = "", batchSize = 4, contextSize = 1, onProgress = () => {} }) {
  const transcript = await store.getTranscript(projectId, transcriptId);
  if (!transcript || transcript.status !== "ready") throw Object.assign(new Error("访谈不存在或尚未完成解析。"), { code: "TRANSCRIPT_NOT_FOUND" });
  const rawSegments = await store.listTranscriptSegments(projectId, transcript.id);
  if (!rawSegments.length) throw Object.assign(new Error("访谈没有可校正的 Segment。"), { code: "TRANSCRIPT_SEGMENTS_REQUIRED" });
  const terminology = extractProjectTerminology(project);
  const rawVersion = await store.ensureRawTranscriptVersion(projectId, transcript, rawSegments);
  const version = await store.createCorrectedTranscriptVersion(projectId, transcript, rawVersion, rawSegments, { model, terminology });
  const boundedBatch = integer(batchSize, 4, 1, 8); const boundedContext = integer(contextSize, 1, 0, 2);
  const batches = Array.from({ length: Math.ceil(rawSegments.length / boundedBatch) }, (_, index) => rawSegments.slice(index * boundedBatch, (index + 1) * boundedBatch));
  try {
    await onProgress({ stage: "parse", transcript_id: transcript.id, version_id: version.id, current: 0, total: batches.length });
    for (const [batchIndex, batch] of batches.entries()) {
      const firstIndex = batchIndex * boundedBatch; const lastIndex = firstIndex + batch.length;
      const prompt = buildTranscriptCorrectionPrompt({ transcript, batch, before: rawSegments.slice(Math.max(0, firstIndex - boundedContext), firstIndex), after: rawSegments.slice(lastIndex, lastIndex + boundedContext), terminology, batchIndex, batchCount: batches.length });
      const result = parseTranscriptCorrectionReply(await generate(prompt, { transcript, version, batchIndex, batchCount: batches.length }));
      const returned = new Map(result.segments.map((item) => [text(item.segment_id), item]));
      for (const raw of batch) {
        const modelSegment = returned.get(raw.id); const versionSegment = await store.getTranscriptVersionSegmentByRaw(projectId, version.id, raw.id);
        const deterministic = deterministicDuplicateChanges(raw); const supplied = Array.isArray(modelSegment?.changes) ? [...modelSegment.changes] : [];
        if (modelSegment?.corrected_speaker && text(modelSegment.corrected_speaker) !== text(raw.speaker) && !supplied.some((item) => item?.reason === "speaker")) supplied.push({ original_text: raw.speaker, corrected_text: modelSegment.corrected_speaker, reason: "speaker", confidence: "low", note: "模型未提供明确说话人校正依据，需人工确认。" });
        if (!deterministic.length && !supplied.length && modelSegment && text(modelSegment.corrected_text) !== text(raw.content)) supplied.push({ reason: "other", confidence: "low", note: "模型返回了整段变化但未提供逐项依据，需人工确认。" });
        const changes = [...deterministic, ...supplied]
          .map((change) => normalizeChange(change, raw, modelSegment)).filter(Boolean);
        const seen = new Set();
        for (const change of changes) {
          const key = `${change.original_text}\u0000${change.corrected_text}`; if (seen.has(key)) continue; seen.add(key);
          await applyStoredCorrection({ store, projectId, version, versionSegment, rawSegment: raw, change, batchIndex });
        }
      }
      await onProgress({ stage: "correction", transcript_id: transcript.id, version_id: version.id, current: batchIndex + 1, total: batches.length });
    }
    await onProgress({ stage: "consistency", transcript_id: transcript.id, version_id: version.id, current: batches.length, total: batches.length });
    await terminologyConsistencyPass({ store, projectId, version, rawSegments });
    const corrections = await store.listTranscriptCorrections(projectId, version.id);
    const auto = corrections.filter((item) => item.status === "auto_applied").length;
    const pending = corrections.filter((item) => item.status === "pending_review").length;
    const completed = await store.updateTranscriptVersion(projectId, version.id, { status: pending ? "review_required" : "confirmed", auto_applied_count: auto, pending_review_count: pending, confirmed_at: pending ? null : now(), error: "" });
    await onProgress({ stage: "complete", transcript_id: transcript.id, version_id: version.id, current: batches.length, total: batches.length, auto_applied_count: auto, pending_review_count: pending });
    return { transcript, version: completed, raw_version: rawVersion, corrections, batch_count: batches.length, terminology };
  } catch (error) {
    await store.updateTranscriptVersion(projectId, version.id, { status: "failed", error: text(error?.message || error?.code || "笔录校正失败").slice(0, 2_000) });
    throw error;
  }
}

export async function runTranscriptCorrectionBatch({ transcriptIds = [], concurrency = 2, runOne, onProgress = () => {} }) {
  const ids = unique(transcriptIds.map(text)); const results = new Array(ids.length); let cursor = 0;
  const workers = Array.from({ length: Math.min(integer(concurrency, 2, 1, 4), Math.max(1, ids.length)) }, async () => {
    while (cursor < ids.length) {
      const index = cursor; cursor += 1; const transcriptId = ids[index];
      try { results[index] = { transcript_id: transcriptId, ok: true, result: await runOne(transcriptId, index) }; }
      catch (error) { results[index] = { transcript_id: transcriptId, ok: false, error: text(error?.message || error?.code || "笔录校正失败") }; }
      await onProgress({ completed_files: results.filter(Boolean).length, total_files: ids.length, transcript_id: transcriptId, ok: results[index].ok });
    }
  });
  await Promise.all(workers);
  return results;
}

export async function preferredTranscriptSegments({ store, projectId, transcriptId, includeReview = false }) {
  const version = typeof store.getPreferredTranscriptVersion === "function" ? await store.getPreferredTranscriptVersion(projectId, transcriptId, { includeReview }) : null;
  if (!version) return { version: null, source: "raw", warning: "", segments: await store.listTranscriptSegments(projectId, transcriptId) };
  return { version, source: version.type === "corrected" ? `corrected_v${version.version}` : `raw_v${version.version}`, warning: version.status === "review_required" ? "校正版仍有待复核项。" : "", segments: await store.listTranscriptVersionSegments(projectId, version.id) };
}

export async function resolveTranscriptCorrection({ store, projectId, correctionId, decision }) {
  if (!["accept", "reject"].includes(decision)) throw Object.assign(new Error("复核决定无效。"), { code: "TRANSCRIPT_CORRECTION_DECISION_INVALID" });
  return store.resolveTranscriptCorrection(projectId, correctionId, decision);
}

export const transcriptCorrectionInternals = { deterministicDuplicateChanges, editRatio, normalizeChange, terminologyConsistencyPass };
