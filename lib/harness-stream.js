"use strict";

// Collect upstream tokens before the existing workflow validates and saves JSON.
async function readOpenAiStream(response) {
  const fail = (code = "HARNESS_BAD_RESPONSE") => Object.assign(new Error(code), { name: "HarnessError", code, retryable: true });
  if (!response.body) throw fail();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", finishReason = null, done = false, bytes = 0;
  function frame(value) {
    const data = value.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") { done = true; return; }
    let chunk;
    try { chunk = JSON.parse(data); } catch { throw fail(); }
    if (chunk.error) throw fail("HARNESS_UPSTREAM");
    const choice = chunk.choices?.find(item => item.index === 0) ?? chunk.choices?.[0];
    if (!choice) return; // Usage-only and heartbeat chunks.
    if (choice.delta?.tool_calls?.length) throw fail("HARNESS_TOOL_BLOCKED");
    if (typeof choice.delta?.content === "string") content += choice.delta.content;
    if (content.length > 2097152) throw fail();
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  try {
    while (!done) {
      const part = await reader.read();
      if (part.done) {
        buffer += decoder.decode();
        if (buffer.trim()) frame(buffer);
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw fail();
      buffer += decoder.decode(part.value, { stream: true });
      let boundary;
      while (!done && (boundary = /\r?\n\r?\n/.exec(buffer))) {
        const value = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        frame(value);
      }
    }
    if (!finishReason || !content.trim()) throw fail();
    return { choices: [{ message: { role: "assistant", content }, finish_reason: finishReason }] };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

module.exports = { readOpenAiStream };
