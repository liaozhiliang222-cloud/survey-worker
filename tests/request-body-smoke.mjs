import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";

const require = createRequire(import.meta.url);
const { configuredBodyLimit, collectRequestBody, bodyLimitError } = require("../lib/request-body");

function collect(stream, maxBytes) {
  return new Promise((resolve) => collectRequestBody(stream, maxBytes, resolve));
}

assert.equal(configuredBodyLimit(undefined, 100, 1000), 100);
assert.equal(configuredBodyLimit("2048", 100, 4096), 2048);
assert.equal(configuredBodyLimit("1", 100, 4096), 1024);
assert.equal(configuredBodyLimit("9999", 100, 4096), 4096);

const valid = new PassThrough();
valid.headers = {};
const validResultPromise = collect(valid, 1024);
valid.end(Buffer.from("hello"));
const validResult = await validResultPromise;
assert.equal(validResult.tooLarge, false);
assert.equal(validResult.size, 5);
assert.equal(validResult.body.toString("utf8"), "hello");

const streamed = new PassThrough();
streamed.headers = {};
const streamedResultPromise = collect(streamed, 1024);
streamed.write(Buffer.alloc(600, 1));
streamed.end(Buffer.alloc(600, 2));
const streamedResult = await streamedResultPromise;
assert.equal(streamedResult.tooLarge, true);
assert.equal(streamedResult.size, 1200);
assert.equal(streamedResult.body.length, 0);

const declared = new PassThrough();
declared.headers = { "content-length": "2048" };
const declaredResult = await collect(declared, 1024);
assert.equal(declaredResult.tooLarge, true);
assert.equal(declaredResult.size, 2048);
assert.equal(declaredResult.body.length, 0);
declared.end();

assert.deepEqual(bodyLimitError("AI", 1024), {
  error: {
    message: "AI请求体超过限制（最大 1024 字节）。",
    code: "REQUEST_BODY_TOO_LARGE",
  },
});

console.log("Request body module smoke passed: limits, buffering and error shape");
