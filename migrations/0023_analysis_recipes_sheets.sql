-- Sheet identity replaces file-only identity; existing registrations retain their sheet metadata.
DROP INDEX IF EXISTS idx_research_datasets_raw_file;
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_datasets_raw_sheet ON research_datasets(project_id,source_file_id,COALESCE(json_extract(metadata,'$.sheet_name'),'')) WHERE type='raw' AND source_file_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS research_analysis_batches (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, name TEXT NOT NULL, input TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(project_id,id)
);
