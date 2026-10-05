import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Jyoti Paradise is locked before bulk project storage or database deletion", () => {
  const worker = read("workers/project-deletion.mjs");

  assert.match(worker, /LOCKED_PRODUCTION_PROJECT_SLUGS/);
  assert.match(worker, /"jyoti-paradise"/);
  assert.match(worker, /Permanent bulk deletion is blocked/);
  assert.match(worker, /status: 423/);

  const runStart = worker.indexOf("async function runDeletionJob");
  const nextFunction = worker.indexOf("async function startDeletionJob", runStart);
  const block = worker.slice(runStart, nextFunction);
  const guardIndex = block.indexOf("lockedProductionProjects(projects)");
  const r2DeleteIndex = block.indexOf("deleteProjectOwnedObjects");
  const dbDeleteIndex = block.indexOf("deleteProjectRecords");

  assert.ok(guardIndex >= 0, "runDeletionJob must guard locked projects");
  assert.ok(
    guardIndex < r2DeleteIndex && guardIndex < dbDeleteIndex,
    "locked-project guard must run before destructive cleanup",
  );

  assert.match(
    worker,
    /async function deleteProjectOwnedObjects\(env, slug, onDeleted\) \{\s*assertProjectDeletionAllowed\(slug\);/,
  );
  assert.match(
    worker,
    /async function deleteProjectRecords\(env, project\) \{\s*assertProjectDeletionAllowed\(project\.slug\);/,
  );
});

test("manual R2 purge refuses any prefix overlapping Jyoti Paradise", () => {
  const purge = read("scripts/purge-project-r2-prefix.mjs");

  assert.match(purge, /LOCKED_PRODUCTION_PREFIXES/);
  assert.match(purge, /projects\/jyoti-paradise\//);
  assert.match(purge, /locked\.startsWith\(candidate\) \|\| candidate\.startsWith\(locked\)/);
  assert.match(purge, /Refusing R2 purge because prefix overlaps locked production data/);
});

test("database rejects direct Jyoti Paradise project deletion", () => {
  const migration = read(
    "database/migrations/0029_protect_jyoti_paradise_delete.sql",
  );

  assert.match(
    migration,
    /CREATE TRIGGER IF NOT EXISTS trg_projects_3d_protect_jyoti_paradise_delete/,
  );
  assert.match(migration, /BEFORE DELETE ON projects_3d/);
  assert.match(migration, /WHEN OLD\.slug = 'jyoti-paradise'/);
  assert.match(migration, /Jyoti Paradise is a locked production project and cannot be deleted/);
});
