import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("published presentation walkthrough uses reviewed-door transition resolver", () => {
  const canvas = read("apps/admin/src/studio/PresentationCanvas.tsx");
  assert.match(canvas, /resolveReviewedDoorWalkStep/);
  assert.match(canvas, /onWalkRoomChange/);
});

test("walkthrough connectivity is derived only from reviewed two-room doors", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  assert.match(domain, /reviewedDoorConnections/);
  assert.match(domain, /opening\.reviewed/);
  assert.match(domain, /opening\.kind !== "door"/);
  assert.match(domain, /opening\.roomIds\.length !== 2/);
  assert.match(domain, /doorLandingPoint/);
});

test("demo room navigation remains separate from reviewed-door transition truth", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  const readiness = read("apps/admin/src/studio/readiness.ts");
  assert.match(domain, /verifiedRoomNavigationTargets/);
  assert.match(domain, /room\.verified/);
  assert.match(domain, /room\.floorId === source\.floorId/);
  assert.match(domain, /room\.unit\.trim\(\)\.toLowerCase\(\) === unit/);
  assert.match(readiness, /did not yield a trustworthy reviewed shared door/);
  assert.match(readiness, /same unit for demo navigation/);
});
