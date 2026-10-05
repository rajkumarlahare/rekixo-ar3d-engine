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

test("visual alignment workspace remains mouse-first with numeric controls advanced", () => {
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

test("plan calibration reference keeps zoom and large-view controls", () => {
  const workspace = read("apps/admin/src/studio/ReferenceWorkspace.tsx");
  assert.match(workspace, /const \[previewZoom, setPreviewZoom\] = useState\(1\)/);
  assert.match(workspace, /const \[previewExpanded, setPreviewExpanded\] = useState\(false\)/);
  assert.match(workspace, /aria-label="Plan preview zoom"/);
  assert.match(workspace, /Zoom out plan/);
  assert.match(workspace, /Zoom in plan/);
  assert.match(workspace, /Large view/);
  assert.match(workspace, /Close large view/);
  assert.match(workspace, /event\.key !== "Escape"/);
  assert.match(workspace, /naturalSize\.width \* previewZoom/);
});

test("legacy SceneCanvas alignment implementation remains retired", () => {
  assert.equal(fs.existsSync("apps/admin/src/studio/SceneCanvas.tsx"), false);
  assert.equal(fs.existsSync("apps/admin/src/studio/SceneCanvasOverlays.tsx"), false);
});
