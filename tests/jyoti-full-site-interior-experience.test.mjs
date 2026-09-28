import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("project site follows supplied exterior instead of inventing unsupported amenities", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /Car Parking/);
  assert.match(source, /Front Road/);
  assert.match(source, /Front Landscaping/);
  assert.match(source, /Main Gate/);
  assert.match(source, /Project Plot/);
  assert.doesNotMatch(source, /Swimming Pool/);
  assert.doesNotMatch(source, /lounger/);
});

test("brochure-backed typical floor includes the three marketed unit series", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /101-501/);
  assert.match(source, /102-502/);
  assert.match(source, /103-403/);
  assert.match(source, /Living 4\.954 x 3\.050/);
  assert.match(source, /Kitchen 3\.279 x 2\.196/);
  assert.match(source, /Living 4\.828 x 3\.050/);
  assert.match(source, /Kitchen 3\.416 x 2\.155/);
  assert.match(source, /Living 5\.366 x 3\.000/);
  assert.match(source, /Fire Lift 1\.60 x 1\.80/);
  assert.match(source, /DUCT 1\.80 x 3\.96/);
});

test("interior furniture follows brochure room types", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /addBed/);
  assert.match(source, /addSofa/);
  assert.match(source, /addKitchen/);
  assert.match(source, /addDining/);
  assert.match(source, /addToilet/);
  assert.match(source, /addBalcony/);
});

test("roof mode does not claim an unsupported recreational roof amenity", () => {
  const source = read("apps/public/src/viewer/projectExperience.ts");
  assert.match(source, /Roof \/ Terrace/);
  assert.match(source, /No recreational roof amenity is claimed/);
  assert.doesNotMatch(source, /pergola/i);
});

test("viewer raycasts project features and supports experience modes", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const profiles = read("apps/public/src/viewer/projectProfiles.ts");
  assert.match(viewer, /loadProfileExperience/);
  assert.match(profiles, /createJyotiProjectExperience/);
  assert.match(viewer, /experienceMode/);
  assert.match(viewer, /Raycaster/);
  assert.match(viewer, /intersectObject\(projectExperience\.root, true\)/);
  assert.match(viewer, /onFeatureSelect/);
});

test("digital twin navigation exposes brochure-backed interior and roof modes", () => {
  const app = read("apps/public/src/main.tsx");
  assert.match(app, /Typical Floor Interior/);
  assert.match(app, /Roof Inspection/);
  assert.match(app, /amenitySettings\.amenities/);
  assert.match(app, /experienceMode=\{experienceMode\}/);
  assert.match(app, /twin-feature-card/);
});
