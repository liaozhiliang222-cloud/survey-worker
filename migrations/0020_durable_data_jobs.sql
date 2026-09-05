CREATE TABLE research_data_jobs_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES research_datasets(id) ON DELETE RESTRICT,
  tool_id TEXT NOT NULL CHECK(tool_id IN ('data_profile','data_clean','data_weight','crosstab')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  input TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_expires_at TEXT, heartbeat_at TEXT, deadline_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(project_id,idempotency_key)
);
INSERT INTO research_data_jobs_v2(id,project_id,user_id,dataset_id,tool_id,status,progress,input,result,error,idempotency_key,created_at,updated_at,completed_at)
SELECT id,project_id,user_id,dataset_id,tool_id,
CASE WHEN status='running' THEN 'failed' ELSE status END,progress,input,result,
CASE WHEN status='running' THEN 'DATA_JOB_LEGACY_INTERRUPTED' ELSE error END,
id,created_at,updated_at,completed_at FROM research_data_jobs;
DROP TABLE research_data_jobs;
ALTER TABLE research_data_jobs_v2 RENAME TO research_data_jobs;
CREATE INDEX idx_research_data_jobs_project_updated ON research_data_jobs(project_id,updated_at DESC);
CREATE INDEX idx_research_data_jobs_pending ON research_data_jobs(status,created_at);

-- First statement of the publication batch. A stale/cancelled attempt aborts
-- the entire D1 transaction, including every result and evidence INSERT.
CREATE TABLE research_data_job_commits (
  job_id TEXT PRIMARY KEY REFERENCES research_data_jobs(id) ON DELETE CASCADE,
  lease_token TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1)
);
