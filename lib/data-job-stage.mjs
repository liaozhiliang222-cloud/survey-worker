// Only these records may be published by a deterministic data job.
export const jobTables = Object.freeze({ datasets: 'research_datasets', files: 'research_project_files', cleaningLogs: 'research_cleaning_logs', analysisResults: 'research_analysis_results', evidence: 'research_evidence', toolResults: 'research_tool_results' });

export function createJobStage(store, projectId, userId) {
  const records = Object.fromEntries(Object.keys(jobTables).map((name) => [name, []]));
  const add = (table, input, defaults = {}, jsonFields = []) => {
    const row = { id: crypto.randomUUID(), project_id: projectId, created_at: new Date().toISOString(), ...defaults, ...input };
    for (const field of jsonFields) row[field] = JSON.stringify(row[field] ?? {});
    records[table].push(row); return row;
  };
  const staged = {
    async createDataset(uid, pid, input) {
      const { storage_path, ...fields } = input;
      return add('datasets', { ...fields, storage_key: input.storage_key || storage_path || '' }, { user_id: userId, updated_at: new Date().toISOString() }, ['metadata']);
    },
    async createFile(uid, pid, input) {
      const { storage_path, ...fields } = input;
      return add('files', { ...fields, storage_key: input.storage_key || storage_path || '' }, { user_id: userId, parse_status: 'pending', parsed_text: '', summary: '', structured_data: '{}', parse_note: '', ocr_status: 'not_requested', ocr_note: '', updated_at: new Date().toISOString() });
    },
    async updateFile(pid, id, patch) { const row = records.files.find((r) => r.id === id); if (!row) throw new Error('JOB_STAGE_FILE_NOT_FOUND'); Object.assign(row, patch); return row; },
    async deleteFile(pid, id) { records.files = records.files.filter((r) => r.id !== id); },
    async createCleaningLog(pid, input) { return add('cleaningLogs', input, {}, ['rules', 'summary']); },
    async createAnalysisResult(pid, input) { return add('analysisResults', input, {}, ['input', 'result', 'compact_result']); },
    async createEvidence(pid, input) { return add('evidence', input, { excluded: 0, metadata: {}, updated_at: new Date().toISOString() }, ['value', 'metadata']); },
    async createToolResult(uid, pid, toolId, input, result, metadata = {}) { return add('toolResults', { tool_id: toolId, input, result }, { user_id: userId, source: metadata.agent_call_id ? 'agent' : 'user', agent_call_id: metadata.agent_call_id || null }, ['input', 'result']); },
  };
  return { records, store: new Proxy(staged, { get(target, key) { if (key in target) return target[key]; if (/^(create|update|delete|replace)/.test(String(key))) throw new Error(`JOB_MUTATION_UNSUPPORTED:${String(key)}`); return store[key]?.bind(store); } }) };
}
