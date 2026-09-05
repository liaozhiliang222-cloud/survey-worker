PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_transcript_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES research_transcripts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  type TEXT NOT NULL CHECK (type IN ('raw', 'corrected')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'review_required', 'confirmed', 'failed')),
  source_fingerprint TEXT NOT NULL DEFAULT '',
  parent_version_id TEXT REFERENCES research_transcript_versions(id) ON DELETE SET NULL,
  segment_count INTEGER NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  auto_applied_count INTEGER NOT NULL DEFAULT 0 CHECK (auto_applied_count >= 0),
  pending_review_count INTEGER NOT NULL DEFAULT 0 CHECK (pending_review_count >= 0),
  model TEXT NOT NULL DEFAULT '',
  terminology TEXT NOT NULL DEFAULT '[]',
  error TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(transcript_id, type, version)
);

CREATE INDEX IF NOT EXISTS idx_transcript_versions_project
  ON research_transcript_versions(project_id, transcript_id, type, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_raw_source
  ON research_transcript_versions(transcript_id, source_fingerprint)
  WHERE type = 'raw';

CREATE TABLE IF NOT EXISTS research_transcript_version_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES research_transcripts(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES research_transcript_versions(id) ON DELETE CASCADE,
  raw_segment_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  speaker TEXT NOT NULL DEFAULT 'unknown',
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(version_id, sequence),
  UNIQUE(version_id, raw_segment_id)
);

CREATE INDEX IF NOT EXISTS idx_transcript_version_segments
  ON research_transcript_version_segments(project_id, version_id, sequence);

CREATE TABLE IF NOT EXISTS research_transcript_corrections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  transcript_id TEXT NOT NULL REFERENCES research_transcripts(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES research_transcript_versions(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES research_transcript_version_segments(id) ON DELETE CASCADE,
  raw_segment_id TEXT NOT NULL,
  original_text TEXT NOT NULL,
  corrected_text TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('typo', 'asr_error', 'proper_noun', 'punctuation', 'speaker', 'duplication', 'other')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('auto_applied', 'pending_review', 'accepted', 'rejected')),
  batch_index INTEGER NOT NULL DEFAULT 0 CHECK (batch_index >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transcript_corrections_review
  ON research_transcript_corrections(project_id, version_id, status, created_at);

CREATE TABLE research_workflows_v16 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('research_plan', 'data_analysis', 'qualitative_analysis', 'transcript_correction')),
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

INSERT INTO research_workflows_v16
SELECT id, project_id, client_request_id, task_type, status, artifact_id, parent_artifact_id,
       tool_calls, tool_result_ids, stages, quality, constraints, error, started_at,
       completed_at, duration_ms, created_at, updated_at
FROM research_workflows;
DROP TABLE research_workflows;
ALTER TABLE research_workflows_v16 RENAME TO research_workflows;
CREATE INDEX idx_research_workflows_project_updated ON research_workflows(project_id, updated_at DESC);
CREATE INDEX idx_research_workflows_artifact ON research_workflows(artifact_id);
