PRAGMA defer_foreign_keys = ON;

ALTER TABLE research_evidence ADD COLUMN strength TEXT NOT NULL DEFAULT 'medium' CHECK (strength IN ('strong', 'medium', 'weak'));
ALTER TABLE research_evidence ADD COLUMN theme TEXT NOT NULL DEFAULT '';
ALTER TABLE research_evidence ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1));
ALTER TABLE research_evidence ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_evidence ADD COLUMN updated_at TEXT;

UPDATE research_evidence
SET type = CASE
  WHEN source_type = 'crosstab' THEN 'quantitative'
  WHEN source_type = 'transcript_segment' THEN 'transcript_quote'
  WHEN source_type = 'tool_result' THEN 'tool_result'
  WHEN source_type = 'file' THEN 'project_file'
  WHEN source_type = 'artifact' THEN 'artifact'
  ELSE type
END,
strength = CASE
  WHEN source_type IN ('crosstab', 'tool_result') THEN 'strong'
  WHEN source_type = 'transcript_segment' THEN 'weak'
  ELSE 'medium'
END,
updated_at = COALESCE(updated_at, created_at);

CREATE INDEX IF NOT EXISTS idx_research_evidence_storyline
  ON research_evidence(project_id, excluded, type, strength, created_at DESC);

ALTER TABLE research_insights ADD COLUMN business_implication TEXT NOT NULL DEFAULT '';
ALTER TABLE research_insights ADD COLUMN level TEXT NOT NULL DEFAULT 'finding' CHECK (level IN ('core', 'supporting', 'finding'));
ALTER TABLE research_insights ADD COLUMN status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('candidate', 'validated', 'conflicted', 'needs_evidence', 'excluded'));
ALTER TABLE research_insights ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));
ALTER TABLE research_insights ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_insights ADD COLUMN updated_at TEXT;
UPDATE research_insights SET updated_at = COALESCE(updated_at, created_at);
CREATE INDEX IF NOT EXISTS idx_research_insights_storyline
  ON research_insights(project_id, status, level, is_pinned, created_at DESC);

CREATE TABLE research_artifacts_v17 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'qualitative_summary', 'qualitative_analysis', 'interview_summary', 'analysis', 'report_outline', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts_v17(id) ON DELETE SET NULL,
  UNIQUE(project_id, type, version)
);

INSERT INTO research_artifacts_v17
SELECT id, project_id, type, title, version, content, created_at, updated_at, parent_artifact_id
FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_v17 RENAME TO research_artifacts;
CREATE INDEX idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
CREATE INDEX idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);

CREATE TABLE research_workflows_v17 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('research_plan', 'data_analysis', 'qualitative_analysis', 'transcript_correction', 'report_storyline')),
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

INSERT INTO research_workflows_v17
SELECT id, project_id, client_request_id, task_type, status, artifact_id, parent_artifact_id,
       tool_calls, tool_result_ids, stages, quality, constraints, error, started_at,
       completed_at, duration_ms, created_at, updated_at
FROM research_workflows;
DROP TABLE research_workflows;
ALTER TABLE research_workflows_v17 RENAME TO research_workflows;
CREATE INDEX idx_research_workflows_project_updated ON research_workflows(project_id, updated_at DESC);
CREATE INDEX idx_research_workflows_artifact ON research_workflows(artifact_id);

CREATE TABLE research_evidence_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT '',
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK (status IN ('resolved', 'segmented', 'unresolved')),
  explanation TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_research_evidence_conflicts_artifact ON research_evidence_conflicts(project_id, artifact_id, created_at DESC);

CREATE TABLE research_evidence_gaps (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  page_refs TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_research_evidence_gaps_artifact ON research_evidence_gaps(project_id, artifact_id, status, created_at DESC);

