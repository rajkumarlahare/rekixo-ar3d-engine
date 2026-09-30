import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Interior defaults to a selected-room focus with an explicit floor overview toggle", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(studio, /const \[interiorFloorOverview, setInteriorFloorOverview\] = useState\(false\)/);
  assert.match(studio, /view === "rooms" && room/);
  assert.match(studio, /interiorFloorOverview \? "Focus room" : "Show floor"/);
  assert.match(
    studio,
    /view === "rooms" && !interiorFloorOverview[\s\S]*?roomId \|\| undefined/,
  );
  assert.match(studio, /if \(v === "rooms"\) setInteriorFloorOverview\(false\)/);
});

test("Scene canvas excludes neighboring rooms and unrelated openings in room-focus mode", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(canvas, /soloRoomId\?: string/);
  assert.match(
    canvas,
    /props\.view === "rooms"[\s\S]*?props\.soloRoomId[\s\S]*?room\.id !== props\.soloRoomId/,
  );
  assert.match(
    canvas,
    /props\.view === "rooms"[\s\S]*?props\.soloRoomId[\s\S]*?!opening\.roomIds\.includes\(props\.soloRoomId\)/,
  );
});

test("room-focus mode frames the active room instead of the whole floor", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");

  assert.match(
    canvas,
    /props\.view === "rooms" && props\.soloRoomId[\s\S]*?api\.current\?\.focusSelected\(\)/,
  );
  assert.match(canvas, /props\.soloRoomId,[\s\S]*?\]\);/);
});
