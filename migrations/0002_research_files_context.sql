PRAGMA foreign_keys = ON;

ALTER TABLE research_artifacts ADD COLUMN parent_artifact_id TEXT REFERENCES research_artifacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);

CREATE TABLE IF NOT EXISTS research_project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('docx', 'pdf', 'txt', 'md', 'xlsx', 'pptx')),
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('brief', 'historical_report', 'questionnaire', 'interview', 'data', 'other')),
  storage_key TEXT NOT NULL UNIQUE,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'completed', 'failed', 'unsupported')),
  parsed_text TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  parse_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_files_project_created ON research_project_files(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_files_user_project ON research_project_files(user_id, project_id);

CREATE TABLE IF NOT EXISTS research_usage_counters (
  counter_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_usage_expiry ON research_usage_counters(expires_at);
