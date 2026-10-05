import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const studioPath = (name) => path.join("apps/admin/src/studio", name);

test("published viewer uses the read-only presentation canvas", () => {
  const viewer = read("apps/admin/src/studio/PublishedViewer.tsx");

  assert.match(viewer, /from "\.\/PresentationCanvas"/);
  assert.match(viewer, /<PresentationCanvas/);
  assert.match(viewer, /onWalkRoomChange=\{\(nextRoomId\) => setRoomId\(nextRoomId\)\}/);
  assert.doesNotMatch(viewer, /from "\.\/SceneCanvas"/);
});

test("presentation canvas keeps published rendering and walking foundations", () => {
  const canvas = read("apps/admin/src/studio/PresentationCanvas.tsx");

  for (const token of [
    "OrbitControls",
    "GLTFLoader",
    "FBXLoader",
    "MeshoptDecoder",
    "applyModelProfileExterior",
    "applySceneCanvasAppearance",
    "applyModelMaterialOverrides",
    "addFurnitureVisual",
    "addSiteElementVisual",
    "reviewedDoorConnections",
    "resolveReviewedDoorWalkStep",
    "roomBoundaryPoints",
  ]) assert.ok(canvas.includes(token), `PresentationCanvas lost ${token}`);
});

test("presentation canvas cannot regain authoring dependencies", () => {
  const canvas = read("apps/admin/src/studio/PresentationCanvas.tsx");

  for (const forbidden of [
    "TransformControls",
    "sceneCanvasArchitectureController",
    "sceneCanvasEditorUx",
    "sceneCanvasDirectManipulation",
    "canvasFurniturePlacement",
    "sceneCanvasPlanResizeHandles",
    "SceneCanvasOverlays",
    "CanvasAuthoringHints",
    "ArchitectureEditingPanels",
    "FurnitureShelf",
    "VisualRoomMapper",
  ])
    assert.equal(
      canvas.includes(forbidden),
      false,
      `PresentationCanvas must stay read-only: ${forbidden}`,
    );
});

test("legacy SceneCanvas authoring shell and detached panels remain retired", () => {
  for (const name of [
    "SceneCanvas.tsx",
    "SceneCanvasOverlays.tsx",
    "sceneCanvasArchitectureController.ts",
    "sceneCanvasDirectManipulation.ts",
    "sceneCanvasEditorUx.ts",
    "canvasFurniturePlacement.ts",
    "MaterialQuickEditor.tsx",
    "ModelNodeInspector.tsx",
    "ReferenceWorkspace.tsx",
  ]) assert.equal(fs.existsSync(studioPath(name)), false, `retired authoring module returned: ${name}`);
});

test("shared room and site rendering helper dependency remains until separately proven removable", () => {
  assert.equal(fs.existsSync(studioPath("sceneCanvasPlanResizeHandles.ts")), true);
});
