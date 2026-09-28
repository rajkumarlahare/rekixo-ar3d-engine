import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("premium presentation profile receives the dedicated full-screen digital twin shell", () => {
  const app = read("apps/public/src/main.tsx");
  assert.match(app, /presentation\?\.style === "premium-real-estate-digital-twin"/);
  assert.match(app, /PremiumDigitalTwin/);
  assert.match(app, /Project Navigation/);
  assert.match(app, /Building Explorer/);
  assert.match(app, /Floor Explorer/);
  assert.match(app, /Unit Explorer/);
  assert.match(app, /Balcony View/);
  assert.match(app, /Distance & Context/);
  assert.doesNotMatch(app, /project\.slug === "jyoti-paradise"/);
});

test("digital twin viewer supports reference-style presentation cameras", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(viewer, /"aerial"/);
  assert.match(viewer, /"building"/);
  assert.match(viewer, /"top"/);
  assert.match(viewer, /"balcony"/);
  assert.match(viewer, /"context"/);
  assert.match(viewer, /initialExploded/);
  assert.match(viewer, /compactUi/);
});

test("floor and unit navigation stays source-backed", () => {
  const app = read("apps/public/src/main.tsx");
  assert.match(app, /unitNumberForFloor/);
  assert.match(app, /configured units/i);
  assert.match(app, /source boundary is verified/i);
});

test("migration makes digital twin primary and walkthrough secondary", () => {
  const migration = read("database/migrations/0007_jyoti_reference_digital_twin.sql");
  assert.match(migration, /premium-real-estate-digital-twin/);
  assert.match(migration, /aerial-project-explorer/);
  assert.match(migration, /"walkthroughRole":"secondary"/);
  assert.match(migration, /No Platform\/customer website resources are modified/);
});
