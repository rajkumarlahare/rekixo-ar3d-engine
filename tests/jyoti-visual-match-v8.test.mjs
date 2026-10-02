import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("V8 history remains additive and reference calibration stays isolated", () => {
  const migration = read("database/migrations/0015_jyoti_visual_match_v8.sql");
  const realism = read("packages/model-profiles/src/referenceMaterials.ts");
  assert.match(migration, /visual-match-v8/);
  assert.match(migration, /zoomed visual comparison/i);
  assert.match(realism, /referenceVisual = false/);
  assert.match(realism, /referenceFacadeTint/);
  assert.match(realism, /sourceMaterialTint/);
});

test("V9 supersedes the V8 detached facade cage with source-model rendering", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.doesNotMatch(source, /addReferenceFacadeAccents/);
  assert.doesNotMatch(source, /Vertical privacy fins/);
  assert.doesNotMatch(source, /Right-side return cladding/);
  assert.match(source, /addFacadeWarmLights/);
  assert.match(source, /addBrickFacing/);
});

test("reference site remains compact instead of dominating the building", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /referenceVisual \? 1\.28 : 1\.68/);
  assert.match(source, /referenceVisual \? 1\.16 : 1\.48/);
  assert.match(source, /referenceVisual \? 1\.72 : 2\.35/);
  assert.match(source, /referenceVisual \? 0\.30 : 0\.42/);
  assert.match(source, /const treeLayout[\s\S]*referenceVisual[\s\S]*\? \[\]/);
});

test("reference mode keeps mobile quality without invented facade geometry", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const profiles = read("apps/public/src/viewer/projectProfiles.ts");
  assert.match(viewer, /antialias: referenceVisual \|\| !mobile/);
  assert.match(viewer, /renderer\.shadowMap\.enabled = referenceVisual \|\| !mobile/);
  assert.match(viewer, /loadProfileExperience/);
  assert.match(profiles, /await import\("\.\/projectExperience"\)/);
  assert.match(
    profiles,
    /createJyotiProjectExperience\([\s\S]*bounds,[\s\S]*context\.mobile,[\s\S]*context\.referenceVisual,[\s\S]*context\.preserveSourceSite/,
  );
});
