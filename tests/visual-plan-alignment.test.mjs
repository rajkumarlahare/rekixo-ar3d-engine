import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("PDF floor-plan preparation is lazy, cropped and keeps the source unchanged", () => {
  const helper = read("apps/admin/src/studio/pdfReferenceRaster.ts");
  const pkg = JSON.parse(read("apps/admin/package.json"));

  assert.equal(pkg.dependencies["pdfjs-dist"], "6.3.289");
  assert.match(helper, /await import\("pdfjs-dist"\)/);
  assert.match(helper, /pdf\.worker\.min\.mjs\?url/);
  assert.match(helper, /clampCrop/);
  assert.match(helper, /drawImage\(canvas, sx, sy, sw, sh, 0, 0, sw, sh\)/);
  assert.match(helper, /new File\(/);
  assert.doesNotMatch(helper, /source\.blob\s*=/);
});

test("visual alignment UI is mouse-first with numeric controls kept advanced", () => {
  const workspace = read("apps/admin/src/studio/ReferenceWorkspace.tsx");

  assert.match(workspace, /VISUAL PLAN ALIGNMENT/);
  assert.match(workspace, /Use detected floor plan/);
  assert.match(workspace, /Calibrate & show under model/);
  assert.match(workspace, /↔ Move model/);
  assert.match(workspace, /↻ Rotate model/);
  assert.match(workspace, /Snap/);
  assert.match(workspace, /Center on plan/);
  assert.match(workspace, /Plan opacity/);
  assert.match(workspace, /type="range"/);
  assert.match(workspace, /Advanced numeric alignment/);
  assert.match(workspace, /mouse या touch से/);
});

test("Studio opens alignment in top view and reuses the existing model transform gizmo", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");

  assert.match(studio, /function startVisualAlignment\(\)/);
  assert.match(studio, /setShowReferenceWorkspace\(true\)/);
  assert.match(studio, /setCameraOrientation\("top"\)/);
  assert.match(studio, /setTransformMode\("translate"\)/);
  assert.match(studio, /onStartAlignment={startVisualAlignment}/);
  assert.match(studio, /onCreatePdfReference={createPdfReferenceAsset}/);
  assert.match(studio, /onSnap={setTransformSnap}/);
  assert.match(studio, /modelTransformEnabled={showReferenceWorkspace}/);
  assert.match(canvas, /runtime\.transform\.attach\(runtime\.model\)/);
  assert.match(canvas, /setTranslationSnap\(props\.snap \? 0\.1 : null\)/);
  assert.match(canvas, /setRotationSnap\(props\.snap \? Math\.PI \/ 12 : null\)/);
  assert.match(builder, /Align floor plan →/);
});


test("alignment mode prioritizes the canvas and removes editor-side clutter", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(studio, /editor-core--alignment/);
  assert.match(studio, /aria-label="Plan alignment tools"/);
  assert.match(studio, /Auto position first · fine-tune only if needed/);
  assert.match(studio, /\bTop view\b/);
  assert.match(studio, /Move <kbd>W<\/kbd>/);
  assert.match(studio, /Rotate <kbd>E<\/kbd>/);
  assert.match(studio, /\+ Reference/);
  assert.match(studio, /className="primary alignment-done"/);
  assert.match(studio, /sectionCutEnabled && !showReferenceWorkspace/);

  assert.match(css, /\/\* Phase 3 dedicated plan-alignment workspace \*\//);
  assert.match(css, /\.editor-core--alignment > \.studio-sidebar,/);
  assert.match(css, /\.editor-core--alignment > \.studio-inspector/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.editor-core--alignment \.canvas-wrap/);
  assert.match(css, /min-height: clamp\(280px, 52vh, 650px\)/);
  assert.match(css, /flex: 0 0 clamp\(150px, 24vh, 220px\)/);
  assert.match(css, /\.editor-core--alignment \.reference-workspace-head,/);
  assert.match(css, /\.editor-core--alignment \.reference-quickbar/);
});


test("plan calibration reference has operator-friendly zoom and large view", () => {
  const workspace = read("apps/admin/src/studio/ReferenceWorkspace.tsx");
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(workspace, /const \[previewZoom, setPreviewZoom\] = useState\(1\)/);
  assert.match(workspace, /const \[previewExpanded, setPreviewExpanded\] = useState\(false\)/);
  assert.match(workspace, /aria-label="Plan preview zoom"/);
  assert.match(workspace, /Zoom out plan/);
  assert.match(workspace, /Zoom in plan/);
  assert.match(workspace, /Large view/);
  assert.match(workspace, /Close large view/);
  assert.match(workspace, /event\.key !== "Escape"/);
  assert.match(workspace, /naturalSize\.width \* previewZoom/);
  assert.match(css, /\.reference-image-viewer--expanded/);
  assert.match(css, /overflow: auto/);
});


test("alignment mode locks camera and prevents vertical model movement", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(canvas, /alignmentMode\?: boolean/);
  assert.match(canvas, /controls\.enableRotate = !latest\.current\.alignmentMode/);
  assert.match(canvas, /controls\.enablePan = !latest\.current\.alignmentMode/);
  assert.match(canvas, /runtime\.transform\.showY = mode === "rotate" && Boolean\(props\.alignmentMode\)/);
  assert.match(canvas, /if \(props\.alignmentMode\) return;[\s\S]*api\.current\?\.focus\(\)/);
  assert.match(studio, /alignmentMode=\{showReferenceWorkspace\}/);
});

test("alignment mode offers fine nudge controls and identifies the faded plan", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(studio, /aria-label="Fine move"/);
  assert.match(studio, /Fine move 10 cm/);
  assert.match(studio, /Move model left 10 centimetres/);
  assert.match(studio, /aria-label="Fine rotate"/);
  assert.match(studio, /Fine rotate 1°/);
  assert.match(canvas, /BLUE FADED = REFERENCE PLAN/);
  assert.match(canvas, /Math\.min\(layer\.opacity, 0\.34\)/);
  assert.match(css, /\.alignment-canvas-legend/);
});


test("alignment offers one-click auto positioning before manual fine tuning", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(studio, /const \[autoAlignRequest, setAutoAlignRequest\] = useState\(0\)/);
  assert.match(studio, /Auto position/);
  assert.match(studio, /setAutoAlignRequest\(\(value\) => value \+ 1\)/);
  assert.match(studio, /autoAlignRequest=\{autoAlignRequest\}/);

  assert.match(canvas, /autoAlignRequest\?: number/);
  assert.match(canvas, /floor-tagged building meshes/);
  assert.match(canvas, /runtime\.model\.rotation\.y = 0/);
  assert.match(canvas, /referenceCentre\.x - modelCentre\.x/);
  assert.match(canvas, /referenceCentre\.z - modelCentre\.z/);
  assert.match(canvas, /rotationY: 0/);
  assert.match(css, /\.alignment-auto-position/);
});


test("reference plan is hidden after leaving alignment mode", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(studio, /showReferenceLayers=\{showReferenceWorkspace\}/);
  assert.match(studio, /\{showReferenceWorkspace && \([\s\S]*<ReferenceWorkspace/);
});
