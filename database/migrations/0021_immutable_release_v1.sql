-- Phase 5 immutable release schema.
ALTER TABLE projects_3d ADD COLUMN active_release_id TEXT;

CREATE TABLE IF NOT EXISTS releases_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  manifest_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  source_draft_revision INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  UNIQUE (project_id, version),
  UNIQUE (project_id, manifest_sha256)
);

CREATE TABLE IF NOT EXISTS release_assets_3d (
  release_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','media','studio')),
  logical_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT,
  source_etag TEXT,
  r2_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (release_id, kind, logical_id),
  FOREIGN KEY (release_id) REFERENCES releases_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS release_activations_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  previous_release_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('publish','rollback')),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (release_id) REFERENCES releases_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_release_id) REFERENCES releases_3d(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_releases_3d_project_version
  ON releases_3d(project_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_release_assets_3d_release
  ON release_assets_3d(release_id, kind, logical_id);
CREATE INDEX IF NOT EXISTS idx_release_activations_3d_project
  ON release_activations_3d(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_3d_active_release
  ON projects_3d(active_release_id);


CREATE TRIGGER IF NOT EXISTS trg_projects_3d_active_release_owner
BEFORE UPDATE OF active_release_id ON projects_3d
WHEN NEW.active_release_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM releases_3d r
     WHERE r.id = NEW.active_release_id
       AND r.project_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'active release must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_assets_3d_owner
BEFORE INSERT ON release_assets_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM releases_3d r
   WHERE r.id = NEW.release_id
     AND r.project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'release asset project mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_release_activations_3d_owner
BEFORE INSERT ON release_activations_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM releases_3d r
   WHERE r.id = NEW.release_id
     AND r.project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'release activation project mismatch');
END;
