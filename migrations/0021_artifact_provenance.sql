-- Existing content and versions remain intact. Historical rows are not
-- assigned a fabricated source snapshot; API reads identify them as untracked.
ALTER TABLE research_artifacts ADD COLUMN provenance TEXT NOT NULL DEFAULT '{}';
