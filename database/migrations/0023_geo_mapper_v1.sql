-- Engine-owned 3D Geo Mapper placement state.
-- Additive only: existing projects, releases, models and public experiences remain untouched.

CREATE TABLE IF NOT EXISTS geo_placements_3d (
  project_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  release_version INTEGER NOT NULL CHECK (release_version >= 1),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  altitude_m REAL NOT NULL DEFAULT 0,
  heading_deg REAL NOT NULL DEFAULT 0,
  pitch_deg REAL NOT NULL DEFAULT 0,
  roll_deg REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1 CHECK (scale > 0),
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0,1)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_geo_placements_3d_release
  ON geo_placements_3d(release_id);

CREATE TRIGGER IF NOT EXISTS trg_geo_placements_3d_release_owner_insert
BEFORE INSERT ON geo_placements_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM releases_3d r
   WHERE r.id = NEW.release_id
     AND r.project_id = NEW.project_id
     AND r.version = NEW.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo placement release must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_placements_3d_release_owner_update
BEFORE UPDATE OF project_id, release_id, release_version ON geo_placements_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM releases_3d r
   WHERE r.id = NEW.release_id
     AND r.project_id = NEW.project_id
     AND r.version = NEW.release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo placement release must belong to project');
END;

-- Browser map keys are public client configuration, not authentication secrets.
-- Keeping this Engine-owned avoids a runtime dependency on the Platform database.
CREATE TABLE IF NOT EXISTS engine_settings_3d (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
