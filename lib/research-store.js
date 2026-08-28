"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function now() { return new Date().toISOString(); }
function clean(value, max = 100_000) { return String(value ?? "").trim().slice(0, max); }

class JsonResearchStore {
  constructor(filePath) { this.filePath = filePath; this.queue = Promise.resolve(); }
  _empty() { return { projects: [], sessions: [], messages: [], artifacts: [], files: [], chunks: [] }; }
  _read() {
    try { return { ...this._empty(), ...JSON.parse(fs.readFileSync(this.filePath, "utf8")) }; }
    catch (error) { if (error.code === "ENOENT") return this._empty(); throw error; }
  }
  _write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }
  _mutate(operation) {
    const next = this.queue.then(() => { const data = this._read(); const result = operation(data); this._write(data); return result; });
    this.queue = next.catch(() => {}); return next;
  }
  async listProjects(userId) { return this._read().projects.filter((p) => p.user_id === userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async createProject(userId, input) {
    return this._mutate((data) => {
      const id = clean(input.client_project_id, 128) || randomUUID();
      if (data.projects.some((p) => p.id === id)) { const error = new Error("PROJECT_ID_CONFLICT"); error.code = "CONFLICT"; throw error; }
      const timestamp = now();
      const project = { id, user_id: userId, title: clean(input.title, 200), client_name: clean(input.client_name, 200), brief: clean(input.brief), research_goal: clean(input.research_goal), status: clean(input.status, 32) || "active", created_at: timestamp, updated_at: timestamp };
      data.projects.push(project); return project;
    });
  }
  async getProject(userId, projectId) { return this._read().projects.find((p) => p.user_id === userId && p.id === projectId) || null; }
  async updateProject(userId, projectId, patch) {
    return this._mutate((data) => {
      const project = data.projects.find((p) => p.user_id === userId && p.id === projectId); if (!project) return null;
      for (const [key, max] of [["title", 200], ["client_name", 200], ["brief", 100_000], ["research_goal", 100_000], ["status", 32]]) if (Object.prototype.hasOwnProperty.call(patch, key)) project[key] = clean(patch[key], max);
      project.updated_at = now(); return project;
    });
  }
  async deleteProject(userId, projectId) {
    return this._mutate((data) => {
      const index = data.projects.findIndex((p) => p.user_id === userId && p.id === projectId); if (index < 0) return false;
      data.projects.splice(index, 1); data.sessions = data.sessions.filter((s) => s.project_id !== projectId); data.messages = data.messages.filter((m) => m.project_id !== projectId); data.artifacts = data.artifacts.filter((a) => a.project_id !== projectId); data.files = data.files.filter((file) => file.project_id !== projectId); data.chunks = data.chunks.filter((chunk) => chunk.project_id !== projectId); return true;
    });
  }
  async listMessages(projectId) { return this._read().messages.filter((m) => m.project_id === projectId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async findRequest(projectId, requestId) {
    const messages = this._read().messages; const user = messages.find((m) => m.project_id === projectId && m.role === "user" && m.client_request_id === requestId);
    return user ? { user, assistant: messages.find((m) => m.reply_to === user.id) || null } : null;
  }
  async saveExchange(projectId, requestId, userContent, assistantContent) {
    return this._mutate((data) => {
      const existing = data.messages.find((m) => m.project_id === projectId && m.role === "user" && m.client_request_id === requestId);
      if (existing) return { user: existing, assistant: data.messages.find((m) => m.reply_to === existing.id) || null, duplicate: true };
      const user = { id: randomUUID(), project_id: projectId, role: "user", content: userContent, client_request_id: requestId, reply_to: null, created_at: now() };
      const assistant = { id: randomUUID(), project_id: projectId, role: "assistant", content: assistantContent, client_request_id: null, reply_to: user.id, created_at: now() };
      data.messages.push(user, assistant); const project = data.projects.find((p) => p.id === projectId); if (project) project.updated_at = now();
      return { user, assistant, duplicate: false };
    });
  }
  async getSession(projectId) { return this._read().sessions.find((s) => s.project_id === projectId) || null; }
  async setSession(projectId, harnessSessionId) {
    return this._mutate((data) => {
      let session = data.sessions.find((s) => s.project_id === projectId);
      if (session) { session.harness_session_id = harnessSessionId; session.updated_at = now(); }
      else { session = { id: randomUUID(), project_id: projectId, harness_session_id: harnessSessionId, created_at: now(), updated_at: now() }; data.sessions.push(session); }
      return session;
    });
  }
  async listArtifacts(projectId) { return this._read().artifacts.filter((a) => a.project_id === projectId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async getArtifact(projectId, artifactId) { return this._read().artifacts.find((a) => a.project_id === projectId && a.id === artifactId) || null; }
  async createArtifact(projectId, input) {
    return this._mutate((data) => {
      const type = clean(input.type, 32) || "other"; const version = data.artifacts.filter((a) => a.project_id === projectId && a.type === type).reduce((max, a) => Math.max(max, a.version), 0) + 1; const timestamp = now();
      const parentArtifactId = clean(input.parent_artifact_id, 128) || null;
      if (parentArtifactId && !data.artifacts.some((artifact) => artifact.project_id === projectId && artifact.id === parentArtifactId && artifact.type === type)) { const error = new Error("ARTIFACT_PARENT_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; }
      const artifact = { id: randomUUID(), project_id: projectId, parent_artifact_id: parentArtifactId, type, title: clean(input.title, 300), version, content: clean(input.content, 2_000_000), created_at: timestamp, updated_at: timestamp };
      data.artifacts.push(artifact); return artifact;
    });
  }
  async updateArtifact(projectId, artifactId, patch) {
    return this._mutate((data) => { const artifact = data.artifacts.find((a) => a.project_id === projectId && a.id === artifactId); if (!artifact) return null; if (Object.prototype.hasOwnProperty.call(patch, "title")) artifact.title = clean(patch.title, 300); artifact.updated_at = now(); return artifact; });
  }
  async deleteArtifact(projectId, artifactId) { return this._mutate((data) => { const before = data.artifacts.length; data.artifacts = data.artifacts.filter((a) => !(a.project_id === projectId && a.id === artifactId)); data.artifacts.forEach((artifact) => { if (artifact.parent_artifact_id === artifactId) artifact.parent_artifact_id = null; }); return before !== data.artifacts.length; }); }
  async listFiles(projectId) { return this._read().files.filter((file) => file.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async getFile(projectId, fileId) { return this._read().files.find((file) => file.project_id === projectId && file.id === fileId) || null; }
  async createFile(userId, projectId, input) {
    return this._mutate((data) => {
      const timestamp = now();
      const file = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, user_id: userId, file_name: clean(input.file_name, 200), file_type: clean(input.file_type, 32), mime_type: clean(input.mime_type, 200), file_size: Number(input.file_size || 0), category: clean(input.category, 32) || "other", storage_path: clean(input.storage_path, 500), parse_status: "pending", parsed_text: "", summary: "", structured_data: "{}", parse_note: "", ocr_status: "not_requested", ocr_note: "", created_at: timestamp, updated_at: timestamp };
      data.files.push(file); return file;
    });
  }
  async updateFile(projectId, fileId, patch) {
    return this._mutate((data) => {
      const file = data.files.find((item) => item.project_id === projectId && item.id === fileId); if (!file) return null;
      for (const [key, max] of [["category", 32], ["parse_status", 32], ["parsed_text", 750_000], ["summary", 10_000], ["structured_data", 100_000], ["parse_note", 1_000], ["ocr_status", 32], ["ocr_note", 1_000]]) if (Object.prototype.hasOwnProperty.call(patch, key)) file[key] = clean(patch[key], max);
      file.updated_at = now(); return file;
    });
  }
  async deleteFile(projectId, fileId) { return this._mutate((data) => { const before = data.files.length; data.files = data.files.filter((file) => !(file.project_id === projectId && file.id === fileId)); data.chunks = data.chunks.filter((chunk) => !(chunk.project_id === projectId && chunk.file_id === fileId)); return before !== data.files.length; }); }
  async replaceFileChunks(projectId, fileId, chunks) {
    return this._mutate((data) => {
      data.chunks = data.chunks.filter((chunk) => !(chunk.project_id === projectId && chunk.file_id === fileId));
      const timestamp = now();
      const saved = chunks.map((chunk, index) => ({ id: randomUUID(), project_id: projectId, file_id: fileId, chunk_index: Number(chunk.chunk_index ?? index), heading: clean(chunk.heading, 200), content: clean(chunk.content, 8_000), char_count: Number(chunk.char_count || String(chunk.content || "").length), created_at: timestamp }));
      data.chunks.push(...saved); return saved;
    });
  }
  async listChunks(projectId) { return this._read().chunks.filter((chunk) => chunk.project_id === projectId).sort((a, b) => a.file_id.localeCompare(b.file_id) || a.chunk_index - b.chunk_index); }
}

function createJsonResearchStore(env = process.env) { return new JsonResearchStore(path.resolve(env.RESEARCH_DATA_FILE || path.join(__dirname, "..", ".data", "research.json"))); }
module.exports = { JsonResearchStore, createJsonResearchStore };
