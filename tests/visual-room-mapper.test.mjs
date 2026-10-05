import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("room drawing happens on the selected floor and derives geometry from a drag", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /roomPlanePoint/);
  assert.match(canvas, /new T\.Plane\(new T\.Vector3\(0, 1, 0\), -floor\.elevation\)/);
  assert.match(canvas, /Math\.abs\(end\.x - start\.x\)/);
  assert.match(canvas, /Math\.abs\(end\.z - start\.z\)/);
  assert.match(canvas, /onRoomDraw/);
  assert.match(canvas, /resolvePlanSnap/);
  assert.match(canvas, /edgeTolerance: 0\.18/);
});

test("automatic room draft foundations preserve evidence discipline", () => {
  const autoBuild = read("apps/admin/src/studio/autoBuildPipeline.ts");
  const autoRooms = read("apps/admin/src/studio/autoRoomDraft.ts");

  assert.match(autoBuild, /buildSmartSceneDraft/);
  assert.match(autoBuild, /applyReadyOpeningWorkflow/);
  assert.match(autoRooms, /verified: false/);
});

test("polygon room geometry keeps snap and callback foundations", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /roomBoundaryPoints/);
  assert.match(canvas, /resolvePlanSnap/);
  assert.match(canvas, /midpointTolerance: 0\.18/);
  assert.match(canvas, /onRoomPolygonDraw/);
  assert.match(canvas, /onRoomPolygonChange/);
  assert.match(canvas, /roomVertexIndex/);
  assert.match(canvas, /click first corner or press Enter/);
});
