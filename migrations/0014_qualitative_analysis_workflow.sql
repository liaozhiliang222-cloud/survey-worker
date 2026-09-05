PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_transcripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES research_project_files(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  interview_type TEXT NOT NULL DEFAULT 'other' CHECK (interview_type IN ('expert', 'consumer', 'internal', 'other')),
  respondent_label TEXT NOT NULL DEFAULT '',
  respondent_metadata TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  segment_count INTEGER NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  summary TEXT NOT NULL DEFAULT '',
  source_fingerprint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_research_transcripts_project_updated ON research_transcripts(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_transcripts_file ON research_transcripts(file_id);

CREATE TABLE IF NOT EXISTS research_transcript_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES research_transcripts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  speaker TEXT NOT NULL DEFAULT 'unknown',
  content TEXT NOT NULL,
  start_offset INTEGER NOT NULL DEFAULT 0 CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL DEFAULT 0 CHECK (end_offset >= 0),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(transcript_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_project ON research_transcript_segments(project_id, transcript_id, sequence);

CREATE TABLE IF NOT EXISTS research_qualitative_codes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_code_id TEXT REFERENCES research_qualitative_codes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_qualitative_themes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  code_ids TEXT NOT NULL DEFAULT '[]',
  frequency INTEGER NOT NULL DEFAULT 0 CHECK (frequency >= 0),
  coverage INTEGER NOT NULL DEFAULT 0 CHECK (coverage >= 0),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE research_evidence_v14 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  claim TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  source_type TEXT NOT NULL CHECK (source_type IN ('crosstab', 'tool_result', 'file', 'artifact', 'transcript_segment')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO research_evidence_v14 SELECT id, project_id, type, claim, value, source_type, source_id, created_at FROM research_evidence;
DROP TABLE research_evidence;
ALTER TABLE research_evidence_v14 RENAME TO research_evidence;
CREATE INDEX idx_research_evidence_project ON research_evidence(project_id, created_at DESC);
CREATE INDEX idx_research_evidence_source ON research_evidence(source_type, source_id);

CREATE TABLE research_artifacts_v14 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'qualitative_summary', 'qualitative_analysis', 'interview_summary', 'analysis', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts_v14(id) ON DELETE SET NULL,
  UNIQUE(project_id, type, version)
);

INSERT INTO research_artifacts_v14 SELECT id, project_id, type, title, version, content, created_at, updated_at, parent_artifact_id FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_v14 RENAME TO research_artifacts;
CREATE INDEX idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
CREATE INDEX idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);

CREATE TABLE IF NOT EXISTS research_insights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  interpretation TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'low' CHECK (confidence IN ('insufficient', 'low', 'medium', 'high')),
  theme_id TEXT REFERENCES research_qualitative_themes(id) ON DELETE SET NULL,
  artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_insights_artifact ON research_insights(project_id, artifact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_insight_evidence (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  insight_id TEXT NOT NULL REFERENCES research_insights(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(insight_id, evidence_id)
);

CREATE TABLE research_workflows_v14 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('research_plan', 'data_analysis', 'qualitative_analysis')),
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

INSERT INTO research_workflows_v14 SELECT id, project_id, client_request_id, task_type, status, artifact_id, parent_artifact_id, tool_calls, tool_result_ids, stages, quality, constraints, error, started_at, completed_at, duration_ms, created_at, updated_at FROM research_workflows;
DROP TABLE research_workflows;
ALTER TABLE research_workflows_v14 RENAME TO research_workflows;
CREATE INDEX idx_research_workflows_project_updated ON research_workflows(project_id, updated_at DESC);
CREATE INDEX idx_research_workflows_artifact ON research_workflows(artifact_id);

CREATE TABLE research_tool_results_v14 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL CHECK (tool_id IN ('sample-size', 'quota', 'questionnaire-check', 'data-profile', 'data-clean', 'data-weight', 'crosstab', 'transcript-search', 'transcript-read')),
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  agent_call_id TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO research_tool_results_v14 SELECT id, project_id, user_id, tool_id, input, result, source, agent_call_id, created_at FROM research_tool_results;
DROP TABLE research_tool_results;
ALTER TABLE research_tool_results_v14 RENAME TO research_tool_results;
CREATE INDEX idx_research_tool_results_project_created ON research_tool_results(project_id, created_at DESC);
CREATE UNIQUE INDEX idx_research_tool_results_agent_call ON research_tool_results(project_id, agent_call_id) WHERE agent_call_id IS NOT NULL;
