-- Phase 4: separate editable Geo authoring state from the legacy/public placement snapshot.
-- Additive only. Existing geo_placements_3d remains untouched for backward-compatible
-- public runtime until immutable Geo releases replace it in later phases.
-- The stable rekixo-ar3d-platform is not read or modified by this migration.

CREATE TABLE IF NOT EXISTS geo_experience_drafts_3d (
  experience_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  source_building_release_id TEXT NOT NULL,
  source_building_release_version INTEGER NOT NULL
    CHECK (source_building_release_version >= 1),
  longitude REAL,
  latitude REAL,
  altitude_m REAL NOT NULL DEFAULT 0,
  heading_deg REAL NOT NULL DEFAULT 0,
  pitch_deg REAL NOT NULL DEFAULT 0,
  roll_deg REAL NOT NULL DEFAULT 0,
  scale REAL NOT NULL DEFAULT 1 CHECK (scale > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (source_building_release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT,
  CHECK (
    (longitude IS NULL AND latitude IS NULL)
    OR
    (
      longitude IS NOT NULL
      AND latitude IS NOT NULL
      AND longitude >= -180
      AND longitude <= 180
      AND latitude >= -90
      AND latitude <= 90
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_geo_experience_drafts_3d_source
  ON geo_experience_drafts_3d(source_building_release_id);

-- Existing optional Geo Experiences receive one editable draft. A compatible
-- legacy placement is used only when it is pinned to the same immutable Building
-- release as the Experience. Otherwise the draft starts without coordinates so
-- alignment is never silently reattached to the wrong Building version.
INSERT OR IGNORE INTO geo_experience_drafts_3d (
  experience_id,
  project_id,
  source_building_release_id,
  source_building_release_version,
  longitude,
  latitude,
  altitude_m,
  heading_deg,
  pitch_deg,
  roll_deg,
  scale,
  revision,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  e.id,
  e.project_id,
  e.source_building_release_id,
  r.version,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.longitude ELSE NULL END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.latitude ELSE NULL END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.altitude_m ELSE 0 END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.heading_deg ELSE 0 END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.pitch_deg ELSE 0 END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.roll_deg ELSE 0 END,
  CASE WHEN g.release_id=e.source_building_release_id THEN g.scale ELSE 1 END,
  CASE WHEN g.release_id=e.source_building_release_id THEN 1 ELSE 0 END,
  COALESCE(NULLIF(g.updated_by,''), e.created_by, 'system:phase4-backfill'),
  COALESCE(NULLIF(g.updated_by,''), e.created_by, 'system:phase4-backfill'),
  COALESCE(g.updated_at, e.created_at, datetime('now')),
  COALESCE(g.updated_at, e.updated_at, datetime('now'))
FROM experiences_3d e
JOIN releases_3d r
  ON r.id=e.source_building_release_id
 AND r.project_id=e.project_id
LEFT JOIN geo_placements_3d g
  ON g.project_id=e.project_id
WHERE e.type='geo';

-- Every future optional Geo Experience owns exactly one editable Geo draft from
-- creation time, even before a map coordinate has been chosen.
CREATE TRIGGER IF NOT EXISTS trg_experiences_3d_geo_draft_insert
AFTER INSERT ON experiences_3d
WHEN NEW.type='geo'
BEGIN
  INSERT OR IGNORE INTO geo_experience_drafts_3d (
    experience_id,
    project_id,
    source_building_release_id,
    source_building_release_version,
    longitude,
    latitude,
    altitude_m,
    heading_deg,
    pitch_deg,
    roll_deg,
    scale,
    revision,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  SELECT
    NEW.id,
    NEW.project_id,
    NEW.source_building_release_id,
    r.version,
    NULL,
    NULL,
    0,
    0,
    0,
    0,
    1,
    0,
    NEW.created_by,
    NEW.created_by,
    NEW.created_at,
    NEW.updated_at
  FROM releases_3d r
  WHERE r.id=NEW.source_building_release_id
    AND r.project_id=NEW.project_id;
END;

-- A Geo draft must always belong to a Geo Experience in the same project and
-- must pin the exact immutable Building release currently selected by that
-- Experience. Cross-project and cross-Experience attachment fail closed.
CREATE TRIGGER IF NOT EXISTS trg_geo_experience_drafts_3d_owner_insert
BEFORE INSERT ON geo_experience_drafts_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN releases_3d r
      ON r.id=NEW.source_building_release_id
     AND r.project_id=NEW.project_id
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
     AND e.source_building_release_id=NEW.source_building_release_id
     AND r.version=NEW.source_building_release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo draft must belong to Geo Experience source release');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_experience_drafts_3d_owner_update
BEFORE UPDATE OF experience_id,project_id,source_building_release_id,source_building_release_version
ON geo_experience_drafts_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN releases_3d r
      ON r.id=NEW.source_building_release_id
     AND r.project_id=NEW.project_id
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
     AND e.source_building_release_id=NEW.source_building_release_id
     AND r.version=NEW.source_building_release_version
)
BEGIN
  SELECT RAISE(ABORT, 'Geo draft must belong to Geo Experience source release');
END;
