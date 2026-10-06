import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "database/migrations/0036_processing_lifecycle_race_guards.sql",
  "utf8",
);

test("processing enqueue and stale recovery fail closed after lifecycle freeze", () => {
  assert.match(migration, /trg_processing_jobs_3d_enqueue_writable_project/);
  assert.match(migration, /trg_processing_jobs_3d_running_writable_project/);
  assert.match(migration, /project\.status<>'archived'/);
  assert.match(migration, /lock\.operation='processing-write'/);
  assert.match(migration, /deletion\.kind='all-projects'/);
  assert.match(migration, /deletion\.status<>'completed'/);
  assert.match(migration, /SELECT RAISE\(IGNORE\)/);
});

test("archive cannot race a queued or running processing attempt", () => {
  assert.match(migration, /trg_projects_3d_archive_blocks_active_processing/);
  assert.match(migration, /NEW\.status='archived'/);
  assert.match(migration, /job\.project_id=OLD\.id/);
  assert.match(migration, /job\.state IN \('queued','running'\)/);
  assert.match(migration, /Project cannot be archived while processing is active/);
});

test("processing-write lock cannot be inserted halfway through an active attempt", () => {
  assert.match(migration, /trg_project_processing_lock_blocks_active_processing/);
  assert.match(migration, /NEW\.operation='processing-write'/);
  assert.match(migration, /job\.project_id=NEW\.project_id/);
  assert.match(migration, /Processing-write lock requires processing to be terminal/);
});

test("whole-project deletion cannot race R2 processing output", () => {
  assert.match(migration, /trg_deletion_job_blocks_active_processing/);
  assert.match(migration, /BEFORE INSERT ON engine_deletion_jobs_3d/);
  assert.match(migration, /NEW\.kind='all-projects'/);
  assert.match(migration, /Permanent deletion cannot start while processing is active/);
});
