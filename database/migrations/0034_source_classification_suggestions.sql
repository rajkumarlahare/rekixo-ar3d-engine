-- Automatic Source Pack V2 classification suggestions.
-- Suggestions are advisory only: they never mutate source_pack_files_3d or seal a
-- geometry authority. The operator-owned source-pack decision remains separate.

CREATE TABLE IF NOT EXISTS source_classification_suggestions_3d (
  source_file_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  classifier_version TEXT NOT NULL
    CHECK (length(classifier_version) BETWEEN 1 AND 80),
  suggested_roles_json TEXT NOT NULL
    CHECK (json_valid(suggested_roles_json) AND json_type(suggested_roles_json)='array'),
  suggested_capabilities_json TEXT NOT NULL
    CHECK (json_valid(suggested_capabilities_json) AND json_type(suggested_capabilities_json)='array'),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  geometry_authority_score REAL NOT NULL
    CHECK (geometry_authority_score >= 0 AND geometry_authority_score <= 1),
  rationale_code TEXT NOT NULL CHECK (length(rationale_code) BETWEEN 1 AND 120),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- One ownership delete path only: project -> source file -> suggestion.
  FOREIGN KEY (source_file_id) REFERENCES source_files_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_source_classification_suggestions_3d_project
  ON source_classification_suggestions_3d(project_id, geometry_authority_score DESC, source_file_id);

CREATE TRIGGER IF NOT EXISTS trg_source_classification_suggestions_3d_owner_insert
BEFORE INSERT ON source_classification_suggestions_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM source_files_3d f
   WHERE f.id=NEW.source_file_id
     AND f.project_id=NEW.project_id
     AND f.upload_state='verified'
)
BEGIN
  SELECT RAISE(ABORT, 'Classification suggestion requires a verified source from the same project');
END;

CREATE TRIGGER IF NOT EXISTS trg_source_classification_suggestions_3d_owner_update
BEFORE UPDATE OF source_file_id,project_id ON source_classification_suggestions_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM source_files_3d f
   WHERE f.id=NEW.source_file_id
     AND f.project_id=NEW.project_id
     AND f.upload_state='verified'
)
BEGIN
  SELECT RAISE(ABORT, 'Classification suggestion requires a verified source from the same project');
END;
