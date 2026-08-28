import assert from "node:assert/strict";
import { chunkProjectText, researchQueryTerms, searchProjectChunks } from "../lib/project-memory.mjs";
import { compareArtifacts } from "../lib/artifact-diff.mjs";
import { buildProjectContext } from "../lib/project-context.mjs";
import { requestProjectOcr } from "../lib/project-ocr.mjs";

const chunks = chunkProjectText(`# 售后体验\n\n${"年轻用户在退货流程中流失，客服响应慢。".repeat(45)}\n\n# 价格认知\n\n价格并非主要障碍。`, { targetChars: 600, overlapChars: 50 });
assert.ok(chunks.length >= 2);
assert.deepEqual(chunks.map((item) => item.chunk_index), chunks.map((_, index) => index));
assert.ok(researchQueryTerms("如何提升售后体验？").includes("售后"));

const files = [{ id: "f1", file_name: "访谈纪要.md", category: "interview", parse_status: "completed" }];
const indexed = chunks.map((chunk) => ({ ...chunk, id: `c${chunk.chunk_index}`, file_id: "f1" }));
const matches = searchProjectChunks(indexed, files, "售后退货体验", { limit: 3 });
assert.ok(matches.length > 0);
assert.match(matches[0].content, /售后|退货/);

const built = buildProjectContext({
  project: { title: "体验研究", brief: "定位流失原因", research_goal: "提升留存" },
  retrievedChunks: matches,
  userMessage: "请解释售后流失",
  limits: { maxContextChars: 8_000 },
});
assert.match(built.prompt, /【自动检索的项目记忆】/);
assert.equal(built.context.retrieved_chunks.length, matches.length);

const comparison = compareArtifacts(
  { id: "a1", title: "方案", version: 1, content: "目标\n样本 20\n方法：访谈" },
  { id: "a2", title: "方案", version: 2, content: "目标\n样本 30\n方法：访谈\n补充桌面研究" },
);
assert.equal(comparison.summary.added, 2);
assert.equal(comparison.summary.removed, 1);

let ocrRequest;
const ocr = await requestProjectOcr({
  env: { RESEARCH_OCR_ENDPOINT: "https://ocr.example/extract", RESEARCH_OCR_API_KEY: "server-secret" },
  file: { file_name: "扫描.pdf", mime_type: "application/pdf" },
  bytes: new Uint8Array([1, 2, 3]),
  fetchImpl: async (url, options) => { ocrRequest = { url, options }; return new Response(JSON.stringify({ text: "OCR 文本", provider: "fixture" }), { status: 200, headers: { "Content-Type": "application/json" } }); },
});
assert.equal(ocr.text, "OCR 文本");
assert.equal(ocrRequest.options.headers.Authorization, "Bearer server-secret");
assert.equal(ocrRequest.options.body.byteLength, 3);

console.log("research-memory-v03-smoke: PASS");
