import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("focused Interior uses presentation lighting instead of exterior sky/grid", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /PCFSoftShadowMap/);
  assert.match(canvas, /const focusedInterior =[\s\S]*?props\.view === "rooms"/);
  assert.match(canvas, /runtime\.grid\.visible = !focusedInterior/);
  assert.match(canvas, /runtime\.scene\.background = new T\.Color\("#e7e1d8"\)/);
  assert.match(canvas, /runtime\.fill\.intensity = focusedInterior \? 1\.0 : 0\.72/);
});

test("focused Interior raises cutaway walls and adds warm architectural finish", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const rooms = read("apps/admin/src/studio/sceneCanvasRooms.ts");

  assert.match(canvas, /focusedInterior[\s\S]*?Math\.min\(room\.height, 1\.05\)/);
  assert.match(canvas, /roomSurface\([\s\S]*?focusedInterior/);
  assert.match(rooms, /interiorPresentation = false/);
  assert.match(rooms, /#f4f0e9/);
  assert.match(rooms, /skirting/);
  assert.match(rooms, /#c9b9a4/);
});

test("focused Interior keeps the initial room view clean until furniture is selected", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(
    canvas,
    /room\.id === props\.selected[\s\S]*?!\(props\.view === "rooms" && props\.soloRoomId\)/,
  );
  assert.match(
    canvas,
    /isRoom && props\.view === "rooms" && props\.soloRoomId/,
  );
  assert.match(
    canvas,
    /focusedInterior \? 1\.04 : 0\.9/,
  );
});

test("presentation polish is render-only and does not mutate project scene data", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const rooms = read("apps/admin/src/studio/sceneCanvasRooms.ts");

  assert.doesNotMatch(rooms, /room\.[a-zA-Z]+\s*=/);
  assert.doesNotMatch(canvas, /props\.scene\.[a-zA-Z]+\s*=/);
});
