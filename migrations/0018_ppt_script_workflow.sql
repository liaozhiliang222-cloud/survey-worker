PRAGMA defer_foreign_keys = ON;

CREATE TABLE research_artifacts_v18 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'qualitative_summary', 'qualitative_analysis', 'interview_summary', 'analysis', 'report_outline', 'ppt_script', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts_v18(id) ON DELETE SET NULL,
  UNIQUE(project_id, type, version)
);

INSERT INTO research_artifacts_v18
SELECT id, project_id, type, title, version, content, created_at, updated_at, parent_artifact_id
FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_v18 RENAME TO research_artifacts;
CREATE INDEX idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
CREATE INDEX idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);

CREATE TABLE research_workflows_v18 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('research_plan', 'data_analysis', 'qualitative_analysis', 'transcript_correction', 'report_storyline', 'ppt_script')),
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

INSERT INTO research_workflows_v18
SELECT id, project_id, client_request_id, task_type, status, artifact_id, parent_artifact_id,
       tool_calls, tool_result_ids, stages, quality, constraints, error, started_at,
       completed_at, duration_ms, created_at, updated_at
FROM research_workflows;
DROP TABLE research_workflows;
ALTER TABLE research_workflows_v18 RENAME TO research_workflows;
CREATE INDEX idx_research_workflows_project_updated ON research_workflows(project_id, updated_at DESC);
CREATE INDEX idx_research_workflows_artifact ON research_workflows(artifact_id);
