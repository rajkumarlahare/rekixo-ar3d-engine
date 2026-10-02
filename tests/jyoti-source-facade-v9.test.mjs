import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("V9 renders the supplied exterior model without detached facade cages", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.doesNotMatch(source, /addReferenceFacadeAccents/);
  assert.doesNotMatch(source, /Right-side return cladding/);
  assert.doesNotMatch(source, /Roof crown: dark\/wood fascia/);
  assert.match(source, /addFacadeWarmLights/);
});

test("V9 reference palette is warm and material-driven", () => {
  const profile = read("packages/model-profiles/src/referenceMaterials.ts");
  const realism = read("apps/public/src/viewer/realism.ts");
  for (const token of [
    "frontcolor: 0xdcd5cc",
    "color_m06: 0x2a3035",
    "metal_panel: 0x68483c",
    "color_a06: 0x8a5742",
    "color_j08: 0xb2beb2",
    "translucent_glass_blue: 0x829ba5",
  ]) assert.match(profile, new RegExp(token));
  assert.match(profile, /material\.emissive\.setHex\(0x24150d\)/);
  assert.match(realism, /material\.opacity = Math\.min/);
  assert.match(realism, /referenceVisual \? 0\.42 : 0\.62/);
});

test("V9 uses a lower closer reference camera and stronger dusk separation", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /mobile \? 0\.84 : 0\.96/);
  assert.match(viewer, /mobile \? 0\.98 : 1\.10/);
  assert.match(viewer, /fov: mobile \? 30 : 29/);
  assert.match(viewer, /referenceVisual \? 0\.62 : 1\.45/);
  assert.match(viewer, /referenceVisual \? 1\.78 : 2\.25/);
  assert.match(viewer, /referenceVisual \? 2\.6 : 0/);
  assert.match(viewer, /referenceVisual \? 0\.34 : 0\.65/);
});

test("V9 keeps the reference site secondary to the building", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /referenceVisual \? 1\.28 : 1\.68/);
  assert.match(source, /referenceVisual \? 1\.06 : 1\.35/);
  assert.match(source, /referenceVisual \? 1\.72 : 2\.35/);
  assert.match(source, /referenceVisual[\s\S]*\? \[\][\s\S]*: \(!mobile/);
});

test("V9 migration records the corrective strategy", () => {
  const migration = read("database/migrations/0016_jyoti_source_facade_v9.sql");
  assert.match(migration, /source-facade-v9/);
  assert.match(migration, /no-detached-synthetic-facade-cage/);
  assert.match(migration, /source-model-only-exterior/);
  assert.match(migration, /No Platform\/customer website resources are modified/);
});
