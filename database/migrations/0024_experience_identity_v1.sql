-- Phase 2: Engine-owned customer Experience identity.
-- Additive only. Existing Building release tables and live URLs remain unchanged.
-- The stable rekixo-ar3d-platform is not read or modified by this migration.

CREATE TABLE IF NOT EXISTS experiences_3d (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('building','geo')),
  lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle IN ('active','archived')),
  source_building_release_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (source_building_release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT,
  UNIQUE (project_id, type),
  CHECK (
    (type='building' AND source_building_release_id IS NULL)
    OR
    (type='geo' AND source_building_release_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_experiences_3d_project
  ON experiences_3d(project_id, type);

CREATE INDEX IF NOT EXISTS idx_experiences_3d_source_release
  ON experiences_3d(source_building_release_id)
  WHERE source_building_release_id IS NOT NULL;

-- Every Engine project has exactly one canonical Building Experience identity.
-- Existing Building release/public behavior is still owned by releases_3d and
-- projects_3d.active_release_id; this row is identity only.
INSERT OR IGNORE INTO experiences_3d
  (id,project_id,type,lifecycle,source_building_release_id,created_by,created_at,updated_at)
SELECT
  'experience_building_' || p.id,
  p.id,
  'building',
  CASE WHEN p.status='archived' THEN 'archived' ELSE 'active' END,
  NULL,
  'system:phase2-backfill',
  COALESCE(p.created_at, datetime('now')),
  COALESCE(p.updated_at, datetime('now'))
FROM projects_3d p;

-- Preserve any already-configured Engine Geo work as an optional Geo Experience.
-- The immutable Building release pinned by geo_placements_3d becomes the source
-- release identity; no Building asset or project is copied.
INSERT OR IGNORE INTO experiences_3d
  (id,project_id,type,lifecycle,source_building_release_id,created_by,created_at,updated_at)
SELECT
  'experience_geo_' || g.project_id,
  g.project_id,
  'geo',
  'active',
  g.release_id,
  COALESCE(NULLIF(g.updated_by,''), 'system:phase2-backfill'),
  COALESCE(g.updated_at, datetime('now')),
  COALESCE(g.updated_at, datetime('now'))
FROM geo_placements_3d g;

-- Future project provisioning cannot forget the canonical Building Experience.
CREATE TRIGGER IF NOT EXISTS trg_projects_3d_building_experience_insert
AFTER INSERT ON projects_3d
BEGIN
  INSERT OR IGNORE INTO experiences_3d
    (id,project_id,type,lifecycle,source_building_release_id,created_by,created_at,updated_at)
  VALUES
    (
      'experience_building_' || NEW.id,
      NEW.id,
      'building',
      CASE WHEN NEW.status='archived' THEN 'archived' ELSE 'active' END,
      NULL,
      'system:project-create',
      COALESCE(NEW.created_at, datetime('now')),
      COALESCE(NEW.updated_at, datetime('now'))
    );
END;

-- Geo source releases are immutable Building releases and must belong to the
-- same Engine project. This prevents cross-project source attachment.
CREATE TRIGGER IF NOT EXISTS trg_experiences_3d_geo_source_owner_insert
BEFORE INSERT ON experiences_3d
WHEN NEW.type='geo'
 AND NOT EXISTS (
   SELECT 1
     FROM releases_3d r
    WHERE r.id=NEW.source_building_release_id
      AND r.project_id=NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Geo Experience source release must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_experiences_3d_geo_source_owner_update
BEFORE UPDATE OF project_id,type,source_building_release_id ON experiences_3d
WHEN NEW.type='geo'
 AND NOT EXISTS (
   SELECT 1
     FROM releases_3d r
    WHERE r.id=NEW.source_building_release_id
      AND r.project_id=NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'Geo Experience source release must belong to project');
END;
