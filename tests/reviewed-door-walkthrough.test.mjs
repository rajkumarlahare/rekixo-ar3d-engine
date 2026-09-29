import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Studio walkthrough uses reviewed-door transition resolver", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(canvas, /resolveReviewedDoorWalkStep/);
  assert.match(canvas, /onWalkRoomChange/);
  assert.match(canvas, /reviewed shared doors connect rooms/);
  assert.match(studio, /WALKTHROUGH CONNECTIONS/);
  assert.match(studio, /Walk there/);
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
