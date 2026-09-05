import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { inspectQualitativeSummaryTemplate, qualitativeExcelInternals } from "../lib/qualitative-excel.mjs";

const require = createRequire(import.meta.url);
const { createResearchHandler } = require("../lib/research-handler.js");
const { createJsonResearchStore } = require("../lib/research-store.js");
const { createLocalResearchFileStorage } = require("../lib/research-file-storage.js");
const encoder = new TextEncoder();
const sheetRows = [1, 2].map((sequence, index) => `<row r="${index + 3}"><c r="A${index + 3}" t="inlineStr"><is><t>模块</t></is></c><c r="B${index + 3}" t="inlineStr"><is><t>关注</t></is></c><c r="C${index + 3}"><v>${sequence}</v></c><c r="D${index + 3}" t="inlineStr"><is><t>问题${sequence}</t></is></c>${["E", "F", "G", "H", "I"].map((column) => `<c r="${column}${index + 3}" s="1" t="inlineStr"><is><t>旧内容</t></is></c>`).join("")}</row>`).join("");
const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I4"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>小结框架</t></is></c>${["E", "F", "G", "H", "I"].map((column, index) => `<c r="${column}1" t="inlineStr"><is><t>用户${index + 1}</t></is></c>`).join("")}</row><row r="2"><c r="A2" t="inlineStr"><is><t>模块</t></is></c><c r="B2" t="inlineStr"><is><t>重点关注</t></is></c><c r="C2" t="inlineStr"><is><t>序号</t></is></c><c r="D2" t="inlineStr"><is><t>问题设置</t></is></c>${["E", "F", "G", "H", "I"].map((column) => `<c r="${column}2" t="inlineStr"><is><t>旧姓名</t></is></c>`).join("")}</row>${sheetRows}</sheetData></worksheet>`;
const templateBytes = qualitativeExcelInternals.writeZip(new Map([
  ["[Content_Types].xml", encoder.encode(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)],
  ["_rels/.rels", encoder.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
  ["xl/workbook.xml", encoder.encode(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="用户访谈小结" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
  ["xl/_rels/workbook.xml.rels", encoder.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
  ["xl/worksheets/sheet1.xml", encoder.encode(sheetXml)],
]));

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-qual-excel-"));
const env = { RESEARCH_DEV_USER_ID: "owner", RESEARCH_DATA_FILE: path.join(temp, "research.json"), RESEARCH_FILES_DIR: path.join(temp, "files"), RESEARCH_AI_REQUESTS_PER_MINUTE: "100" };
const store = createJsonResearchStore(env);
const storage = createLocalResearchFileStorage(env);
const project = await store.createProject("owner", { title: "集成测试", client_project_id: "project" });
const template = await inspectQualitativeSummaryTemplate(templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength));
const templatePath = storage.key(project.id, "template", "xlsx");
await storage.put(templatePath, templateBytes);
await store.createFile("owner", project.id, { id: "template", file_name: "客户访谈小结模板.xlsx", file_type: "xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file_size: templateBytes.byteLength, category: "other", storage_path: templatePath });
await store.updateFile(project.id, "template", { parse_status: "completed", parsed_text: "模板", structured_data: JSON.stringify(template) });
const interviewPath = storage.key(project.id, "interview", "txt");
await storage.put(interviewPath, encoder.encode("访谈正文"));
await store.createFile("owner", project.id, { id: "interview", file_name: "张三访谈.txt", file_type: "txt", mime_type: "text/plain", file_size: 12, category: "interview", storage_path: interviewPath });
await store.updateFile(project.id, "interview", { parse_status: "completed", parsed_text: "受访者张三表示交通很重要。" });

const harnessAdapter = {
  isConfigured: () => true,
  createSession: async () => "session",
  sendMessage: async ({ prompt, forbidTools }) => {
    assert.equal(forbidTools, true);
    assert.match(prompt, /问题1/);
    return JSON.stringify({ respondents: [{ interview_id: "interview", name: "张三", items: [{ sequence: 1, coverage: "covered", summary: "• 重视交通\n“交通很重要”", evidence_refs: ["第1段"] }, { sequence: 2, coverage: "not_covered", summary: "本次访谈未涉及", evidence_refs: [] }] }] });
  },
};
const handler = createResearchHandler({ env, store, fileStorage: storage, harnessAdapter, logger: { log() {}, error() {} } });

async function request(method, url, payload) {
  const input = payload == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload));
  const req = Readable.from(input.length ? [input] : []); req.method = method; req.url = url; req.headers = { "content-type": "application/json", "x-request-id": "qual-excel-test-123" };
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = { headersSent: false, writeHead(status, headers = {}) { this.status = status; this.headers = headers; this.headersSent = true; }, end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); resolve({ status: this.status || 200, headers: this.headers || {}, body: Buffer.concat(chunks) }); }, write(chunk) { chunks.push(Buffer.from(chunk)); return true; }, destroy: reject };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

try {
  const response = await request("POST", "/api/research/projects/project/messages", { message: "生成 Excel 小结", task_type: "qualitative_excel_summary", selected_file_ids: ["template", "interview"], auto_retrieve: false, client_request_id: "request-1" });
  assert.equal(response.status, 200, response.body.toString());
  const payload = JSON.parse(response.body.toString());
  assert.equal(payload.generated_file.file_type, "xlsx");
  assert.match(payload.reply, /1 位受访者、2 个问题/);
  const download = await request("GET", `/api/research/projects/project/files/${payload.generated_file.id}/download`);
  assert.equal(download.status, 200);
  assert.match(String(download.headers["Content-Disposition"] || download.headers["content-disposition"]), /attachment/);
  const outputTemplate = await inspectQualitativeSummaryTemplate(download.body.buffer.slice(download.body.byteOffset, download.body.byteOffset + download.body.byteLength));
  assert.equal(outputTemplate.question_count, 2);
  const savedFiles = await store.listFiles(project.id);
  assert.equal(savedFiles.filter((file) => file.id !== "template" && file.id !== "interview").length, 1);
  assert.equal(JSON.parse(savedFiles.find((file) => file.id === payload.generated_file.id).structured_data).kind, "qualitative_excel_output");
  console.log("qualitative excel handler smoke passed");
} finally { await fs.rm(temp, { recursive: true, force: true }); }
