import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 2 adds Experience identity with an additive Engine-only migration", () => {
  const sql = read("database/migrations/0024_experience_identity_v1.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS experiences_3d/);
  assert.match(sql, /type TEXT NOT NULL CHECK \(type IN \('building','geo'\)\)/);
  assert.match(sql, /UNIQUE \(project_id, type\)/);
  assert.match(sql, /source_building_release_id TEXT/);
  assert.match(
    sql,
    /FOREIGN KEY \(source_building_release_id\) REFERENCES releases_3d\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /tiyansh-production|tiyansh-gallery-production|rekixo-ar3d-platform\/database/i);
});

test("all existing and future Engine projects receive one Building Experience identity", () => {
  const sql = read("database/migrations/0024_experience_identity_v1.sql");

  assert.match(
    sql,
    /INSERT OR IGNORE INTO experiences_3d[\s\S]*'experience_building_' \|\| p\.id[\s\S]*'building'/,
  );
  assert.match(sql, /FROM projects_3d p/);
  assert.match(sql, /trg_projects_3d_building_experience_insert/);
  assert.match(sql, /AFTER INSERT ON projects_3d/);
  assert.match(
    sql,
    /'experience_building_' \|\| NEW\.id[\s\S]*'building'/,
  );
});

test("existing Geo placements become optional Geo Experience identities without copying Building data", () => {
  const sql = read("database/migrations/0024_experience_identity_v1.sql");

  assert.match(
    sql,
    /'experience_geo_' \|\| g\.project_id[\s\S]*'geo'[\s\S]*g\.release_id/,
  );
  assert.match(sql, /FROM geo_placements_3d g/);
  assert.match(sql, /Geo Experience source release must belong to project/);
  assert.doesNotMatch(sql, /INSERT[\s\S]*INTO\s+projects_3d/i);
  assert.doesNotMatch(sql, /INSERT[\s\S]*INTO\s+releases_3d/i);
});

test("Experience API is authenticated, project-scoped and explicit about Geo source release", () => {
  const worker = read("workers/admin-cloud.mjs");

  assert.match(worker, /async function experienceSchemaReady/);
  assert.match(worker, /async function projectExperiences/);
  assert.match(worker, /parts\[1\] === "experiences"/);
  assert.match(worker, /request\.method === "GET"/);
  assert.match(worker, /request\.method !== "POST"/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /Only optional Geo Experiences are created explicitly/);
  assert.match(worker, /sourceBuildingReleaseId/);
  assert.match(worker, /WHERE id=\? AND project_id=\?/);
  assert.match(worker, /experience\.geo_created/);
  assert.match(worker, /Source upgrades require the Geo workflow/);
});

test("legacy Geo placement can self-register identity but cannot overwrite a pinned Geo source", () => {
  const worker = read("workers/admin-cloud.mjs");
  const start = worker.indexOf("async function projectGeoPlacement");
  const end = worker.indexOf("async function geoMapsSettings", start);
  assert.ok(start >= 0 && end > start);
  const placementBlock = worker.slice(start, end);

  assert.match(placementBlock, /INSERT INTO experiences_3d/);
  assert.match(placementBlock, /ON CONFLICT\(project_id,type\) DO UPDATE SET/);
  assert.match(placementBlock, /lifecycle='active'/);
  assert.doesNotMatch(
    placementBlock,
    /ON CONFLICT\(project_id,type\) DO UPDATE SET[\s\S]{0,220}source_building_release_id=excluded/,
  );
  assert.match(placementBlock, /release\.id/);
  assert.match(placementBlock, /experience_geo_\$\{project\.id\}/);
  assert.match(placementBlock, /geo\.placement_saved/);
});

test("hard delete removes Experience rows before immutable Building releases", () => {
  const worker = read("workers/admin-cloud.mjs");
  const experienceAt = worker.indexOf(
    '"DELETE FROM experiences_3d WHERE project_id=?"',
  );
  const releaseAt = worker.indexOf(
    '"DELETE FROM releases_3d WHERE project_id=?"',
  );

  assert.ok(experienceAt >= 0, "Experience cleanup must be present");
  assert.ok(releaseAt > experienceAt, "Experience cleanup must run before Building release cleanup");
});

test("archive and restore keep canonical Building Experience lifecycle coherent", () => {
  const worker = read("workers/admin-cloud.mjs");

  assert.match(
    worker,
    /UPDATE experiences_3d[\s\S]*SET lifecycle=\?,updated_at=\?[\s\S]*type='building'/,
  );
  assert.match(worker, /action === "archive" \? "archived" : "active"/);
});

test("typed Admin client exposes Experience listing and explicit Geo creation", () => {
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(cloud, /EngineExperienceSummary/);
  assert.match(cloud, /export async function experiences\(slug: string\)/);
  assert.match(cloud, /export async function createGeoExperience/);
  assert.match(cloud, /sourceBuildingReleaseId/);
  assert.match(cloud, /type: "geo"/);
});

test("shared contracts expose Experience lifecycle and summaries for the next Admin phase", () => {
  const contracts = read("packages/contracts/src/index.ts");

  assert.match(contracts, /Experience3DLifecycle = "active" \| "archived"/);
  assert.match(contracts, /interface EngineExperienceSummary/);
  assert.match(contracts, /sourceBuildingReleaseId\?: string/);
  assert.match(contracts, /sourceBuildingReleaseVersion\?: number/);
  assert.match(contracts, /interface AdminExperiencesResponse/);
});
