import assert from "node:assert/strict";
import stream from "../lib/harness-stream.js";
import harness from "../lib/harness.js";
import { createHarnessClient } from "../functions/api/research/[[path]].js";

function response(text) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (i === bytes.length) return controller.close();
    controller.enqueue(bytes.slice(i, ++i)); // Split UTF-8 and CRLF at every boundary.
  } }), { headers: { "content-type": "text/event-stream" } });
}
const chunk = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\r\n\r\n`;
const complete = chunk("中文🙂", "stop") + "data: [DONE]\r\n\r\n";
assert.equal((await stream.readOpenAiStream(response(": heartbeat\r\n\r\n" + complete))).choices[0].message.content, "中文🙂");
await assert.rejects(stream.readOpenAiStream(response(chunk("partial") + "data: [DONE]\n\n")), { code: "HARNESS_BAD_RESPONSE" });
await assert.rejects(stream.readOpenAiStream(response('data: {"error":{"message":"private"}}\n\n')), error => error.code === "HARNESS_UPSTREAM" && !error.message.includes("private"));
await assert.rejects(stream.readOpenAiStream(response('data: invalid\n\n')), { code: "HARNESS_BAD_RESPONSE" });
const env = { HARNESS_BASE_URL: "https://model.example/v1", HARNESS_API_STYLE: "openai-chat", HARNESS_API_KEY: "test", HARNESS_MODEL: "test" };
const originalFetch = globalThis.fetch;
try {
  for (const edge of [false, true]) {
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.stream, true);
      assert.equal(body.tools, undefined);
      calls++;
      return response(chunk(calls === 1 ? "上半" : "下半", calls === 1 ? "length" : "stop") + "data: [DONE]\n\n");
    };
    globalThis.fetch = fetchImpl;
    const result = edge
      ? await createHarnessClient(env).send("session", "JSON 对象", "request", { streamResponse: true, forbidTools: true })
      : await harness.createHarnessAdapter({ env, fetchImpl }).sendMessage({ sessionId: "session", prompt: "JSON 对象", requestId: "request", streamResponse: true, forbidTools: true });
    assert.equal(result, "上半下半");
    assert.equal(calls, 2);
  }
} finally { globalThis.fetch = originalFetch; }
console.log("upstream streaming: fragmented Unicode, truncation, safe errors, Node/Pages continuation passed");
