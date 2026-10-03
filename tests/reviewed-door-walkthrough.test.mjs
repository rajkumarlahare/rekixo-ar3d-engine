import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Studio walkthrough uses reviewed-door transition resolver", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const overlays = read("apps/admin/src/studio/SceneCanvasOverlays.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const panel = read("apps/admin/src/studio/RoomNavigationPanel.tsx");

  assert.match(canvas, /resolveReviewedDoorWalkStep/);
  assert.match(canvas, /onWalkRoomChange/);
  assert.match(overlays, /reviewed shared doors connect rooms/);
  assert.match(studio, /RoomNavigationPanel/);
  assert.match(panel, /WALKTHROUGH CONNECTIONS/);
  assert.match(panel, /Walk there/);
  assert.match(panel, /Demo room navigation/);
  assert.match(panel, /Jump to reviewed room/);
  assert.match(panel, /does not claim a physical doorway/);
  assert.match(studio, /onWalkRoomChange=/);
});

test("walkthrough connectivity is derived only from reviewed two-room doors", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  assert.match(domain, /reviewedDoorConnections/);
  assert.match(domain, /opening\.reviewed/);
  assert.match(domain, /opening\.kind !== "door"/);
  assert.match(domain, /opening\.roomIds\.length !== 2/);
  assert.match(domain, /doorLandingPoint/);
});


test("demo room navigation is separate from reviewed-door transition truth", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  const readiness = read("apps/admin/src/studio/readiness.ts");
  const overlays = read("apps/admin/src/studio/SceneCanvasOverlays.tsx");

  assert.match(domain, /verifiedRoomNavigationTargets/);
  assert.match(domain, /room\.verified/);
  assert.match(domain, /room\.floorId === source\.floorId/);
  assert.match(domain, /room\.unit\.trim\(\)\.toLowerCase\(\) === unit/);
  assert.match(readiness, /did not yield a trustworthy reviewed shared door/);
  assert.match(readiness, /same unit for demo navigation/);
  assert.match(overlays, /WASD inside room/);
});
