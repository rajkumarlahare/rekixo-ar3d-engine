import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "database/migrations/0032_source_pack_v2_delete_guards.sql",
  "utf8",
);

test("verified source originals cannot be deleted outside resumable hard delete", () => {
  assert.match(migration, /trg_source_files_3d_verified_delete_block/);
  assert.match(migration, /OLD\.upload_state='verified'/);
  assert.match(migration, /Verified source file is immutable outside project hard delete/);
});

test("ready and superseded source packs cannot be deleted outside resumable hard delete", () => {
  assert.match(migration, /trg_source_packs_3d_sealed_delete_block/);
  assert.match(migration, /OLD\.status IN \('ready','superseded'\)/);
  assert.match(migration, /Sealed source pack is immutable outside project hard delete/);
});

test("delete exception is tied to the exact active all-project deletion snapshot", () => {
  assert.match(migration, /engine_deletion_jobs_3d job/);
  assert.match(migration, /job\.kind='all-projects'/);
  assert.match(
    migration,
    /job\.status IN \('running','cleanup_pending','db_cleanup_pending'\)/,
  );
  assert.match(migration, /json_each\(job\.projects_json\)/);
  assert.match(
    migration,
    /json_extract\(snapshot_project\.value, '\$\.id'\)=OLD\.project_id/,
  );
  assert.doesNotMatch(migration, /jyoti-paradise/i);
});