import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { buildProjectContext } from "../lib/project-context.mjs";

const root = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-files-"));
const dataFile = path.join(temp, "research.json");
const filesDir = path.join(temp, "files");
const children = []; const prompts = [];

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
assert.match(bounded.prompt, /禁止调用任何工具/);

const questionnaire = buildProjectContext({ project: { title: "问卷测试" }, userMessage: "设计定量问卷", taskType: "questionnaire" });
assert.equal(questionnaire.context.direct_reply_only, true);
assert.match(questionnaire.prompt, /完整、可编程的问卷/);
assert.match(questionnaire.prompt, /skill、bash、write/);

const freeChat = buildProjectContext({ project: { title: "问答测试" }, userMessage: "解释样本量", taskType: "free_chat" });
assert.equal(freeChat.context.direct_reply_only, false);
assert.doesNotMatch(freeChat.prompt, /禁止调用任何工具/);

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

const harness = http.createServer((req, res) => { let raw = ""; req.on("data", (chunk) => raw += chunk); req.on("end", () => { const payload = raw ? JSON.parse(raw) : {}; if (req.url === "/session") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ id: "files-session" })); return; } if (/\/message$/.test(req.url)) { prompts.push(payload.parts[0].text); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ parts: [{ type: "text", text: "context reply" }] })); return; } res.writeHead(404).end(); }); });

try {
  const harnessPort = await listen(harness); const base = await start("owner-a", `http://127.0.0.1:${harnessPort}`);
  let result = await api(base, "/api/research/projects/files-project/files", { method: "OPTIONS" }); assert.match(result.response.headers.get("access-control-allow-headers") || "", /X-Research-File-Name/i);
  result = await post(base, "/api/research/projects", { title: "文件上下文项目", brief: "基础背景", research_goal: "找到提升机会", client_project_id: "files-project" }); assert.equal(result.response.status, 201);
  for (const [name, mime, bytes] of fixtures) { result = await upload(base, "files-project", name, mime, bytes, name === "brief.txt" ? "brief" : "other"); assert.equal(result.response.status, 201, name); assert.equal(result.payload.file.parse_status, "pending"); assert.ok(!("storage_path" in result.payload.file)); }
  const files = await waitForFiles(base, "files-project", fixtures.length); assert.ok(files.every((file) => file.parse_status === "completed"), JSON.stringify(files));
  const byName = Object.fromEntries(files.map((file) => [file.file_name, file]));
  for (const [name, expected] of [["brief.docx", "DOCX客户背景"], ["data.xlsx", "raw_data"], ["report.pptx", "NPS历史报告"], ["layer.pdf", "PDF text layer insight"]]) { result = await api(base, `/api/research/projects/files-project/files/${byName[name].id}`); assert.match(result.payload.file.preview + result.payload.file.summary, new RegExp(expected)); assert.ok(!JSON.stringify(result.payload).includes(filesDir)); }
  result = await api(base, `/api/research/projects/files-project/files/${byName["data.xlsx"].id}/structure`); assert.equal(result.payload.structure.kind, "xlsx_workbook"); assert.deepEqual(result.payload.structure.sheets[0].fields, ["respondent_id", "age", "nps"]);
  result = await api(base, "/api/research/projects/files-project/memory/search?q=%E5%94%AE%E5%90%8E%E4%BD%93%E9%AA%8C"); assert.equal(result.response.status, 200); assert.ok(result.payload.matches.some((match) => /brief|report/.test(match.file_name)));
  result = await post(base, `/api/research/projects/files-project/files/${byName["layer.pdf"].id}/ocr`, {}); assert.equal(result.response.status, 503); assert.equal(result.payload.error.type, "ocr_not_configured");
  result = await upload(base, "files-project", "secret.txt", "text/plain", new TextEncoder().encode("UNSELECTED_SECRET_MATERIAL")); assert.equal(result.response.status, 201); const allFiles = await waitForFiles(base, "files-project", fixtures.length + 1); const selected = allFiles.find((file) => file.file_name === "brief.txt");
  result = await post(base, "/api/research/projects/files-project/messages", { message: "基于选中文件设计方案", selected_file_ids: [selected.id], task_type: "research_plan", client_request_id: "files-context-request" }); assert.equal(result.response.status, 200); assert.equal(result.payload.applied_context.selected_files.length, 1); assert.ok(prompts.at(-1).length <= 8000); assert.match(prompts.at(-1), /年轻用户流失主要发生在售后阶段/); assert.doesNotMatch(prompts.at(-1), /UNSELECTED_SECRET_MATERIAL/); assert.match(prompts.at(-1), /基于选中文件设计方案/);
  result = await post(base, "/api/research/projects/files-project/messages", { message: "请查找 UNSELECTED_SECRET_MATERIAL", auto_retrieve: true, client_request_id: "memory-context-request" }); assert.equal(result.response.status, 200); assert.equal(result.payload.applied_context.retrieved_chunks.length, 1); assert.match(prompts.at(-1), /【自动检索的项目记忆】/); assert.match(prompts.at(-1), /UNSELECTED_SECRET_MATERIAL/);
  result = await post(base, "/api/research/projects/files-project/artifacts", { type: "research_plan", title: "方案", content: "V1" }); const parent = result.payload.artifact; result = await post(base, "/api/research/projects/files-project/artifacts", { type: "research_plan", title: "方案", content: "V2", parent_artifact_id: parent.id }); assert.equal(result.payload.artifact.version, 2); assert.equal(result.payload.artifact.parent_artifact_id, parent.id);
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
