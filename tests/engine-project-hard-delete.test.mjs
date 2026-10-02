import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine hard delete is authenticated, same-origin and exact-confirmation gated", () => {
  const worker = read("workers/project-deletion.mjs");

  assert.match(worker, /async function hardDeleteAllProjects/);
  assert.match(worker, /request\.method !== "DELETE"/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /DELETE ALL PROJECTS/);
  assert.match(worker, /expectedProjectCount/);
  assert.match(worker, /Project list changed\. Refresh before permanent deletion/);
});

test("permanent deletion uses a persistent resumable job before touching R2", () => {
  const worker = read("workers/project-deletion.mjs");
  const migration = read(
    "database/migrations/0027_resumable_project_deletion_v1.sql",
  );

  assert.match(migration, /CREATE TABLE IF NOT EXISTS engine_deletion_jobs_3d/);
  assert.match(
    migration,
    /status IN \('running','cleanup_pending','db_cleanup_pending','completed'\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_engine_deletion_jobs_3d_one_active/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER IF NOT EXISTS trg_projects_3d_block_insert_during_delete/,
  );

  assert.match(worker, /async function startDeletionJob/);
  assert.match(worker, /"projects\.delete_started"/);
  assert.match(
    worker,
    /UPDATE projects_3d SET status='archived',updated_at=\? WHERE id=\?/,
  );
  assert.match(
    worker,
    /UPDATE experiences_3d SET lifecycle='archived',updated_at=\? WHERE project_id=\?/,
  );
});

test("R2 cleanup is retryable and database records are deleted only after storage cleanup", () => {
  const worker = read("workers/project-deletion.mjs");
  const runStart = worker.indexOf("async function runDeletionJob");
  const startJob = worker.indexOf("async function startDeletionJob", runStart);
  assert.ok(runStart >= 0 && startJob > runStart);
  const block = worker.slice(runStart, startJob);

  const r2Index = block.indexOf("deleteProjectOwnedObjects");
  const dbIndex = block.indexOf("deleteProjectRecords");
  assert.ok(r2Index >= 0 && dbIndex > r2Index);

  assert.match(block, /"cleanup_pending"/);
  assert.match(block, /"db_cleanup_pending"/);
  assert.match(block, /retryable: true/);
  assert.match(
    block,
    /Retry permanent deletion to resume/,
  );
  assert.match(block, /status='completed'/);
});

test("Engine hard delete removes all project-owned records after R2 cleanup", () => {
  const worker = read("workers/project-deletion.mjs");

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
  assert.match(worker, /"projects\.all_deleted"/);
  assert.match(worker, /remainingProjects: 0/);
});

test("pending deletion freezes project recreation and project mutations", () => {
  const worker = read("workers/project-deletion.mjs");
  const migration = read(
    "database/migrations/0027_resumable_project_deletion_v1.sql",
  );

  assert.match(
    migration,
    /RAISE\(ABORT, 'Engine project deletion cleanup in progress'\)/,
  );
  assert.match(
    worker,
    /Permanent project cleanup is in progress\. Finish that cleanup before creating another project\./,
  );
  assert.match(
    worker,
    /Project mutations are frozen until it finishes\./,
  );
});

test("Dashboard can discover and resume a cleanup after reload", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(cloud, /export interface CloudDeletionJob/);
  assert.match(cloud, /export async function deletionStatus/);
  assert.match(cloud, /deletion-status/);
  assert.match(dashboard, /Finish project cleanup/);
  assert.match(dashboard, /Finish permanent cleanup/);
  assert.match(dashboard, /deletionJob\?\.expectedProjectCount \?\? projects\.length/);
  assert.match(dashboard, /CLEANUP PENDING/);
  assert.match(dashboard, /DELETE ALL PROJECTS/);
});

test("delete-all does not mutate global Engine settings or authentication state", () => {
  const worker = read("workers/project-deletion.mjs");

  assert.doesNotMatch(worker, /DELETE FROM engine_settings_3d/);
  assert.doesNotMatch(worker, /DELETE FROM engine_admin_security/);
  assert.doesNotMatch(worker, /DELETE FROM engine_admin_login_attempts/);
});


test("Admin cloud worker delegates destructive cleanup to a focused module", () => {
  const admin = read("workers/admin-cloud.mjs");
  const deletion = read("workers/project-deletion.mjs");

  assert.match(admin, /from "\.\/project-deletion\.mjs"/);
  assert.doesNotMatch(admin, /^async function deleteProjectOwnedObjects/m);
  assert.doesNotMatch(admin, /^async function deleteProjectRecords/m);
  assert.match(deletion, /export async function hardDeleteAllProjects/);
  assert.match(deletion, /export async function deletionStatus/);
});
