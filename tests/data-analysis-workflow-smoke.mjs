import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonResearchStore } from "../lib/research-store.js";
import { LocalResearchFileStorage } from "../lib/research-file-storage.js";
import { createDataToolExecutor, exportCrosstabResults, registerRawDataset } from "../lib/data-engine.mjs";
import { dataAnalysisToolPolicy, enhanceDataAnalysisPrompt, isDataAnalysisWorkflow } from "../lib/data-analysis-workflow.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-v06-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
const storage = new LocalResearchFileStorage(path.join(temporary, "files"));
const userA = "user-a"; const userB = "user-b";
const projectA = await store.createProject(userA, { title: "荣耀年轻用户NPS研究" });
const projectB = await store.createProject(userB, { title: "隔离项目" });
const projectExcel = await store.createProject(userA, { title: "Excel Profile 验证" });

async function rawDataset(project, userId, name, bytes, extension, mimeType) {
  const fileId = crypto.randomUUID(); const key = storage.key(project.id, fileId, extension);
  await storage.put(key, bytes);
  const file = await store.createFile(userId, project.id, { id: fileId, file_name: `${name}.${extension}`, file_type: extension, mime_type: mimeType, file_size: bytes.byteLength, category: "data", storage_path: key });
  await store.updateFile(project.id, file.id, { parse_status: "completed", summary: "结构摘要", parsed_text: "不含原始行", structured_data: "{}" });
  const dataset = await registerRawDataset({ store, fileStorage: storage, userId, projectId: project.id, file, name });
  return { dataset, file, bytes };
}
const rawCsvDataset = (project, userId, name, csv) => rawDataset(project, userId, name, new TextEncoder().encode(csv), "csv", "text/csv");

const rows = ["respondent_id,age,brand,NPS,duration"];
for (let index = 1; index <= 60; index += 1) rows.push(`${index},18-24,荣耀,10,120`);
for (let index = 61; index <= 120; index += 1) rows.push(`${index},35-44,荣耀,0,120`);
rows.push("120,35-44,荣耀,0,30");
const source = await rawCsvDataset(projectA, userA, "NPS原始数据", rows.join("\n"));
const executeA = createDataToolExecutor({ store, fileStorage: storage });
const scopeA = { project: projectA, user_id: userA };

// Test 1: 上传正常 Excel 后 profile 成功。
const exportSource = await fs.readFile(new URL("../src/shared/export.js", import.meta.url), "utf8");
const { buildExcelWorkbookXlsxBytes } = await import(`data:text/javascript;base64,${Buffer.from(exportSource).toString("base64")}`);
const excelBytes = buildExcelWorkbookXlsxBytes([{ name: "raw_data", rows: [
  { cells: [{ value: "respondent_id" }, { value: "age" }, { value: "NPS" }] },
  { cells: [{ value: 1, type: "number" }, { value: "18-24" }, { value: 9, type: "number" }] },
] }]);
const excelSource = await rawDataset(projectExcel, userA, "正常数据", excelBytes, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
const excelProfile = await createDataToolExecutor({ store, fileStorage: storage })({ agentToolId: "data_profile", args: { dataset_id: excelSource.dataset.id }, scope: { project: projectExcel, user_id: userA } });
assert.equal(excelProfile.compact.sample_size, 1);
assert.equal(excelProfile.compact.variables, 3);

// Test 2: 重复 respondent_id 被识别。
const profile = await executeA({ agentToolId: "data_profile", args: { dataset_id: source.dataset.id }, scope: scopeA });
assert.equal(profile.compact.sample_size, 121);
assert.equal(profile.compact.variables, 5);
assert.ok(profile.compact.issues.some((item) => /重复 respondent_id/.test(item)));
assert.ok(!JSON.stringify(profile.compact).includes("18-24,荣耀"));

// Test 3: 高影响规则先预估，确认后生成 Clean Dataset，Raw 字节保持不变。
const rules = [{ type: "duplicate_id", field: "respondent_id", label: "删除重复ID" }, { type: "duration", field: "duration", threshold: 60, label: "排除60秒以下" }];
const preview = await executeA({ agentToolId: "data_clean", args: { dataset_id: source.dataset.id, rules, confirmed: false }, scope: scopeA });
assert.equal(preview.compact.requires_confirmation, true);
assert.equal(preview.compact.removed_rows, 1);
assert.equal((await store.listDatasets(projectA.id)).length, 1);
const cleaned = await executeA({ agentToolId: "data_clean", args: { dataset_id: source.dataset.id, rules, confirmed: true, name: "NPS清洗数据" }, scope: scopeA });
assert.equal(cleaned.compact.after_rows, 120);
const cleanDataset = await store.getDataset(projectA.id, cleaned.compact.clean_dataset_id);
assert.equal(cleanDataset.parent_dataset_id, source.dataset.id);
assert.equal(cleanDataset.type, "cleaned");
assert.deepEqual(new Uint8Array(await storage.get(source.file.storage_path)), source.bytes);
await assert.rejects(() => store.deleteFile(projectA.id, source.file.id), (error) => error.code === "CONFLICT");

// Test 4: NPS 必须由 crosstab 工具计算，并返回显著性与 result_id。
const crosstab = await executeA({ agentToolId: "crosstab", args: { dataset_id: cleanDataset.id, banner: ["age"], variables: ["NPS"] }, scope: scopeA });
assert.ok(crosstab.compact.result_id);
assert.ok(crosstab.compact.key_findings.some((item) => item.significant));
assert.equal(crosstab.result.results[0].metric, "nps");
assert.ok(crosstab.compact.excel_file_id);
const crosstabExcel = await store.getFile(projectA.id, crosstab.compact.excel_file_id);
assert.equal(crosstabExcel.parse_status, "completed");
assert.deepEqual([...new Uint8Array(await storage.get(crosstabExcel.storage_path)).slice(0, 2)], [0x50, 0x4b]);

// Test 4b: 合并当前数据集的全部确定性交叉表结果，不受单次 12 题调用上限影响。
await executeA({ agentToolId: "crosstab", args: { dataset_id: cleanDataset.id, banner: ["age"], variables: ["brand"] }, scope: scopeA });
await executeA({ agentToolId: "crosstab", args: { dataset_id: cleanDataset.id, banner: ["age"], variables: ["NPS"] }, scope: scopeA });
const exportedCrosstabs = await exportCrosstabResults({ store, fileStorage: storage, userId: userA, projectId: projectA.id, dataset: cleanDataset });
assert.equal(exportedCrosstabs.variable_count, 2);
assert.equal(exportedCrosstabs.banner_count, 1);
assert.equal(exportedCrosstabs.analysis_count, 2, "重复的题目 × Banner 应只保留最新结果");
assert.equal(exportedCrosstabs.file.parse_status, "completed");
assert.deepEqual([...new Uint8Array(await storage.get(exportedCrosstabs.file.storage_path)).slice(0, 2)], [0x50, 0x4b]);
assert.match(exportedCrosstabs.file.summary, /2 个题目/);
await assert.rejects(() => exportCrosstabResults({ store, fileStorage: storage, userId: userA, projectId: projectExcel.id, dataset: excelSource.dataset }), (error) => error.code === "CROSSTAB_EXPORT_EMPTY");

// 已明确目标总体分布时，任何加权仍先预估；确认后生成 Weighted Dataset，并由 Crosstab 使用权重。
const weightArgs = { dataset_id: cleanDataset.id, method: "rim", targets: [{ variable: "age", categories: [{ value: "18-24", share: 70 }, { value: "35-44", share: 30 }] }] };
const weightPreview = await executeA({ agentToolId: "data_weight", args: { ...weightArgs, confirmed: false }, scope: scopeA });
assert.equal(weightPreview.compact.requires_confirmation, true);
assert.equal((await store.listDatasets(projectA.id)).filter((item) => item.type === "weighted").length, 0);
const weighted = await executeA({ agentToolId: "data_weight", args: { ...weightArgs, confirmed: true }, scope: scopeA });
const weightedDataset = await store.getDataset(projectA.id, weighted.compact.weighted_dataset_id);
assert.equal(weightedDataset.type, "weighted");
assert.equal(weightedDataset.parent_dataset_id, cleanDataset.id);
assert.ok(weighted.compact.diagnostics.effective_n < cleanDataset.row_count);
const weightedCrosstab = await executeA({ agentToolId: "crosstab", args: { dataset_id: weightedDataset.id, banner: ["age"], variables: ["NPS"] }, scope: scopeA });
assert.equal(weightedCrosstab.compact.weighted, true);
assert.equal(weightedCrosstab.result.results[0].overall, 40);
assert.equal(weightedCrosstab.result.results[0].groups.find((item) => item.segment === "18-24").significant, false);

// Test 5: 普通研究问题不进入正式数据工作流，也没有默认数据 Tool policy。
assert.equal(isDataAnalysisWorkflow("free_chat"), false);
assert.equal(dataAnalysisToolPolicy(cleanDataset, []).allowed_tools.length, 4);

// Test 6: 不存在字段时明确失败，不能得到伪造结果。
await assert.rejects(() => executeA({ agentToolId: "crosstab", args: { dataset_id: cleanDataset.id, banner: ["不存在字段"], variables: ["NPS"] }, scope: scopeA }), (error) => error.code === "FIELD_NOT_FOUND");

// Test 7: 显著结论可以追溯到 crosstab Analysis Result。
const evidence = await store.listEvidence(projectA.id);
assert.ok(evidence.length >= 1);
assert.ok(evidence.every((item) => item.source_type === "crosstab"));
assert.ok(evidence.some((item) => item.source_id === crosstab.compact.result_id));

// Test 8: Raw → Clean 刷新/重建 Store 后版本仍存在。
const reloaded = new JsonResearchStore(path.join(temporary, "research.json"));
const versions = await reloaded.listDatasets(projectA.id);
assert.deepEqual(new Set(versions.map((item) => item.type)), new Set(["raw", "cleaned", "weighted"]));

// Test 9: 用户/项目 B 即使猜中 dataset_id 也不能访问项目 A 数据。
const executeB = createDataToolExecutor({ store, fileStorage: storage });
await assert.rejects(() => executeB({ agentToolId: "data_profile", args: { dataset_id: source.dataset.id }, scope: { project: projectB, user_id: userB } }), (error) => error.code === "DATASET_NOT_FOUND");

// Test 10: 5000 × 200 模拟数据；compact/prompt 不含任何原始行或哨兵值。
const headers = Array.from({ length: 200 }, (_, index) => index === 0 ? "respondent_id" : index === 1 ? "age" : `Q${index}`);
const largeRows = [headers.join(",")];
for (let row = 0; row < 5000; row += 1) largeRows.push(headers.map((_, column) => column === 0 ? `RID${row}` : column === 1 ? (row % 2 ? "18-24" : "35-44") : column === 199 && row === 4999 ? "RAW_SENTINEL_DO_NOT_LEAK" : String((row + column) % 11)).join(","));
const large = await rawCsvDataset(projectA, userA, "大数据", largeRows.join("\n"));
const largeProfile = await executeA({ agentToolId: "data_profile", args: { dataset_id: large.dataset.id }, scope: scopeA });
assert.equal(largeProfile.compact.sample_size, 5000);
assert.equal(largeProfile.compact.variables, 200);
assert.equal(largeProfile.compact.field_index.length, 200, "the Harness must receive the complete bounded field-name index");
assert.ok(JSON.stringify(largeProfile.compact).length < 20_000);
assert.ok(!JSON.stringify(largeProfile.compact).includes("RAW_SENTINEL_DO_NOT_LEAK"));
const queriedProfile = await executeA({ agentToolId: "data_profile", args: { dataset_id: large.dataset.id, field_query: ["Q199"], field_limit: 10 }, scope: scopeA });
assert.deepEqual(queriedProfile.compact.metadata_query, ["q199"]);
assert.deepEqual(queriedProfile.compact.field_metadata.map((item) => item.field), ["Q199"], "field queries must search beyond the first metadata page");
const prompt = enhanceDataAnalysisPrompt({ basePrompt: "项目摘要", dataset: large.dataset, message: "比较年龄差异", toolResults: [], maxChars: 30_000 });
assert.ok(!prompt.includes("RAW_SENTINEL_DO_NOT_LEAK"));
assert.ok(prompt.includes("原始数据行不在上下文中"));
assert.ok(prompt.includes("Q199"));
assert.ok(prompt.includes("field_query"));

const migration = await fs.readFile(new URL("../migrations/0009_data_analysis_workflow.sql", import.meta.url), "utf8");
assert.match(migration, /research_datasets/);
assert.match(migration, /research_evidence/);
assert.match(migration, /'data_analysis'/);
const weightingMigration = await fs.readFile(new URL("../migrations/0010_data_weight_and_exports.sql", import.meta.url), "utf8");
assert.match(weightingMigration, /'data-weight'/);
assert.match(weightingMigration, /'data_weight'/);
const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
const researcher = await fs.readFile(new URL("../src/modules/ai-researcher/index.js", import.meta.url), "utf8");
assert.match(html, /researchDatasetList/);
assert.match(html, /id="researchExportCrosstabs"/);
assert.match(researcher, /dataset_id/);
assert.match(researcher, /data_analysis/);
assert.match(researcher, /crosstab-export/);

const css = await fs.readFile(new URL("../styles.css", import.meta.url), "utf8");
assert.match(css, /\.research-message-list \{[^}]*flex: 0 1 auto;/s);
assert.match(css, /\.research-composer \{[^}]*margin-top: 0;/s);

await fs.rm(temporary, { recursive: true, force: true });
console.log("data analysis workflow smoke passed: 11/11 scenarios");
