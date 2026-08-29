import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createResearchStore } from "../functions/api/research/[[path]].js";

const require = createRequire(import.meta.url);
const { JsonResearchStore } = require("../lib/research-store.js");
const timestamp = "2026-08-29T04:00:00.000Z";
const messages = [
  { id: "assistant-z", project_id: "project", role: "assistant", content: "reply z", client_request_id: null, reply_to: "user-z", created_at: timestamp },
  { id: "user-z", project_id: "project", role: "user", content: "question z", client_request_id: "request-z", reply_to: null, created_at: timestamp },
  { id: "assistant-a", project_id: "project", role: "assistant", content: "reply a", client_request_id: null, reply_to: "user-a", created_at: timestamp },
  { id: "user-a", project_id: "project", role: "user", content: "question a", client_request_id: "request-a", reply_to: null, created_at: timestamp },
];
const expectedIds = ["user-a", "assistant-a", "user-z", "assistant-z"];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "surveykit-message-order-"));
try {
  const jsonPath = path.join(temp, "research.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ messages }));
  const jsonStore = new JsonResearchStore(jsonPath);
  assert.deepEqual((await jsonStore.listMessages("project")).map((message) => message.id), expectedIds);

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE research_messages (id TEXT PRIMARY KEY, project_id TEXT, role TEXT, content TEXT, client_request_id TEXT, reply_to TEXT, created_at TEXT)");
  const insert = sqlite.prepare("INSERT INTO research_messages VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const message of messages) insert.run(message.id, message.project_id, message.role, message.content, message.client_request_id, message.reply_to, message.created_at);
  const d1 = {
    prepare(sql) {
      return {
        bind(...args) {
          const statement = sqlite.prepare(sql);
          return {
            async all() { return { results: statement.all(...args) }; },
            async first() { return statement.get(...args) || null; },
            async run() { return statement.run(...args); },
          };
        },
      };
    },
  };
  const d1Store = createResearchStore(d1);
  assert.deepEqual((await d1Store.listMessages("project")).map((message) => message.id), expectedIds);
  sqlite.close();
  console.log("research-message-order-smoke: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
