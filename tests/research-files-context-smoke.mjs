import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { buildProjectContext, contextLimitsFromEnv, normalizeInterviewGuideFormatting } from "../lib/project-context.mjs";

const root = path.resolve(import.meta.dirname, "..");
const qualitativeMigration = fs.readFileSync(path.join(root, "migrations", "0007_qualitative_summary_artifacts.sql"), "utf8");
assert.match(qualitativeMigration, /'qualitative_summary'/);
assert.match(qualitativeMigration, /parent_artifact_id TEXT REFERENCES research_artifacts_v2/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-files-"));
const dataFile = path.join(temp, "research.json");
const filesDir = path.join(temp, "files");
const children = []; const prompts = []; const harnessPayloads = [];

const bounded = buildProjectContext({
  project: { title: "预算测试", brief: "背景", research_goal: "目标" },
  files: [{ id: "long-file", file_name: "long.txt", category: "brief", parse_status: "completed", summary: "摘要", parsed_text: "长内容".repeat(20_000) }],
  artifact: { id: "artifact", title: "长成果", type: "research_plan", version: 3, content: "成果内容".repeat(10_000) },
  recentMessages: Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `历史${index}`.repeat(1_000) })),
  userMessage: "当前要求必须保留",
  includeRecentMessages: true,
  limits: { maxContextChars: 8_000, maxRecentMessages: 6 },
});
assert.ok(bounded.prompt.length <= 8_000);
assert.match(bounded.prompt, /当前要求必须保留/);
assert.ok(bounded.context.recent_message_count <= 6);
assert.equal(bounded.context.direct_reply_only, true);
assert.match(bounded.prompt, /仅在确需确定性计算或检查时，可调用 sample_size、quota_design、questionnaire_check/);

const questionnaire = buildProjectContext({ project: { title: "问卷测试" }, userMessage: "设计定量问卷", taskType: "questionnaire" });
assert.equal(questionnaire.context.direct_reply_only, true);
assert.match(questionnaire.prompt, /完整、可编程的问卷/);
assert.match(questionnaire.prompt, /skill、bash、write/);
assert.doesNotMatch(questionnaire.prompt, /不得使用问卷式字母数字题号/);

const interviewGuide = buildProjectContext({ project: { title: "访谈测试" }, userMessage: "设计访谈大纲", taskType: "interview_guide" });
assert.equal(interviewGuide.context.direct_reply_only, true);
assert.match(interviewGuide.prompt, /不得使用问卷式字母数字题号（如 A1、A2、B1）/);
assert.match(interviewGuide.prompt, /一级章节保留中文序号（一、二、三…）或“环节1、环节2…”/);
assert.match(interviewGuide.prompt, /二级模块禁止使用 1-1、4-2、1\.1 等编号，统一以“• ”开头/);
assert.match(interviewGuide.prompt, /具体追问统一以“- ”开头/);
assert.match(interviewGuide.prompt, /避免多层数字编号造成阅读负担/);
assert.match(interviewGuide.prompt, /贴近研究员实际执行访谈时使用的提纲，而不是论文目录或考试题/);

const revisedInterviewGuide = buildProjectContext({ project: { title: "访谈测试" }, artifact: { id: "guide-v1", title: "访谈大纲", type: "interview_guide", version: 1, content: "旧版大纲" }, userMessage: "基于此版本派生", taskType: "artifact_revision" });
assert.match(revisedInterviewGuide.prompt, /不得使用问卷式字母数字题号（如 A1、A2、B1）/);
assert.match(revisedInterviewGuide.prompt, /二级模块禁止使用 1-1、4-2、1\.1 等编号，统一以“• ”开头/);

const revisedResearchPlan = buildProjectContext({ project: { title: "方案测试" }, artifact: { id: "plan-v1", title: "调研方案", type: "research_plan", version: 1, content: "旧版方案" }, userMessage: "基于此版本派生", taskType: "artifact_revision" });
assert.doesNotMatch(revisedResearchPlan.prompt, /不得使用问卷式字母数字题号/);

const qualitativeLimits = contextLimitsFromEnv({ RESEARCH_MAX_CONTEXT_CHARS: "8000" }, "qualitative_summary");
assert.equal(qualitativeLimits.total, 80_000);
assert.equal(qualitativeLimits.fileExcerpt, 20_000);
const qualitative = buildProjectContext({
  project: { title: "定性测试", research_goal: "理解售后体验" },
  files: [{ id: "interview-1", file_name: "受访者01.txt", category: "interview", parse_status: "completed", summary: "售后访谈", parsed_text: `${"逐字稿内容".repeat(3_000)}\n深部证据标记` }],
  userMessage: "生成定性小结",
  taskType: "qualitative_summary",
  limits: qualitativeLimits,
});
assert.equal(qualitative.context.qualitative_summary, true);
assert.equal(qualitative.context.direct_reply_only, true);
assert.ok(qualitative.prompt.length > 8_000, "定性任务应获得独立的大文本预算");
assert.match(qualitative.prompt, /深部证据标记/);
assert.match(qualitative.prompt, /不得补造受访者、观点、频次或原话/);
assert.match(qualitative.prompt, /\[文件名｜受访者\/位置\]/);
assert.match(qualitative.prompt, /不得把定性材料伪装成总体比例/);
assert.match(qualitative.prompt, /不得调用任何专业计算或问卷检查工具/);

const normalizedGuide = normalizeInterviewGuideFormatting([
  "一、开场与破冰",
  "1-1 开场说明",
  "  4-2、核心体验",
  "1.3:决策因素",
  "1、4 复购意愿",
  "- 具体追问",
  "8-10分钟",
  "1-2个月",
  "Top1-2",
  "2025-2026",
].join("\n"));
assert.equal(normalizedGuide, [
  "一、开场与破冰",
  "• 开场说明",
  "• 核心体验",
  "• 决策因素",
  "• 复购意愿",
  "- 具体追问",
  "8-10分钟",
  "1-2个月",
  "Top1-2",
  "2025-2026",
].join("\n"));

const freeChat = buildProjectContext({ project: { title: "问答测试" }, userMessage: "解释样本量", taskType: "free_chat" });
assert.equal(freeChat.context.direct_reply_only, false);
assert.match(freeChat.prompt, /仅在确需确定性计算或检查时，可调用 sample_size、quota_design、questionnaire_check/);

function listen(server) { return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server.address().port)); }); }
function freePort() { const server = http.createServer(); return listen(server).then((port) => new Promise((resolve) => server.close(() => resolve(port)))); }
function ready(child) { return new Promise((resolve, reject) => { let output = ""; const timer = setTimeout(() => reject(new Error(output || "server timeout")), 10_000); const onData = (chunk) => { output += chunk; if (output.includes("Research toolbox running")) { clearTimeout(timer); resolve(); } }; child.stdout.on("data", onData); child.stderr.on("data", onData); child.once("exit", (code) => reject(new Error(`server exited ${code}: ${output}`))); }); }
async function start(user, harnessUrl) { const port = await freePort(); const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), RESEARCH_DEV_USER_ID: user, RESEARCH_DATA_FILE: dataFile, RESEARCH_FILES_DIR: filesDir, HARNESS_BASE_URL: harnessUrl, HARNESS_API_KEY: "secret", RESEARCH_MAX_CONTEXT_CHARS: "8000", RESEARCH_AI_REQUESTS_PER_MINUTE: "100" } }); children.push(child); await ready(child); return `http://127.0.0.1:${port}`; }
async function api(base, route, options = {}) { const response = await fetch(base + route, options); const payload = response.status === 204 ? null : await response.json(); return { response, payload }; }
const post = (base, route, value) => api(base, route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

function write16(array, value) { array.push(value & 255, (value >>> 8) & 255); }
function write32(array, value) { array.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function officeZip(entries) {
  const output = []; const central = []; const encoder = new TextEncoder();
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name); const data = typeof content === "string" ? encoder.encode(content) : content; const compressed = new Uint8Array(deflateRawSync(data)); const offset = output.length;
    write32(output, 0x04034b50); write16(output, 20); write16(output, 0); write16(output, 8); write16(output, 0); write16(output, 0); write32(output, 0); write32(output, compressed.length); write32(output, data.length); write16(output, nameBytes.length); write16(output, 0); output.push(...nameBytes, ...compressed);
    write32(central, 0x02014b50); write16(central, 20); write16(central, 20); write16(central, 0); write16(central, 8); write16(central, 0); write16(central, 0); write32(central, 0); write32(central, compressed.length); write32(central, data.length); write16(central, nameBytes.length); write16(central, 0); write16(central, 0); write16(central, 0); write16(central, 0); write32(central, 0); write32(central, offset); central.push(...nameBytes);
  }
  const centralOffset = output.length; output.push(...central); write32(output, 0x06054b50); write16(output, 0); write16(output, 0); write16(output, Object.keys(entries).length); write16(output, Object.keys(entries).length); write32(output, central.length); write32(output, centralOffset); write16(output, 0); return Uint8Array.from(output);
}

const fixtures = [
  ["brief.txt", "text/plain", new TextEncoder().encode("客户Brief：年轻用户流失主要发生在售后阶段。")],
  ["notes.md", "text/markdown", new TextEncoder().encode("# 访谈记录\n用户希望提升维修透明度。")],
  ["brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", officeZip({ "word/document.xml": '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>DOCX客户背景</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>指标</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>NPS</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' })],
  ["data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", officeZip({ "xl/workbook.xml": '<workbook><sheets><sheet name="raw_data" r:id="rId1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', "xl/worksheets/sheet1.xml": '<worksheet><dimension ref="A1:C3"/><sheetData><row><c r="A1" t="inlineStr"><is><t>respondent_id</t></is></c><c r="B1" t="inlineStr"><is><t>age</t></is></c><c r="C1" t="inlineStr"><is><t>nps</t></is></c></row><row><c r="A2"><v>1</v></c><c r="B2"><v>24</v></c><c r="C2"><v>9</v></c></row></sheetData></worksheet>' })],
  ["report.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", officeZip({ "ppt/slides/slide1.xml": '<p:sld xmlns:p="p" xmlns:a="a"><a:t>NPS历史报告</a:t><a:t>售后体验是主要短板</a:t></p:sld>' })],
  ["layer.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Length 38 >>\nstream\nBT (PDF text layer insight) Tj ET\nendstream\nendobj\n%%EOF")],
];

async function upload(base, projectId, name, mime, bytes, category = "other") { return api(base, `/api/research/projects/${projectId}/files`, { method: "POST", headers: { "Content-Type": mime, "X-Research-File-Name": encodeURIComponent(name), "X-Research-File-Category": category }, body: bytes }); }
async function waitForFiles(base, projectId, count) { for (let attempt = 0; attempt < 100; attempt += 1) { const result = await api(base, `/api/research/projects/${projectId}/files`); if (result.payload.files.length === count && result.payload.files.every((file) => !["pending", "processing"].includes(file.parse_status))) return result.payload.files; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("file parsing timeout"); }

const numberedReply = "一、核心章节\n1-1 使用体验\n- 具体追问\n时长：8-10分钟\n周期：1-2个月\n排序：Top1-2\n年份：2025-2026";
const qualitativeReply = "一、执行小结\n维修进度透明度是当前最明确的体验缺口。\n\n二、核心主题\n发现：用户需要可预期的维修状态。\n证据：‘我不知道修到哪一步了。’[notes.md｜访谈记录]\n差异：现有材料不足以判断人群差异。\n解释：等待过程缺少状态反馈。\n\n三、共识与分歧\n材料仅包含一位受访者，暂不判断共识。\n\n四、痛点、需求及机会\n提供维修节点通知。\n\n五、代表性原话\n‘我不知道修到哪一步了。’[notes.md｜访谈记录]\n\n六、研究启示与行动建议\n优先验证进度通知方案。\n\n七、证据边界\n仅依据当前选中的一份访谈记录，不代表总体。";
const harness = http.createServer((req, res) => { let raw = ""; req.on("data", (chunk) => raw += chunk); req.on("end", () => { const payload = raw ? JSON.parse(raw) : {}; if (req.url === "/session") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "files-session" })); return; } if (/\/message$/.test(req.url)) { harnessPayloads.push(payload); const prompt = payload.parts[0].text; prompts.push(prompt); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ parts: [{ type: "text", text: prompt.includes("当前任务：基于选定的定性材料") ? qualitativeReply : numberedReply }] })); return; } res.writeHead(404).end(); }); });

try {
  const harnessPort = await listen(harness); const base = await start("owner-a", `http://127.0.0.1:${harnessPort}`);
  let result = await api(base, "/api/research/projects/files-project/files", { method: "OPTIONS" }); assert.match(result.response.headers.get("access-control-allow-headers") || "", /X-Research-File-Name/i);
  result = await post(base, "/api/research/projects", { title: "文件上下文项目", brief: "基础背景", research_goal: "找到提升机会", client_project_id: "files-project" }); assert.equal(result.response.status, 201);
  for (const [name, mime, bytes] of fixtures) { result = await upload(base, "files-project", name, mime, bytes, name === "brief.txt" ? "brief" : name === "notes.md" ? "interview" : "other"); assert.equal(result.response.status, 201, name); assert.equal(result.payload.file.parse_status, "pending"); assert.ok(!("storage_path" in result.payload.file)); }
  const files = await waitForFiles(base, "files-project", fixtures.length); assert.ok(files.every((file) => file.parse_status === "completed"), JSON.stringify(files));
  const byName = Object.fromEntries(files.map((file) => [file.file_name, file]));
  for (const [name, expected] of [["brief.docx", "DOCX客户背景"], ["data.xlsx", "raw_data"], ["report.pptx", "NPS历史报告"], ["layer.pdf", "PDF text layer insight"]]) { result = await api(base, `/api/research/projects/files-project/files/${byName[name].id}`); assert.match(result.payload.file.preview + result.payload.file.summary, new RegExp(expected)); assert.ok(!JSON.stringify(result.payload).includes(filesDir)); }
  result = await api(base, `/api/research/projects/files-project/files/${byName["data.xlsx"].id}/structure`); assert.equal(result.payload.structure.kind, "xlsx_workbook"); assert.deepEqual(result.payload.structure.sheets[0].fields, ["respondent_id", "age", "nps"]);
  result = await api(base, "/api/research/projects/files-project/memory/search?q=%E5%94%AE%E5%90%8E%E4%BD%93%E9%AA%8C"); assert.equal(result.response.status, 200); assert.ok(result.payload.matches.some((match) => /brief|report/.test(match.file_name)));
  result = await post(base, `/api/research/projects/files-project/files/${byName["layer.pdf"].id}/ocr`, {}); assert.equal(result.response.status, 503); assert.equal(result.payload.error.type, "ocr_not_configured");
  result = await upload(base, "files-project", "secret.txt", "text/plain", new TextEncoder().encode("UNSELECTED_SECRET_MATERIAL")); assert.equal(result.response.status, 201); const allFiles = await waitForFiles(base, "files-project", fixtures.length + 1); const selected = allFiles.find((file) => file.file_name === "brief.txt");
  result = await post(base, "/api/research/projects/files-project/messages", { message: "基于选中文件设计方案", selected_file_ids: [selected.id], task_type: "research_plan", client_request_id: "files-context-request" }); assert.equal(result.response.status, 200); assert.equal(result.payload.applied_context.selected_files.length, 1); assert.ok(prompts.at(-1).length <= 8000); assert.match(prompts.at(-1), /年轻用户流失主要发生在售后阶段/); assert.doesNotMatch(prompts.at(-1), /UNSELECTED_SECRET_MATERIAL/); assert.match(prompts.at(-1), /基于选中文件设计方案/); assert.match(result.payload.artifact_created.content, /^1-1 使用体验$/m, "调研方案正文不得套用访谈大纲格式化"); assert.match(result.payload.reply, /调研方案已经完成并保存/);
  result = await post(base, "/api/research/projects/files-project/messages", { message: "请查找 UNSELECTED_SECRET_MATERIAL", auto_retrieve: true, client_request_id: "memory-context-request" }); assert.equal(result.response.status, 200); assert.equal(result.payload.applied_context.retrieved_chunks.length, 1); assert.match(prompts.at(-1), /【自动检索的项目记忆】/); assert.match(prompts.at(-1), /UNSELECTED_SECRET_MATERIAL/);
  result = await post(base, "/api/research/projects/files-project/messages", { message: "设计访谈大纲", task_type: "interview_guide", client_request_id: "interview-guide-format-request" }); assert.equal(result.response.status, 200); assert.match(result.payload.reply, /^• 使用体验$/m); assert.doesNotMatch(result.payload.reply, /^1-1 /m); assert.match(result.payload.reply, /时长：8-10分钟\n周期：1-2个月\n排序：Top1-2\n年份：2025-2026/);
  const qualitativePayloadIndex = harnessPayloads.length;
  result = await post(base, "/api/research/projects/files-project/messages", { message: "生成定性小结", selected_file_ids: [byName["notes.md"].id], task_type: "qualitative_summary", auto_retrieve: false, client_request_id: "qualitative-summary-request" });
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.applied_context.qualitative_summary, true);
  assert.equal(result.payload.applied_context.selected_files[0].name, "notes.md");
  assert.deepEqual(result.payload.tool_calls, []);
  assert.equal(result.payload.artifact_created.type, "qualitative_summary");
  assert.equal(result.payload.artifact_created.title, "文件上下文项目 定性小结");
  assert.match(result.payload.reply, /一、执行小结/);
  assert.match(result.payload.reply, /七、证据边界/);
  assert.deepEqual(harnessPayloads[qualitativePayloadIndex].tools, { "*": false }, "定性小结必须禁用 Harness 工具");
  result = await api(base, "/api/research/projects/files-project/artifacts");
  assert.ok(result.payload.artifacts.some((item) => item.type === "qualitative_summary" && item.content === qualitativeReply));
  result = await api(base, "/api/research/projects/files-project/messages"); const persistedGuide = result.payload.messages.find((item) => item.reply_to && item.content.includes("• 使用体验")); assert.ok(persistedGuide, "页面、成果保存和 Word 导出读取的持久化消息必须已标准化");
  result = await post(base, "/api/research/projects/files-project/artifacts", { type: "interview_guide", title: "访谈大纲", content: "旧版大纲" }); const guideArtifact = result.payload.artifact;
  result = await post(base, "/api/research/projects/files-project/messages", { message: "基于此版本派生", artifact_id: guideArtifact.id, task_type: "artifact_revision", client_request_id: "interview-guide-revision-format-request" }); assert.equal(result.response.status, 200); assert.match(result.payload.reply, /^• 使用体验$/m);
  result = await post(base, "/api/research/projects/files-project/artifacts", { type: "research_plan", title: "方案", content: "V1" }); const parent = result.payload.artifact; result = await post(base, "/api/research/projects/files-project/artifacts", { type: "research_plan", title: "方案", content: "V2", parent_artifact_id: parent.id }); assert.equal(result.payload.artifact.version, parent.version + 1); assert.equal(result.payload.artifact.parent_artifact_id, parent.id);
  result = await api(base, `/api/research/projects/files-project/artifacts/${result.payload.artifact.id}/compare`); assert.equal(result.response.status, 200); assert.equal(result.payload.comparison.summary.added, 1); assert.equal(result.payload.comparison.summary.removed, 1);
  result = await api(base, `/api/research/projects/files-project/files/${selected.id}`, { method: "DELETE" }); assert.equal(result.response.status, 204); result = await api(base, `/api/research/projects/files-project/files/${selected.id}`); assert.equal(result.response.status, 404);
  const other = await start("owner-b", `http://127.0.0.1:${harnessPort}`); result = await api(other, "/api/research/projects/files-project/files"); assert.equal(result.response.status, 404);
  result = await upload(base, "files-project", "evil.exe", "application/octet-stream", new Uint8Array([1, 2, 3])); assert.equal(result.response.status, 400);
  console.log("research-files-context-smoke: PASS");
} finally {
  for (const child of children) child.kill();
  await new Promise((resolve) => harness.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
