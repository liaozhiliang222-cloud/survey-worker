ALTER TABLE research_transcripts ADD COLUMN deep_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE research_transcripts ADD COLUMN summary_status TEXT NOT NULL DEFAULT 'pending' CHECK (summary_status IN ('pending', 'processing', 'ready', 'failed'));
ALTER TABLE research_transcripts ADD COLUMN summary_model TEXT NOT NULL DEFAULT '';
ALTER TABLE research_transcripts ADD COLUMN summary_source_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE research_transcripts ADD COLUMN summary_generated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE research_transcripts ADD COLUMN summary_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_research_transcripts_summary_status
  ON research_transcripts(project_id, summary_status, updated_at DESC);
