import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("large editor shells delegate focused responsibilities to modules", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(studio, /ModelNodeInspector/);
  assert.match(studio, /RoomNavigationPanel/);
  assert.doesNotMatch(studio, /className="room-door-connectivity"/);

  assert.match(canvas, /from "\.\/sceneCanvasModel"/);
  assert.match(canvas, /from "\.\/sceneCanvasRooms"/);
  assert.match(canvas, /from "\.\/threeResources"/);
  assert.match(canvas, /from "@rekixo\/3d-model-profiles"/);
  assert.doesNotMatch(canvas, /public\/src\/viewer\/modelProfiles/);
  assert.doesNotMatch(canvas, /^function summarizeModelMaterials/m);
  assert.doesNotMatch(canvas, /^function roomSurface/m);

  assert.match(viewer, /WalkGraphPanel/);
  assert.match(viewer, /from "\.\/viewerCamera"/);
  assert.match(viewer, /from "\.\/viewerPreview"/);
  assert.match(viewer, /from "\.\/viewerResources"/);
  assert.doesNotMatch(viewer, /^function createPreviewBuilding/m);
  assert.doesNotMatch(viewer, /^function fitCamera/m);
});

test("generic Studio shell contains no project-specific local model loader", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  assert.doesNotMatch(studio, /jyoti-source-preserved\.glb/i);
  assert.doesNotMatch(studio, /Load local Jyoti model/i);
});
