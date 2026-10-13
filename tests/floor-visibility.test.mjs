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

test("cross-storey meshes remain intact instead of being cut", () => {
  assert.match(visibility, /Keep structural\/facade objects spanning several storeys intact/);
  assert.match(visibility, /height > Math\.max\(top - bottom, 0\.1\) \* 1\.5/);
  assert.match(visibility, /record\.mesh\.material = ghostMaterialFor\(record\)/);
  assert.match(visibility, /opacity = Math\.min\(materialWithOpacity\.opacity, 0\.16\)/);
  assert.match(visibility, /record\.mesh\.material = record\.originalMaterial/);
});

test("explicit floor names and source geometry can map imported meshes to levels", () => {
  assert.match(visibility, /floorFromNodeName/);
  assert.match(visibility, /ground_floor/);
  assert.match(visibility, /floor\|level\|storey\|story\|f/);
  assert.match(visibility, /centerY >= bottom - 0\.02 && centerY <= top \+ 0\.02/);
});

test("walkthrough and disposal restore source object visibility", () => {
  assert.match(viewer, /if \(enabled && clientPresentation\) floorVisibilityController\?\.showAll\(\)/);
  assert.match(viewer, /floorVisibilityController\?\.dispose\(\)/);
});
