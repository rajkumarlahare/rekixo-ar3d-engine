import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Interior Material Editor exposes semantic surface controls and presets", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(studio, /INTERIOR FINISHES/);
  assert.match(studio, /SURFACE_MATERIAL_PRESETS/);
  assert.match(studio, /Apply to all walls/);
  assert.match(studio, /Reset surface/);
  assert.match(studio, /onSurfaceSelect=/);
});

test("room renderer binds authored surface finish data without mutating source model", () => {
  const rooms = read("apps/admin/src/studio/sceneCanvasRooms.ts");
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(rooms, /findSurfaceFinish/);
  assert.match(rooms, /surfaceKind = "floor"/);
  assert.match(rooms, /surfaceKind = "wall"/);
  assert.match(rooms, /surfaceKind = "ceiling"/);
  assert.match(canvas, /onSurfaceSelect\?/);
  assert.doesNotMatch(rooms, /room\.[a-zA-Z]+\s*=/);
});

test("surface material authoring is part of project scene and cloud publication", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  const worker = read("workers/studio-draft-validation.mjs");

  assert.match(domain, /surfaceFinishes\?: SurfaceFinish\[\]/);
  assert.match(worker, /surfaceFinishes: structuredClone\(scene\.surfaceFinishes \?\? \[\]\)/);
  assert.match(worker, /Invalid Studio wall finish edge/);
});
