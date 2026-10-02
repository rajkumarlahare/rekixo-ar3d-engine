import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("production deploy is valid when Engine has zero projects", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Verify empty-safe Engine production shell/);
  assert.match(workflow, /no-project-selected/);
  assert.match(workflow, /PUBLIC_CODE" = "404"/);
  assert.match(workflow, /without requiring any project fixture/);
  assert.doesNotMatch(workflow, /Verify legacy Jyoti public production fixture/);
  assert.doesNotMatch(workflow, /Verify Jyoti admin shell/);
  assert.doesNotMatch(workflow, /Verify Platform integration contract/);
});

test("Geo derivative deployment registry starts empty after legacy cleanup", () => {
  const registry = JSON.parse(read("project-profiles/geo-model-derivatives.json"));
  assert.equal(registry.format, "rekixo-geo-model-derivative-registry");
  assert.equal(registry.version, 1);
  assert.deepEqual(registry.projects, []);
});
