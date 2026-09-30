import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("production deploy verifies all remote Engine Admin secret names", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify remote Engine Admin secret names/);
  assert.match(workflow, /wrangler@4 secret list/);
  for (const name of [
    "ENGINE_ADMIN_EMAIL",
    "ENGINE_ADMIN_PASSWORD_SALT",
    "ENGINE_ADMIN_PASSWORD_HASH",
    "ENGINE_ADMIN_SESSION_SECRET",
  ])
    assert.match(workflow, new RegExp(name));
});

test("production deploy verifies Engine Admin auth and schema readiness", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify Engine Admin cloud readiness/);
  assert.match(workflow, /api\/cloud\/session/);
  assert.match(workflow, /payload\.configured !== true/);
  assert.match(workflow, /payload\.databaseReady !== true/);
});

test("production deploy exercises the password verification boundary", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify Engine Admin invalid-login boundary/);
  assert.match(workflow, /api\/cloud\/login/);
  assert.match(workflow, /engine-admin@rekixo\.com/);
  assert.match(workflow, /definitely-wrong-password/);
  assert.match(workflow, /STATUS" != "401"/);
});
