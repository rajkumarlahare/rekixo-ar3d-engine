import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(absolute));
    else out.push(absolute);
  }
  return out;
}

test("generic runtime has no first-project or Jyoti identity fallback", () => {
  const runtimeFiles = [
    ...walk("apps"),
    ...walk("packages"),
    ...walk("workers"),
  ].filter((file) => {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) return false;
    const normalized = file.replaceAll("\\\\", "/");
    // Project/profile bundles are positive-match, lazy-loaded modules. Tenant
    // identity may exist there; it must not exist in the generic entry/runtime.
    if (normalized.endsWith("/src/viewer/projectExperience.ts")) return false;
    if (/\/dist\/assets\/projectExperience-[^/]+\.js$/.test(normalized))
      return false;
    return true;
  });

  const violations = [];
  for (const file of runtimeFiles) {
    const source = read(file);
    if (/FIRST_PROJECT_SLUG|jyoti-paradise|Jyoti Paradise|project_jyoti|model_jyoti|scene_jyoti/i.test(source)) {
      violations.push(file);
    }
  }
  assert.deepEqual(violations, []);
});

test("admin discovers projects dynamically instead of assuming one tenant", () => {
  const worker = read("workers/admin.mjs");
  const admin = read("apps/admin/src/main.tsx");
  assert.match(worker, /async function listProjects/);
  assert.match(worker, /\/api\/projects/);
  assert.match(worker, /ORDER BY p\.created_at ASC, p\.slug ASC/);
  assert.match(admin, /fetch\(\`\$\{ADMIN_BASE_PATH\}\/api\/projects\`/);
  assert.match(admin, /items\[0\]\?\.slug/);
  assert.doesNotMatch(admin, /FIRST_PROJECT_SLUG/);
});

test("public runtime derives tenant only from the requested project path", () => {
  const app = read("apps/public/src/main.tsx");
  const core = read("packages/engine-core/src/index.ts");
  assert.match(app, /projectSlugFromPathname\(window\.location\.pathname\)/);
  assert.match(core, /validProjectSlug/);
  assert.match(core, /publicProjectPath/);
  assert.match(core, /projectAssetPrefix/);
});

test("future project creation is controlled provisioning, not a schema migration", () => {
  const workflow = read(".github/workflows/provision-project.yml");
  const renderer = read("scripts/render-project-provision-sql.mjs");
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /rekixo-3d-production/);
  assert.match(workflow, /render-project-provision-sql\.mjs/);
  assert.match(renderer, /status, created_at, updated_at/);
  assert.match(renderer, /'draft'/);
  assert.match(renderer, /ON CONFLICT\(slug\) DO NOTHING/);
  assert.doesNotMatch(renderer, /published/);
});

test("historical Jyoti migrations remain immutable compatibility history", () => {
  const migrations = fs.readdirSync("database/migrations").sort();
  assert.deepEqual(migrations.slice(0, 3), [
    "0001_core.sql",
    "0002_jyoti_production_viewer.sql",
    "0003_jyoti_supplied_content_v1.sql",
  ]);
  for (const migration of migrations.slice(3)) {
    const prefix = Number(migration.slice(0, 4));
    assert.ok(Number.isInteger(prefix) && prefix >= 4, `new migrations must be additive after 0003: ${migration}`);
  }
  assert.match(read("database/migrations/0001_core.sql"), /jyoti-paradise/);
});

test("Stage 4 does not expose privileged admin writes before auth integration", () => {
  const worker = read("workers/admin.mjs");
  assert.doesNotMatch(worker, /request\.method === "(?:POST|PUT|PATCH|DELETE)"/);
  assert.match(worker, /request\.method !== "GET"/);
});
