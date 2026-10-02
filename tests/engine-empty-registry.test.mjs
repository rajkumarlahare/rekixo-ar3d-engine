import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("production deploy is valid when Engine has zero projects", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify empty-safe Engine production shell/);
  assert.match(workflow, /no-project-selected/);
  assert.match(workflow, /PUBLIC_CODE" = "404"/);
  assert.match(workflow, /without requiring any project fixture/);
  assert.doesNotMatch(workflow, /Verify legacy Jyoti public production fixture/);
  assert.doesNotMatch(workflow, /Verify Jyoti admin shell/);
  assert.doesNotMatch(workflow, /Verify Platform integration contract/);
});

test("Geo derivative deployment registry starts empty after legacy cleanup", () => {
  const registry = JSON.parse(read("project-profiles/geo-model-derivatives.json"));
  assert.equal(registry.format, "rekixo-geo-model-derivative-registry");
  assert.equal(registry.version, 1);
  assert.deepEqual(registry.projects, []);
});


test("clean-room reset clears project-owned D1 data and R2 project prefix", () => {
  const migration = read("database/migrations/0028_clean_room_project_reset_v1.sql");
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  const purge = read("scripts/purge-project-r2-prefix.mjs");

  for (const table of [
    "geo_experience_active_releases_3d",
    "geo_release_activations_3d",
    "geo_releases_3d",
    "geo_draft_verifications_3d",
    "geo_placements_3d",
    "geo_experience_drafts_3d",
    "experiences_3d",
    "release_activations_3d",
    "release_assets_3d",
    "releases_3d",
    "studio_assets_3d",
    "studio_drafts_3d",
    "publish_versions_3d",
    "scenes_3d",
    "camera_presets_3d",
    "models_3d",
    "projects_3d",
    "engine_deletion_jobs_3d",
    "engine_admin_audit",
  ])
    assert.match(migration, new RegExp(`DELETE FROM ${table}`));

  assert.match(workflow, /0028_clean_room_project_reset_v1\\.sql/);
  assert.match(
    workflow,
    /database\/migrations\/0028_clean_room_project_reset_v1\\.sql\$/,
    "clean-room reset must also trigger a Public runtime deploy",
  );
  assert.match(workflow, /Purge project-owned R2 objects for clean-room reset/);
  assert.match(workflow, /CONFIRM_ENGINE_PROJECT_PURGE: DELETE_ENGINE_PROJECT_DATA/);
  assert.match(purge, /R2_PREFIX \|\| "projects\/"|process\.env\.R2_PREFIX/);
  assert.match(purge, /Engine R2 project prefix is empty/);
});
