"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { snapshotArtifact, annotateArtifacts } = require("./artifact-provenance");

function now() { return new Date().toISOString(); }
function clean(value, max = 100_000) { return String(value ?? "").trim().slice(0, max); }
function compareText(left, right) { return String(left ?? "").localeCompare(String(right ?? "")); }
function messageRoleRank(message) { return message.role === "user" ? 0 : message.role === "assistant" ? 1 : 2; }
function compareMessages(left, right) {
  return compareText(left.created_at, right.created_at)
    || compareText(left.reply_to || left.id, right.reply_to || right.id)
    || messageRoleRank(left) - messageRoleRank(right)
    || compareText(left.id, right.id);
}

class JsonResearchStore {
  constructor(filePath) { this.filePath = filePath; this.queue = Promise.resolve(); }
  _empty() { return { projects: [], sessions: [], messages: [], artifacts: [], files: [], chunks: [], toolResults: [], workflows: [], datasets: [], cleaningLogs: [], analysisResults: [], evidence: [], evidenceConflicts: [], evidenceGaps: [], dataJobs: [], transcripts: [], transcriptSegments: [], transcriptVersions: [], transcriptVersionSegments: [], transcriptCorrections: [], qualitativeCodes: [], qualitativeThemes: [], researchInsights: [], insightEvidence: [] }; }
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
      const project = { id, user_id: userId, title: clean(input.title, 200), client_name: clean(input.client_name, 200), brief: clean(input.brief), research_goal: clean(input.research_goal), constraints: clean(typeof input.constraints === "string" ? input.constraints : JSON.stringify(input.constraints || {}), 10_000) || "{}", status: clean(input.status, 32) || "active", created_at: timestamp, updated_at: timestamp };
      data.projects.push(project); return project;
    });
  }
  async getProject(userId, projectId) { return this._read().projects.find((p) => p.user_id === userId && p.id === projectId) || null; }
  async updateProject(userId, projectId, patch) {
    return this._mutate((data) => {
      const project = data.projects.find((p) => p.user_id === userId && p.id === projectId); if (!project) return null;
      for (const [key, max] of [["title", 200], ["client_name", 200], ["brief", 100_000], ["research_goal", 100_000], ["constraints", 10_000], ["status", 32]]) if (Object.prototype.hasOwnProperty.call(patch, key)) project[key] = clean(key === "constraints" && typeof patch[key] !== "string" ? JSON.stringify(patch[key] || {}) : patch[key], max);
      project.updated_at = now(); return project;
    });
  }
  async deleteProject(userId, projectId) {
    return this._mutate((data) => {
      const index = data.projects.findIndex((p) => p.user_id === userId && p.id === projectId); if (index < 0) return false;
      data.projects.splice(index, 1); data.sessions = data.sessions.filter((s) => s.project_id !== projectId); data.messages = data.messages.filter((m) => m.project_id !== projectId); data.artifacts = data.artifacts.filter((a) => a.project_id !== projectId); data.files = data.files.filter((file) => file.project_id !== projectId); data.chunks = data.chunks.filter((chunk) => chunk.project_id !== projectId); data.toolResults = data.toolResults.filter((item) => item.project_id !== projectId); data.workflows = data.workflows.filter((item) => item.project_id !== projectId); data.datasets = data.datasets.filter((item) => item.project_id !== projectId); data.cleaningLogs = data.cleaningLogs.filter((item) => item.project_id !== projectId); data.analysisResults = data.analysisResults.filter((item) => item.project_id !== projectId); data.evidence = data.evidence.filter((item) => item.project_id !== projectId); data.evidenceConflicts = data.evidenceConflicts.filter((item) => item.project_id !== projectId); data.evidenceGaps = data.evidenceGaps.filter((item) => item.project_id !== projectId); data.dataJobs = data.dataJobs.filter((item) => item.project_id !== projectId); data.transcripts = data.transcripts.filter((item) => item.project_id !== projectId); data.transcriptSegments = data.transcriptSegments.filter((item) => item.project_id !== projectId); data.transcriptVersions = data.transcriptVersions.filter((item) => item.project_id !== projectId); data.transcriptVersionSegments = data.transcriptVersionSegments.filter((item) => item.project_id !== projectId); data.transcriptCorrections = data.transcriptCorrections.filter((item) => item.project_id !== projectId); data.qualitativeCodes = data.qualitativeCodes.filter((item) => item.project_id !== projectId); data.qualitativeThemes = data.qualitativeThemes.filter((item) => item.project_id !== projectId); data.researchInsights = data.researchInsights.filter((item) => item.project_id !== projectId); data.insightEvidence = data.insightEvidence.filter((item) => item.project_id !== projectId); return true;
    });
  }
  async listMessages(projectId) { return this._read().messages.filter((m) => m.project_id === projectId).sort(compareMessages); }
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
  async listArtifacts(projectId) { const data=this._read();return annotateArtifacts(data.artifacts.filter(a=>a.project_id===projectId),{evidence:data.evidence.filter(e=>e.project_id===projectId),analysisResults:data.analysisResults.filter(a=>a.project_id===projectId)}).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)); }
  async getArtifact(projectId,artifactId) { return (await this.listArtifacts(projectId)).find(a=>a.id===artifactId)||null; }
  async createArtifact(projectId, input) {
    return this._mutate((data) => {
      const type = clean(input.type, 32) || "other"; const version = data.artifacts.filter((a) => a.project_id === projectId && a.type === type).reduce((max, a) => Math.max(max, a.version), 0) + 1; const timestamp = now();
      const parentArtifactId = clean(input.parent_artifact_id, 128) || null;
      if (parentArtifactId && !data.artifacts.some((artifact) => artifact.project_id === projectId && artifact.id === parentArtifactId && artifact.type === type)) { const error = new Error("ARTIFACT_PARENT_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; }
      const artifact = { id: randomUUID(), project_id: projectId, parent_artifact_id: parentArtifactId, type, title: clean(input.title, 300), version, content: clean(input.content, 2_000_000), created_at: timestamp, updated_at: timestamp };
      artifact.provenance=JSON.stringify(snapshotArtifact(artifact,{evidence:data.evidence.filter(e=>e.project_id===projectId),artifacts:data.artifacts.filter(a=>a.project_id===projectId)}));
      data.artifacts.push(artifact); return annotateArtifacts(data.artifacts.filter(a=>a.project_id===projectId),{evidence:data.evidence.filter(e=>e.project_id===projectId),analysisResults:data.analysisResults.filter(a=>a.project_id===projectId)}).find(a=>a.id===artifact.id);
    });
  }
  async updateArtifact(projectId, artifactId, patch) {
    return this._mutate((data) => { const artifact = data.artifacts.find((a) => a.project_id === projectId && a.id === artifactId); if (!artifact) return null; if (Object.prototype.hasOwnProperty.call(patch, "title")) artifact.title = clean(patch.title, 300); if (Object.prototype.hasOwnProperty.call(patch, "content")) { artifact.content = clean(patch.content, 2_000_000); artifact.provenance=JSON.stringify(snapshotArtifact(artifact,{evidence:data.evidence.filter(e=>e.project_id===projectId),artifacts:data.artifacts.filter(a=>a.project_id===projectId)})); } artifact.updated_at = now(); return artifact; });
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
  async deleteFile(projectId, fileId) { return this._mutate((data) => { if (data.datasets.some((item) => item.project_id === projectId && item.source_file_id === fileId)) { const error = new Error("DATASET_SOURCE_FILE_IN_USE"); error.code = "CONFLICT"; throw error; } const transcriptIds = new Set(data.transcripts.filter((item) => item.project_id === projectId && item.file_id === fileId).map((item) => item.id)); const before = data.files.length; data.files = data.files.filter((file) => !(file.project_id === projectId && file.id === fileId)); data.chunks = data.chunks.filter((chunk) => !(chunk.project_id === projectId && chunk.file_id === fileId)); data.transcripts = data.transcripts.filter((item) => !(item.project_id === projectId && item.file_id === fileId)); data.transcriptSegments = data.transcriptSegments.filter((item) => !transcriptIds.has(item.transcript_id)); data.transcriptVersions = data.transcriptVersions.filter((item) => !transcriptIds.has(item.transcript_id)); data.transcriptVersionSegments = data.transcriptVersionSegments.filter((item) => !transcriptIds.has(item.transcript_id)); data.transcriptCorrections = data.transcriptCorrections.filter((item) => !transcriptIds.has(item.transcript_id)); return before !== data.files.length; }); }
  async replaceFileChunks(projectId, fileId, chunks) {
    return this._mutate((data) => {
      data.chunks = data.chunks.filter((chunk) => !(chunk.project_id === projectId && chunk.file_id === fileId));
      const timestamp = now();
      const saved = chunks.map((chunk, index) => ({ id: randomUUID(), project_id: projectId, file_id: fileId, chunk_index: Number(chunk.chunk_index ?? index), heading: clean(chunk.heading, 200), content: clean(chunk.content, 8_000), char_count: Number(chunk.char_count || String(chunk.content || "").length), created_at: timestamp }));
      data.chunks.push(...saved); return saved;
    });
  }
  async listChunks(projectId) { return this._read().chunks.filter((chunk) => chunk.project_id === projectId).sort((a, b) => a.file_id.localeCompare(b.file_id) || a.chunk_index - b.chunk_index); }
  async getProjectByHarnessSession(harnessSessionId) {
    const data = this._read();
    const session = data.sessions.find((item) => item.harness_session_id === harnessSessionId);
    if (!session) return null;
    const project = data.projects.find((item) => item.id === session.project_id);
    return project ? { project, user_id: project.user_id } : null;
  }
  async listToolResults(projectId) { return this._read().toolResults.filter((item) => item.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async findToolResultByAgentCallId(projectId, agentCallId) { return this._read().toolResults.find((item) => item.project_id === projectId && item.agent_call_id === agentCallId) || null; }
  async createToolResult(userId, projectId, toolId, input, result, metadata = {}) {
    return this._mutate((data) => {
      if (metadata.agent_call_id) {
        const existing = data.toolResults.find((item) => item.project_id === projectId && item.agent_call_id === metadata.agent_call_id);
        if (existing) return existing;
      }
      const item = {
        id: randomUUID(),
        project_id: projectId,
        user_id: userId,
        tool_id: clean(toolId, 64),
        input: JSON.stringify(input ?? {}),
        result: JSON.stringify(result ?? {}),
        source: metadata.source === "agent" ? "agent" : "user",
        agent_call_id: metadata.agent_call_id ? clean(metadata.agent_call_id, 160) : null,
        created_at: now(),
      };
      data.toolResults.push(item);
      const project = data.projects.find((candidate) => candidate.id === projectId);
      if (project) project.updated_at = now();
      return item;
    });
  }
  async listDatasets(projectId) { return this._read().datasets.filter((item) => item.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async getDataset(projectId, datasetId) { return this._read().datasets.find((item) => item.project_id === projectId && item.id === datasetId) || null; }
  async createDataset(userId, projectId, input) {
    return this._mutate((data) => {
      if (input.type === "raw" && input.source_file_id) { const existing = data.datasets.find((item) => item.project_id === projectId && item.type === "raw" && item.source_file_id === input.source_file_id); if (existing) return existing; }
      if (input.parent_dataset_id && !data.datasets.some((item) => item.project_id === projectId && item.id === input.parent_dataset_id)) { const error = new Error("DATASET_PARENT_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; }
      const timestamp = now(); const dataset = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, user_id: userId, name: clean(input.name, 300), source_file_id: clean(input.source_file_id, 128) || null, type: clean(input.type, 32), parent_dataset_id: clean(input.parent_dataset_id, 128) || null, status: clean(input.status, 32) || "ready", row_count: Math.max(0, Number(input.row_count || 0)), column_count: Math.max(0, Number(input.column_count || 0)), storage_path: clean(input.storage_key || input.storage_path, 500), metadata: typeof input.metadata === "string" ? input.metadata : JSON.stringify(input.metadata || {}), created_at: timestamp, updated_at: timestamp };
      data.datasets.push(dataset); return dataset;
    });
  }
  async createCleaningLog(projectId, input) { return this._mutate((data) => { const item = { id: randomUUID(), project_id: projectId, source_dataset_id: clean(input.source_dataset_id, 128), created_dataset_id: clean(input.created_dataset_id, 128), rules: JSON.stringify(input.rules || []), affected_rows: Math.max(0, Number(input.affected_rows || 0)), summary: JSON.stringify(input.summary || {}), created_at: now() }; data.cleaningLogs.push(item); return item; }); }
  async listCleaningLogs(projectId) { return this._read().cleaningLogs.filter((item) => item.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async createAnalysisResult(projectId, input) { return this._mutate((data) => { const item = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, dataset_id: clean(input.dataset_id, 128), type: clean(input.type, 32), input: JSON.stringify(input.input || {}), result: JSON.stringify(input.result || {}), compact_result: JSON.stringify(input.compact_result || {}), created_at: now() }; data.analysisResults.push(item); return item; }); }
  async listAnalysisResults(projectId) { return this._read().analysisResults.filter((item) => item.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async getAnalysisResult(projectId, resultId) { return this._read().analysisResults.find((item) => item.project_id === projectId && item.id === resultId) || null; }
  async createEvidence(projectId, input) { return this._mutate((data) => { const timestamp = now(); const sourceType = clean(input.source_type, 32); const type = clean(input.type, 64) || (sourceType === "crosstab" ? "quantitative" : sourceType === "transcript_segment" ? "transcript_quote" : sourceType === "tool_result" ? "tool_result" : sourceType === "file" ? "project_file" : "artifact"); const strength = ["strong", "medium", "weak"].includes(input.strength) ? input.strength : type === "quantitative" || sourceType === "crosstab" || sourceType === "tool_result" ? "strong" : type === "transcript_quote" || sourceType === "transcript_segment" ? "weak" : "medium"; const item = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, type, claim: clean(input.claim, 2_000), value: JSON.stringify(input.value || {}), source_type: sourceType, source_id: clean(input.source_id, 128), strength, theme: clean(input.theme, 200), excluded: Boolean(input.excluded), metadata: JSON.stringify(input.metadata || {}), created_at: timestamp, updated_at: timestamp }; data.evidence.push(item); return item; }); }
  async getEvidence(projectId, evidenceId) { return this._read().evidence.find((item) => item.project_id === projectId && item.id === evidenceId) || null; }
  async listEvidence(projectId, filters = {}) { const query = clean(filters.query, 500).toLowerCase(); const type = clean(filters.type, 64); const theme = clean(filters.theme, 200).toLowerCase(); return this._read().evidence.filter((item) => item.project_id === projectId && (!type || item.type === type) && (!theme || clean(item.theme, 200).toLowerCase().includes(theme)) && (!query || `${item.claim} ${item.theme} ${item.source_type}`.toLowerCase().includes(query))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, Math.max(1, Math.min(200, Number(filters.limit || 200)))); }
  async updateEvidence(projectId, evidenceId, patch) { return this._mutate((data) => { const item = data.evidence.find((candidate) => candidate.project_id === projectId && candidate.id === evidenceId); if (!item) return null; if (Object.prototype.hasOwnProperty.call(patch, "excluded")) item.excluded = Boolean(patch.excluded); if (Object.prototype.hasOwnProperty.call(patch, "strength") && ["strong", "medium", "weak"].includes(patch.strength)) item.strength = patch.strength; if (Object.prototype.hasOwnProperty.call(patch, "theme")) item.theme = clean(patch.theme, 200); item.updated_at = now(); return item; }); }
  async listTranscripts(projectId) { return this._read().transcripts.filter((item) => item.project_id === projectId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async getTranscript(projectId, transcriptId) { return this._read().transcripts.find((item) => item.project_id === projectId && item.id === transcriptId) || null; }
  async getTranscriptByFile(projectId, fileId) { return this._read().transcripts.find((item) => item.project_id === projectId && item.file_id === fileId) || null; }
  async upsertTranscript(projectId, input) { return this._mutate((data) => { const timestamp = now(); let item = data.transcripts.find((candidate) => candidate.project_id === projectId && candidate.file_id === input.file_id); if (!item) { item = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, file_id: clean(input.file_id, 128), created_at: timestamp }; data.transcripts.push(item); } for (const [key, max] of [["title", 300], ["interview_type", 32], ["respondent_label", 300], ["respondent_metadata", 20_000], ["status", 32], ["summary", 20_000], ["source_fingerprint", 500], ["deep_summary", 40_000], ["summary_status", 32], ["summary_model", 300], ["summary_source_fingerprint", 500], ["summary_generated_at", 100], ["summary_error", 2_000]]) if (Object.prototype.hasOwnProperty.call(input, key)) item[key] = clean(key === "respondent_metadata" && typeof input[key] !== "string" ? JSON.stringify(input[key] || {}) : input[key], max); if (Object.prototype.hasOwnProperty.call(input, "word_count")) item.word_count = Math.max(0, Number(input.word_count || 0)); if (Object.prototype.hasOwnProperty.call(input, "segment_count")) item.segment_count = Math.max(0, Number(input.segment_count || 0)); item.summary_status ||= "pending"; item.deep_summary ||= ""; item.updated_at = timestamp; return item; }); }
  async updateTranscript(projectId, transcriptId, patch) { return this._mutate((data) => { const item = data.transcripts.find((candidate) => candidate.project_id === projectId && candidate.id === transcriptId); if (!item) return null; for (const [key, max] of [["title", 300], ["interview_type", 32], ["respondent_label", 300], ["respondent_metadata", 20_000], ["summary", 20_000], ["deep_summary", 40_000], ["summary_status", 32], ["summary_model", 300], ["summary_source_fingerprint", 500], ["summary_generated_at", 100], ["summary_error", 2_000]]) if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = clean(key === "respondent_metadata" && typeof patch[key] !== "string" ? JSON.stringify(patch[key] || {}) : patch[key], max); item.updated_at = now(); return item; }); }
  async claimTranscriptSummary(projectId, transcriptId, { force = false, staleBefore = "" } = {}) { return this._mutate((data) => { const item = data.transcripts.find((candidate) => candidate.project_id === projectId && candidate.id === transcriptId); if (!item || item.status !== "ready") return null; const stale = item.summary_status === "processing" && String(item.updated_at || "") <= String(staleBefore || ""); const claimable = (force && item.summary_status === "ready") || !item.summary_status || ["pending", "failed"].includes(item.summary_status) || stale; if (!claimable) return null; item.summary_status = "processing"; item.summary_error = ""; item.updated_at = now(); return item; }); }
  async completeTranscriptSummary(projectId, transcriptId, sourceFingerprint, patch) { return this._mutate((data) => { const item = data.transcripts.find((candidate) => candidate.project_id === projectId && candidate.id === transcriptId); if (!item || item.source_fingerprint !== sourceFingerprint) return item || null; for (const [key, max] of [["deep_summary", 40_000], ["summary_status", 32], ["summary_model", 300], ["summary_source_fingerprint", 500], ["summary_generated_at", 100], ["summary_error", 2_000]]) if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = clean(patch[key], max); item.updated_at = now(); return item; }); }
  async replaceTranscriptSegments(projectId, transcriptId, segments) { return this._mutate((data) => { if (!data.transcripts.some((item) => item.project_id === projectId && item.id === transcriptId)) { const error = new Error("TRANSCRIPT_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; } data.transcriptSegments = data.transcriptSegments.filter((item) => !(item.project_id === projectId && item.transcript_id === transcriptId)); const timestamp = now(); const saved = (segments || []).map((segment, index) => ({ id: clean(segment.id, 128) || randomUUID(), project_id: projectId, transcript_id: transcriptId, sequence: Number(segment.sequence ?? index), speaker: clean(segment.speaker, 200) || "unknown", content: clean(segment.content, 8_000), start_offset: Math.max(0, Number(segment.start_offset || 0)), end_offset: Math.max(0, Number(segment.end_offset || 0)), metadata: clean(typeof segment.metadata === "string" ? segment.metadata : JSON.stringify(segment.metadata || {}), 20_000), created_at: timestamp })); data.transcriptSegments.push(...saved); return saved; }); }
  async listTranscriptSegments(projectId, transcriptId) { return this._read().transcriptSegments.filter((item) => item.project_id === projectId && item.transcript_id === transcriptId).sort((a, b) => a.sequence - b.sequence); }
  async getTranscriptSegment(projectId, transcriptId, segmentId) { return this._read().transcriptSegments.find((item) => item.project_id === projectId && item.transcript_id === transcriptId && item.id === segmentId) || null; }
  async listTranscriptVersions(projectId, transcriptId = "") { return this._read().transcriptVersions.filter((item) => item.project_id === projectId && (!transcriptId || item.transcript_id === transcriptId)).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async getTranscriptVersion(projectId, versionId) { return this._read().transcriptVersions.find((item) => item.project_id === projectId && item.id === versionId) || null; }
  async ensureRawTranscriptVersion(projectId, transcript, rawSegments) {
    return this._mutate((data) => {
      const existing = data.transcriptVersions.find((item) => item.project_id === projectId && item.transcript_id === transcript.id && item.type === "raw" && item.source_fingerprint === transcript.source_fingerprint);
      if (existing) return existing;
      const timestamp = now(); const version = data.transcriptVersions.filter((item) => item.project_id === projectId && item.transcript_id === transcript.id && item.type === "raw").reduce((max, item) => Math.max(max, Number(item.version || 0)), 0) + 1;
      const record = { id: randomUUID(), project_id: projectId, transcript_id: transcript.id, version, type: "raw", status: "confirmed", source_fingerprint: transcript.source_fingerprint || "", parent_version_id: null, segment_count: rawSegments.length, auto_applied_count: 0, pending_review_count: 0, model: "", terminology: "[]", error: "", confirmed_at: timestamp, created_at: timestamp, updated_at: timestamp };
      data.transcriptVersions.push(record);
      data.transcriptVersionSegments.push(...rawSegments.map((segment, index) => ({ id: randomUUID(), project_id: projectId, transcript_id: transcript.id, version_id: record.id, raw_segment_id: segment.id, sequence: Number(segment.sequence ?? index), speaker: clean(segment.speaker, 200) || "unknown", content: clean(segment.content, 8_000), metadata: clean(segment.metadata, 20_000) || "{}", created_at: timestamp, updated_at: timestamp })));
      return record;
    });
  }
  async createCorrectedTranscriptVersion(projectId, transcript, rawVersion, rawSegments, input = {}) {
    return this._mutate((data) => {
      if (!data.transcriptVersions.some((item) => item.project_id === projectId && item.id === rawVersion.id && item.type === "raw")) { const error = new Error("RAW_TRANSCRIPT_VERSION_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; }
      const timestamp = now(); const version = data.transcriptVersions.filter((item) => item.project_id === projectId && item.transcript_id === transcript.id && item.type === "corrected").reduce((max, item) => Math.max(max, Number(item.version || 0)), 0) + 1;
      const record = { id: randomUUID(), project_id: projectId, transcript_id: transcript.id, version, type: "corrected", status: "processing", source_fingerprint: transcript.source_fingerprint || "", parent_version_id: rawVersion.id, segment_count: rawSegments.length, auto_applied_count: 0, pending_review_count: 0, model: clean(input.model, 300), terminology: JSON.stringify(input.terminology || []), error: "", confirmed_at: null, created_at: timestamp, updated_at: timestamp };
      data.transcriptVersions.push(record);
      data.transcriptVersionSegments.push(...rawSegments.map((segment, index) => ({ id: randomUUID(), project_id: projectId, transcript_id: transcript.id, version_id: record.id, raw_segment_id: segment.id, sequence: Number(segment.sequence ?? index), speaker: clean(segment.speaker, 200) || "unknown", content: clean(segment.content, 8_000), metadata: clean(segment.metadata, 20_000) || "{}", created_at: timestamp, updated_at: timestamp })));
      return record;
    });
  }
  async updateTranscriptVersion(projectId, versionId, patch) { return this._mutate((data) => { const item = data.transcriptVersions.find((candidate) => candidate.project_id === projectId && candidate.id === versionId); if (!item) return null; for (const key of ["status", "model", "error"]) if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = clean(patch[key], key === "error" ? 2_000 : 300); for (const key of ["segment_count", "auto_applied_count", "pending_review_count"]) if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = Math.max(0, Number(patch[key] || 0)); if (Object.prototype.hasOwnProperty.call(patch, "confirmed_at")) item.confirmed_at = patch.confirmed_at || null; item.updated_at = now(); return item; }); }
  async listTranscriptVersionSegments(projectId, versionId) { return this._read().transcriptVersionSegments.filter((item) => item.project_id === projectId && item.version_id === versionId).sort((a, b) => a.sequence - b.sequence); }
  async getTranscriptVersionSegment(projectId, versionId, segmentId) { return this._read().transcriptVersionSegments.find((item) => item.project_id === projectId && item.version_id === versionId && item.id === segmentId) || null; }
  async getTranscriptVersionSegmentByRaw(projectId, versionId, rawSegmentId) { return this._read().transcriptVersionSegments.find((item) => item.project_id === projectId && item.version_id === versionId && item.raw_segment_id === rawSegmentId) || null; }
  async updateTranscriptVersionSegment(projectId, versionId, segmentId, patch) { return this._mutate((data) => { const item = data.transcriptVersionSegments.find((candidate) => candidate.project_id === projectId && candidate.version_id === versionId && candidate.id === segmentId); if (!item) return null; if (Object.prototype.hasOwnProperty.call(patch, "content")) item.content = clean(patch.content, 8_000); if (Object.prototype.hasOwnProperty.call(patch, "speaker")) item.speaker = clean(patch.speaker, 200) || "unknown"; item.updated_at = now(); return item; }); }
  async createTranscriptCorrection(projectId, input) { return this._mutate((data) => { const version = data.transcriptVersions.find((item) => item.project_id === projectId && item.id === input.version_id); const segment = data.transcriptVersionSegments.find((item) => item.project_id === projectId && item.id === input.segment_id && item.version_id === input.version_id); if (!version || !segment || version.transcript_id !== input.transcript_id) { const error = new Error("TRANSCRIPT_CORRECTION_SCOPE_INVALID"); error.code = "NOT_FOUND"; throw error; } const timestamp = now(); const item = { id: randomUUID(), project_id: projectId, transcript_id: input.transcript_id, version_id: input.version_id, segment_id: input.segment_id, raw_segment_id: clean(input.raw_segment_id, 128), original_text: clean(input.original_text, 8_000), corrected_text: clean(input.corrected_text, 8_000), reason: clean(input.reason, 32), confidence: clean(input.confidence, 32), status: clean(input.status, 32), batch_index: Math.max(0, Number(input.batch_index || 0)), note: clean(input.note, 500), created_at: timestamp, updated_at: timestamp, reviewed_at: null }; data.transcriptCorrections.push(item); return item; }); }
  async listTranscriptCorrections(projectId, versionId) { return this._read().transcriptCorrections.filter((item) => item.project_id === projectId && item.version_id === versionId).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
  async getTranscriptCorrection(projectId, correctionId) { return this._read().transcriptCorrections.find((item) => item.project_id === projectId && item.id === correctionId) || null; }
  async resolveTranscriptCorrection(projectId, correctionId, decision) { return this._mutate((data) => { const item = data.transcriptCorrections.find((candidate) => candidate.project_id === projectId && candidate.id === correctionId); if (!item) return null; if (item.status !== "pending_review") return { correction: item, version: data.transcriptVersions.find((version) => version.id === item.version_id), idempotent: true }; const segment = data.transcriptVersionSegments.find((candidate) => candidate.project_id === projectId && candidate.id === item.segment_id && candidate.version_id === item.version_id); if (!segment) { const error = new Error("TRANSCRIPT_SEGMENT_NOT_FOUND"); error.code = "NOT_FOUND"; throw error; } if (decision === "accept") { const matches = item.reason === "speaker" ? segment.speaker === item.original_text : String(segment.content).includes(item.original_text); if (!matches) { const error = new Error("待复核原文已发生变化，请刷新后重试。"); error.code = "TRANSCRIPT_CORRECTION_CONFLICT"; throw error; } if (item.reason === "speaker") segment.speaker = item.corrected_text; else segment.content = String(segment.content).replace(item.original_text, item.corrected_text); segment.updated_at = now(); item.status = "accepted"; } else item.status = "rejected"; item.reviewed_at = now(); item.updated_at = now(); const version = data.transcriptVersions.find((candidate) => candidate.project_id === projectId && candidate.id === item.version_id); const pending = data.transcriptCorrections.filter((candidate) => candidate.project_id === projectId && candidate.version_id === item.version_id && candidate.status === "pending_review").length; version.pending_review_count = pending; if (!pending) { version.status = "confirmed"; version.confirmed_at = now(); } version.updated_at = now(); return { correction: item, version, idempotent: false }; }); }
  async getPreferredTranscriptVersion(projectId, transcriptId, { includeReview = false } = {}) { const data = this._read(); const transcript = data.transcripts.find((item) => item.project_id === projectId && item.id === transcriptId); if (!transcript) return null; const versions = data.transcriptVersions.filter((item) => item.project_id === projectId && item.transcript_id === transcriptId && item.source_fingerprint === transcript.source_fingerprint && item.type === "corrected" && (item.status === "confirmed" || (includeReview && item.status === "review_required"))).sort((a, b) => b.version - a.version); return versions[0] || null; }
  async createQualitativeCode(projectId, input) { return this._mutate((data) => { const item = { id: randomUUID(), project_id: projectId, name: clean(input.name, 300), description: clean(input.description, 5_000), parent_code_id: clean(input.parent_code_id, 128) || null, created_at: now() }; data.qualitativeCodes.push(item); return item; }); }
  async createQualitativeTheme(projectId, input) { return this._mutate((data) => { const item = { id: randomUUID(), project_id: projectId, name: clean(input.name, 300), description: clean(input.description, 5_000), code_ids: JSON.stringify(input.code_ids || []), frequency: Math.max(0, Number(input.frequency || 0)), coverage: Math.max(0, Number(input.coverage || 0)), metadata: JSON.stringify(input.metadata || {}), created_at: now() }; data.qualitativeThemes.push(item); return item; }); }
  async createResearchInsight(projectId, input) { return this._mutate((data) => { const timestamp = now(); const item = { id: randomUUID(), project_id: projectId, title: clean(input.title, 300), statement: clean(input.statement, 5_000), interpretation: clean(input.interpretation, 20_000), business_implication: clean(input.business_implication, 10_000), confidence: ["insufficient", "low", "medium", "high"].includes(input.confidence) ? input.confidence : "low", level: ["core", "supporting", "finding"].includes(input.level) ? input.level : "finding", status: ["candidate", "validated", "conflicted", "needs_evidence", "excluded"].includes(input.status) ? input.status : "validated", is_pinned: Boolean(input.is_pinned), theme_id: clean(input.theme_id, 128) || null, artifact_id: clean(input.artifact_id, 128) || null, metadata: JSON.stringify(input.metadata || {}), created_at: timestamp, updated_at: timestamp }; data.researchInsights.push(item); return item; }); }
  async getResearchInsight(projectId, insightId) { const data = this._read(); const item = data.researchInsights.find((candidate) => candidate.project_id === projectId && candidate.id === insightId); if (!item) return null; return { ...item, evidence_ids: data.insightEvidence.filter((link) => link.project_id === projectId && link.insight_id === item.id).map((link) => link.evidence_id) }; }
  async listResearchInsights(projectId, artifactId = "") { const data = this._read(); return data.researchInsights.filter((item) => item.project_id === projectId && (!artifactId || item.artifact_id === artifactId)).map((item) => ({ ...item, evidence_ids: data.insightEvidence.filter((link) => link.project_id === projectId && link.insight_id === item.id).map((link) => link.evidence_id) })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }
  async updateResearchInsight(projectId, insightId, patch) { return this._mutate((data) => { const item = data.researchInsights.find((candidate) => candidate.project_id === projectId && candidate.id === insightId); if (!item) return null; for (const [key, max] of [["title", 300], ["statement", 5_000], ["interpretation", 20_000], ["business_implication", 10_000], ["artifact_id", 128]]) if (Object.prototype.hasOwnProperty.call(patch, key)) item[key] = clean(patch[key], max) || (key === "artifact_id" ? null : ""); if (Object.prototype.hasOwnProperty.call(patch, "confidence") && ["insufficient", "low", "medium", "high"].includes(patch.confidence)) item.confidence = patch.confidence; if (Object.prototype.hasOwnProperty.call(patch, "level") && ["core", "supporting", "finding"].includes(patch.level)) item.level = patch.level; if (Object.prototype.hasOwnProperty.call(patch, "status") && ["candidate", "validated", "conflicted", "needs_evidence", "excluded"].includes(patch.status)) item.status = patch.status; if (Object.prototype.hasOwnProperty.call(patch, "is_pinned")) item.is_pinned = Boolean(patch.is_pinned); item.updated_at = now(); return { ...item, evidence_ids: data.insightEvidence.filter((link) => link.project_id === projectId && link.insight_id === item.id).map((link) => link.evidence_id) }; }); }
  async linkInsightEvidence(projectId, insightId, evidenceId) { return this._mutate((data) => { if (!data.researchInsights.some((item) => item.project_id === projectId && item.id === insightId) || !data.evidence.some((item) => item.project_id === projectId && item.id === evidenceId)) { const error = new Error("INSIGHT_EVIDENCE_SCOPE_INVALID"); error.code = "NOT_FOUND"; throw error; } const existing = data.insightEvidence.find((item) => item.project_id === projectId && item.insight_id === insightId && item.evidence_id === evidenceId); if (existing) return existing; const item = { project_id: projectId, insight_id: insightId, evidence_id: evidenceId, created_at: now() }; data.insightEvidence.push(item); return item; }); }
  async createEvidenceConflict(projectId, input) { return this._mutate((data) => { const item = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, artifact_id: clean(input.artifact_id, 128) || null, theme: clean(input.theme, 300), evidence_ids: JSON.stringify(input.evidence_ids || []), status: ["resolved", "segmented", "unresolved"].includes(input.status) ? input.status : "unresolved", explanation: clean(input.explanation, 5_000), created_at: now() }; data.evidenceConflicts.push(item); return item; }); }
  async listEvidenceConflicts(projectId, artifactId = "") { return this._read().evidenceConflicts.filter((item) => item.project_id === projectId && (!artifactId || item.artifact_id === artifactId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }
  async createEvidenceGap(projectId, input) { return this._mutate((data) => { const item = { id: clean(input.id, 128) || randomUUID(), project_id: projectId, artifact_id: clean(input.artifact_id, 128) || null, claim: clean(input.claim, 2_000), reason: clean(input.reason, 5_000), recommendation: clean(input.recommendation, 5_000), page_refs: JSON.stringify(input.page_refs || []), status: "open", created_at: now(), updated_at: now() }; data.evidenceGaps.push(item); return item; }); }
  async listEvidenceGaps(projectId, artifactId = "") { return this._read().evidenceGaps.filter((item) => item.project_id === projectId && (!artifactId || item.artifact_id === artifactId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); }
  async createDataJob(userId, projectId, input) { return this._mutate((data) => {
    const prior = input.idempotency_key && data.dataJobs.find((j) => j.project_id === projectId && j.idempotency_key === input.idempotency_key);
    if (prior) return prior;
    const timestamp = now(); const item = { id: randomUUID(), project_id: projectId, user_id: userId, dataset_id: input.dataset_id, tool_id: input.tool_id, status: "pending", progress: 0, input: JSON.stringify(input.input || {}), result: "{}", error: "", idempotency_key: input.idempotency_key || randomUUID(), request_hash: input.request_hash || '', attempt: 0, lease_token: null, lease_expires_at: null, heartbeat_at: null, deadline_at: null, created_at: timestamp, updated_at: timestamp, completed_at: null }; data.dataJobs.push(item); return item;
  }); }
  async getDataJob(pid, id) { return this._read().dataJobs.find((j) => j.project_id === pid && j.id === id) || null; }
  async listDataJobs(pid) { return this._read().dataJobs.filter((j) => j.project_id === pid).sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,100); }
  async listRunnableDataJobs(limit = 4) { return this._read().dataJobs.filter((j) => j.status === 'pending').sort((a,b) => a.created_at.localeCompare(b.created_at)).slice(0,limit); }
  async claimDataJob(pid, id, token, lease, timeout) { return this._mutate((data) => {
    const j = data.dataJobs.find((j) => j.project_id === pid && j.id === id); if (!j || j.status !== 'pending') return null;
    Object.assign(j, { status: 'running', progress: 10, lease_token: token, lease_expires_at: new Date(Date.now()+lease).toISOString(), heartbeat_at: now(), deadline_at: new Date(Date.now()+timeout).toISOString(), attempt: (j.attempt || 0)+1, updated_at: now() }); return j;
  }); }
  _liveJob(data, pid, id, token) { const j = data.dataJobs.find((j) => j.project_id === pid && j.id === id); return j?.status === 'running' && j.lease_token === token && j.lease_expires_at > now() && j.deadline_at > now() ? j : null; }
  async heartbeatDataJob(pid, id, token, lease) { return this._mutate((data) => { const j = this._liveJob(data,pid,id,token); if (!j) return false; j.heartbeat_at = now(); j.lease_expires_at = new Date(Math.min(Date.now()+lease,Date.parse(j.deadline_at))).toISOString(); j.updated_at = now(); return true; }); }
  async expireDataJobs() { if (!this._read().dataJobs.some((j) => j.status === "running")) return; return this._mutate((data) => { for (const j of data.dataJobs) if (j.status === 'running' && (!j.lease_expires_at || j.lease_expires_at <= now() || j.deadline_at <= now())) Object.assign(j,{ status:'failed', error:'DATA_JOB_LEASE_EXPIRED', lease_token:null, completed_at:now(), updated_at:now() }); }); }
  async failDataJob(pid,id,token,error) { return this._mutate((data) => { const j = data.dataJobs.find((j) => j.project_id === pid && j.id === id && j.status === 'running' && j.lease_token === token); if (j) Object.assign(j,{status:'failed',error,lease_token:null,completed_at:now(),updated_at:now()}); }); }
  async controlDataJob(pid,id,action) { return this._mutate((data) => { const j = data.dataJobs.find((j) => j.project_id === pid && j.id === id); if (!j) return null;
    if (action === 'cancel' && ['pending','running'].includes(j.status)) Object.assign(j,{status:'cancelled',lease_token:null,completed_at:now(),updated_at:now()});
    if (action === 'retry' && j.status === 'failed') Object.assign(j,{status:'pending',error:'',progress:0,lease_token:null,completed_at:null,updated_at:now()}); return j;
  }); }
  async publishDataJob(pid,id,token,records,result) { return this._mutate((data) => {
    const j = this._liveJob(data,pid,id,token); if (!j) return false;
    if (!data.projects.some((p) => p.id === pid) || !data.datasets.some((d) => d.id === j.dataset_id && d.project_id === pid)) throw new Error('DATA_JOB_SOURCE_MISSING');
    for (const key of ['datasets','files','cleaningLogs','analysisResults','evidence','toolResults']) for (const row of records[key]) {
      if (row.project_id !== pid || data[key].some((r) => r.id === row.id)) throw new Error('DATA_JOB_RECORD_CONFLICT');
      data[key].push(['datasets','files'].includes(key) ? {...row,storage_path:row.storage_key} : row);
    }
    Object.assign(j,{status:'completed',progress:100,result:JSON.stringify(result),error:'',lease_token:null,completed_at:now(),updated_at:now()}); return true;
  }); }
  async listWorkflows(projectId) { return this._read().workflows.filter((item) => item.project_id === projectId).sort((a, b) => b.updated_at.localeCompare(a.updated_at)); }
  async getWorkflow(projectId, workflowId) { return this._read().workflows.find((item) => item.project_id === projectId && item.id === workflowId) || null; }
  async findWorkflowByRequest(projectId, requestId) { return this._read().workflows.find((item) => item.project_id === projectId && item.client_request_id === requestId) || null; }
  async createWorkflow(projectId, input) {
    return this._mutate((data) => {
      const existing = data.workflows.find((item) => item.project_id === projectId && item.client_request_id === input.client_request_id);
      if (existing) return existing;
      const timestamp = now();
      const workflow = {
        id: clean(input.id, 128) || randomUUID(), project_id: projectId, client_request_id: clean(input.client_request_id, 128), task_type: ["research_plan", "data_analysis", "qualitative_analysis", "transcript_correction", "report_storyline", "ppt_script"].includes(input.task_type) ? input.task_type : "research_plan", status: "pending",
        artifact_id: null, parent_artifact_id: clean(input.parent_artifact_id, 128) || null, tool_calls: "[]", tool_result_ids: "[]", stages: "[]", quality: "{}",
        constraints: clean(typeof input.constraints === "string" ? input.constraints : JSON.stringify(input.constraints || {}), 10_000) || "{}", error: "", started_at: null, completed_at: null, duration_ms: null,
        created_at: timestamp, updated_at: timestamp,
      };
      data.workflows.push(workflow); return workflow;
    });
  }
  async updateWorkflow(projectId, workflowId, patch) {
    return this._mutate((data) => {
      const workflow = data.workflows.find((item) => item.project_id === projectId && item.id === workflowId); if (!workflow) return null;
      const timestamp = now();
      for (const [key, max] of [["status", 32], ["artifact_id", 128], ["parent_artifact_id", 128], ["tool_calls", 100_000], ["tool_result_ids", 100_000], ["stages", 100_000], ["quality", 100_000], ["constraints", 10_000], ["error", 10_000]]) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        const value = ["tool_calls", "tool_result_ids", "stages", "quality", "constraints"].includes(key) && typeof patch[key] !== "string" ? JSON.stringify(patch[key] ?? (key === "quality" || key === "constraints" ? {} : [])) : patch[key];
        workflow[key] = clean(value, max);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "started_at")) workflow.started_at = patch.started_at || null;
      if (Object.prototype.hasOwnProperty.call(patch, "completed_at")) workflow.completed_at = patch.completed_at || null;
      if (Object.prototype.hasOwnProperty.call(patch, "duration_ms")) workflow.duration_ms = Number.isFinite(Number(patch.duration_ms)) ? Math.max(0, Math.round(Number(patch.duration_ms))) : null;
      workflow.updated_at = timestamp; return workflow;
    });
  }
}

function createJsonResearchStore(env = process.env) { return new JsonResearchStore(path.resolve(env.RESEARCH_DATA_FILE || path.join(__dirname, "..", ".data", "research.json"))); }
module.exports = { JsonResearchStore, createJsonResearchStore };
