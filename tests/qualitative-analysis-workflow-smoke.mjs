import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { parseProjectFile } from "../lib/project-file-parser.mjs";
import { buildTranscriptDeepSummaryPrompt, enhanceQualitativeAnalysisPrompt, finalizeQualitativeAnalysis, finalizeQuoteSearch, generateTranscriptDeepSummary, segmentTranscriptText, syncTranscriptFromFile, transcriptRead, transcriptSearch } from "../lib/qualitative-analysis.mjs";

const require = createRequire(import.meta.url);
const { JsonResearchStore } = require("../lib/research-store.js");
const { createResearchHandler } = require("../lib/research-handler.js");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-qual-workflow-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));

try {
  const project = await store.createProject("owner-a", { client_project_id: "qual-a", title: "年轻用户体验研究", research_goal: "理解购买阻力与留存机会" });
  const foreign = await store.createProject("owner-b", { client_project_id: "qual-b", title: "其他项目" });

  const exporterSource = fs.readFileSync(new URL("../src/shared/docx-export.js", import.meta.url), "utf8");
  const { buildAiResearchDocxBytes } = await import(`data:text/javascript;base64,${Buffer.from(exporterSource).toString("base64")}`);
  const docxText = "# 购买体验访谈\n\n访谈员：为什么考虑购买？\n\n受访者：线下体验让我更放心，售后也是关键。\n\n访谈员：有什么顾虑？\n\n受访者：价格偏高，但可靠性可以弥补。";
  const docxBytes = buildAiResearchDocxBytes({ content: docxText, projectTitle: project.title, exportedAt: new Date("2026-08-31T00:00:00Z") });
  const parsedDocx = await parseProjectFile(docxBytes.buffer.slice(docxBytes.byteOffset, docxBytes.byteOffset + docxBytes.byteLength), { extension: "docx", fileName: "访谈01.docx" });
  assert.equal(parsedDocx.status, "completed");
  assert.match(parsedDocx.parsedText, /售后也是关键/);

  const files = [];
  for (let index = 0; index < 10; index += 1) {
    const city = index < 5 ? "上海" : "成都";
    const segment = index < 7 ? "高频用户" : "低频用户";
    const transcriptText = index === 0 ? parsedDocx.parsedText : `# 访谈 ${index + 1}\n访谈员：你最看重什么？\n受访者：${city}的服务响应很重要，产品可靠性让我愿意继续使用。\n访谈员：有没有不同看法？\n受访者：${index === 9 ? "我反而认为价格不是问题，学习成本才是阻力。" : "价格偏高会让我犹豫，但售后保障能降低顾虑。"}\n唯一原文标记_${index}`;
    const file = { id: `file-${index}`, project_id: project.id, file_name: `访谈${String(index + 1).padStart(2, "0")}.${index === 0 ? "docx" : "txt"}`, category: "interview", parse_status: "completed", parsed_text: transcriptText, created_at: new Date().toISOString(), updated_at: `2026-08-31T00:00:${String(index).padStart(2, "0")}Z` };
    files.push(file);
    const transcript = await syncTranscriptFromFile({ store, projectId: project.id, file });
    await store.updateTranscript(project.id, transcript.id, { interview_type: index < 2 ? "expert" : "consumer", respondent_label: `受访者${index + 1}`, respondent_metadata: { city, segment } });
  }
  const failedFile = { id: "file-failed", project_id: project.id, file_name: "损坏访谈.docx", category: "interview", parse_status: "failed", parsed_text: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const failedTranscript = await syncTranscriptFromFile({ store, projectId: project.id, file: failedFile });
  assert.equal(failedTranscript.status, "failed", "one broken interview must not block the other transcripts");

  const transcripts = (await store.listTranscripts(project.id)).filter((item) => item.status === "ready");
  assert.equal(transcripts.length, 10);
  assert.ok(transcripts.every((item) => item.segment_count > 0));
  assert.ok(segmentTranscriptText("主持人：问题\n受访者：回答").every((item) => Number.isInteger(item.start_offset) && item.end_offset >= item.start_offset));

  const summaryTarget = transcripts.find((item) => item.file_id === "file-9");
  const summarySegments = await store.listTranscriptSegments(project.id, summaryTarget.id);
  const summaryPrompt = buildTranscriptDeepSummaryPrompt({ transcript: summaryTarget, segments: summarySegments, maxSourceChars: 12_000, targetChars: 2_000 });
  assert.match(summaryPrompt, /重要 Segment 索引/);
  assert.match(summaryPrompt, new RegExp(`segment:${summarySegments[0].id}`));
  assert.match(summaryPrompt, /不是最终证据/);
  let summaryGenerationCalls = 0;
  const generatedSummary = await generateTranscriptDeepSummary({ store, projectId: project.id, transcriptId: summaryTarget.id, model: "newapi/deepseek-v4-flash", generate: async () => { summaryGenerationCalls += 1; return "## 受访者背景与情境\n\n该受访者来自成都，属于低频用户，讨论重点围绕服务响应、产品可靠性、价格与学习成本。\n\n## 核心观点与决策机制\n\n受访者认可快速服务和可靠产品对持续使用的作用，但与多数强调价格的受访者不同，其主要阻力是学习成本。这一差异适合作为跨访谈分析中的反例线索。\n\n## 主要问题、需求与态度\n\n受访者需要更低的上手门槛和明确的使用引导，对价格本身的敏感度相对较低。以上为研究者归纳，仍需回查原文。\n\n## 重要 Segment 索引\n\n核心判断对应输入中的服务、价格和学习成本 Segment；后续引用必须按 Segment ID 读取原文。\n\n## 证据边界\n\n摘要仅用于导航，不代表样本总体，也不作为直接引语证据。"; } });
  assert.equal(generatedSummary.transcript.summary_status, "ready");
  assert.equal(generatedSummary.transcript.summary_source_fingerprint, generatedSummary.transcript.source_fingerprint);
  assert.equal(generatedSummary.transcript.summary_model, "newapi/deepseek-v4-flash");
  const cachedSummary = await generateTranscriptDeepSummary({ store, projectId: project.id, transcriptId: summaryTarget.id, generate: async () => { summaryGenerationCalls += 1; return "不应重复生成"; } });
  assert.equal(cachedSummary.cached, true);
  assert.equal(summaryGenerationCalls, 1, "unchanged source must reuse the cached deep summary");

  const filtered = await transcriptSearch({ store, projectId: project.id, query: "服务 响应", filters: { city: "上海", interview_type: "consumer" }, limit: 20 });
  assert.ok(filtered.matches.length > 0);
  assert.ok(filtered.matches.every((item) => item.respondent_metadata.city === "上海" && item.interview_type === "consumer"));
  assert.ok(filtered.matches.length <= 20);
  const candidate = filtered.matches[0];
  const context = await transcriptRead({ store, projectId: project.id, transcriptId: candidate.transcript_id, segmentId: candidate.segment_id, contextBefore: 2, contextAfter: 2 });
  assert.ok(context.segments.some((item) => item.is_target));
  assert.ok(context.segments.length <= 5);
  await assert.rejects(transcriptRead({ store, projectId: foreign.id, transcriptId: candidate.transcript_id, segmentId: candidate.segment_id }), (error) => error.code === "TRANSCRIPT_NOT_FOUND");

  const transcriptsWithSummary = (await store.listTranscripts(project.id)).filter((item) => item.status === "ready");
  const prompt = enhanceQualitativeAnalysisPrompt({ basePrompt: "项目基础信息", message: "比较不同城市的购买阻力，识别共识、差异和反例", transcripts: transcriptsWithSummary, failedFiles: [failedFile], maxChars: 80_000 });
  assert.ok(prompt.length < 80_000);
  assert.match(prompt, /共识、群体差异、关键少数与反例/);
  assert.match(prompt, /transcript_search/);
  assert.match(prompt, /最多调用 3 次 transcript_search、5 次 transcript_read/);
  assert.match(prompt, /禁止按受访者逐份检索/);
  assert.match(prompt, /缓存单访谈深度摘要/);
  assert.match(prompt, /学习成本/);
  assert.doesNotMatch(prompt, /唯一原文标记_9/, "raw transcript content must not be inserted into the model prompt");
  const invalidatedSummary = await syncTranscriptFromFile({ store, projectId: project.id, file: { ...files[9], parsed_text: `${files[9].parsed_text}\n受访者：补充了新的使用情境。`, updated_at: "2026-08-31T01:00:09Z" } });
  assert.equal(invalidatedSummary.summary_status, "pending", "source changes must invalidate the model-generated cache");
  assert.equal(invalidatedSummary.deep_summary, "");

  const quotedSegment = (await store.listTranscriptSegments(project.id, candidate.transcript_id)).find((item) => item.id === candidate.segment_id);
  const exactQuote = quotedSegment.content.split("\n")[0].slice(0, 120);
  const reply = `# 多访谈定性分析\n\n### 服务与信任\n多个受访者把响应速度和保障视为信任来源。\n\n> “${exactQuote}” [segment:${quotedSegment.id}]\n\n### 价格与学习成本的反例\n主流顾虑是价格，但低频用户中也存在“学习成本优先”的关键少数，不能把价格解释为唯一阻力。\n\n> “这条原声是模型编造的” [segment:${quotedSegment.id}]`;
  const first = await finalizeQualitativeAnalysis({ store, projectId: project.id, projectTitle: project.title, reply, transcripts, failedFiles: [failedFile] });
  assert.equal(first.artifact.type, "qualitative_analysis");
  assert.equal(first.artifact.version, 1);
  assert.equal(first.quality.verified_quote_count, 1);
  assert.equal(first.quality.invalid_quote_count, 1);
  assert.match(first.artifact.content, new RegExp(exactQuote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(first.artifact.content, /这条原声是模型编造的/);
  assert.match(first.artifact.content, /损坏访谈\.docx/);
  assert.equal(first.evidence[0].source_type, "transcript_segment");
  assert.ok(first.insights.length >= 1);

  const second = await finalizeQualitativeAnalysis({ store, projectId: project.id, projectTitle: project.title, reply: `### 服务与信任\n修订结论。\n\n> “${exactQuote}” [segment:${quotedSegment.id}]`, parentArtifactId: first.artifact.id, transcripts, failedFiles: [] });
  assert.equal(second.artifact.version, 2);
  assert.equal(second.artifact.parent_artifact_id, first.artifact.id);

  const quotes = await finalizeQuoteSearch({ store, projectId: project.id, reply: `> “${exactQuote}” [segment:${quotedSegment.id}]`, transcripts });
  assert.equal(quotes.evidence.length, 1);
  assert.equal(quotes.evidence[0].value.includes("find_quotes"), true);

  const handlerProject = await store.createProject("owner-a", { client_project_id: "qual-handler", title: "服务体验访谈", research_goal: "识别服务信任的形成机制" });
  for (let index = 0; index < 2; index += 1) {
    const created = await store.createFile("owner-a", handlerProject.id, { id: `handler-file-${index}`, file_name: `服务访谈${index + 1}.txt`, file_type: "txt", mime_type: "text/plain", file_size: 100, category: "interview", storage_path: `unused/${index}.txt` });
    await store.updateFile(handlerProject.id, created.id, { parse_status: "completed", parsed_text: `访谈员：为什么信任服务？\n受访者：服务响应快让我愿意继续使用，编号${index}。`, summary: "已解析", parse_note: "" });
  }
  const harnessCalls = [];
  const summaryHarnessCalls = [];
  const harnessAdapter = {
    isConfigured: () => true,
    createSession: async () => "qualitative-handler-session",
    async sendMessage(options) {
      harnessCalls.push(options);
      const ready = (await store.listTranscripts(handlerProject.id)).filter((item) => item.status === "ready");
      const segment = (await store.listTranscriptSegments(handlerProject.id, ready[0].id))[1] || (await store.listTranscriptSegments(handlerProject.id, ready[0].id))[0];
      options.onToolStatus?.({ tool_id: "transcript_search", status: "completed", label: "访谈原声检索", message: "访谈原声检索完成" });
      options.onToolStatus?.({ tool_id: "transcript_read", status: "completed", label: "访谈上下文回查", message: "原声上下文回查完成" });
      await store.createToolResult("owner-a", handlerProject.id, "transcript-search", { query: "服务信任" }, { matches: [{ transcript_id: ready[0].id, segment_id: segment.id }] }, { source: "agent", agent_call_id: `handler-search-${harnessCalls.length}` });
      await store.createToolResult("owner-a", handlerProject.id, "transcript-read", { transcript_id: ready[0].id, segment_id: segment.id }, { segments: [{ id: segment.id, content: segment.content }] }, { source: "agent", agent_call_id: `handler-read-${harnessCalls.length}` });
      return `### 服务响应建立信任\n受访者把快速响应与继续使用联系起来。\n\n> “${segment.content}” [segment:${segment.id}]\n\n### 差异与反例\n当前材料中没有足够反例，应在后续招募中主动验证。`;
    },
  };
  const transcriptSummaryHarnessAdapter = {
    isConfigured: () => true,
    createSession: async () => "transcript-summary-session",
    async sendMessage(options) { summaryHarnessCalls.push(options); return "## 受访者背景与情境\n\n受访者讨论服务响应和持续使用意愿，当前 Metadata 信息有限。\n\n## 核心观点与决策机制\n\n快速响应能够降低不确定性，并增强继续使用的意愿；这是基于当前单篇访谈内容形成的导航性归纳。\n\n## 主要问题、需求与态度\n\n受访者重视及时服务，对服务可靠性持积极态度。需要在跨访谈阶段继续比较不同受访者的差异和反例。\n\n## 典型案例与重要 Segment 索引\n\n服务响应与持续使用的关联应回到输入中的真实 Segment 进一步核验，不在缓存摘要中形成逐字引语。\n\n## 证据边界\n\n本摘要不构成最终证据，任何结论与引用必须通过 transcript_search 和 transcript_read 回查原始 Segment。"; },
  };
  const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: "owner-a", RESEARCH_AI_REQUESTS_PER_MINUTE: "100", HARNESS_MAX_QUALITATIVE_TOOL_CALLS: "10", HARNESS_TRANSCRIPT_SUMMARY_MODEL_PROVIDER: "newapi", HARNESS_TRANSCRIPT_SUMMARY_MODEL: "deepseek-v4-flash" }, store, harnessAdapter, transcriptSummaryHarnessAdapter, logger: { log() {}, error() {} } });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/research/projects/${handlerProject.id}`;
  try {
    const send = async (body) => { const response = await fetch(`${base}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { response, payload: await response.json() }; };
    let response = await send({ message: "比较两位受访者如何形成服务信任，并说明差异与反例。", task_type: "qualitative_analysis", client_request_id: "qual-handler-v1" });
    assert.equal(response.response.status, 200);
    assert.equal(response.payload.workflow.status, "completed");
    assert.equal(response.payload.workflow.task_type, "qualitative_analysis");
    assert.equal(response.payload.artifact_created.version, 1);
    assert.deepEqual(harnessCalls[0].allowedResearchTools, ["transcript_search", "transcript_read"]);
    assert.equal(harnessCalls[0].maxToolCalls, 8);
    assert.deepEqual(harnessCalls[0].toolBudgets, { transcript_search: 3, transcript_read: 5 });
    assert.equal(response.payload.applied_context.raw_transcript_chars_in_prompt, 0);
    assert.equal(response.payload.applied_context.transcript_deep_summary_ready_count, 0);
    assert.doesNotMatch(harnessCalls[0].prompt, /编号0/, "handler prompt must use transcript metadata/cache rather than raw text");
    const handlerTranscript = (await store.listTranscripts(handlerProject.id)).find((item) => item.file_id === "handler-file-0");
    let summaryResponse = await fetch(`${base}/transcripts/${handlerTranscript.id}/summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(summaryResponse.status, 200);
    let summaryPayload = await summaryResponse.json();
    assert.equal(summaryPayload.transcript.summary_status, "ready");
    assert.equal(summaryPayload.cached, false);
    assert.equal(summaryHarnessCalls[0].forbidTools, true);
    summaryResponse = await fetch(`${base}/transcripts/${handlerTranscript.id}/summary`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    summaryPayload = await summaryResponse.json();
    assert.equal(summaryPayload.cached, true);
    assert.equal(summaryHarnessCalls.length, 1, "summary endpoint must reuse a ready cache");
    const v1 = response.payload.artifact_created;
    response = await send({ message: "保留原结论，补充材料边界。", task_type: "artifact_revision", artifact_id: v1.id, client_request_id: "qual-handler-v2" });
    assert.equal(response.payload.artifact_created.version, 2);
    assert.equal(response.payload.artifact_created.parent_artifact_id, v1.id);
    response = await send({ message: "生成这份访谈的单篇小结。", task_type: "interview_summary", selected_file_ids: ["handler-file-0"], client_request_id: "qual-handler-single-v1" });
    assert.equal(response.payload.artifact_created.type, "interview_summary");
    assert.equal(response.payload.artifact_created.version, 1);
    assert.equal(response.payload.applied_context.transcript_count, 1);
    const summaryV1 = response.payload.artifact_created;
    response = await send({ message: "补充与项目目标的关联。", task_type: "artifact_revision", artifact_id: summaryV1.id, selected_file_ids: ["handler-file-0"], client_request_id: "qual-handler-single-v2" });
    assert.equal(response.payload.artifact_created.version, 2);
    assert.equal(response.payload.artifact_created.parent_artifact_id, summaryV1.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log("qualitative-analysis-workflow-smoke: PASS (core evidence + handler workflow)");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
