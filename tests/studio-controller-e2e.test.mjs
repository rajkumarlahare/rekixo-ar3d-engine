import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("browser E2E smoke covers Automatic Engine entry and source decision boundary", () => {
  const config = read("playwright.config.ts");
  const main = read("apps/admin/src/main.tsx");
  const e2e = read("e2e/automatic-engine-entry.spec.ts");
  const workflow = read(".github/workflows/deploy-cloudflare.yml");

  assert.match(config, /Desktop Chrome/);
  assert.match(main, /LegacyStudioRedirect/);
  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.doesNotMatch(main, /lazy\(\(\) => import\("\.\/studio\/Studio"\)\)/);
  assert.match(e2e, /legacy Studio URL enters the Automatic Engine/);
  assert.match(e2e, /Source Pack Review/);
  assert.match(e2e, /AUTOMATIC ENGINE · INPUT WORKSPACE/);
  assert.match(e2e, /One geometry authority/);
  assert.match(e2e, /Smart 3D project builder/);
  assert.match(e2e, /3D editor tools/);
  assert.match(workflow, /Run browser E2E smoke/);
  assert.match(workflow, /playwright install --with-deps chromium/);
});
