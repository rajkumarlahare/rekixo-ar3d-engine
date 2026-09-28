import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("generic viewer and Studio depend on the profile registry, not a customer implementation", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const studio = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(viewer, /\.\/projectProfiles/);
  assert.doesNotMatch(viewer, /jyotiReferenceExterior|createProjectExperience|101-living/);
  assert.match(studio, /modelProfiles/);
  assert.doesNotMatch(studio, /jyotiReferenceExterior/);
});

test("project-specific reconstructed interiors are profile-gated", () => {
  const exteriorRegistry = read("apps/public/src/viewer/modelProfiles.ts");
  const experienceRegistry = read("apps/public/src/viewer/projectProfiles.ts");
  assert.match(exteriorRegistry, /if \(!exterior\) return undefined/);
  assert.match(experienceRegistry, /createProfileExperience/);
  assert.match(experienceRegistry, /profile\?\.id !== "reference-source-v9"/);
});

test("premium shell reads floors and units from project scene data", () => {
  const app = read("apps/public/src/main.tsx");
  assert.doesNotMatch(app, /\[0,1,2,3,4,5\]/);
  assert.doesNotMatch(app, /Flats 101 \/ 102 \/ 103/);
  assert.doesNotMatch(app, /101 to 501|102 to 502|103 to 403/);
  assert.match(app, /settings\.floors/);
  assert.match(app, /floorSettings\.units/);
});


test("generic realism cannot inherit Reference Source V9 customer textures or tints", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const generic = read("apps/public/src/viewer/realism.ts");
  const profile = read("apps/public/src/viewer/referenceSourceV9Materials.ts");
  const registry = read("apps/public/src/viewer/modelProfiles.ts");

  assert.match(viewer, /enhanceModelProfileMaterials/);
  assert.doesNotMatch(generic, /sourceTextureData|sourceMaterialTint|referenceFacadeTint/);
  assert.doesNotMatch(generic, /color_a06|color_m06|metal_panel:\s*0x|frontcolor:\s*0x/);
  assert.match(profile, /JYOTI_SOURCE_MODEL_SHA256/);
  assert.match(profile, /if \(!hasReferenceSource\(root\)\) return false/);
  assert.match(profile, /sourceTextureData/);
  assert.match(profile, /sourceMaterialTint/);
  assert.match(profile, /referenceFacadeTint/);
  assert.match(registry, /enhanceReferenceSourceV9Model/);
});
