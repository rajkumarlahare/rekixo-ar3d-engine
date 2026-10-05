import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "database/migrations/0031_source_pack_v2_foundation.sql",
  "utf8",
);

function tableSql(name, nextName) {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = nextName
    ? migration.indexOf(`CREATE TABLE IF NOT EXISTS ${nextName}`, start + 1)
    : migration.length;
  assert.ok(end > start, `${name} table boundary must be readable`);
  return migration.slice(start, end);
}

test("source-pack detail rows have one project deletion cascade path", () => {
  const mappings = tableSql("source_pack_files_3d", "source_upload_sessions_3d");
  assert.match(
    mappings,
    /FOREIGN KEY \(source_pack_id\) REFERENCES source_packs_3d\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    mappings,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE NO ACTION/,
  );
  assert.doesNotMatch(
    mappings,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/,
  );
});

test("multipart session rows cascade through source file, not twice from project", () => {
  const sessions = tableSql("source_upload_sessions_3d", "source_upload_parts_3d");
  assert.match(
    sessions,
    /FOREIGN KEY \(source_file_id\) REFERENCES source_files_3d\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    sessions,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE NO ACTION/,
  );
  assert.doesNotMatch(
    sessions,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/,
  );
});

test("only root source entities cascade directly from projects", () => {
  const sourceFiles = tableSql("source_files_3d", "source_packs_3d");
  const sourcePacks = tableSql("source_packs_3d", "source_pack_files_3d");
  assert.match(
    sourceFiles,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/,
  );
  assert.match(
    sourcePacks,
    /FOREIGN KEY \(project_id\) REFERENCES projects_3d\(id\) ON DELETE CASCADE/,
  );
});