import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("reusable opening renderer can still isolate reviewed openings to a room", () => {
  const roomObjects = read("apps/admin/src/studio/sceneCanvasRoomObjects.ts");

  assert.match(
    roomObjects,
    /options\.view === "rooms"[\s\S]*?options\.soloRoomId[\s\S]*?!opening\.roomIds\.includes\(options\.soloRoomId\)/,
  );
  assert.match(
    roomObjects,
    /options\.view === "walk"[\s\S]*?!opening\.roomIds\.includes\(options\.roomId\)/,
  );
});

test("published room view frames the active room while walk mode renders only that room", () => {
  const presentation = read("apps/admin/src/studio/PresentationCanvas.tsx");

  assert.match(presentation, /const activeRoomId =/);
  assert.match(presentation, /current\.roomId/);
  assert.match(
    presentation,
    /current\.scene\.rooms\.find\([\s\S]*?candidate\.id === activeRoomId/,
  );
  assert.match(presentation, /roomBoundaryPoints\(room\)/);
  assert.match(
    presentation,
    /props\.view === "walk" && room\.id !== props\.roomId/,
  );
});
