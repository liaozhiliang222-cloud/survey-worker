import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { JsonResearchStore } from "../lib/research-store.js";
import { LocalResearchFileStorage } from "../lib/research-file-storage.js";
import { createResearchHandler } from "../lib/research-handler.js";
import { createDataToolExecutor, registerRawDataset } from "../lib/data-engine.mjs";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-data-regressions-"));
const store = new JsonResearchStore(path.join(temporary, "research.json"));
const storage = new LocalResearchFileStorage(path.join(temporary, "files"));
const userId = "regression-user";
const project = await store.createProject(userId, { title: "Synthetic regressions" });
const scope = { project, user_id: userId };
const execute = createDataToolExecutor({ store, fileStorage: storage });
let server;

async function derived(rows, type = "cleaned") {
  const id = crypto.randomUUID(); const key = storage.key(project.id, id, "json"); const headers = Object.keys(rows[0]);
  await storage.put(key, new TextEncoder().encode(JSON.stringify({ sheet_name: "Data", headers, rows })));
  return store.createDataset(userId, project.id, { id, name: "Fixture", type, status: "ready", row_count: rows.length, column_count: headers.length, storage_key: key });
}
async function cross(dataset, variable) {
  const result = await execute({ agentToolId: "crosstab", args: { dataset_id: dataset.id, variables: [variable], banner: ["group"] }, scope });
  return result.result.results[0];
}

try {
  // B1: total and segment use identical valid bases, including real zero.
  for (const type of ["cleaned", "weighted"]) {
    const dataset = await derived([10, "", null, "  "].map((NPS) => ({ group: "A", NPS, __weight: 1 })), type);
    const result = await cross(dataset, "NPS");
    assert.equal(result.overall, 100); assert.equal(result.base, 1);
    assert.equal(result.groups[0].value, 100); assert.equal(result.groups[0].base, 1);
    const zeros = await cross(await derived([10, 0, ""].map((NPS) => ({ group: "A", NPS, __weight: 1 })), type), "NPS");
    assert.equal(zeros.overall, 0); assert.equal(zeros.groups[0].value, 0); assert.equal(zeros.base, 2);
    const empty = await cross(await derived(["", null].map((NPS) => ({ group: "A", NPS, __weight: 1 })), type), "NPS");
    assert.equal(empty.metric, "nps"); assert.equal(empty.overall, null); assert.equal(empty.base, 0);
    const mean = await cross(await derived([...Array.from({ length: 13 }, (_, i) => i + 1), "", null].map((value) => ({ group: "A", value, __weight: 1 })), type), "value");
    assert.equal(mean.metric, "mean"); assert.equal(mean.overall, 7); assert.equal(mean.groups[0].value, 7); assert.equal(mean.groups[0].base, 13);
  }

  // B6: valid pairs only, equal weights match ordinary crosstabs; numeric 0 survives.
  const categoryRows = [{ group: "A", choice: "yes" }, { group: "A", choice: "" }, { group: "A", choice: "  " }, { group: "", choice: "yes" }, { group: 0, choice: 0 }].map((row) => ({ ...row, __weight: 1 }));
  for (const type of ["cleaned", "weighted"]) {
    const result = await cross(await derived(categoryRows, type), "choice");
    assert.equal(result.base, 2);
    assert.equal(result.categories.find((item) => item.category === "yes").groups.find((item) => item.segment === "A").percent, 100);
    assert.equal(result.categories.find((item) => item.category === "0").groups.find((item) => item.segment === "0").percent, 100);
  }

  // B3: reject weighted cleaning before any derivative or log is persisted.
  const weighted = await derived([{ group: "A", NPS: 10, __weight: 2 }, { group: "A", NPS: 0, __weight: 1 }], "weighted");
  const count = (await store.listDatasets(project.id)).length;
  const originalBytes = await storage.get(weighted.storage_path);
  for (const confirmed of [false, true]) await assert.rejects(() => execute({ agentToolId: "data_clean", args: { dataset_id: weighted.id, confirmed, rules: [{ type: "blank_row" }] }, scope }), (error) => error.code === "DATASET_WEIGHTED_CLEAN_FORBIDDEN");
  assert.equal((await store.listDatasets(project.id)).length, count);
  assert.deepEqual(await storage.get(weighted.storage_path), originalBytes);
  assert.equal((await cross(weighted, "NPS")).overall, 33.3);

  // B4: same-Sheet requests remain idempotent; another Sheet is never silently substituted.
  const exportSource = await fs.readFile(new URL("../src/shared/export.js", import.meta.url), "utf8");
  const { buildExcelWorkbookXlsxBytes } = await import(`data:text/javascript;base64,${Buffer.from(exportSource).toString("base64")}`);
  const workbook = buildExcelWorkbookXlsxBytes(["SheetA", "SheetB"].map((name) => ({ name, rows: [{ cells: [{ value: "id" }, { value: "group" }] }, { cells: [{ value: "1" }, { value: name }] }] })));
  const fileId = crypto.randomUUID(); const key = storage.key(project.id, fileId, "xlsx");
  await storage.put(key, workbook);
  const file = await store.createFile(userId, project.id, { id: fileId, file_name: "sheets.xlsx", file_type: "xlsx", storage_path: key });
  const registration = { store, fileStorage: storage, userId, projectId: project.id, file };
  const first = await registerRawDataset({ ...registration, sheetName: "SheetA" });
  assert.equal((await registerRawDataset({ ...registration, sheetName: "SheetA" })).id, first.id);
  await assert.rejects(() => registerRawDataset({ ...registration, sheetName: "SheetB" }), (error) => error.code === "DATASET_SHEET_CONFLICT");
  const concurrentStore = { listDatasets: async () => [], createDataset: async () => first };
  await assert.rejects(() => registerRawDataset({ ...registration, store: concurrentStore, sheetName: "SheetB" }), (error) => error.code === "DATASET_SHEET_CONFLICT");

  const handler = createResearchHandler({ env: { RESEARCH_DEV_USER_ID: userId }, store, fileStorage: storage, harnessAdapter: {}, logger: { log() {}, error() {} } });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/research/projects/${project.id}`;
  const sheetResponse = await fetch(`${base}/datasets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file_id: file.id, sheet_name: "SheetB" }) });
  assert.equal(sheetResponse.status, 400); assert.match((await sheetResponse.json()).error.message, /工作表/);
  const cleanResponse = await fetch(`${base}/datasets/${weighted.id}/clean`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: [{ type: "blank_row" }], confirmed: true }) });
  assert.equal(cleanResponse.status, 400); assert.match((await cleanResponse.json()).error.message, /加权/);

  // B5: partial deletion fails visibly, retry removes every byte before metadata.
  const files = await store.listFiles(project.id); const datasets = await store.listDatasets(project.id);
  const keys = [...new Set([...files, ...datasets].map((item) => item.storage_path).filter(Boolean))];
  const deleteFile = storage.delete.bind(storage);
  storage.delete = async (storageKey) => { if (storageKey === weighted.storage_path) throw new Error("synthetic storage failure"); await deleteFile(storageKey); };
  const failed = await fetch(base, { method: "DELETE" });
  assert.notEqual(failed.status, 204); await failed.text();
  assert.ok(await store.getProject(userId, project.id));
  storage.delete = deleteFile;
  const deleted = await fetch(base, { method: "DELETE" }); assert.equal(deleted.status, 204);
  assert.equal(await store.getProject(userId, project.id), null);
  for (const storageKey of keys) await assert.rejects(() => storage.get(storageKey), (error) => error.code === "ENOENT");
  assert.equal((await fetch(base, { method: "DELETE" })).status, 404);
  console.log("Data regressions passed: missing values, valid bases, weighted cleaning guard, Sheet conflict, complete deletion and retry.");
} finally {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  // Only remove this test's own verified temporary workspace.
  if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith("surveykit-data-regressions-")) await fs.rm(temporary, { recursive: true, force: true });
}
