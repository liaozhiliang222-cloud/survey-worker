PRAGMA defer_foreign_keys = ON;

CREATE TABLE research_analysis_results_v10 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('data_profile', 'data_weight', 'crosstab')),
  input TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL,
  compact_result TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

INSERT INTO research_analysis_results_v10
SELECT id, project_id, dataset_id, type, input, result, compact_result, created_at
FROM research_analysis_results;
DROP TABLE research_analysis_results;
ALTER TABLE research_analysis_results_v10 RENAME TO research_analysis_results;
CREATE INDEX idx_research_analysis_results_project ON research_analysis_results(project_id, created_at DESC);

CREATE TABLE research_tool_results_v10 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tool_id TEXT NOT NULL CHECK (tool_id IN ('sample-size', 'quota', 'questionnaire-check', 'data-profile', 'data-clean', 'data-weight', 'crosstab')),
  input TEXT NOT NULL,
  result TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  agent_call_id TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO research_tool_results_v10
SELECT id, project_id, user_id, tool_id, input, result, source, agent_call_id, created_at
FROM research_tool_results;
DROP TABLE research_tool_results;
ALTER TABLE research_tool_results_v10 RENAME TO research_tool_results;
CREATE INDEX idx_research_tool_results_project_created ON research_tool_results(project_id, created_at DESC);
CREATE UNIQUE INDEX idx_research_tool_results_agent_call ON research_tool_results(project_id, agent_call_id) WHERE agent_call_id IS NOT NULL;
