import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Scene canvas excludes neighboring rooms and unrelated openings in room-focus mode", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const roomObjects = read("apps/admin/src/studio/sceneCanvasRoomObjects.ts");

  assert.match(canvas, /soloRoomId\?: string/);
  assert.match(canvas, /props\.view === "rooms"[\s\S]*?props\.soloRoomId[\s\S]*?room\.id !== props\.soloRoomId/);
  assert.match(canvas, /renderReviewedOpeningMarkers/);
  assert.match(canvas, /soloRoomId: props\.soloRoomId/);
  assert.match(roomObjects, /options\.view === "rooms"[\s\S]*?options\.soloRoomId[\s\S]*?!opening\.roomIds\.includes\(options\.soloRoomId\)/);
});

test("room-focus mode frames the active room instead of the whole floor", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /props\.view === "rooms" && props\.soloRoomId[\s\S]*?api\.current\?\.focusSelected\(\)/);
  assert.match(canvas, /props\.soloRoomId,[\s\S]*?\]\);/);
});
