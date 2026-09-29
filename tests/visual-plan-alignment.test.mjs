import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Jyoti source profile points visual alignment at the useful brochure plan", () => {
  const profile = read("project-profiles/studio-source-profiles.ts");
  const setup = read("apps/admin/src/studio/sourcePackSetup.ts");

  assert.match(profile, /alignment:\s*{/);
  assert.match(profile, /slotKey: "floorPlan"/);
  assert.match(profile, /page: 2/);
  assert.match(profile, /x: 0\.5/);
  assert.match(profile, /y: 0\.12/);
  assert.match(profile, /width: 0\.48/);
  assert.match(profile, /height: 0\.84/);
  assert.match(setup, /alignment\?: QuickAlignmentPreset/);
  assert.match(setup, /alignment: profile\.alignment/);
});

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
  assert.match(workspace, />Snap</);
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
