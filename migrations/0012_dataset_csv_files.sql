PRAGMA defer_foreign_keys = ON;

CREATE TABLE research_project_files_v12 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('docx', 'pdf', 'txt', 'md', 'xlsx', 'csv', 'pptx')),
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('brief', 'historical_report', 'questionnaire', 'interview', 'data', 'other')),
  storage_key TEXT NOT NULL UNIQUE,
  parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending', 'processing', 'completed', 'failed', 'unsupported')),
  parsed_text TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  parse_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  structured_data TEXT NOT NULL DEFAULT '{}',
  ocr_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (ocr_status IN ('not_requested', 'processing', 'completed', 'failed')),
  ocr_note TEXT NOT NULL DEFAULT ''
);

INSERT INTO research_project_files_v12 (
  id, project_id, user_id, file_name, file_type, mime_type, file_size, category,
  storage_key, parse_status, parsed_text, summary, parse_note, created_at, updated_at,
  structured_data, ocr_status, ocr_note
)
SELECT
  id, project_id, user_id, file_name, file_type, mime_type, file_size, category,
  storage_key, parse_status, parsed_text, summary, parse_note, created_at, updated_at,
  structured_data, ocr_status, ocr_note
FROM research_project_files;

DROP TABLE research_project_files;
ALTER TABLE research_project_files_v12 RENAME TO research_project_files;
CREATE INDEX idx_research_files_project_created ON research_project_files(project_id, created_at DESC);
CREATE INDEX idx_research_files_user_project ON research_project_files(user_id, project_id);
