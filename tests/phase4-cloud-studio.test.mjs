import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const cloudWorker = await import(
  new URL("../workers/admin-cloud.mjs", import.meta.url)
);
const {
  authConfigured,
  cloudAssetKey,
  validateCloudDraft,
} = cloudWorker;

test("Engine Cloud Admin is fail-closed without dedicated secrets", () => {
  assert.equal(authConfigured({}), false);
  assert.equal(
    authConfigured({
      ENGINE_ADMIN_EMAIL: "owner@example.com",
      ENGINE_ADMIN_PASSWORD_SALT: "salt",
      ENGINE_ADMIN_PASSWORD_HASH: "hash",
      ENGINE_ADMIN_SESSION_SECRET: "short",
    }),
    false,
  );
  assert.equal(
    authConfigured({
      ENGINE_ADMIN_EMAIL: "owner@example.com",
      ENGINE_ADMIN_PASSWORD_SALT: "salt",
      ENGINE_ADMIN_PASSWORD_HASH: "hash",
      ENGINE_ADMIN_SESSION_SECRET: "x".repeat(48),
    }),
    true,
  );
});

test("cloud R2 keys are project-scoped and never filename-controlled", () => {
  assert.equal(
    cloudAssetKey("garden-heights", "asset_12345678"),
    "projects/garden-heights/draft-assets/asset_12345678",
  );
  assert.throws(() => cloudAssetKey("../escape", "asset_12345678"));
  assert.throws(() => cloudAssetKey("garden-heights", "../asset"));
});

test("cloud draft identity and asset ownership shape are strict", () => {
  const project = { id: "project_12345678", slug: "garden-heights" };
  const draft = {
    schema: 1,
    id: project.id,
    slug: project.slug,
    name: "Garden Heights",
    assets: ["asset_12345678"],
    scene: { modelId: "asset_12345678" },
  };
  assert.deepEqual(validateCloudDraft(draft, project), ["asset_12345678"]);

  assert.throws(
    () => validateCloudDraft({ ...draft, slug: "other-project" }, project),
    /identity mismatch/,
  );
  assert.throws(
    () =>
      validateCloudDraft(
        { ...draft, assets: [], scene: { modelId: "asset_12345678" } },
        project,
      ),
    /model asset is missing/,
  );
  assert.throws(
    () =>
      validateCloudDraft(
        { ...draft, assets: ["asset_12345678", "asset_12345678"] },
        project,
      ),
    /invalid asset IDs/,
  );
});

test("Phase 4 migration keeps draft, asset, auth and audit state Engine-owned", () => {
  const migration = fs.readFileSync(
    "database/migrations/0020_engine_studio_cloud_v1.sql",
    "utf8",
  );
  for (const table of [
    "studio_drafts_3d",
    "studio_assets_3d",
    "engine_admin_security",
    "engine_admin_audit",
    "engine_admin_login_attempts",
  ])
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /FOREIGN KEY \(project_id\) REFERENCES projects_3d/);
  assert.match(migration, /CHECK \(kind IN \('model','reference','source','texture','other'\)\)/);
});

test("Studio treats IndexedDB as cache and exposes authenticated cloud sync", () => {
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  const storage = fs.readFileSync("apps/admin/src/studio/storage.ts", "utf8");
  const client = fs.readFileSync("apps/admin/src/studio/cloud.ts", "utf8");
  const worker = fs.readFileSync("workers/admin-cloud.mjs", "utf8");

  assert.match(studio, /Save to cloud/);
  assert.match(studio, /openCloudProject/);
  assert.match(studio, /Archive cloud project/);
  assert.match(worker, /Cloud draft changed elsewhere/);
  assert.match(client, /downloadProject/);
  assert.match(client, /checksum mismatch/i);
  assert.match(storage, /indexedDB\.open\("rekixo-engine-studio"/);
  assert.match(storage, /removeAssetIfUnreferenced/);
});

test("admin-infra deployment applies Engine D1/R2 without deploying Public Worker", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/deploy-cloudflare.yml",
    "utf8",
  );
  assert.match(workflow, /- admin-infra/);
  assert.match(
    workflow,
    /Apply isolated D1 migrations[\s\S]*deployment_scope != 'admin-only'/,
  );
  assert.match(
    workflow,
    /Deploy isolated 3D Public Worker[\s\S]*deployment_scope == 'engine-all'/,
  );
});

test("Platform credentials and cookies are not reused by Engine cloud auth", () => {
  const worker = fs.readFileSync("workers/admin-cloud.mjs", "utf8");
  assert.match(worker, /ENGINE_ADMIN_EMAIL/);
  assert.match(worker, /ENGINE_ADMIN_PASSWORD_SALT/);
  assert.match(worker, /ENGINE_ADMIN_PASSWORD_HASH/);
  assert.match(worker, /ENGINE_ADMIN_SESSION_SECRET/);
  assert.doesNotMatch(worker, /tiyansh_admin/);
  assert.doesNotMatch(worker, /\bADMIN_EMAIL\b/);
  assert.doesNotMatch(worker, /\bSESSION_SECRET\b/);
});
