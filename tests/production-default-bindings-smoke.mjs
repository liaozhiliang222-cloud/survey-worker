import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contextLimitsFromEnv, buildProjectContext } from "../lib/project-context.mjs";
import { parseProjectFile } from "../lib/project-file-parser.mjs";
import { chunkProjectText } from "../lib/project-memory.mjs";

const before = JSON.parse(readFileSync(new URL("./fixtures/redundant-production-vars.json", import.meta.url), "utf8"));
for (const taskType of ["free_chat", "research_plan", "qualitative_summary", "data_analysis"]) {
  const previous = contextLimitsFromEnv(before, taskType);
  const current = contextLimitsFromEnv({}, taskType);
  assert.deepEqual(current, previous);
  const input = { project: { id: "test", title: "Test project" }, userMessage: "test", taskType };
  assert.deepEqual(buildProjectContext({ ...input, limits: current }), buildProjectContext({ ...input, limits: previous }));
}
const text = "Long interview transcript with meaningful evidence.\n\n".repeat(5000);
assert.deepEqual(chunkProjectText(text), chunkProjectText(text, {
  targetChars: before.RESEARCH_MEMORY_CHUNK_CHARS,
  overlapChars: before.RESEARCH_MEMORY_CHUNK_OVERLAP,
  maxChunks: before.RESEARCH_MAX_CHUNKS_PER_FILE,
}));
const bytes = new TextEncoder().encode(text);
const defaults = await parseProjectFile(bytes, { extension: "txt", fileName: "test.txt" });
const explicit = await parseProjectFile(bytes, { extension: "txt", fileName: "test.txt",
  maxParsedChars: before.RESEARCH_MAX_PARSED_CHARS, summaryChars: before.RESEARCH_FILE_SUMMARY_CHARS });
assert.deepEqual(defaults, explicit);
console.log("Production default bindings: context, chunking and file parsing unchanged.");
