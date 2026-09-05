PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_tool_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL CHECK (tool_id IN ('sample-size', 'quota', 'questionnaire-check')),
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_tool_results_project_created
  ON research_tool_results(project_id, created_at DESC);
