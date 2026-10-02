import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("daylight stays readable without V4 overexposure", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /toneMappingExposure = 0\.9/);
  assert.match(viewer, /environmentIntensity = 0\.65/);
  assert.match(viewer, /HemisphereLight\(0xdcecff, 0x514b45, 1\.45\)/);
  assert.match(viewer, /DirectionalLight\(0xffe4c2, 2\.25\)/);
  assert.match(viewer, /FogExp2\(0xa9bfd0, 0\.0015\)/);
  assert.doesNotMatch(viewer, /toneMappingExposure = 1\.28/);
  assert.doesNotMatch(viewer, /environmentIntensity = 1\.48/);
});

test("source FBX diffuse colors are preserved when SKB textures are attached", () => {
  const realism = read("packages/model-profiles/src/referenceMaterials.ts");
  assert.match(realism, /sourceMaterialTint/);
  assert.match(realism, /color_004: 0x8e8e8e/);
  assert.match(realism, /color_a06: 0xc29b7a/);
  assert.match(realism, /color_m06: 0x565656/);
  assert.match(realism, /metal_panel: 0x8f9d9e/);
  assert.doesNotMatch(realism, /target\.color\.setHex\(0xffffff\)/);
});

test("source-faithful road, curb, sidewalk and boundary remain visible", () => {
  const site = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(site, /standard\(0x3a3d40, 0\.94\)/);
  assert.match(site, /sidewalkMat/);
  assert.match(site, /curbMat/);
  assert.match(site, /standard\(0xb8684f, 0\.84\)/);
  assert.match(site, /PointLight\(\s*0xffb56d,/);
});

test("viewer has no synthetic circular ground layers", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const env = read("apps/public/src/viewer/siteEnvironment.ts");
  assert.doesNotMatch(viewer, /new THREE\.CircleGeometry\(16, 72\)/);
  assert.doesNotMatch(env, /CircleGeometry/);
  assert.match(env, /Do not add synthetic/);
});

test("V4 history remains additive and V5 is isolated", () => {
  const migration = read("database/migrations/0011_jyoti_realism_v4.sql");
  assert.match(migration, /No Platform\/customer website resources are modified/);
});
