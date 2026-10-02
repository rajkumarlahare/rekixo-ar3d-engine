import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("public model URL carries the database model version", () => {
  const worker = read("workers/public.mjs");
  assert.match(worker, /content\?v=\$\{encodeURIComponent\(String\(model\.version \|\| 1\)\)\}/);
});

test("Jyoti PBR v2 publishes a versioned immutable asset", () => {
  const migration = read("database/migrations/0009_jyoti_pbr_model_v2.sql");
  assert.match(migration, /exterior-v2\.glb/);
  assert.match(migration, /version = 2/);
  assert.match(migration, /4033620/);
  assert.match(migration, /46cde07ba8a59e04e198c778189f24eff89f05eb73e823369fcc7594cbf05bf2/);
});

test("production smoke is valid with an empty project registry", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify empty-safe Engine production shell/);
  assert.match(workflow, /no-project-selected/);
  assert.match(workflow, /PUBLIC_CODE" = "404"/);
  assert.doesNotMatch(workflow, /jyoti-live-model\.glb/);
});
