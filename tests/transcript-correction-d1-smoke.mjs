import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createResearchStore } from "../functions/api/research/[[path]].js";

const sqlite = new DatabaseSync(":memory:");
const migrations = fs.readdirSync(new URL("../migrations/", import.meta.url)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
for (const name of migrations) sqlite.exec(fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));

function bound(sql, args) {
  const statement = sqlite.prepare(sql);
  return {
    async all() { return { results: statement.all(...args) }; },
    async first() { return statement.get(...args) || null; },
    async run() { return statement.run(...args); },
  };
}
const d1 = {
  prepare(sql) { return { bind(...args) { return bound(sql, args); } }; },
  async batch(statements) { const results = []; sqlite.exec("BEGIN"); try { for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; } catch (error) { sqlite.exec("ROLLBACK"); throw error; } },
};

const store = createResearchStore(d1);
const project = await store.createProject("user-a", { title: "D1 校正测试" });
const file = await store.createFile("user-a", project.id, { id: "file-1", file_name: "interview.txt", file_type: "txt", mime_type: "text/plain", file_size: 20, category: "interview", storage_key: "test/file-1" });
const transcript = await store.upsertTranscript(project.id, { file_id: file.id, title: file.file_name, interview_type: "consumer", respondent_label: "A", status: "ready", word_count: 8, segment_count: 1, summary: "", source_fingerprint: "fp-1", deep_summary: "", summary_status: "pending" });
const rawSegments = await store.replaceTranscriptSegments(project.id, transcript.id, [{ id: "raw-1", sequence: 0, speaker: "受访者", content: "我用荣要手机。" }]);
const rawVersion = await store.ensureRawTranscriptVersion(project.id, transcript, rawSegments);
const corrected = await store.createCorrectedTranscriptVersion(project.id, transcript, rawVersion, rawSegments, { model: "mock/model", terminology: ["荣耀"] });
const versionSegment = await store.getTranscriptVersionSegmentByRaw(project.id, corrected.id, "raw-1");
const correction = await store.createTranscriptCorrection(project.id, { transcript_id: transcript.id, version_id: corrected.id, segment_id: versionSegment.id, raw_segment_id: "raw-1", original_text: "荣要", corrected_text: "荣耀", reason: "proper_noun", confidence: "medium", status: "pending_review", batch_index: 0, note: "test" });
await store.updateTranscriptVersion(project.id, corrected.id, { status: "review_required", pending_review_count: 1 });
const resolved = await store.resolveTranscriptCorrection(project.id, correction.id, "accept");
assert.equal(resolved.version.status, "confirmed");
assert.match((await store.getTranscriptVersionSegmentByRaw(project.id, corrected.id, "raw-1")).content, /荣耀/);
assert.equal((await store.listTranscriptVersions(project.id, transcript.id)).length, 2);
assert.equal((await store.getPreferredTranscriptVersion(project.id, transcript.id)).id, corrected.id);

sqlite.close();
console.log("transcript correction D1 smoke: ok");
