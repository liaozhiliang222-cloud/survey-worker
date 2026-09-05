import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonResearchStore } from "../lib/research-store.js";
import { LocalResearchFileStorage } from "../lib/research-file-storage.js";
import { createDataToolExecutor, registerRawDataset } from "../lib/data-engine.mjs";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: node scripts/verify-sav-analysis.mjs <source.sav>");

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "surveykit-real-sav-"));
try {
  const bytes = await fs.readFile(sourcePath);
  const store = new JsonResearchStore(path.join(temporary, "research.json"));
  const storage = new LocalResearchFileStorage(path.join(temporary, "files"));
  const userId = "sav-regression-user";
  const project = await store.createProject(userId, { title: "真实 SAV 回归" });
  const fileId = crypto.randomUUID();
  const storageKey = storage.key(project.id, fileId, "sav");
  await storage.put(storageKey, bytes);
  const file = await store.createFile(userId, project.id, {
    id: fileId,
    file_name: path.basename(sourcePath),
    file_type: "sav",
    mime_type: "application/x-spss-sav",
    file_size: bytes.byteLength,
    category: "data",
    storage_path: storageKey,
  });
  const dataset = await registerRawDataset({ store, fileStorage: storage, userId, projectId: project.id, file });
  const execute = createDataToolExecutor({ store, fileStorage: storage });
  const scope = { project, user_id: userId };
  const profile = await execute({ agentToolId: "data_profile", args: { dataset_id: dataset.id, field_query: ["NPS", "推荐"], field_limit: 40 }, scope });

  assert.equal(profile.compact.field_count_total, dataset.column_count);
  assert.equal(profile.compact.field_index_returned, dataset.column_count);
  assert.equal(profile.compact.fields_truncated, false);
  const nps = profile.compact.field_metadata.find((item) => /nps|净推荐|推荐.*(?:可能|意愿|程度)|多大.*可能.*推荐/i.test(`${item.field}\n${item.label}`));
  assert.ok(nps, "NPS variable must be discoverable by variable label across the full SAV dictionary");
  const banner = profile.compact.field_index.includes("FZ_Q1") ? "FZ_Q1" : profile.result.possible_single_choice_fields.find((field) => field !== nps.field);
  assert.ok(banner, "a usable categorical banner variable must exist");

  const crosstab = await execute({ agentToolId: "crosstab", args: { dataset_id: dataset.id, banner: [banner], variables: [nps.field] }, scope });
  assert.equal(crosstab.result.results[0].metric, "nps", "an SAV question label must identify NPS even when the variable name is Q-coded");
  process.stdout.write(`${JSON.stringify({ file: path.basename(sourcePath), bytes: bytes.byteLength, rows: dataset.row_count, columns: dataset.column_count, nps_field: nps.field, nps_label: nps.label, banner, metric: crosstab.result.results[0].metric, result_id: crosstab.compact.result_id })}\n`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
