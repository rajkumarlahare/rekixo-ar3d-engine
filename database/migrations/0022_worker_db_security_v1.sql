-- Phase 6: Engine DB uniqueness, tenant ownership and JSON integrity guards.
-- Additive hardening only; stable Platform/Super Admin resources are untouched.

CREATE UNIQUE INDEX IF NOT EXISTS idx_models_3d_project_version_unique
  ON models_3d(project_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_models_3d_asset_key_unique
  ON models_3d(asset_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_camera_presets_3d_project_name_unique
  ON camera_presets_3d(project_id, name COLLATE NOCASE);

CREATE TRIGGER IF NOT EXISTS trg_models_3d_storage_prefix_insert
BEFORE INSERT ON models_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM projects_3d p
   WHERE p.id = NEW.project_id
     AND NEW.asset_key LIKE 'projects/' || p.slug || '/models/%'
)
BEGIN
  SELECT RAISE(ABORT, 'model asset key must match project models prefix');
END;

CREATE TRIGGER IF NOT EXISTS trg_models_3d_storage_prefix_update
BEFORE UPDATE OF project_id, asset_key ON models_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM projects_3d p
   WHERE p.id = NEW.project_id
     AND NEW.asset_key LIKE 'projects/' || p.slug || '/models/%'
)
BEGIN
  SELECT RAISE(ABORT, 'model asset key must match project models prefix');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_3d_cover_prefix_insert
BEFORE INSERT ON projects_3d
WHEN NEW.cover_asset_key IS NOT NULL
 AND NEW.cover_asset_key NOT LIKE 'projects/' || NEW.slug || '/media/%'
BEGIN
  SELECT RAISE(ABORT, 'cover asset key must match project media prefix');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_3d_cover_prefix_update
BEFORE UPDATE OF cover_asset_key ON projects_3d
WHEN NEW.cover_asset_key IS NOT NULL
 AND NEW.cover_asset_key NOT LIKE 'projects/' || NEW.slug || '/media/%'
BEGIN
  SELECT RAISE(ABORT, 'cover asset key must match project media prefix');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_3d_slug_immutable_with_assets
BEFORE UPDATE OF slug ON projects_3d
WHEN NEW.slug <> OLD.slug
 AND (
   EXISTS (SELECT 1 FROM models_3d m WHERE m.project_id = OLD.id)
   OR EXISTS (SELECT 1 FROM studio_assets_3d a WHERE a.project_id = OLD.id)
   OR EXISTS (SELECT 1 FROM releases_3d r WHERE r.project_id = OLD.id)
 )
BEGIN
  SELECT RAISE(ABORT, 'project slug is immutable after assets or releases exist');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_model_owner_insert
BEFORE INSERT ON scenes_3d
WHEN NEW.model_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM models_3d m
    WHERE m.id = NEW.model_id AND m.project_id = NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'scene model must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_model_owner_update
BEFORE UPDATE OF project_id, model_id ON scenes_3d
WHEN NEW.model_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM models_3d m
    WHERE m.id = NEW.model_id AND m.project_id = NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'scene model must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_camera_owner_insert
BEFORE INSERT ON scenes_3d
WHEN NEW.camera_preset_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM camera_presets_3d c
    WHERE c.id = NEW.camera_preset_id AND c.project_id = NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'scene camera must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_camera_owner_update
BEFORE UPDATE OF project_id, camera_preset_id ON scenes_3d
WHEN NEW.camera_preset_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM camera_presets_3d c
    WHERE c.id = NEW.camera_preset_id AND c.project_id = NEW.project_id
 )
BEGIN
  SELECT RAISE(ABORT, 'scene camera must belong to project');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_json_insert
BEFORE INSERT ON scenes_3d
WHEN json_valid(NEW.settings_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'scene settings_json must be valid JSON');
END;

CREATE TRIGGER IF NOT EXISTS trg_scenes_3d_json_update
BEFORE UPDATE OF settings_json ON scenes_3d
WHEN json_valid(NEW.settings_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'scene settings_json must be valid JSON');
END;

CREATE TRIGGER IF NOT EXISTS trg_models_3d_transform_json_insert
BEFORE INSERT ON models_3d
WHEN json_valid(NEW.transform_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'model transform_json must be valid JSON');
END;

CREATE TRIGGER IF NOT EXISTS trg_models_3d_transform_json_update
BEFORE UPDATE OF transform_json ON models_3d
WHEN json_valid(NEW.transform_json) = 0
BEGIN
  SELECT RAISE(ABORT, 'model transform_json must be valid JSON');
END;

CREATE TRIGGER IF NOT EXISTS trg_camera_presets_3d_json_insert
BEFORE INSERT ON camera_presets_3d
WHEN json_valid(NEW.position_json) = 0
  OR json_valid(NEW.target_json) = 0
  OR json_array_length(NEW.position_json) <> 3
  OR json_array_length(NEW.target_json) <> 3
BEGIN
  SELECT RAISE(ABORT, 'camera vectors must be valid 3-element JSON arrays');
END;

CREATE TRIGGER IF NOT EXISTS trg_camera_presets_3d_json_update
BEFORE UPDATE OF position_json, target_json ON camera_presets_3d
WHEN json_valid(NEW.position_json) = 0
  OR json_valid(NEW.target_json) = 0
  OR json_array_length(NEW.position_json) <> 3
  OR json_array_length(NEW.target_json) <> 3
BEGIN
  SELECT RAISE(ABORT, 'camera vectors must be valid 3-element JSON arrays');
END;

CREATE TRIGGER IF NOT EXISTS trg_studio_assets_3d_storage_prefix_insert
BEFORE INSERT ON studio_assets_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM projects_3d p
   WHERE p.id = NEW.project_id
     AND NEW.r2_key =
       'projects/' || p.slug || '/draft-assets/' || NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'studio asset key must match project draft prefix');
END;

CREATE TRIGGER IF NOT EXISTS trg_studio_assets_3d_storage_prefix_update
BEFORE UPDATE OF project_id, r2_key ON studio_assets_3d
WHEN NOT EXISTS (
  SELECT 1
    FROM projects_3d p
   WHERE p.id = NEW.project_id
     AND NEW.r2_key =
       'projects/' || p.slug || '/draft-assets/' || NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'studio asset key must match project draft prefix');
END;
