import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

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
  for (const path of [
    "apps/admin/src/studio/SceneCanvas.tsx",
    "apps/admin/src/studio/SceneCanvasOverlays.tsx",
    "apps/admin/src/studio/sceneCanvasArchitectureController.ts",
    "apps/admin/src/studio/sceneCanvasDirectManipulation.ts",
    "apps/admin/src/studio/sceneCanvasEditorUx.ts",
    "apps/admin/src/studio/canvasFurniturePlacement.ts",
    "apps/admin/src/studio/MaterialQuickEditor.tsx",
    "apps/admin/src/studio/ModelNodeInspector.tsx",
    "apps/admin/src/studio/ReferenceWorkspace.tsx",
  ]) assert.equal(fs.existsSync(path), false, `retired authoring module returned: ${path}`);
});

test("shared room and site rendering helper dependency remains until separately proven removable", () => {
  assert.equal(
    fs.existsSync("apps/admin/src/studio/sceneCanvasPlanResizeHandles.ts"),
    true,
  );
});
