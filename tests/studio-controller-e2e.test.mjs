import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Studio cloud discovery and release state live in a focused hook", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const hook = read("apps/admin/src/studio/useStudioCloudState.ts");
  assert.match(studio, /useStudioCloudState/);
  assert.doesNotMatch(studio, /const \[cloudSession, setCloudSession\]/);
  assert.match(hook, /\.session\(\)/);
  assert.match(hook, /refreshCloudProjects/);
  assert.match(hook, /refreshCloudReleases/);
  assert.match(hook, /markCloudSignedOut/);
});

test("browser E2E smoke covers authoring, analysis and reload-safe autosave", () => {
  const config = read("playwright.config.ts");
  const e2e = read("e2e/studio-authoring.spec.ts");
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(config, /Desktop Chrome/);
  assert.match(e2e, /getByTestId\("analyze-project"\)/);
  assert.match(e2e, /getByTestId\("detected-floor-levels"\)/);
  assert.match(e2e, /getByTestId\("build-analyzed-draft"\)/);
  assert.match(e2e, /getByTestId\("open-visual-editor"\)/);
  assert.match(e2e, /Autosaved/);
  assert.match(e2e, /More project actions/);
  assert.match(e2e, /name: "Setup"/);
  assert.match(e2e, /name: "3D Edit"/);
  assert.match(e2e, /hard reload without pressing Save local/);
  assert.match(e2e, /page\.reload\(\)/);
  assert.match(e2e, /toBeDisabled/);
  assert.match(e2e, /Selected local project/);
  assert.match(workflow, /Run browser E2E smoke/);
  assert.match(workflow, /playwright install --with-deps chromium/);
});
