PRAGMA defer_foreign_keys = ON;

CREATE TABLE research_artifacts_v19 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'qualitative_summary', 'qualitative_analysis', 'interview_summary', 'analysis', 'report_outline', 'ppt_script', 'qualitative_ppt', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  parent_artifact_id TEXT REFERENCES research_artifacts_v19(id) ON DELETE SET NULL,
  UNIQUE(project_id, type, version)
);

INSERT INTO research_artifacts_v19
SELECT id, project_id, type, title, version, content, created_at, updated_at, parent_artifact_id
FROM research_artifacts;
DROP TABLE research_artifacts;
ALTER TABLE research_artifacts_v19 RENAME TO research_artifacts;
CREATE INDEX idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
CREATE INDEX idx_research_artifacts_parent ON research_artifacts(parent_artifact_id);
