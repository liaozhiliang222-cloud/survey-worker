import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runTranscriptCorrection, runTranscriptCorrectionBatch, preferredTranscriptSegments } from "../lib/transcript-correction.mjs";
import { transcriptRead, transcriptSearch, validateQualitativeQuotes } from "../lib/qualitative-analysis.mjs";

const require = createRequire(import.meta.url);
const { JsonResearchStore } = require("../lib/research-store.js");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-transcript-correction-"));
const store = new JsonResearchStore(path.join(temp, "research.json"));
const project = await store.createProject("user-a", { title: "荣耀手机体验研究", client_name: "荣耀", brief: "了解 Magic 系列体验", research_goal: "识别真实用户反馈" });
const transcript = await store.upsertTranscript(project.id, { file_id: "file-a", title: "消费者A.txt", interview_type: "consumer", respondent_label: "消费者A", status: "ready", word_count: 120, segment_count: 6, source_fingerprint: "source-a-v1" });
const raw = await store.replaceTranscriptSegments(project.id, transcript.id, [
  { id: "raw-1", sequence: 0, speaker: "受访者", content: "我用的是荣要手机，嗯我觉得还可以。" },
  { id: "raw-2", sequence: 1, speaker: "受访者", content: "那个麦吉克七我不确定。" },
  { id: "raw-3", sequence: 2, speaker: "受访者", content: "嗯，我觉得吧，就是还可以。" },
  { id: "raw-4", sequence: 3, speaker: "受访者", content: "我觉得觉得这个价格价格有点高。" },
  { id: "raw-5", sequence: 4, speaker: "受访者", content: "很贵，很贵，非常贵。" },
  { id: "raw-6", sequence: 5, speaker: "受访者", content: "今天很好吧" },
]);

const prompts = [];
const generate = async (prompt) => {
  prompts.push(prompt);
  const segments = [];
  if (prompt.includes("[segment:raw-1]")) segments.push({ segment_id: "raw-1", corrected_text: "我用的是荣耀手机，嗯我觉得还可以。", changes: [{ original_text: "荣要", corrected_text: "荣耀", reason: "proper_noun", confidence: "high", note: "项目术语与上下文一致" }] });
  if (prompt.includes("[segment:raw-2]")) segments.push({ segment_id: "raw-2", corrected_text: "那个 Magic 7 我不确定。", changes: [{ original_text: "麦吉克七", corrected_text: "Magic 7", reason: "proper_noun", confidence: "low", note: "证据不足，需人工确认" }] });
  if (prompt.includes("[segment:raw-3]")) segments.push({ segment_id: "raw-3", corrected_text: "嗯，我觉得吧，就是还可以。", changes: [] });
  if (prompt.includes("[segment:raw-4]")) segments.push({ segment_id: "raw-4", corrected_text: "我觉得这个价格有点高。", changes: [] });
  if (prompt.includes("[segment:raw-5]")) segments.push({ segment_id: "raw-5", corrected_text: "很贵，很贵，非常贵。", changes: [] });
  if (prompt.includes("[segment:raw-6]")) segments.push({ segment_id: "raw-6", corrected_text: "今天很好吧。", changes: [{ original_text: "今天很好吧", corrected_text: "今天很好吧。", reason: "punctuation", confidence: "medium", note: "句末标点建议" }] });
  return JSON.stringify({ segments });
};

const v1 = await runTranscriptCorrection({ store, projectId: project.id, project, transcriptId: transcript.id, generate, model: "mock/correction", batchSize: 2, contextSize: 1 });
assert.equal(v1.batch_count, 3, "长笔录必须按 Segment 小批次处理");
assert.equal(prompts.length, 3);
assert.ok(prompts.every((prompt) => ((prompt.split("\n【待校正 Segments】\n")[1] || "").split("\n\n【后文上下文】")[0].match(/\[segment:/g) || []).length <= 2), "单批不得把整份笔录作为待校正正文");

const rawAfter = await store.listTranscriptSegments(project.id, transcript.id);
assert.deepEqual(rawAfter.map((item) => item.content), raw.map((item) => item.content), "Raw Transcript 永远不可覆盖");
const v1Segments = await store.listTranscriptVersionSegments(project.id, v1.version.id);
assert.match(v1Segments[0].content, /荣耀/, "高置信专有名词应自动应用");
assert.match(v1Segments[1].content, /麦吉克七/, "低置信专有名词不得自动猜测");
assert.equal(v1Segments[2].content, "嗯，我觉得吧，就是还可以。", "口语表达必须保持");
assert.equal(v1Segments[3].content, "我觉得这个价格有点高。", "机械重复应删除");
assert.equal(v1Segments[4].content, "很贵，很贵，非常贵。", "强调式重复必须保留");
assert.equal(v1.version.status, "review_required");
assert.equal(v1.version.pending_review_count, 2);

const pending = (await store.listTranscriptCorrections(project.id, v1.version.id)).filter((item) => item.status === "pending_review");
const proper = pending.find((item) => item.original_text === "麦吉克七");
const punctuation = pending.find((item) => item.reason === "punctuation");
await store.resolveTranscriptCorrection(project.id, proper.id, "accept");
await store.resolveTranscriptCorrection(project.id, punctuation.id, "reject");
const confirmed = await store.getTranscriptVersion(project.id, v1.version.id);
assert.equal(confirmed.status, "confirmed", "逐条接受/拒绝后版本应确认");
const acceptedSegment = await store.getTranscriptVersionSegmentByRaw(project.id, confirmed.id, "raw-2");
assert.match(acceptedSegment.content, /Magic 7/);

const preferred = await preferredTranscriptSegments({ store, projectId: project.id, transcriptId: transcript.id });
assert.equal(preferred.version.id, confirmed.id, "下游默认应优先 Confirmed Corrected");
const search = await transcriptSearch({ store, projectId: project.id, query: "荣耀", transcriptIds: [transcript.id] });
assert.equal(search.matches[0].quote_source_version, "corrected_v1");
const read = await transcriptRead({ store, projectId: project.id, transcriptId: transcript.id, segmentId: search.matches[0].segment_id });
assert.match(read.segments.find((item) => item.is_target).raw_content, /荣要/, "校正引文必须可查看 Raw 原文");
const validated = await validateQualitativeQuotes({ store, projectId: project.id, reply: `> “我用的是荣耀手机” [segment:${search.matches[0].segment_id}]`, transcripts: [transcript] });
assert.equal(validated.citations[0].raw_source_id, "raw-1");
assert.equal(validated.citations[0].quote_source_version, "corrected_v1", "定性分析与找原声应记录使用版本");

const v2 = await runTranscriptCorrection({ store, projectId: project.id, project, transcriptId: transcript.id, generate: async () => JSON.stringify({ segments: [] }), model: "mock/correction", batchSize: 3, contextSize: 1 });
assert.equal(v2.version.version, 2, "重新校正必须生成 Corrected V2");
assert.equal((await store.getTranscriptVersion(project.id, confirmed.id)).version, 1, "V2 不得覆盖 V1");
assert.equal(v2.version.parent_version_id, v1.raw_version.id, "V2 必须再次基于 Raw，而不是基于 V1");

const multi = await runTranscriptCorrectionBatch({ transcriptIds: ["t1", "t2", "t3", "t4", "t5", "t6"], concurrency: 2, runOne: async (id) => { if (id === "t4") throw new Error("mock failure"); return { id }; } });
assert.equal(multi.filter((item) => item.ok).length, 5, "多文件单个失败不得拖垮整批");
assert.equal(multi.find((item) => item.transcript_id === "t4").ok, false);

await store.upsertTranscript(project.id, { ...transcript, file_id: transcript.file_id, source_fingerprint: "source-a-v2", status: "ready" });
assert.equal(await store.getPreferredTranscriptVersion(project.id, transcript.id), null, "Raw 来源变化后不得继续使用旧校正版");

const other = await store.createProject("user-b", { title: "隔离项目" });
assert.equal(await store.getTranscriptVersion(other.id, confirmed.id), null, "版本查询必须按项目/用户作用域隔离");
assert.equal(await store.getTranscriptCorrection(other.id, proper.id), null, "校正记录必须按项目/用户作用域隔离");

console.log("transcript correction workflow smoke: ok");
