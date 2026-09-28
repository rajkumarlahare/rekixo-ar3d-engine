import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("final Jyoti product exposes only source-backed public modules", () => {
  const migration = read("database/migrations/0004_jyoti_final_product_modules.sql");
  assert.match(migration, /scene_jyoti_wing_distance_pending/);
  assert.match(migration, /Interactive Section Cut/);
  assert.match(migration, /Facade & Balcony Detail/);
  assert.match(migration, /No interior balcony panorama is claimed/);
  assert.match(migration, /Location Map/);
});

test("public UI contains location map and floor explorer without inventing unit numbers", () => {
  const app = read("apps/public/src/main.tsx");
  assert.match(app, /LocationMap/);
  assert.match(app, /unitNumberForFloor/);
  assert.match(app, /No configured unit for this floor/);
  assert.match(app, /wing-distance/);
});

test("viewer supports floor isolation, section cut and day-night modes", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /renderer\.clippingPlanes/);
  assert.match(viewer, /applyFloor/);
  assert.match(viewer, /applySection/);
  assert.match(viewer, /applyLighting/);
  assert.match(viewer, /Ground/);
});

test("location module stays inside the existing Engine scene contract", () => {
  const contracts = read("packages/contracts/src/index.ts");
  assert.match(contracts, /\| "wing-distance"/);
  assert.doesNotMatch(contracts, /\| "site-map"/);
});
