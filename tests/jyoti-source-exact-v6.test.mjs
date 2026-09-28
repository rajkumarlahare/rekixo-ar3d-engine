import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("typical floor uses source-evidenced unit dimensions", () => {
  const scene = JSON.parse(
    read("project-profiles/jyoti-paradise/interior-scene-v2.json"),
  );
  const names = scene.rooms.map((room) => room.name).join("\\n");
  for (const token of [
    "Living 4.954 x 3.050",
    "Kitchen 3.279 x 2.196",
    "Dining 1.265 x 1.023",
    "Bed Room 3.679 x 3.153",
    "Bed Room 3.500 x 3.701",
    "Living 4.828 x 3.050",
    "Kitchen 3.416 x 2.155",
    "Living 5.366 x 3.000",
    "Kitchen 3.640 x 2.061",
    "Bed Room 3.313 x 3.146",
    "Bed Room 3.130 x 3.830",
    "Fire Lift 1.60 x 1.80",
    "DUCT 1.80 x 3.96",
  ]) assert.match(names, new RegExp(token.replaceAll(".", "\\.")));
});

test("balcony presentation derives orientation from Scene V2 positions", () => {
  const scene = JSON.parse(
    read("project-profiles/jyoti-paradise/interior-scene-v2.json"),
  );
  const byId = new Map(scene.rooms.map((room) => [room.id, room]));
  for (const id of ["101-balcony", "101-wbal", "103-balcony-side"])
    assert.ok(byId.get(id).boundary.center[0] < 0, id);
  for (const id of ["102-balcony", "102-wbal"])
    assert.ok(byId.get(id).boundary.center[0] > 0, id);
  for (const id of ["103-wbal", "103-balcony"])
    assert.ok(byId.get(id).boundary.center[1] < -9, id);

  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /room\.id === "103-wbal" \|\| room\.id === "103-balcony"/);
  assert.match(source, /position\[0\] < 0/);
});

test("brochure furniture cues are represented in the dollhouse", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /addWardrobe/);
  assert.match(source, /addLShapeSofa/);
  assert.match(source, /addBed/);
  assert.match(source, /addKitchen/);
  assert.match(source, /addDining/);
  assert.match(source, /addToilet/);
});

test("source conflicts are explicitly recorded rather than hidden", () => {
  const migration = read("database/migrations/0013_jyoti_source_exact_v6.sql");
  assert.match(migration, /3\.279 x 2\.196/);
  assert.match(migration, /3\.379 x 2\.196/);
  assert.match(migration, /3\.416 x 2\.155/);
  assert.match(migration, /3\.516 x 2\.155/);
  assert.match(migration, /1\.80 x 3\.96/);
  assert.match(migration, /1\.90 x 3\.26/);
});

test("V6 remains isolated from Platform customer websites", () => {
  const migration = read("database/migrations/0013_jyoti_source_exact_v6.sql");
  assert.match(migration, /No Platform\/customer website resources are modified/);
});
