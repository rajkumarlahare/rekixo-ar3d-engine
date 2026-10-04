import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("phase 6 walkthrough polish is loaded by the public app", async () => {
  const index = await read("apps/public/index.html");
  assert.match(index, /walkthrough-polish\.css/);
  assert.match(index, /walkthrough-polish\.ts/);
});

test("walkthrough polish exposes a customer exit path and device-specific guidance", async () => {
  const source = await read("apps/public/src/walkthrough-polish.ts");
  assert.match(source, /Exit walk/);
  assert.match(source, /WASD \/ arrows to move/);
  assert.match(source, /hold on-screen arrows to move/);
  assert.match(source, /viewer-walk-controls/);
  assert.match(source, /twin-rail-item/);
  assert.match(source, /building/);
});

test("walkthrough runtime keeps reviewed graph movement and collision-backed fallback", async () => {
  const viewer = await read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /resolvePublicWalkStep/);
  assert.match(viewer, /collectWalkColliders/);
  assert.match(viewer, /walkRaycastCandidates/);
  assert.match(viewer, /reviewed door/);
  assert.match(viewer, /on-screen arrows/);
  assert.match(viewer, /Escape/);
});

test("walkthrough polish remains presentation-only and does not infer geometry", async () => {
  const source = await read("apps/public/src/walkthrough-polish.ts");
  assert.doesNotMatch(source, /GLTFLoader|FBXLoader|createPreviewBuilding|reconstruct|infer.*room/i);
  const css = await read("apps/public/src/walkthrough-polish.css");
  assert.match(css, /data-walkthrough-active/);
  assert.match(css, /pointer: coarse|@media \(max-width: 760px\)/);
});
