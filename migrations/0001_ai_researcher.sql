PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  research_goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_projects_user_updated ON research_projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES research_projects(id) ON DELETE CASCADE,
  harness_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_project_locks (
  project_id TEXT PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS research_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  client_request_id TEXT,
  reply_to TEXT REFERENCES research_messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_message_idempotency ON research_messages(project_id, client_request_id) WHERE role = 'user' AND client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_messages_project_created ON research_messages(project_id, created_at, id);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('research_plan', 'questionnaire', 'interview_guide', 'other')),
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, type, version)
);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_project_updated ON research_artifacts(project_id, updated_at DESC);
