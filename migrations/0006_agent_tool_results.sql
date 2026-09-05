ALTER TABLE research_tool_results ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE research_tool_results ADD COLUMN agent_call_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_tool_results_agent_call
  ON research_tool_results(project_id, agent_call_id)
  WHERE agent_call_id IS NOT NULL;
