import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine hard delete is authenticated, same-origin and exact-confirmation gated", () => {
  const worker = read("workers/admin-cloud.mjs");

  assert.match(worker, /async function hardDeleteAllProjects/);
  assert.match(worker, /request\.method !== "DELETE"/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /DELETE ALL PROJECTS/);
  assert.match(worker, /expectedProjectCount/);
  assert.match(worker, /Project list changed\. Refresh before permanent deletion/);
});

test("Engine hard delete removes all project-owned storage and project records", () => {
  const worker = read("workers/admin-cloud.mjs");

  assert.match(worker, /projectAssetPrefix\(slug\)/);
  assert.match(worker, /MODEL_ASSETS\.list/);
  assert.match(worker, /MODEL_ASSETS\.delete\(keys\)/);
  assert.match(worker, /DELETE FROM geo_experience_active_releases_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM geo_release_activations_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM geo_releases_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM geo_draft_verifications_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM geo_placements_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM geo_experience_drafts_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM experiences_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM release_assets_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM studio_assets_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM models_3d WHERE project_id=\?/);
  assert.match(worker, /DELETE FROM projects_3d WHERE id=\?/);
  assert.match(worker, /projects\.all_deleted/);
  assert.match(worker, /remainingProjects: 0/);
});

test("Dashboard requires typed destructive confirmation and renders a true empty state", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(cloud, /export async function deleteAllProjects/);
  assert.match(dashboard, /Delete all projects/);
  assert.match(dashboard, /DELETE ALL PROJECTS/);
  assert.match(dashboard, /Permanently delete all projects/);
  assert.match(dashboard, /No 3D projects yet/);
  assert.match(dashboard, /Engine registry ab empty hai/);
  assert.match(dashboard, /projectsLoaded && projects\.length === 0/);
});

test("delete-all does not mutate global Engine settings or authentication state", () => {
  const worker = read("workers/admin-cloud.mjs");
  const start = worker.indexOf("async function hardDeleteAllProjects");
  const end = worker.indexOf("async function patchProject", start);
  assert.ok(start >= 0 && end > start);
  const block = worker.slice(start, end);

  assert.doesNotMatch(block, /DELETE FROM engine_settings_3d/);
  assert.doesNotMatch(block, /DELETE FROM engine_admin_security/);
  assert.doesNotMatch(block, /DELETE FROM engine_admin_login_attempts/);
});
