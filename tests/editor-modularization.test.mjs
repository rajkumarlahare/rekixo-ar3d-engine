import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("retained presentation shells delegate focused responsibilities to modules", () => {
  const canvas = read("apps/admin/src/studio/PresentationCanvas.tsx");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(canvas, /from "\.\/sceneCanvasModel"/);
  assert.match(canvas, /from "\.\/threeResources"/);
  assert.match(canvas, /from "@rekixo\/3d-model-profiles"/);
  assert.doesNotMatch(canvas, /public\/src\/viewer\/modelProfiles/);
  assert.doesNotMatch(canvas, /^function summarizeModelMaterials/m);

  assert.match(viewer, /WalkGraphPanel/);
  assert.match(viewer, /from "\.\/viewerCamera"/);
  assert.match(viewer, /from "\.\/viewerPreview"/);
  assert.match(viewer, /from "\.\/viewerResources"/);
  assert.doesNotMatch(viewer, /^function createPreviewBuilding/m);
  assert.doesNotMatch(viewer, /^function fitCamera/m);
});
