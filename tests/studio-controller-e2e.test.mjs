import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Studio cloud discovery and release state live in a focused hook", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const hook = read("apps/admin/src/studio/useStudioCloudState.ts");
  assert.match(studio, /useStudioCloudState/);
  assert.doesNotMatch(studio, /const \[cloudSession, setCloudSession\]/);
  assert.match(hook, /cloud\.session\(\)/);
  assert.match(hook, /refreshCloudProjects/);
  assert.match(hook, /refreshCloudReleases/);
  assert.match(hook, /markCloudSignedOut/);
});

test("browser E2E smoke covers authoring, analysis, persistence and unsaved guard", () => {
  const config = read("playwright.config.ts");
  const e2e = read("e2e/studio-authoring.spec.ts");
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(config, /Desktop Chrome/);
  assert.match(e2e, /Analyze project/);
  assert.match(e2e, /Build smart draft/);
  assert.match(e2e, /Saved in the local offline cache/);
  assert.match(e2e, /page\.reload\(\)/);
  assert.match(e2e, /Save your changes before creating a project/);
  assert.match(workflow, /Run browser E2E smoke/);
  assert.match(workflow, /playwright install --with-deps chromium/);
});
