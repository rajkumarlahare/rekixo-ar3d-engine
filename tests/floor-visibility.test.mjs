import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewer = await readFile(new URL("../apps/public/src/viewer/Viewer3D.tsx", import.meta.url), "utf8");
const visibility = await readFile(new URL("../apps/public/src/viewer/floorVisibility.ts", import.meta.url), "utf8");

test("customer floor isolation uses original mesh visibility and not vertical clipping planes", () => {
  assert.match(viewer, /createFloorVisibilityController\(object\)/);
  assert.match(viewer, /clientPresentation && floorVisibilityController/);
  assert.match(viewer, /floorVisibilityController\.showFloor\(level\)/);
  assert.match(viewer, /floorVisibilityController\.showAll\(\)/);
  assert.match(visibility, /record\.mesh\.visible\s*=/);
  assert.doesNotMatch(visibility, /new THREE\.Plane/);
});

test("cross-storey meshes are ghosted while a floor is isolated and restored on All", () => {
  assert.match(visibility, /selectedHeight/);
  assert.match(visibility, /ghostMaterialFor\(record\)/);
  assert.match(visibility, /opacity = Math\.min\(materialWithOpacity\.opacity, 0\.16\)/);
  assert.match(visibility, /record\.mesh\.material = record\.originalMaterial/);
  assert.match(visibility, /height > selectedHeight \* 1\.5/);
});

test("explicit floor names and source bounds are used for mesh assignment", () => {
  assert.match(visibility, /floorFromNodeName/);
  assert.match(visibility, /ground_floor/);
  assert.match(visibility, /centerY >= bottom - 0\.02 && centerY <= top \+ 0\.02/);
  assert.match(visibility, /record\.floor === level\.floor/);
});

test("walkthrough and disposal restore source object visibility and materials", () => {
  assert.match(viewer, /if \(enabled && clientPresentation\) floorVisibilityController\?\.showAll\(\)/);
  assert.match(viewer, /floorVisibilityController\?\.dispose\(\)/);
  assert.match(visibility, /material\.dispose\(\)/);
});
