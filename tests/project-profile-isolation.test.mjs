import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("generic viewer and Studio depend on the profile registry, not a customer implementation", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const studio = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(viewer, /\.\/projectProfiles/);
  assert.doesNotMatch(viewer, /jyotiReferenceExterior|createProjectExperience|101-living/);
  assert.match(studio, /projectProfiles/);
  assert.doesNotMatch(studio, /jyotiReferenceExterior/);
});

test("project-specific reconstructed interiors are profile-gated", () => {
  const registry = read("apps/public/src/viewer/projectProfiles.ts");
  assert.match(registry, /if \(!exterior\) return undefined/);
  assert.match(registry, /createProfileExperience/);
  assert.match(registry, /profile\?\.id !== "reference-source-v9"/);
});

test("premium shell reads floors and units from project scene data", () => {
  const app = read("apps/public/src/main.tsx");
  assert.doesNotMatch(app, /\[0,1,2,3,4,5\]/);
  assert.doesNotMatch(app, /Flats 101 \/ 102 \/ 103/);
  assert.doesNotMatch(app, /101 to 501|102 to 502|103 to 403/);
  assert.match(app, /settings\.floors/);
  assert.match(app, /floorSettings\.units/);
});
