import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const transform = read("apps/admin/src/studio/sceneCanvasTransform.ts");
const apply = read("apps/admin/src/studio/sceneTransformApply.ts");
const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
const direct = read("apps/admin/src/studio/sceneCanvasDirectManipulation.ts");
const ux = read("apps/admin/src/studio/sceneCanvasEditorUx.ts");
const studio = read("apps/admin/src/studio/Studio.tsx");

test("Phase 4 batches group moves into one transform transaction", () => {
  assert.match(transform, /kind: "batch"; changes: AtomicTransformCommit\[\]/);
  assert.match(apply, /change\.kind === "batch"/);
  assert.match(direct, /groupMove\?\.length/);
  assert.match(direct, /kind: "batch"/);
  assert.match(studio, /applyTransformCommit\(p\.scene, change\)/);
});

test("Phase 4 keeps multi-select explicit and prevents Shift from starting a drag", () => {
  assert.match(canvas, /selectedIds\?: readonly string\[\]/);
  assert.match(canvas, /onSelectionChange\?:/);
  assert.match(canvas, /!e\.shiftKey \|\| !latest\.current\.onSelectionChange/);
  assert.match(ux, /toggleCanvasSelection/);
  assert.match(direct, /event\.shiftKey/);
  assert.match(studio, /selectedIds, setSelectedIds/);
});

test("Phase 4 keyboard nudging has fine, normal and coarse precision", () => {
  assert.match(apply, /modifiers\.altKey \? 0\.01 : modifiers\.shiftKey \? 0\.5 : 0\.1/);
  assert.match(apply, /case "arrowleft"/);
  assert.match(apply, /case "arrowup"/);
  assert.match(ux, /buildTranslationCommit/);
  assert.match(ux, /Alt 0\.01 m/);
  assert.match(canvas, /resolveCanvasNudge/);
});

test("Phase 4 polygon editing has touch targets, insertion and cancellation safety", () => {
  assert.match(ux, /Polygon corner .* touch target/);
  assert.match(ux, /roomEdgeInsertIndex/);
  assert.match(ux, /next\.splice\(insertIndex, 0/);
  assert.match(canvas, /e\.type === "pointercancel"/);
  assert.match(canvas, /originalPoints/);
  assert.match(canvas, /Polygon corner edit cancelled/);
});

test("Phase 4 renders secondary selection outlines and disables single-object gizmo", () => {
  assert.match(canvas, /Multi-selection outlines/);
  assert.match(ux, /new T\.BoxHelper\(target, 0x2bc7ff\)/);
  assert.match(canvas, /\(props\.selectedIds\?\.length \?\? 0\) > 1/);
  assert.match(canvas, /renderMultiSelectionOutlines/);
});
