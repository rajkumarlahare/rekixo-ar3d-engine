import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("canonical Building and optional Geo routes stay under /3Dprojects", () => {
  const contracts = read("packages/contracts/src/index.ts");
  const core = read("packages/engine-core/src/index.ts");
  const publicApp = read("apps/public/src/main.tsx");

  assert.match(contracts, /PUBLIC_BASE_PATH = "\/3Dprojects"/);
  assert.match(core, /function buildingPublicProjectPath\(slug: string\)/);
  assert.match(
    core,
    /return `\$\{PUBLIC_PROJECT_ORIGIN\}\$\{PUBLIC_BASE_PATH\}\/\$\{encodeURIComponent\(normalized\)\}`/,
  );
  assert.match(core, /PUBLIC_PROJECT_ORIGIN = "https:\/\/ar3dstudio\.in"/);
  assert.match(
    core,
    /function publicProjectPath\(slug: string\)[\s\S]*return buildingPublicProjectPath\(slug\)/,
  );
  assert.match(core, /function geoPublicProjectPath\(slug: string\)/);
  assert.match(
    core,
    /return `\$\{buildingPublicProjectPath\(slug\)\}\/geo`/,
  );

  // Existing public Building and nested Geo entry points remain compatible.
  assert.match(publicApp, /projectSlugFromPathname\(window\.location\.pathname\)/);
  assert.match(publicApp, /const geoRoute = [^\n]*3Dprojects[^\n]*geo/);
});

test("Experience identity is Building-first and Geo remains optional", () => {
  const contracts = read("packages/contracts/src/index.ts");
  const architecture = read("docs/EXPERIENCE-ARCHITECTURE.md");

  assert.match(contracts, /Experience3DType = "building" \| "geo"/);
  assert.match(architecture, /Building Experience is always the primary\/default deliverable/);
  assert.match(architecture, /A Building project is complete without Geo/);
  assert.match(architecture, /Geo is created only when the customer orders the add-on/);
  assert.match(architecture, /must not[\s\S]*clone the Building project or authoring draft/);
});

test("Phase 1 preserves the existing immutable Building release system", () => {
  const migration = read("database/migrations/0021_immutable_release_v1.sql");
  const publish = read("workers/release-publish.mjs");
  const architecture = read("ARCHITECTURE.md");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS releases_3d/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS release_assets_3d/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS release_activations_3d/);
  assert.match(migration, /ALTER TABLE projects_3d ADD COLUMN active_release_id/);
  assert.match(publish, /UPDATE projects_3d[\s\S]*active_release_id=/);
  assert.match(
    architecture,
    /The existing `releases_3d`, `release_assets_3d`,[\s\S]*remain the[\s\S]*Building release system/,
  );
});

test("Engine Experience work cannot bind to stable Platform production resources", () => {
  const configs = [
    "wrangler.admin.jsonc",
    "wrangler.public.jsonc",
    "wrangler.infra.jsonc",
    "cloudflare/resources.json",
    ".github/workflows/deploy-cloudflare.yml",
  ].map(read);

  for (const source of configs) {
    assert.doesNotMatch(source, /tiyansh-production/);
    assert.doesNotMatch(source, /tiyansh-gallery-production/);
  }

  const resources = read("cloudflare/resources.json");
  assert.match(resources, /"database_name": "rekixo-3d-production"/);
  assert.match(resources, /"bucket_name": "rekixo-3d-assets"/);
  assert.match(resources, /"admin": "rekixo-3d-admin"/);
  assert.match(resources, /"public": "rekixo-3d-public"/);

  const architecture = read("ARCHITECTURE.md");
  assert.match(architecture, /Platform no-touch rule/);
  assert.match(
    architecture,
    /No phase of[\s\S]*Experience architecture may require a Platform code change/,
  );
});

test("Phase plan is additive and delays database changes until Phase 2", () => {
  const plan = read("docs/EXPERIENCE-ARCHITECTURE.md");
  assert.match(plan, /Phase 1 — architecture guardrails/);
  assert.match(plan, /No database migration or production behavior change was made in Phase 1/);
  assert.match(plan, /Phase 2 — additive Experience data model/);
  assert.match(plan, /without rewriting any existing Building release/);
  assert.match(plan, /No destructive migration or rewrite of applied migration history/);
  assert.match(plan, /No automatic Geo source upgrade when Building publishes a new release/);
});
