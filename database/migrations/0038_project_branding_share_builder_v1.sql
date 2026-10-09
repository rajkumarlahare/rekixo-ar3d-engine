-- Project-scoped logo/favicon and experience-specific share branding.
-- Additive only: existing projects and immutable Building/Geo releases remain untouched.

CREATE TABLE IF NOT EXISTS project_branding_3d (
  project_id TEXT PRIMARY KEY,
  draft_logo_version TEXT,
  published_logo_version TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_branding_logo_versions_3d (
  project_id TEXT NOT NULL,
  version TEXT NOT NULL,
  logo_key TEXT NOT NULL,
  favicon_key TEXT NOT NULL,
  logo_mime_type TEXT NOT NULL DEFAULT 'image/webp'
    CHECK (logo_mime_type IN ('image/webp')),
  favicon_mime_type TEXT NOT NULL DEFAULT 'image/png'
    CHECK (favicon_mime_type IN ('image/png')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  PRIMARY KEY (project_id, version),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  CHECK (length(version) BETWEEN 16 AND 80)
);

CREATE TABLE IF NOT EXISTS project_branding_shares_3d (
  project_id TEXT NOT NULL,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('building','geo')),
  draft_title TEXT NOT NULL DEFAULT '',
  draft_description TEXT NOT NULL DEFAULT '',
  draft_card_version TEXT,
  draft_card_key TEXT,
  draft_source_key TEXT,
  draft_use_building_card INTEGER NOT NULL DEFAULT 0 CHECK (draft_use_building_card IN (0,1)),
  published_version TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, experience_type),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_branding_share_versions_3d (
  project_id TEXT NOT NULL,
  experience_type TEXT NOT NULL CHECK (experience_type IN ('building','geo')),
  version TEXT NOT NULL,
  share_title TEXT NOT NULL CHECK (length(share_title) BETWEEN 3 AND 120),
  share_description TEXT NOT NULL CHECK (length(share_description) BETWEEN 10 AND 280),
  card_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/webp','image/jpeg')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, experience_type, version),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  CHECK (length(version) BETWEEN 16 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_project_branding_logo_versions_public
  ON project_branding_logo_versions_3d(project_id, published_at, version);

CREATE INDEX IF NOT EXISTS idx_project_branding_share_versions_public
  ON project_branding_share_versions_3d(project_id, experience_type, version, created_at DESC);

-- History rows are write-once. New branding is represented by a new version.
CREATE TRIGGER IF NOT EXISTS trg_project_branding_logo_versions_immutable
BEFORE UPDATE OF project_id,version,logo_key,favicon_key,logo_mime_type,
  favicon_mime_type,created_by,created_at
ON project_branding_logo_versions_3d
BEGIN
  SELECT RAISE(ABORT, 'Project branding logo version identity is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_branding_share_versions_immutable
BEFORE UPDATE ON project_branding_share_versions_3d
BEGIN
  SELECT RAISE(ABORT, 'Project branding share versions are immutable');
END;
