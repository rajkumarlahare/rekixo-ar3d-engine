import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath =
  "database/migrations/0030_v2_geo_alignment_foundation.sql";
const read = (path) => fs.readFileSync(path, "utf8");

test("V2 Geo migration is additive and keeps legacy compatibility state", () => {
  const migration = read(migrationPath);

  assert.match(migration, /Additive only/);
  assert.match(migration, /ALTER TABLE geo_experience_drafts_3d/);
  assert.match(migration, /ADD COLUMN height_mode/);
  assert.match(migration, /ground-clamped/);
  assert.match(migration, /ground-relative/);
  assert.match(migration, /absolute/);
  assert.match(migration, /ADD COLUMN east_offset_m/);
  assert.match(migration, /ADD COLUMN north_offset_m/);
  assert.match(migration, /ADD COLUMN vertical_offset_m/);
  assert.match(migration, /ADD COLUMN model_anchor_id/);

  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+geo_placements_3d/i);
  assert.doesNotMatch(migration, /UPDATE\s+geo_placements_3d/i);
});

test("Geo model anchors are metre-local and pinned to exact Building release ownership", () => {
  const migration = read(migrationPath);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS geo_model_anchors_3d/);
  assert.match(migration, /source_building_release_id TEXT NOT NULL/);
  assert.match(migration, /source_building_release_version INTEGER NOT NULL/);
  assert.match(migration, /x_m REAL NOT NULL/);
  assert.match(migration, /y_m REAL NOT NULL/);
  assert.match(migration, /z_m REAL NOT NULL/);
  assert.match(migration, /'entrance'/);
  assert.match(migration, /'main-gate'/);
  assert.match(migration, /'site-center'/);
  assert.match(migration, /'south-west-corner'/);
  assert.match(migration, /trg_geo_model_anchors_3d_owner_insert/);
  assert.match(migration, /e\.type='geo'/);
  assert.match(
    migration,
    /e\.source_building_release_id=NEW\.source_building_release_id/,
  );
  assert.match(
    migration,
    /r\.version=NEW\.source_building_release_version/,
  );
  assert.match(migration, /trg_geo_experience_drafts_3d_anchor_owner_update/);
  assert.match(migration, /trg_geo_model_anchors_3d_delete_in_use/);
});

test("masterplan controls and calibration stay separate from rigid Building placement", () => {
  const migration = read(migrationPath);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS geo_overlays_3d/);
  assert.match(migration, /kind IN \('masterplan','site-reference'\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS geo_control_points_3d/);
  assert.match(migration, /source_u REAL NOT NULL/);
  assert.match(migration, /source_v REAL NOT NULL/);
  assert.match(migration, /longitude REAL NOT NULL/);
  assert.match(migration, /latitude REAL NOT NULL/);
  assert.match(migration, /these points never warp the 3D Building/i);

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS geo_calibration_reports_3d/,
  );
  assert.match(migration, /algorithm IN \('homography-v1'\)/);
  assert.match(migration, /rms_error_m REAL NOT NULL/);
  assert.match(migration, /max_error_m REAL NOT NULL/);
  assert.match(migration, /worst_control_point_id TEXT/);
  assert.match(migration, /status IN \('unverified','verified','failed'\)/);
  assert.match(migration, /UNIQUE \(overlay_id, draft_revision\)/);
});

test("site boundary and migration verifier include the V2 Geo foundation", () => {
  const migration = read(migrationPath);
  const verifier = read("scripts/verify-fresh-migrations.mjs");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS geo_site_boundaries_3d/);
  assert.match(migration, /points_json TEXT NOT NULL/);
  assert.match(migration, /Geo site boundary must match current Geo draft revision/);

  for (const table of [
    "geo_model_anchors_3d",
    "geo_overlays_3d",
    "geo_control_points_3d",
    "geo_calibration_reports_3d",
    "geo_site_boundaries_3d",
  ]) {
    assert.match(verifier, new RegExp(table));
  }
});
