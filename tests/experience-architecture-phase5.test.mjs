import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 5 schema is additive and separates Geo release lifecycle from Building releases", () => {
  const sql = read("database/migrations/0026_geo_immutable_release_v1.sql");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_draft_verifications_3d/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_releases_3d/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_experience_active_releases_3d/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS geo_release_activations_3d/);
  assert.match(sql, /UNIQUE \(experience_id, version\)/);
  assert.match(sql, /UNIQUE \(experience_id, source_draft_revision\)/);
  assert.match(sql, /action TEXT NOT NULL CHECK \(action IN \('publish','rollback'\)\)/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\b/i);
  assert.doesNotMatch(sql, /tiyansh-production|tiyansh-gallery-production/);
});

test("Geo release ownership guards prevent cross-project and cross-Experience attachment", () => {
  const sql = read("database/migrations/0026_geo_immutable_release_v1.sql");

  assert.match(sql, /trg_geo_draft_verifications_3d_owner/);
  assert.match(sql, /trg_geo_releases_3d_owner/);
  assert.match(sql, /trg_geo_active_release_owner_insert/);
  assert.match(sql, /trg_geo_active_release_owner_update/);
  assert.match(sql, /trg_geo_release_activations_3d_owner/);
  assert.match(sql, /e\.id=NEW\.experience_id/);
  assert.match(sql, /e\.project_id=NEW\.project_id/);
  assert.match(sql, /e\.type='geo'/);
  assert.match(sql, /r\.id=NEW\.source_building_release_id/);
});

test("preview verification is bound to exact saved draft revision and active Building source", () => {
  const verify = read("workers/geo-release-verify.mjs");

  assert.match(verify, /expectedDraftRevision/);
  assert.match(verify, /Geo draft changed before preview verification/);
  assert.match(verify, /project\.active_release_id !== context\.sourceBuildingReleaseId/);
  assert.match(verify, /geo_draft_verifications_3d/);
  assert.match(verify, /geo\.preview_verified/);
  assert.match(verify, /Pinned Building release manifest checksum mismatch/);
});

test("immutable Geo publication freezes source Building identity and placement manifest", () => {
  const publish = read("workers/geo-release-publish.mjs");

  assert.match(publish, /format: GEO_RELEASE_FORMAT/);
  assert.match(publish, /sourceBuilding:/);
  assert.match(publish, /placement:/);
  assert.match(publish, /sourceDraftRevision: Number\(context\.revision\)/);
  assert.match(publish, /manifestSha256 = await digestHex\(manifestJson\)/);
  assert.match(publish, /INSERT INTO geo_releases_3d/);
  assert.match(publish, /INSERT INTO geo_experience_active_releases_3d/);
  assert.match(publish, /INSERT INTO geo_release_activations_3d/);
  assert.match(publish, /'publish'/);
  assert.match(publish, /geo\.release_published/);
  assert.match(publish, /already exists for this draft/);
});

test("Geo rollback integrity-checks immutable manifest and Building source before activation", () => {
  const activate = read("workers/geo-release-activate.mjs");

  assert.match(activate, /Geo release manifest checksum mismatch/);
  assert.match(activate, /Geo release manifest identity mismatch/);
  assert.match(activate, /Geo release Building source integrity mismatch/);
  assert.match(activate, /INSERT INTO geo_experience_active_releases_3d/);
  assert.match(activate, /'rollback'/);
  assert.match(activate, /geo\.release_activated/);
  assert.match(activate, /unchanged: true/);
});

test("Admin routes require authenticated same-origin writes for verify publish and rollback", () => {
  const worker = read("workers/admin-cloud.mjs");

  assert.match(worker, /projectGeoDraftVerification/);
  assert.match(worker, /projectGeoReleases/);
  assert.match(worker, /parts\[2\] === "verify"/);
  assert.match(worker, /parts\[1\] === "geo-releases"/);

  const verifyStart = worker.indexOf("async function projectGeoDraftVerification");
  const verifyEnd = worker.indexOf("async function projectGeoReleases", verifyStart);
  const verifyBlock = worker.slice(verifyStart, verifyEnd);
  assert.match(verifyBlock, /request\.method !== "POST"/);
  assert.match(verifyBlock, /sameOrigin\(request\)/);
  assert.match(verifyBlock, /verifyGeoDraftPreview/);

  const releasesStart = worker.indexOf("async function projectGeoReleases");
  const releasesEnd = worker.indexOf("async function experienceSchemaReady", releasesStart);
  const releasesBlock = worker.slice(releasesStart, releasesEnd);
  assert.match(releasesBlock, /sameOrigin\(request\)/);
  assert.match(releasesBlock, /publishGeoRelease/);
  assert.match(releasesBlock, /activateGeoRelease/);
});

test("typed Admin client exposes Geo verification publication history and rollback", () => {
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(cloud, /interface CloudGeoPreviewVerification/);
  assert.match(cloud, /interface CloudGeoReleaseSummary/);
  assert.match(cloud, /interface CloudGeoReleaseState/);
  assert.match(cloud, /export async function geoReleases/);
  assert.match(cloud, /export async function verifyGeoPreview/);
  assert.match(cloud, /export async function publishGeoRelease/);
  assert.match(cloud, /export async function activateGeoRelease/);
});

test("Geo Mapper implements explicit verify then publish and immutable rollback history", () => {
  const mapper = read("apps/admin/src/geo/GeoMapper3D.tsx");

  assert.match(mapper, /Verify current preview/);
  assert.match(mapper, /Publish Geo Release/);
  assert.match(mapper, /Geo Release History/);
  assert.match(mapper, /Activate \/ Rollback/);
  assert.match(mapper, /draftDirty/);
  assert.match(mapper, /geoReleaseState\?\.previewVerified/);
  assert.match(mapper, /verifyGeoPreview\(selectedSlug, state\.draft\.revision\)/);
  assert.match(mapper, /publishGeoRelease\(/);
  assert.match(mapper, /activateGeoRelease\(selectedSlug, releaseId\)/);
  assert.match(mapper, /Building Website unchanged hai/);
});

test("dashboard distinguishes immutable Geo release from public compatibility snapshot", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /geoReleases\(selectedSlug\)/);
  assert.match(dashboard, /activeImmutableGeoRelease/);
  assert.match(dashboard, /Active immutable Geo release/);
  assert.match(dashboard, /Public compatibility snapshot/);
});

test("project hard-delete removes immutable Geo release state before Experiences and Building releases", () => {
  const worker = read("workers/admin-cloud.mjs");

  const activeAt = worker.indexOf(
    '"DELETE FROM geo_experience_active_releases_3d WHERE project_id=?"',
  );
  const activationsAt = worker.indexOf(
    '"DELETE FROM geo_release_activations_3d WHERE project_id=?"',
  );
  const releasesAt = worker.indexOf(
    '"DELETE FROM geo_releases_3d WHERE project_id=?"',
  );
  const verificationAt = worker.indexOf(
    '"DELETE FROM geo_draft_verifications_3d WHERE project_id=?"',
  );
  const experienceAt = worker.indexOf(
    '"DELETE FROM experiences_3d WHERE project_id=?"',
  );
  const buildingReleaseAt = worker.indexOf(
    '"DELETE FROM releases_3d WHERE project_id=?"',
  );

  assert.ok(activeAt >= 0);
  assert.ok(activationsAt > activeAt);
  assert.ok(releasesAt > activationsAt);
  assert.ok(verificationAt > releasesAt);
  assert.ok(experienceAt > verificationAt);
  assert.ok(buildingReleaseAt > experienceAt);
});

test("Phase 5 does not change public Geo runtime source of truth", () => {
  const publicWorker = read("workers/public.mjs");

  assert.match(publicWorker, /FROM geo_placements_3d g/);
  assert.doesNotMatch(publicWorker, /geo_releases_3d/);
  assert.doesNotMatch(publicWorker, /geo_experience_active_releases_3d/);
});
