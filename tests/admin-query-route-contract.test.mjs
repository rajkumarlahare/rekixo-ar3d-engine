import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminConfig = fs.readFileSync(
  new URL("../wrangler.admin.jsonc", import.meta.url),
  "utf8",
);
const deploymentVerifier = fs.readFileSync(
  new URL("../scripts/verify-design-admin.mjs", import.meta.url),
  "utf8",
);

test("Admin Worker route matches root URLs carrying query parameters", () => {
  assert.match(
    adminConfig,
    /"pattern": "admin\.rekixo\.com\/3Dprojects\*"/,
  );
});

test("production verification covers query and Admin deep-link refresh routes", () => {
  for (const path of [
    "/3Dprojects?project=route-smoke",
    "/3Dprojects/building?project=route-smoke",
    "/3Dprojects/geo-mapper?project=route-smoke",
    "/3Dprojects/releases?project=route-smoke",
    "/3Dprojects/advanced?project=route-smoke",
  ]) {
    assert.ok(
      deploymentVerifier.includes(path),
      `Missing production SPA navigation check for ${path}`,
    );
  }
});
