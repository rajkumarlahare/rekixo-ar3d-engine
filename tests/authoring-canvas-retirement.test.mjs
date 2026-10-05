import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const retired = [
  "apps/admin/src/studio/SceneCanvas.tsx",
  "apps/admin/src/studio/SceneCanvasOverlays.tsx",
  "apps/admin/src/studio/CanvasAuthoringHints.tsx",
  "apps/admin/src/studio/MaterialQuickEditor.tsx",
  "apps/admin/src/studio/ModelNodeInspector.tsx",
  "apps/admin/src/studio/ReferenceWorkspace.tsx",
];

const retained = [
  "apps/admin/src/studio/PresentationCanvas.tsx",
  "apps/admin/src/studio/PublishedViewer.tsx",
  "apps/admin/src/source-pack/SourcePackReview.tsx",
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "apps/admin/src/studio/readiness.ts",
  "apps/admin/src/studio/storage.ts",
  "apps/admin/src/studio/materialPresets.ts",
  "apps/admin/src/studio/pdfReferenceRaster.ts",
  "apps/admin/src/geo/GeoMapper3D.tsx",
];

test("detached authoring canvas shell and editor panels stay retired", () => {
  for (const path of retired)
    assert.equal(fs.existsSync(path), false, `${path} must stay retired`);
});

test("Automatic Engine and read-only presentation foundations remain", () => {
  for (const path of retained)
    assert.equal(fs.existsSync(path), true, `${path} must remain available`);

  const main = fs.readFileSync("apps/admin/src/main.tsx", "utf8");
  const published = fs.readFileSync("apps/admin/src/studio/PublishedViewer.tsx", "utf8");
  const presentation = fs.readFileSync("apps/admin/src/studio/PresentationCanvas.tsx", "utf8");

  assert.match(main, /\.\/source-pack\/SourcePackReview/);
  assert.match(main, /\.\/studio\/PublishedViewer/);
  assert.match(published, /from "\.\/PresentationCanvas"/);
  assert.doesNotMatch(published, /from "\.\/SceneCanvas"/);
  assert.doesNotMatch(presentation, /TransformControls/);
  assert.doesNotMatch(presentation, /SceneCanvasOverlays/);
  assert.doesNotMatch(presentation, /CanvasAuthoringHints/);
});
