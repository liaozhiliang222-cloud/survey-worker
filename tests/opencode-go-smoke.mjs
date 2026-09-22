import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { GO_MODELS, GO_URL, handleOpenCodeGo } from "../lib/opencode-go.mjs";

const env = { OPENCODE_GO_API_KEY: "test-backend-key" };
const payload = (model = GO_MODELS[0], stream = false) => ({
  provider: "opencode-go", apiKey: "", url: "https://attacker.invalid/chat/completions",
  sessionId: "test-conversation-12345",
  body: { model, messages: [{ role: "user", content: "test" }], max_tokens: 100, stream }
});
const success = () => Response.json({ choices: [{ message: { content: "OK" } }] });

test("backend key goes only to fixed Go endpoint; default model and session are preserved", async () => {
  const result = await handleOpenCodeGo(payload(), env, async (url, options) => {
    assert.equal(url, GO_URL);
    assert.equal(options.headers.Authorization, "Bearer test-backend-key");
    assert.equal(options.headers["x-opencode-session"], "test-conversation-12345");
    assert.equal(options.headers["User-Agent"], "research-toolbox/1.0");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.model, GO_MODELS[0]);
    assert.deepEqual(body.thinking, { type: "disabled" });
    return success();
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("X-Actual-Model"), GO_MODELS[0]);
  assert.ok(!(await result.text()).includes(env.OPENCODE_GO_API_KEY));
});

test("manual MiMo selection is used first", async () => {
  const result = await handleOpenCodeGo(payload(GO_MODELS[1]), env, async (_, options) => {
    assert.equal(JSON.parse(options.body).model, GO_MODELS[1]);
    return success();
  });
  assert.equal(result.headers.get("X-Actual-Model"), GO_MODELS[1]);
});

for (const [status, error, reason] of [
  [429, {}, "rate_limited"],
  [503, {}, "model_unavailable"],
  [403, { error: { type: "RegionError" } }, "region_opt_in_required"]
]) {
  test(`HTTP ${status}/${reason} switches to the other model, including streaming requests`, async () => {
    const seen = [];
    const result = await handleOpenCodeGo(payload(GO_MODELS[0], true), env, async (_, options) => {
      seen.push(JSON.parse(options.body).model);
      return seen.length === 1 ? Response.json(error, { status }) : success();
    });
    assert.deepEqual(seen, GO_MODELS);
    assert.equal(result.headers.get("X-Actual-Model"), GO_MODELS[1]);
    assert.equal(result.headers.get("X-AI-Fallback-Reason"), reason);
    assert.match(result.headers.get("content-type"), /event-stream/);
    assert.match(await result.text(), /data: \[DONE\]/);
  });
}

test("MiMo failure can switch back to DeepSeek", async () => {
  const seen = [];
  const result = await handleOpenCodeGo(payload(GO_MODELS[1]), env, async (_, options) => {
    seen.push(JSON.parse(options.body).model);
    return seen.length === 1 ? new Response("busy", { status: 503 }) : success();
  });
  assert.deepEqual(seen, [...GO_MODELS].reverse());
  assert.equal(result.headers.get("X-Actual-Model"), GO_MODELS[0]);
});

test("authentication errors do not retry or expose upstream secrets", async () => {
  let calls = 0;
  const result = await handleOpenCodeGo(payload(), env, async () => {
    calls++;
    return new Response(env.OPENCODE_GO_API_KEY, { status: 401 });
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 401);
  assert.ok(!(await result.text()).includes(env.OPENCODE_GO_API_KEY));
});

test("both failures are bounded to two attempts", async () => {
  let calls = 0;
  const result = await handleOpenCodeGo(payload(), env, async () => {
    calls++;
    throw new Error("network error with sensitive details");
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes("sensitive details"));
});

test("missing key and unapproved models fail without any upstream request", async () => {
  const never = () => { assert.fail("unexpected fetch"); };
  assert.equal((await handleOpenCodeGo(payload(), {}, never)).status, 503);
  assert.equal((await handleOpenCodeGo(payload("gpt-anything"), env, never)).status, 400);
  assert.equal((await handleOpenCodeGo({ ...payload(), body: {} }, env, never)).status, 400);
});

test("legacy BYOK requests are left unchanged; legacy no-key requests use the Go default", async () => {
  const legacy = { ...payload("old-model"), provider: "deepseek", apiKey: "personal-key" };
  assert.equal(await handleOpenCodeGo(legacy, env), null);
  assert.equal(await handleOpenCodeGo({ ...legacy, apiKey: "" }, {}), null);
  const result = await handleOpenCodeGo({ ...legacy, apiKey: "" }, env, async (_, options) => {
    assert.equal(JSON.parse(options.body).model, GO_MODELS[0]);
    return success();
  });
  assert.equal(result.status, 200);
});

test("explicit Go BYOK takes precedence over backend credentials", async () => {
  await handleOpenCodeGo({ ...payload(), apiKey: "personal-go-key" }, env, async (_, options) => {
    assert.equal(options.headers.Authorization, "Bearer personal-go-key");
    return success();
  });
});

test("SSE is streamed without buffering and preserves the actual model", async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';
  const result = await handleOpenCodeGo(payload(GO_MODELS[1], true), env, async () =>
    new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
  assert.equal(result.headers.get("X-Actual-Model"), GO_MODELS[1]);
  assert.equal(await result.text(), sse);
});

test("empty response retries rather than returning a blank report", async () => {
  let calls = 0;
  const result = await handleOpenCodeGo(payload(), env, async () => {
    calls++;
    return calls === 1 ? Response.json({ choices: [] }) : success();
  });
  assert.equal(calls, 2);
  assert.equal(result.headers.get("X-AI-Fallback-Reason"), "empty_response");
});

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function loadSettings(saved) {
  const context = vm.createContext({ localStorage: { getItem: () => JSON.stringify(saved) } });
  const presetsStart = app.indexOf("const aiProviderPresets = {");
  const presetsEnd = app.indexOf("\n};", presetsStart) + 3;
  const defaultsStart = app.indexOf("function getDefaultAiSettings(");
  const defaultsEnd = app.indexOf("function readAiSettingsFromForm(", defaultsStart);
  const loadStart = app.indexOf("function loadAiSettings(");
  const loadEnd = app.indexOf("function saveAiSettings(", loadStart);
  vm.runInContext(app.slice(presetsStart, presetsEnd) + "\n" + app.slice(defaultsStart, defaultsEnd) + "\n" + app.slice(loadStart, loadEnd), context);
  return vm.runInContext("loadAiSettings()", context);
}

test("new and legacy keyless browser settings default to backend Go", () => {
  for (const saved of [null, { provider: "deepseek", model: "deepseek-v4-pro", apiKey: "" }]) {
    const settings = loadSettings(saved);
    assert.equal(settings.provider, "opencode-go");
    assert.equal(settings.model, GO_MODELS[0]);
    assert.equal(settings.apiKey, "");
  }
});

test("saved MiMo choice and existing personal keys survive migration", () => {
  assert.equal(loadSettings({ provider: "opencode-go", model: GO_MODELS[1], modelTier: GO_MODELS[1] }).model, GO_MODELS[1]);
  const personal = loadSettings({ provider: "deepseek", model: "deepseek-v4-pro", apiKey: "personal-key" });
  assert.equal(personal.provider, "deepseek");
  assert.equal(personal.apiKey, "personal-key");
});
