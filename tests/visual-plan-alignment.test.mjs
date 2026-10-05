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

test("legacy visual alignment workspace and SceneCanvas implementation remain retired", () => {
  assert.equal(fs.existsSync("apps/admin/src/studio/ReferenceWorkspace.tsx"), false);
  assert.equal(fs.existsSync("apps/admin/src/studio/SceneCanvas.tsx"), false);
  assert.equal(fs.existsSync("apps/admin/src/studio/SceneCanvasOverlays.tsx"), false);
});
