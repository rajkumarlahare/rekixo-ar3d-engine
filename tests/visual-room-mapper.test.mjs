import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("visual room mapper is mouse-first and keeps exact numbers as advanced fallback", () => {
  const mapper = read("apps/admin/src/studio/VisualRoomMapper.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(mapper, /VISUAL UNIT \/ ROOM MAPPER/);
  assert.match(mapper, /\+ Draw room/);
  assert.match(mapper, /Reshape selected/);
  assert.match(mapper, /Clone \+ drag/);
  assert.match(mapper, /Mirror X/);
  assert.match(mapper, /Snap to grid & room edges/);
  assert.match(studio, /Advanced numeric geometry/);
  assert.match(studio, /\+ Map room with mouse/);
});

test("room drawing happens on the selected floor and derives geometry from a drag", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /roomPlanePoint/);
  assert.match(canvas, /new T\.Plane\(new T\.Vector3\(0, 1, 0\), -floor\.elevation\)/);
  assert.match(canvas, /Math\.abs\(end\.x - start\.x\)/);
  assert.match(canvas, /Math\.abs\(end\.z - start\.z\)/);
  assert.match(canvas, /onRoomDraw/);
  assert.match(canvas, /candidateDistance <= 0\.22/);
});

test("visual room mapping preserves evidence discipline", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(studio, /source: "Visual Room Mapper draft"/);
  assert.match(studio, /verified: false/);
  assert.match(studio, /sourceAssetId: undefined/);
  assert.match(studio, /sourcePackSourceId: undefined/);
  assert.match(studio, /sourceClaimIds: undefined/);
  assert.match(studio, /mesh: undefined/);
});
