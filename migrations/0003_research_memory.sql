PRAGMA foreign_keys = ON;

ALTER TABLE research_project_files ADD COLUMN structured_data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_project_files ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (ocr_status IN ('not_requested', 'processing', 'completed', 'failed'));
ALTER TABLE research_project_files ADD COLUMN ocr_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS research_file_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES research_project_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(file_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_research_chunks_project_file ON research_file_chunks(project_id, file_id, chunk_index);

