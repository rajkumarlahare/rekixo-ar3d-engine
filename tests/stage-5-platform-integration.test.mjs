import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("Engine exposes a versioned minimal Platform integration contract", () => {
  const contracts = read("packages/contracts/src/index.ts");
  const worker = read("workers/admin.mjs");
  assert.match(contracts, /PLATFORM_ENGINE_CONTRACT_VERSION = 1/);
  assert.match(contracts, /PlatformEngineProjectContract/);
  assert.match(worker, /PLATFORM_ENGINE_CONTRACT_VERSION = 1/);
  assert.match(worker, /\/api\/integration\/projects\//);
  assert.match(worker, /x-rekixo-ar3d-contract/);
});

test("integration endpoint is read-only and project-scoped", () => {
  const worker = read("workers/admin.mjs");
  assert.match(worker, /async function getIntegrationProject\(env, slug\)/);
  assert.match(worker, /WHERE p\.slug = \?/);
  assert.match(worker, /request\.method !== "GET"/);
  assert.doesNotMatch(worker, /api\/integration[\s\S]{0,1500}(?:INSERT|UPDATE|DELETE)\s/i);
});

test("Engine remains isolated from Platform storage and tables", () => {
  const worker = read("workers/admin.mjs");
  const adminConfig = read("wrangler.admin.jsonc");
  assert.doesNotMatch(worker, /tiyansh-production|tiyansh-gallery-production|project_3d_links/);
  assert.doesNotMatch(adminConfig, /tiyansh-production|tiyansh-gallery-production/);
  assert.match(adminConfig, /rekixo-3d-production/);
  assert.match(adminConfig, /rekixo-3d-assets/);
});

test("Stage 5 does not enable privileged Engine write APIs", () => {
  const worker = read("workers/admin.mjs");
  assert.doesNotMatch(worker, /request\.method === "(?:POST|PUT|PATCH|DELETE)"/);
});


test("integration lookup survives temporary model storage probe failures", () => {
  const worker = read("workers/admin.mjs");
  assert.match(worker, /Platform project linking must still resolve the Engine project/);
  assert.match(worker, /activeModelAvailable = false/);
});
