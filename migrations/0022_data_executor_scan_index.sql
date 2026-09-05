-- Keep the 30-second executor poll off completed files on the D1 free tier.
CREATE INDEX IF NOT EXISTS idx_research_files_executor_scan
ON research_project_files(parse_status, file_type, updated_at, created_at);
