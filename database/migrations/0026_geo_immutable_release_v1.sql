-- Phase 5: immutable Geo Experience releases, preview verification, activation and rollback.
-- Additive only. Building release tables and the legacy public geo_placements_3d
-- compatibility snapshot remain unchanged in this phase.
-- The stable rekixo-ar3d-platform is not read or modified by this migration.

CREATE TABLE IF NOT EXISTS geo_draft_verifications_3d (
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  source_building_release_id TEXT NOT NULL,
  source_building_release_version INTEGER NOT NULL
    CHECK (source_building_release_version >= 1),
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (experience_id, draft_revision),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (source_building_release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_geo_draft_verifications_3d_project
  ON geo_draft_verifications_3d(project_id, verified_at DESC);

CREATE TABLE IF NOT EXISTS geo_releases_3d (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  manifest_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
  source_draft_revision INTEGER NOT NULL CHECK (source_draft_revision >= 0),
  source_building_release_id TEXT NOT NULL,
  source_building_release_version INTEGER NOT NULL
    CHECK (source_building_release_version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (source_building_release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT,
  UNIQUE (experience_id, version),
  UNIQUE (experience_id, manifest_sha256)
);

CREATE INDEX IF NOT EXISTS idx_geo_releases_3d_experience_version
  ON geo_releases_3d(experience_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_geo_releases_3d_project
  ON geo_releases_3d(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_releases_3d_source_building
  ON geo_releases_3d(source_building_release_id);

CREATE TABLE IF NOT EXISTS geo_experience_active_releases_3d (
  experience_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  geo_release_id TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (geo_release_id) REFERENCES geo_releases_3d(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_geo_experience_active_releases_3d_project
  ON geo_experience_active_releases_3d(project_id);

CREATE TABLE IF NOT EXISTS geo_release_activations_3d (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  geo_release_id TEXT NOT NULL,
  previous_geo_release_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('publish','rollback')),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (geo_release_id) REFERENCES geo_releases_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (previous_geo_release_id) REFERENCES geo_releases_3d(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_geo_release_activations_3d_experience
  ON geo_release_activations_3d(experience_id, created_at DESC);

-- Verification may only attest the current Geo Experience/project and a Building
-- release owned by the same project at the exact stored version.
CREATE TRIGGER IF NOT EXISTS trg_geo_draft_verifications_3d_owner
BEFORE INSERT ON geo_draft_verifications_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN releases_3d r
      ON r.id=NEW.source_building_release_id
     AND r.project_id=NEW.project_id
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
     AND r.version=NEW.source_building_release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo verification ownership mismatch');
END;

-- An immutable Geo release can only belong to a Geo Experience in the same
-- project and can only reference an immutable Building release from that project.
CREATE TRIGGER IF NOT EXISTS trg_geo_releases_3d_owner
BEFORE INSERT ON geo_releases_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN releases_3d r
      ON r.id=NEW.source_building_release_id
     AND r.project_id=NEW.project_id
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
     AND r.version=NEW.source_building_release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo release ownership mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_active_release_owner_insert
BEFORE INSERT ON geo_experience_active_releases_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_releases_3d gr
    JOIN experiences_3d e
      ON e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
   WHERE gr.id=NEW.geo_release_id
     AND gr.experience_id=NEW.experience_id
     AND gr.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Active Geo release must belong to Geo Experience');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_active_release_owner_update
BEFORE UPDATE OF experience_id,project_id,geo_release_id
ON geo_experience_active_releases_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_releases_3d gr
    JOIN experiences_3d e
      ON e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
   WHERE gr.id=NEW.geo_release_id
     AND gr.experience_id=NEW.experience_id
     AND gr.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Active Geo release must belong to Geo Experience');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_release_activations_3d_owner
BEFORE INSERT ON geo_release_activations_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_releases_3d gr
   WHERE gr.id=NEW.geo_release_id
     AND gr.experience_id=NEW.experience_id
     AND gr.project_id=NEW.project_id
)
OR (
  NEW.previous_geo_release_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM geo_releases_3d previous
     WHERE previous.id=NEW.previous_geo_release_id
       AND previous.experience_id=NEW.experience_id
       AND previous.project_id=NEW.project_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Geo release activation ownership mismatch');
END;
