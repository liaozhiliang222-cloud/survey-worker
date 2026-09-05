import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SavWriter } from "savfilewriter";
import { loadDatasetTable, profileTable, registerRawDataset } from "../lib/data-engine.mjs";
import { parseDatasetFile, parseProjectFile, validateProjectFile } from "../lib/project-file-parser.mjs";

const sav = SavWriter.write({
  encoding: "UTF-8",
  fileLabel: "SurveyKit SAV compatibility smoke",
  sysvars: [
    { name: "respondent_id", type: 0, label: "受访者编号", printFormat: "F8.0" },
    { name: "gender", type: 0, label: "性别", printFormat: "F1.0", values: { 1: "男性", 2: "女性" } },
    { name: "nps", type: 0, label: "推荐意愿", printFormat: "F2.0" },
    { name: "city", type: 24, label: "常住城市" },
  ],
}, [
  { respondent_id: 1, gender: 1, nps: 9, city: "上海" },
  { respondent_id: 2, gender: 2, nps: 10, city: "北京" },
  { respondent_id: 3, gender: 2, nps: null, city: "广州" },
]);

assert.equal(validateProjectFile({ fileName: "survey.sav", mimeType: "application/x-spss-sav", size: sav.byteLength }).ok, true);
assert.equal(validateProjectFile({ fileName: "survey.sav", mimeType: "application/vnd.spss.sav", size: sav.byteLength }).ok, true);

const workbook = await parseDatasetFile(sav, { extension: "sav" });
assert.equal(workbook.source_format, "sav");
assert.equal(workbook.selected.rows.length, 3);
assert.deepEqual(workbook.selected.headers, ["respondent_id", "GENDER", "NPS", "CITY"]);
assert.equal(workbook.selected.rows[0].GENDER, "男性", "SPSS value labels should be used by deterministic analysis");
assert.equal(workbook.selected.rows[1].GENDER, "女性");
assert.equal(workbook.selected.rows[2].NPS, "", "system-missing values should remain missing");
assert.equal(workbook.selected.variables.find((item) => item.name === "GENDER")?.label, "性别");
assert.deepEqual(workbook.selected.variables.find((item) => item.name === "GENDER")?.value_labels, [
  { value: "1", label: "男性" },
  { value: "2", label: "女性" },
]);

const projectFile = await parseProjectFile(sav, { extension: "sav", fileName: "survey.sav" });
assert.equal(projectFile.status, "completed");
assert.equal(projectFile.structuredData.kind, "sav_dataset");
assert.equal(projectFile.structuredData.sheets[0].row_count, 3);
assert.equal(projectFile.structuredData.sheets[0].column_count, 4);
assert.equal(projectFile.structuredData.sheets[0].field_count, 4);
assert.equal(projectFile.structuredData.sheets[0].variable_count, 4);

const sourceFile = {
  id: "file-sav",
  project_id: "project-sav",
  file_name: "survey.sav",
  file_type: "sav",
  storage_key: "research/project/file-sav.sav",
};
let storedDataset = null;
const store = {
  async listDatasets() { return storedDataset ? [storedDataset] : []; },
  async createDataset(userId, projectId, input) {
    storedDataset = { ...input, id: input.id || "dataset-sav", user_id: userId, project_id: projectId, metadata: JSON.stringify(input.metadata) };
    return storedDataset;
  },
  async getFile(projectId, fileId) { return projectId === sourceFile.project_id && fileId === sourceFile.id ? sourceFile : null; },
};
const fileStorage = { async get(key) { return key === sourceFile.storage_key ? sav : null; } };

const dataset = await registerRawDataset({ store, fileStorage, userId: "user-sav", projectId: "project-sav", file: sourceFile });
assert.equal(dataset.row_count, 3);
assert.equal(dataset.column_count, 4);
assert.equal(JSON.parse(dataset.metadata).source_format, "sav");
assert.equal(JSON.parse(dataset.metadata).variables.find((item) => item.name === "GENDER").label, "性别");

const table = await loadDatasetTable({ store, fileStorage, projectId: "project-sav", dataset });
const profile = profileTable(table, dataset.id);
const genderProfile = profile.variable_summary.find((item) => item.field === "GENDER");
assert.equal(genderProfile.label, "性别");
assert.deepEqual(genderProfile.top_values, [{ value: "女性", count: 2 }, { value: "男性", count: 1 }]);

await assert.rejects(
  parseDatasetFile(new TextEncoder().encode("not a sav file").buffer, { extension: "sav" }),
  (error) => ["DATASET_SAV_INVALID", "DATASET_SAV_UNSUPPORTED"].includes(error.code) && /SAV 解析失败/.test(error.message),
);

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const researcher = fs.readFileSync(path.join(root, "src/modules/ai-researcher/index.js"), "utf8");
const cloudflare = fs.readFileSync(path.join(root, "functions/api/research/[[path]].js"), "utf8");
const migration = fs.readFileSync(path.join(root, "migrations/0013_dataset_sav_files.sql"), "utf8");
assert.match(html, /id="researchDatasetInput"[^>]*accept="\.sav,\.csv,\.xlsx"/);
assert.match(researcher, /application\/x-spss-sav/);
assert.match(researcher, /分析工具可按字段名或题目标签检索全部变量/);
assert.match(researcher, /replace\(\/\\\.\(xlsx\|csv\|sav\)\$\/i/);
assert.match(cloudflare, /\["xlsx","csv","sav"\]\.includes\(file\.file_type\)/);
assert.match(migration, /file_type IN \('docx', 'pdf', 'txt', 'md', 'xlsx', 'csv', 'sav', 'pptx'\)/);

const database = new DatabaseSync(":memory:");
for (const name of fs.readdirSync(path.join(root, "migrations")).filter((item) => /^00(?:0[1-9]|1[0-2])_.+\.sql$/.test(item)).sort()) {
  database.exec(fs.readFileSync(path.join(root, "migrations", name), "utf8"));
}
database.prepare("INSERT INTO research_projects(id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?)").run("project", "user", "SAV", "now", "now");
database.prepare("INSERT INTO research_project_files(id,project_id,user_id,file_name,file_type,mime_type,file_size,category,storage_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("file", "project", "user", "source.csv", "csv", "text/csv", 1, "data", "source", "now", "now");
database.prepare("INSERT INTO research_file_chunks(id,project_id,file_id,chunk_index,heading,content,char_count,created_at) VALUES(?,?,?,?,?,?,?,?)").run("chunk", "project", "file", 0, "字段", "结构摘要", 4, "now");
database.prepare("INSERT INTO research_datasets(id,project_id,user_id,name,source_file_id,type,status,row_count,column_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("dataset", "project", "user", "Raw", "file", "raw", "ready", 1, 1, "now", "now");
database.exec(migration);
assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_project_files").get().count, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_datasets").get().count, 1);
assert.equal(database.prepare("SELECT COUNT(*) AS count FROM research_file_chunks").get().count, 1);
assert.equal(database.prepare("SELECT source_file_id FROM research_datasets WHERE id = 'dataset'").get().source_file_id, "file");
assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
database.prepare("INSERT INTO research_project_files(id,project_id,user_id,file_name,file_type,mime_type,file_size,category,storage_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("sav-file", "project", "user", "source.sav", "sav", "application/x-spss-sav", 1, "data", "sav-source", "now", "now");

console.log("SAV dataset smoke passed: upload validation, SPSS metadata, value labels, missing values, Dataset registration and Harness profile");
