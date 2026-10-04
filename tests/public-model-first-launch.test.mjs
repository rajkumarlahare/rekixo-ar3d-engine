import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("demo launch keeps the published source model as public visual authority", () => {
  const profiles = read("apps/public/src/viewer/projectProfiles.ts");

  assert.match(profiles, /Demo Launch Phase 1 rule/);
  assert.match(profiles, /createSemanticStudioExperience/);
  assert.match(profiles, /replaceSourceModelInInterior\s*=\s*false/);
  assert.match(profiles, /return semantic;/);
  assert.doesNotMatch(profiles, /jyoti-paradise|Jyoti Paradise/i);
});

test("demo launch plan locks model-first scope and defers non-launch engine work", () => {
  const plan = read("docs/DEMO-LAUNCH-PLAN.md");

  assert.match(plan, /Phase 1 — Model First/);
  assert.match(plan, /FBX \/ published GLB.*primary visual building geometry/);
  assert.match(plan, /SKP \/ SKB.*material and texture recovery/);
  assert.match(plan, /DWG \/ PDF \/ brochure data.*verified floor, flat, room, dimension/);
  assert.match(plan, /rekixo-ar3d-platform.*is not modified/);
  assert.match(plan, /Deferred until after the demo/);
  assert.match(plan, /CAD-only full building generation/);
  assert.match(plan, /SketchUp-like authoring features/);
});
