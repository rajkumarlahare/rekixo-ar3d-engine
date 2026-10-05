import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const transform = read("apps/admin/src/studio/sceneCanvasTransform.ts");
const apply = read("apps/admin/src/studio/sceneTransformApply.ts");

test("retained transform contract supports atomic and batch commits", () => {
  assert.match(transform, /kind: "batch"; changes: AtomicTransformCommit\[\]/);
  assert.match(apply, /change\.kind === "batch"/);
  assert.match(apply, /change\.changes\.reduce\(applyAtomicTransform, scene\)/);
});

test("retained keyboard nudge kernel has fine, normal and coarse precision", () => {
  assert.match(apply, /modifiers\.altKey \? 0\.01 : modifiers\.shiftKey \? 0\.5 : 0\.1/);
  assert.match(apply, /case "arrowleft"/);
  assert.match(apply, /case "arrowup"/);
});

test("retained translation commit builder keeps multi-entity moves deterministic", () => {
  assert.match(apply, /export function buildTranslationCommit/);
  assert.match(apply, /new Set\(ids\.filter\(Boolean\)\)/);
  assert.match(apply, /changes\.length === 1 \? changes\[0\] : \{ kind: "batch", changes \}/);
});

test("retired multi-select canvas UX does not return", () => {
  assert.equal(fs.existsSync("apps/admin/src/studio/sceneCanvasEditorUx.ts"), false);
  assert.equal(fs.existsSync("apps/admin/src/studio/SceneCanvas.tsx"), false);
});
