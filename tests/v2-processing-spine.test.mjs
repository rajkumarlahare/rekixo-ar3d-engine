import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "database/migrations/0035_v2_processing_foundation.sql",
  "utf8",
);
const worker = fs.readFileSync("workers/processing-jobs.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
const verifier = fs.readFileSync("scripts/verify-fresh-migrations.mjs", "utf8");
const ui = fs.readFileSync(
  "apps/admin/src/source-pack/ProcessingSpine.tsx",
  "utf8",
);
const sourceReview = fs.readFileSync(
  "apps/admin/src/source-pack/SourcePackReview.tsx",
  "utf8",
);

test("Phase 1 processing foundation is additive and pins immutable Source Pack identity", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS processing_jobs_3d/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS processing_artifacts_3d/);
  assert.match(migration, /source_pack_manifest_sha256 TEXT NOT NULL/);
  assert.match(migration, /processor_version TEXT NOT NULL/);
  assert.match(migration, /artifact_prefix TEXT NOT NULL/);
  assert.match(migration, /trg_processing_jobs_3d_input_insert/);
  assert.match(migration, /status IN \('ready','superseded'\)/);
  assert.match(migration, /operator_approved=1/);
  assert.match(migration, /Processing job input identity is immutable/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /UPDATE\s+releases_3d/i);
  assert.doesNotMatch(migration, /UPDATE\s+geo_releases_3d/i);
});

test("processing retries append attempts and duplicate active work is blocked", () => {
  assert.match(migration, /UNIQUE \(source_pack_id, processor_version, attempt\)/);
  assert.match(migration, /idx_processing_jobs_3d_single_live/);
  assert.match(migration, /WHERE state IN \('queued','running','succeeded'\)/);
  assert.match(migration, /Terminal processing job is immutable; create a retry attempt/);
  assert.match(worker, /COALESCE\(MAX\(attempt\),0\)\+1 AS attempt/);
  assert.match(worker, /NOT EXISTS \([\s\S]*state IN \('queued','running','succeeded'\)/);
  assert.match(worker, /if \(existingLive\) return \{ job: existingLive, created: false \}/);
  assert.match(worker, /Only a failed or cancelled processing attempt can be retried/);
});

test("processing artifacts are attempt-scoped and successful output is immutable", () => {
  assert.match(migration, /NEW\.r2_key LIKE j\.artifact_prefix \|\| '%'/);
  assert.match(migration, /Successful processing job requires a ready artifact/);
  assert.match(migration, /Ready processing artifact is immutable/);
  assert.match(migration, /Successful processing job is immutable outside project hard delete/);
  assert.match(migration, /job\.status='db_cleanup_pending'/);
  assert.match(migration, /json_extract\(snapshot_project\.value, '\$\.id'\)=OLD\.project_id/);
  assert.match(migration, /json_extract\(snapshot_project\.value, '\$\.status'\)='archived'/);
});

test("fresh migration verifier installs and hard-deletes processing state", () => {
  assert.match(verifier, /"processing_jobs_3d"/);
  assert.match(verifier, /"processing_artifacts_3d"/);
  assert.match(verifier, /INSERT INTO processing_jobs_3d/);
  assert.match(verifier, /INSERT INTO processing_artifacts_3d/);
  assert.match(verifier, /SET state='succeeded'/);
  assert.match(verifier, /COUNT\(\*\) FROM processing_jobs_3d/);
  assert.match(verifier, /COUNT\(\*\) FROM processing_artifacts_3d/);
});

test("processing API is guarded, audited and cannot mutate source/release bytes", () => {
  assert.match(worker, /engineAdminReadAccess/);
  assert.match(worker, /sameOrigin/);
  assert.match(worker, /activeDeletionJob/);
  assert.match(worker, /projectOperationLockReason\(env, project\.id, "processing-write"\)/);
  assert.match(worker, /processing\.job_queued/);
  assert.match(worker, /AUTOMATIC_PROCESSOR_VERSION = "canonical-building-v1"/);
  assert.match(worker, /source_pack_manifest_sha256/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.(put|delete)/);
  assert.doesNotMatch(worker, /UPDATE\s+source_files_3d/i);
  assert.doesNotMatch(worker, /UPDATE\s+source_packs_3d/i);
  assert.doesNotMatch(worker, /active_release_id/);
});

test("Admin entry exposes processing before legacy admin fallback", () => {
  const processingIndex = entry.indexOf("handleProcessingRequest");
  const fallbackIndex = entry.indexOf("return adminWorker.fetch");
  assert.ok(processingIndex >= 0);
  assert.ok(fallbackIndex > processingIndex);
});

test("Source Pack UI exposes durable start/retry state without reconstructing geometry", () => {
  assert.match(ui, /Start Processing/);
  assert.match(ui, /Retry Processing/);
  assert.match(ui, /sourcePackId: data\.sourcePack\.id/);
  assert.match(ui, /Existing active processing attempt reused/);
  assert.match(ui, /Source bytes, Building release and Geo release are not mutated/);
  assert.doesNotMatch(ui, /Build Draft|Draw Wall|Create Room/);
  assert.match(sourceReview, /import ProcessingSpine from "\.\/ProcessingSpine"/);
  assert.match(sourceReview, /<ProcessingSpine slug=\{slug\} sourcePackSignal=\{processingSignal\} \/>/);
});
