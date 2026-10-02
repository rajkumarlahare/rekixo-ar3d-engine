import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("3D Jio Mapper schema is additive and release pinned", () => {
  const sql = read("database/migrations/0023_geo_mapper_v1.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_placements_3d/);
  assert.match(sql, /release_id TEXT NOT NULL/);
  assert.match(sql, /release_version INTEGER NOT NULL/);
  assert.match(sql, /public_enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS engine_settings_3d/);
  assert.match(sql, /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/);
  assert.match(sql, /Geo placement release must belong to project/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+projects_3d\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\s+projects_3d\b/i);
});

test("Engine Admin owns editable Geo drafts while legacy placement remains isolated", () => {
  const worker = read("workers/admin-cloud.mjs");
  assert.match(worker, /geoDraftSchemaReady/);
  assert.match(worker, /projectGeoDraft/);
  assert.match(worker, /geoPlacementSchemaReady/);
  assert.match(worker, /projectGeoPlacement/);
  assert.match(worker, /geoMapsSettings/);
  assert.match(worker, /engineMapsBrowserKey/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /geo\.draft_saved/);
  assert.match(worker, /geo\.draft_reset/);
  assert.match(worker, /geo\.placement_saved/);
  assert.match(worker, /geo\.maps_key_updated/);
  assert.match(worker, /Geo draft changed elsewhere/);
});

test("3D Jio Mapper is an Engine route, not a Platform dependency", () => {
  const main = read("apps/admin/src/main.tsx");
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");
  assert.match(dashboard, /\+ Add 3D Geo Experience/);
  assert.match(dashboard, /Manage Geo Experience/);
  assert.match(main, /\/3Dprojects\/geo-mapper/);
  assert.match(mapper, /<h1>3D Geo Mapper<\/h1>/);
  assert.match(mapper, /Optional Geo Experience/);
  assert.match(mapper, /saveGeoDraft/);
  assert.match(mapper, /resetGeoDraft/);
  assert.match(mapper, /saveGeoMapsKey/);
  assert.match(mapper, /sourceUpdateAvailable/);
  assert.doesNotMatch(mapper, /saveGeoPlacement|removeGeoPlacement/);
  assert.doesNotMatch(mapper, /Public 3D Jio demo|type="checkbox"/);
  assert.doesNotMatch(mapper, /tiyansh-production|rekixo-ar3d-platform|geo_3d_placements/);
});

test("public 3D Jio demo is fail-closed on publication and active release identity", () => {
  const worker = read("workers/public.mjs");
  const page = read("apps/public/src/geo/GeoPublicDemo.tsx");
  const main = read("apps/public/src/main.tsx");

  assert.match(worker, /publicGeo3DState/);
  assert.match(worker, /g\.public_enabled=1/);
  assert.match(worker, /p\.status='published'/);
  assert.match(worker, /row\.releaseId !== release\.manifest\.release\.id/);
  assert.match(worker, /row\.releaseVersion/);
  assert.match(worker, /geoModelDerivativeForActiveRelease/);
  assert.match(worker, /Public 3D Jio demo is not currently available/);

  assert.match(page, /LIVE 3D JIO DEMO/);
  assert.match(page, /api\/projects\/\$\{encodeURIComponent\(slug\)\}\/geo-placement/);
  assert.match(page, /Viewer3D/);
  assert.match(page, /Satellite anchor/);
  assert.match(main, /geoRoute/);
  assert.match(main, /GeoPublicDemo/);
});

test("main deploy applies new Engine migrations before Workers deploy", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /migrations_changed=true/);
  assert.match(workflow, /steps\.public_runtime\.outputs\.migrations_changed == 'true'/);
  const migrateAt = workflow.indexOf("Apply isolated D1 migrations");
  const adminDeployAt = workflow.indexOf("Deploy isolated 3D Admin Worker");
  assert.ok(migrateAt >= 0 && adminDeployAt > migrateAt);
});

test("3D Geo mapper keeps model preview separate from map anchor to avoid drag snap regression", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");
  const preview = read("apps/admin/src/geo/GeoModelPreview.tsx");
  assert.match(mapper, /Map anchor aur 3D/);
  assert.match(mapper, /camera movement saved location ko/);
  assert.match(mapper, /<GeoModelPreview/);
  assert.match(preview, /Ground contact preview/);
  assert.match(preview, /Drag = orbit/);
});
