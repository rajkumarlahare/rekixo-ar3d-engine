import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 4 adds an additive Experience-owned Geo draft schema", () => {
  const sql = read("database/migrations/0025_geo_experience_draft_v1.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_experience_drafts_3d/);
  assert.match(sql, /experience_id TEXT PRIMARY KEY/);
  assert.match(sql, /project_id TEXT NOT NULL UNIQUE/);
  assert.match(sql, /source_building_release_id TEXT NOT NULL/);
  assert.match(sql, /revision INTEGER NOT NULL DEFAULT 0/);
  assert.match(
    sql,
    /FOREIGN KEY \(experience_id\) REFERENCES experiences_3d\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    sql,
    /FOREIGN KEY \(source_building_release_id\) REFERENCES releases_3d\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /tiyansh-production|tiyansh-gallery-production/);
});

test("Geo draft backfill only reuses legacy alignment when the pinned Building source matches", () => {
  const sql = read("database/migrations/0025_geo_experience_draft_v1.sql");

  assert.match(sql, /FROM experiences_3d e/);
  assert.match(sql, /WHERE e\.type='geo'/);
  assert.match(
    sql,
    /CASE WHEN g\.release_id=e\.source_building_release_id THEN g\.longitude ELSE NULL END/,
  );
  assert.match(
    sql,
    /CASE WHEN g\.release_id=e\.source_building_release_id THEN g\.latitude ELSE NULL END/,
  );
  assert.match(
    sql,
    /CASE WHEN g\.release_id=e\.source_building_release_id THEN 1 ELSE 0 END/,
  );
});

test("every future optional Geo Experience receives exactly one editable draft", () => {
  const sql = read("database/migrations/0025_geo_experience_draft_v1.sql");

  assert.match(sql, /trg_experiences_3d_geo_draft_insert/);
  assert.match(sql, /AFTER INSERT ON experiences_3d/);
  assert.match(sql, /WHEN NEW\.type='geo'/);
  assert.match(sql, /INSERT OR IGNORE INTO geo_experience_drafts_3d/);
  assert.match(sql, /NEW\.source_building_release_id/);
});

test("DB guards keep Geo drafts scoped to their Geo Experience and immutable Building source", () => {
  const sql = read("database/migrations/0025_geo_experience_draft_v1.sql");

  assert.match(sql, /trg_geo_experience_drafts_3d_owner_insert/);
  assert.match(sql, /trg_geo_experience_drafts_3d_owner_update/);
  assert.match(sql, /e\.id=NEW\.experience_id/);
  assert.match(sql, /e\.project_id=NEW\.project_id/);
  assert.match(sql, /e\.type='geo'/);
  assert.match(
    sql,
    /e\.source_building_release_id=NEW\.source_building_release_id/,
  );
  assert.match(sql, /r\.version=NEW\.source_building_release_version/);
  assert.match(
    sql,
    /Geo draft must belong to Geo Experience source release/,
  );
});

test("Geo draft API is authenticated, same-origin and optimistic-revision protected", () => {
  const worker = read("workers/admin-cloud.mjs");
  const start = worker.indexOf("async function projectGeoDraft");
  const end = worker.indexOf("async function geoPlacementSchemaReady", start);
  assert.ok(start >= 0 && end > start);
  const block = worker.slice(start, end);

  assert.match(worker, /parts\[1\] === "geo-draft"/);
  assert.match(block, /sameOrigin\(request\)/);
  assert.match(block, /expectedRevision/);
  assert.match(block, /revision=revision\+1/);
  assert.match(block, /Geo draft changed elsewhere/);
  assert.match(block, /WHERE id=\? AND project_id=\?/);
  assert.match(block, /geo\.draft_saved/);
  assert.match(block, /geo\.draft_reset/);
});

test("saving a Geo draft cannot mutate the legacy public Geo placement snapshot", () => {
  const worker = read("workers/admin-cloud.mjs");
  const start = worker.indexOf("async function projectGeoDraft");
  const end = worker.indexOf("async function geoPlacementSchemaReady", start);
  assert.ok(start >= 0 && end > start);
  const block = worker.slice(start, end);

  assert.match(block, /UPDATE geo_experience_drafts_3d/);
  assert.match(block, /UPDATE experiences_3d/);
  assert.doesNotMatch(block, /INSERT INTO geo_placements_3d/);
  assert.doesNotMatch(block, /UPDATE geo_placements_3d/);
  assert.doesNotMatch(block, /public_enabled/);
});

test("Geo Mapper edits the draft and no longer exposes direct live publication controls", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(mapper, /geoDraft\(selectedSlug\)/);
  assert.match(mapper, /saveGeoDraft\(selectedSlug/);
  assert.match(mapper, /resetGeoDraft\(selectedSlug/);
  assert.match(mapper, /Save Geo draft/);
  assert.match(mapper, /Existing live Geo snapshot/);
  assert.match(mapper, /sourceUpdateAvailable/);
  assert.match(mapper, /Source change sirf Geo draft me pin hota hai/);
  assert.doesNotMatch(mapper, /saveGeoPlacement|removeGeoPlacement|publicEnabled/);

  assert.match(cloud, /export async function geoDraft/);
  assert.match(cloud, /export async function saveGeoDraft/);
  assert.match(cloud, /export async function resetGeoDraft/);
});

test("Dashboard distinguishes editable Geo draft source from current live compatibility snapshot", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /geoDraftState/);
  assert.match(dashboard, /geoDraftSourceId/);
  assert.match(dashboard, /Geo draft source/);
  assert.match(dashboard, /Current live snapshot/);
  assert.match(dashboard, /preview before draft upgrade/);
});

test("legacy public Geo runtime stays unchanged until immutable Geo release phases", () => {
  const worker = read("workers/public.mjs");

  assert.match(worker, /FROM geo_placements_3d g/);
  assert.match(worker, /g\.public_enabled=1/);
  assert.match(worker, /row\.releaseId !== release\.manifest\.release\.id/);
  assert.doesNotMatch(worker, /geo_experience_drafts_3d/);
});

test("Phase 4 remains Engine-only and leaves stable Platform resources untouched", () => {
  const files = [
    "database/migrations/0025_geo_experience_draft_v1.sql",
    "workers/admin-cloud.mjs",
    "apps/admin/src/studio/cloud.ts",
    "apps/admin/src/geo/GeoMapper3D.tsx",
    "apps/admin/src/dashboard/EngineDashboard.tsx",
  ];

  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /tiyansh-production|tiyansh-gallery-production/);
    assert.doesNotMatch(source, /\/api\/admin\//);
  }
});
