import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../apps/public/index.html", import.meta.url), "utf8");
const floorUi = fs.readFileSync(new URL("../apps/public/src/floor-experience.ts", import.meta.url), "utf8");
const floorCss = fs.readFileSync(new URL("../apps/public/src/floor-experience.css", import.meta.url), "utf8");
const viewer = fs.readFileSync(new URL("../apps/public/src/viewer/Viewer3D.tsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../apps/public/src/main.tsx", import.meta.url), "utf8");

test("public HTML loads the floor explorer enhancement", () => {
  assert.match(index, /floor-experience\.css/);
  assert.match(index, /floor-experience\.ts/);
});

test("all-floor view stays connected to the existing exploded building runtime", () => {
  assert.match(app, /const exploded = mode === "floors" && floor === null/);
  assert.match(app, /initialExploded=\{exploded\}/);
  assert.match(viewer, /floorExploder\?\.setExploded\(true\)/);
});

test("single floor selection keeps the viewer orbit target on the selected level", () => {
  assert.match(viewer, /controls\.target\.y = floorFocusElevation\(level\)/);
  assert.match(viewer, /floorRef\.current\?\.\(initialFloor\)/);
});

test("floor HUD supports all, previous and next navigation", () => {
  assert.match(floorUi, /Previous floor/);
  assert.match(floorUi, /Next floor/);
  assert.match(floorUi, /allFloorsButton\(stage\)\?\.click\(\)/);
  assert.match(floorUi, /move\(-1\)/);
  assert.match(floorUi, /move\(1\)/);
  assert.match(floorUi, /Exploded building stack/);
  assert.match(floorUi, /Isolated 3D floor/);
});

test("floor controls remain keyboard and mobile friendly", () => {
  assert.match(floorUi, /event\.key === "PageUp"/);
  assert.match(floorUi, /event\.key === "PageDown"/);
  assert.match(floorUi, /event\.key === "0" \|\| event\.key === "Home"/);
  assert.match(floorCss, /@media \(max-width: 760px\)/);
  assert.match(floorCss, /overflow-x: auto/);
});

test("floor enhancement stays project agnostic", () => {
  assert.doesNotMatch(floorUi, /Jyoti|Paradise/i);
  assert.doesNotMatch(floorCss, /Jyoti|Paradise/i);
});
