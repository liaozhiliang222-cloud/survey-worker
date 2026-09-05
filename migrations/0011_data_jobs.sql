CREATE TABLE IF NOT EXISTS research_data_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  tool_id TEXT NOT NULL CHECK (tool_id IN ('data_profile', 'data_clean', 'data_weight', 'crosstab')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_data_jobs_project_updated ON research_data_jobs(project_id, updated_at DESC);
