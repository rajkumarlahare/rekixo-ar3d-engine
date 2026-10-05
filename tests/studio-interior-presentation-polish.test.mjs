import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("read-only presentation keeps production shadows and appearance runtime", () => {
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");
  const appearance = read("apps/admin/src/studio/sceneCanvasAppearance.ts");

  assert.match(presentation, /PCFSoftShadowMap/);
  assert.match(presentation, /applySceneCanvasAppearance/);
  assert.match(appearance, /runtime\.grid\.visible = !focusedInterior/);
  assert.match(
    appearance,
    /runtime\.scene\.background = new T\.Color\("#e7e1d8"\)/,
  );
  assert.match(
    appearance,
    /runtime\.fill\.intensity = focusedInterior \? 1 : 0\.72/,
  );
});

test("reusable room renderer retains warm architectural interior finish", () => {
  const rooms = read("apps/admin/src/studio/sceneCanvasRooms.ts");

  assert.match(rooms, /interiorPresentation = false/);
  assert.match(rooms, /#f4f0e9/);
  assert.match(rooms, /skirting/);
  assert.match(rooms, /#c9b9a4/);
});

test("presentation room view uses a shallow cutaway and frames the active room", () => {
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");

  assert.match(
    presentation,
    /props\.view === "walk" \? room\.height : 0\.65/,
  );
  assert.match(presentation, /const activeRoomId =/);
  assert.match(presentation, /current\.roomId/);
  assert.match(presentation, /roomBoundaryPoints\(room\)/);
  assert.match(presentation, /new T\.Box3/);
});

test("presentation polish is render-only and does not mutate project scene data", () => {
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");
  const rooms = read("apps/admin/src/studio/sceneCanvasRooms.ts");

  assert.doesNotMatch(rooms, /room\.[a-zA-Z]+\s*=/);
  assert.doesNotMatch(presentation, /props\.scene\.[a-zA-Z]+\s*=/);
});
