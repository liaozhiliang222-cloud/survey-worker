PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_datasets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_file_id TEXT REFERENCES research_project_files(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('raw', 'cleaned', 'weighted')),
  parent_dataset_id TEXT REFERENCES research_datasets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'processing', 'failed')),
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  column_count INTEGER NOT NULL DEFAULT 0 CHECK (column_count >= 0),
  storage_key TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_datasets_project_created ON research_datasets(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_datasets_parent ON research_datasets(parent_dataset_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_datasets_raw_file ON research_datasets(project_id, source_file_id) WHERE type = 'raw' AND source_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_cleaning_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  source_dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  created_dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  rules TEXT NOT NULL,
  affected_rows INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_cleaning_logs_dataset ON research_cleaning_logs(source_dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_analysis_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('data_profile', 'crosstab')),
  input TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL,
  compact_result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_analysis_results_project ON research_analysis_results(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  claim TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  source_type TEXT NOT NULL CHECK (source_type IN ('crosstab', 'tool_result', 'file', 'artifact')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_evidence_project ON research_evidence(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_evidence_source ON research_evidence(source_type, source_id);

CREATE TABLE research_tool_results_v06 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL CHECK (tool_id IN ('sample-size', 'quota', 'questionnaire-check', 'data-profile', 'data-clean', 'crosstab')),
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  agent_call_id TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO research_tool_results_v06 SELECT id, project_id, user_id, tool_id, input, result, source, agent_call_id, created_at FROM research_tool_results;
DROP TABLE research_tool_results;
ALTER TABLE research_tool_results_v06 RENAME TO research_tool_results;
CREATE INDEX idx_research_tool_results_project_created ON research_tool_results(project_id, created_at DESC);
CREATE UNIQUE INDEX idx_research_tool_results_agent_call ON research_tool_results(project_id, agent_call_id) WHERE agent_call_id IS NOT NULL;

CREATE TABLE research_artifacts_v06 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'qualitative_summary', 'analysis', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts_v06(id) ON DELETE SET NULL,
  UNIQUE(project_id, type, version)
);

INSERT INTO research_artifacts_v06 SELECT id, project_id, type, title, version, content, created_at, updated_at, parent_artifact_id FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_v06 RENAME TO research_artifacts;
CREATE INDEX idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
CREATE INDEX idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);

CREATE TABLE research_workflows_v06 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('research_plan', 'data_analysis')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_input', 'completed', 'failed')),
  artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE SET NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE SET NULL,
  tool_calls TEXT NOT NULL DEFAULT '[]',
  tool_result_ids TEXT NOT NULL DEFAULT '[]',
  stages TEXT NOT NULL DEFAULT '[]',
  quality TEXT NOT NULL DEFAULT '{}',
  constraints TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, client_request_id)
);

INSERT INTO research_workflows_v06 SELECT id, project_id, client_request_id, task_type, status, artifact_id, parent_artifact_id, tool_calls, tool_result_ids, stages, quality, constraints, error, started_at, completed_at, duration_ms, created_at, updated_at FROM research_workflows;
DROP TABLE research_workflows;
ALTER TABLE research_workflows_v06 RENAME TO research_workflows;
CREATE INDEX idx_research_workflows_project_updated ON research_workflows(project_id, updated_at DESC);
CREATE INDEX idx_research_workflows_artifact ON research_workflows(artifact_id);
