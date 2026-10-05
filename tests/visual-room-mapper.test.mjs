import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("read-only presentation renders room geometry without manual room-drawing callbacks", () => {
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");

  assert.match(presentation, /roomBoundaryPoints/);
  assert.match(presentation, /presentationRoomSurface/);
  assert.doesNotMatch(presentation, /onRoomDraw/);
  assert.doesNotMatch(presentation, /onRoomPolygonDraw/);
  assert.doesNotMatch(presentation, /resolvePlanSnap/);
});

test("automatic room draft foundations preserve evidence discipline", () => {
  const autoBuild = read("apps/admin/src/studio/autoBuildPipeline.ts");
  const autoRooms = read("apps/admin/src/studio/autoRoomDraft.ts");

  assert.match(autoBuild, /buildSmartSceneDraft/);
  assert.match(autoBuild, /applyReadyOpeningWorkflow/);
  assert.match(autoRooms, /verified: false/);
});

test("shared plan snap kernel remains standalone from the presentation runtime", () => {
  const snap = read("packages/engine-core/src/editor/snap.ts");
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");

  assert.match(snap, /resolvePlanSnap/);
  assert.match(snap, /midpointTolerance/);
  assert.match(snap, /edgeTolerance/);
  assert.doesNotMatch(presentation, /resolvePlanSnap/);
});
