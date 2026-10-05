-- V2 Geo authoring foundation for the finalized Automatic Presentation Engine.
-- Additive only. Existing geo_placements_3d and immutable Geo release tables remain
-- untouched for backward compatibility. No public runtime is switched here.

-- Extend the editable Geo draft with provider-independent local ENU alignment and
-- an explicit height mode. Existing longitude/latitude/altitude/rotation/scale
-- columns remain valid compatibility state during the migration period.
ALTER TABLE geo_experience_drafts_3d
  ADD COLUMN height_mode TEXT NOT NULL DEFAULT 'ground-relative'
    CHECK (height_mode IN ('ground-clamped','ground-relative','absolute'));
ALTER TABLE geo_experience_drafts_3d
  ADD COLUMN east_offset_m REAL NOT NULL DEFAULT 0;
ALTER TABLE geo_experience_drafts_3d
  ADD COLUMN north_offset_m REAL NOT NULL DEFAULT 0;
ALTER TABLE geo_experience_drafts_3d
  ADD COLUMN vertical_offset_m REAL NOT NULL DEFAULT 0;
ALTER TABLE geo_experience_drafts_3d
  ADD COLUMN model_anchor_id TEXT;

-- A model anchor is expressed in canonical Building-local metres and is pinned to
-- the exact immutable Building release currently selected by the Geo Experience.
CREATE TABLE IF NOT EXISTS geo_model_anchors_3d (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_building_release_id TEXT NOT NULL,
  source_building_release_version INTEGER NOT NULL
    CHECK (source_building_release_version >= 1),
  kind TEXT NOT NULL
    CHECK (kind IN ('entrance','main-gate','site-center','south-west-corner','custom')),
  name TEXT NOT NULL,
  x_m REAL NOT NULL,
  y_m REAL NOT NULL,
  z_m REAL NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (source_building_release_id) REFERENCES releases_3d(id) ON DELETE RESTRICT,
  UNIQUE (experience_id, id)
);

CREATE INDEX IF NOT EXISTS idx_geo_model_anchors_3d_experience
  ON geo_model_anchors_3d(experience_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_geo_model_anchors_3d_source_release
  ON geo_model_anchors_3d(source_building_release_id);

CREATE TRIGGER IF NOT EXISTS trg_geo_model_anchors_3d_owner_insert
BEFORE INSERT ON geo_model_anchors_3d
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
  SELECT RAISE(ABORT, 'Geo model anchor must match Geo Experience Building release');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_model_anchors_3d_owner_update
BEFORE UPDATE OF experience_id,project_id,source_building_release_id,source_building_release_version
ON geo_model_anchors_3d
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
  SELECT RAISE(ABORT, 'Geo model anchor must match Geo Experience Building release');
END;

-- A selected anchor must belong to the same Geo draft and immutable Building source.
CREATE TRIGGER IF NOT EXISTS trg_geo_experience_drafts_3d_anchor_owner_insert
BEFORE INSERT ON geo_experience_drafts_3d
WHEN NEW.model_anchor_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
     FROM geo_model_anchors_3d a
    WHERE a.id=NEW.model_anchor_id
      AND a.experience_id=NEW.experience_id
      AND a.project_id=NEW.project_id
      AND a.source_building_release_id=NEW.source_building_release_id
      AND a.source_building_release_version=NEW.source_building_release_version
 )
BEGIN
  SELECT RAISE(ABORT, 'Geo draft model anchor ownership mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_experience_drafts_3d_anchor_owner_update
BEFORE UPDATE OF model_anchor_id,experience_id,project_id,source_building_release_id,source_building_release_version
ON geo_experience_drafts_3d
WHEN NEW.model_anchor_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
     FROM geo_model_anchors_3d a
    WHERE a.id=NEW.model_anchor_id
      AND a.experience_id=NEW.experience_id
      AND a.project_id=NEW.project_id
      AND a.source_building_release_id=NEW.source_building_release_id
      AND a.source_building_release_version=NEW.source_building_release_version
 )
BEGIN
  SELECT RAISE(ABORT, 'Geo draft model anchor ownership mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_model_anchors_3d_delete_in_use
BEFORE DELETE ON geo_model_anchors_3d
WHEN EXISTS (
  SELECT 1
    FROM geo_experience_drafts_3d d
   WHERE d.model_anchor_id=OLD.id
     AND d.experience_id=OLD.experience_id
)
BEGIN
  SELECT RAISE(ABORT, 'Selected Geo model anchor cannot be deleted');
END;

-- Masterplan/site imagery is an authoring overlay. The asset remains project-owned;
-- geographic calibration lives in control points and reports below.
CREATE TABLE IF NOT EXISTS geo_overlays_3d (
  id TEXT PRIMARY KEY,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('masterplan','site-reference')),
  name TEXT NOT NULL,
  opacity REAL NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES studio_assets_3d(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_geo_overlays_3d_experience
  ON geo_overlays_3d(experience_id, sort_order, created_at);

CREATE TRIGGER IF NOT EXISTS trg_geo_overlays_3d_owner_insert
BEFORE INSERT ON geo_overlays_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN studio_assets_3d a
      ON a.id=NEW.asset_id
     AND a.project_id=NEW.project_id
     AND a.deleted_at IS NULL
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
)
BEGIN
  SELECT RAISE(ABORT, 'Geo overlay must use a live asset from the same Geo project');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_overlays_3d_owner_update
BEFORE UPDATE OF experience_id,project_id,asset_id ON geo_overlays_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM experiences_3d e
    JOIN studio_assets_3d a
      ON a.id=NEW.asset_id
     AND a.project_id=NEW.project_id
     AND a.deleted_at IS NULL
   WHERE e.id=NEW.experience_id
     AND e.project_id=NEW.project_id
     AND e.type='geo'
)
BEGIN
  SELECT RAISE(ABORT, 'Geo overlay must use a live asset from the same Geo project');
END;

-- Control points bind normalized 2D overlay coordinates to WGS84. They calibrate
-- imagery only; these points never warp the 3D Building.
CREATE TABLE IF NOT EXISTS geo_control_points_3d (
  id TEXT PRIMARY KEY,
  overlay_id TEXT NOT NULL,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  label TEXT,
  source_u REAL NOT NULL CHECK (source_u >= 0 AND source_u <= 1),
  source_v REAL NOT NULL CHECK (source_v >= 0 AND source_v <= 1),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  altitude_m REAL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (overlay_id) REFERENCES geo_overlays_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_geo_control_points_3d_overlay
  ON geo_control_points_3d(overlay_id, sort_order, created_at);

CREATE TRIGGER IF NOT EXISTS trg_geo_control_points_3d_owner_insert
BEFORE INSERT ON geo_control_points_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_overlays_3d o
   WHERE o.id=NEW.overlay_id
     AND o.experience_id=NEW.experience_id
     AND o.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Geo control point must belong to overlay Experience/project');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_control_points_3d_owner_update
BEFORE UPDATE OF overlay_id,experience_id,project_id ON geo_control_points_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_overlays_3d o
   WHERE o.id=NEW.overlay_id
     AND o.experience_id=NEW.experience_id
     AND o.project_id=NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Geo control point must belong to overlay Experience/project');
END;

-- Calibration reports are immutable snapshots for a particular editable Geo draft
-- revision. A later draft revision requires a new report/verification.
CREATE TABLE IF NOT EXISTS geo_calibration_reports_3d (
  id TEXT PRIMARY KEY,
  overlay_id TEXT NOT NULL,
  experience_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  algorithm TEXT NOT NULL CHECK (algorithm IN ('homography-v1')),
  point_count INTEGER NOT NULL CHECK (point_count >= 0),
  rms_error_m REAL NOT NULL CHECK (rms_error_m >= 0),
  max_error_m REAL NOT NULL CHECK (max_error_m >= 0),
  worst_control_point_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('unverified','verified','failed')),
  calculated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (overlay_id) REFERENCES geo_overlays_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (worst_control_point_id) REFERENCES geo_control_points_3d(id) ON DELETE SET NULL,
  UNIQUE (overlay_id, draft_revision)
);

CREATE INDEX IF NOT EXISTS idx_geo_calibration_reports_3d_experience
  ON geo_calibration_reports_3d(experience_id, draft_revision DESC);

CREATE TRIGGER IF NOT EXISTS trg_geo_calibration_reports_3d_owner_insert
BEFORE INSERT ON geo_calibration_reports_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_overlays_3d o
    JOIN geo_experience_drafts_3d d
      ON d.experience_id=NEW.experience_id
     AND d.project_id=NEW.project_id
     AND d.revision=NEW.draft_revision
   WHERE o.id=NEW.overlay_id
     AND o.experience_id=NEW.experience_id
     AND o.project_id=NEW.project_id
)
OR (
  NEW.worst_control_point_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
      FROM geo_control_points_3d cp
     WHERE cp.id=NEW.worst_control_point_id
       AND cp.overlay_id=NEW.overlay_id
       AND cp.experience_id=NEW.experience_id
       AND cp.project_id=NEW.project_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Geo calibration report ownership/revision mismatch');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_calibration_reports_3d_immutable
BEFORE UPDATE ON geo_calibration_reports_3d
BEGIN
  SELECT RAISE(ABORT, 'Geo calibration report is immutable');
END;

-- Site/parcel boundary authoring stays WGS84 and revision-scoped. JSON is used for
-- the ordered ring so the schema remains provider-neutral and does not encode map pixels.
CREATE TABLE IF NOT EXISTS geo_site_boundaries_3d (
  experience_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision >= 0),
  points_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experience_id) REFERENCES experiences_3d(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects_3d(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_geo_site_boundaries_3d_owner_insert
BEFORE INSERT ON geo_site_boundaries_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_experience_drafts_3d d
   WHERE d.experience_id=NEW.experience_id
     AND d.project_id=NEW.project_id
     AND d.revision=NEW.draft_revision
)
BEGIN
  SELECT RAISE(ABORT, 'Geo site boundary must match current Geo draft revision');
END;

CREATE TRIGGER IF NOT EXISTS trg_geo_site_boundaries_3d_owner_update
BEFORE UPDATE OF experience_id,project_id,draft_revision ON geo_site_boundaries_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM geo_experience_drafts_3d d
   WHERE d.experience_id=NEW.experience_id
     AND d.project_id=NEW.project_id
     AND d.revision=NEW.draft_revision
)
BEGIN
  SELECT RAISE(ABORT, 'Geo site boundary must match current Geo draft revision');
END;
