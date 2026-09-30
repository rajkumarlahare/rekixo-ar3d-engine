import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Admin Worker declares all Engine Admin secrets as required", () => {
  const config = read("wrangler.admin.jsonc");
  for (const name of [
    "ENGINE_ADMIN_EMAIL",
    "ENGINE_ADMIN_PASSWORD_SALT",
    "ENGINE_ADMIN_PASSWORD_HASH",
    "ENGINE_ADMIN_SESSION_SECRET",
  ])
    assert.match(config, new RegExp(name));
  assert.match(config, /"secrets"\s*:\s*\{/);
  assert.match(config, /"required"\s*:/);
});

test("production deploy verifies Engine Admin auth and schema readiness", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify Engine Admin cloud readiness/);
  assert.match(workflow, /api\/cloud\/session/);
  assert.match(workflow, /payload\.configured !== true/);
  assert.match(workflow, /payload\.databaseReady !== true/);
});
