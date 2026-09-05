import assert from "node:assert/strict";
import { RESEARCH_RUN_RECOVERY_TIMEOUT_MS, latestStreamSnapshot, normalizeStreamPayload, parseSseBuffer, readSseResponse } from "../src/modules/ai-researcher/stream.mjs";

assert.equal(RESEARCH_RUN_RECOVERY_TIMEOUT_MS, 330_000, "recovery window must outlast the 300 second long-task deadline");

const parsed = parseSseBuffer('event: delta\ndata: {"delta":"第一段"}\n\ndata: {"delta":"第二段"}\n\n');
assert.equal(parsed.remainder, "");
assert.deepEqual(parsed.events.map((item) => normalizeStreamPayload(item.payload).text), ["第一段", "第二段"]);

const split = parseSseBuffer('data: {"delta":"跨块');
assert.deepEqual(split.events, []);
const rest = parseSseBuffer(`${split.remainder}文本"}\n\ndata: [DONE]\n\n`, { flush: true });
assert.deepEqual(rest.events.map((item) => item.payload), [{ delta: "跨块文本" }, "[DONE]"]);

assert.deepEqual(normalizeStreamPayload({ type: "done", reply: "完整", applied_context: { selected_files: [], retrieved_chunks: [] } }), {
  kind: "complete",
  result: { type: "done", reply: "完整", applied_context: { selected_files: [], retrieved_chunks: [] } },
});
assert.deepEqual(normalizeStreamPayload({ type: "error", error: { message: "中断", retryable: true } }), { kind: "error", message: "中断", retryable: true });
assert.deepEqual(normalizeStreamPayload({ type: "error", message: "中断", retryable: true }), { kind: "error", message: "中断", retryable: true });
assert.equal(latestStreamSnapshot([
  { event: "delta", payload: { text: "A" } },
  { event: "progress", payload: { partial_content: "AB" } },
  { event: "delta", payload: { text: "C" } },
]), "ABC");

const encoder = new TextEncoder();
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode('data: {"delta":"局部"}\n\n'));
    controller.enqueue(encoder.encode('event: progress\ndata: {"run_id":"run-1","stage":"generating","partial_content":"局部快照"}\n\n'));
    controller.enqueue(encoder.encode('event: tool_status\ndata: {"tool_id":"sample_size","label":"样本量计算","status":"running","message":"正在计算样本量…"}\n\n'));
    controller.enqueue(encoder.encode('event: workflow_status\ndata: {"workflow_id":"workflow-1","status":"running","stage":"quality_gate","label":"正在执行方案质量检查"}\n\n'));
    controller.enqueue(encoder.encode('data: {"message":{"role":"assistant","content":"完整"},"applied_context":{"selected_files":[],"retrieved_chunks":[]}}\n\n'));
    controller.close();
  },
});
const deltas = [];
const snapshots = [];
const toolStatuses = [];
const workflowStatuses = [];
const { result, partialContent } = await readSseResponse(new Response(stream), { onDelta: (delta) => deltas.push(delta), onProgress: (snapshot) => snapshots.push(snapshot), onToolStatus: (status) => toolStatuses.push(status), onWorkflowStatus: (status) => workflowStatuses.push(status) });
assert.deepEqual(deltas, ["局部"]);
assert.deepEqual(snapshots, ["局部快照"]);
assert.equal(result.message.content, "完整");
assert.equal(partialContent, "局部快照");
assert.deepEqual(toolStatuses.map((status) => status.tool_id), ["sample_size"]);
assert.deepEqual(workflowStatuses.map((status) => status.stage), ["quality_gate"]);

const interrupted = new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode('event: start\ndata: {"run_id":"run-interrupted"}\n\nevent: delta\ndata: {"text":"已完成部分"}\n\n'));
    controller.close();
  },
});
await assert.rejects(
  readSseResponse(new Response(interrupted)),
  (error) => error.runId === "run-interrupted" && error.retryable === true && error.partialContent === "已完成部分",
  "a stream that closes before the final result must trigger persisted-run recovery",
);

console.log("research-stream-parser-smoke: PASS");
