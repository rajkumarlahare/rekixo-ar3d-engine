import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../apps/public/index.html", import.meta.url), "utf8");
const info = fs.readFileSync(new URL("../apps/public/src/customer-info.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../apps/public/src/customer-info.css", import.meta.url), "utf8");

test("public HTML loads Phase 5 customer information assets", () => {
  assert.match(index, /customer-info\.css/);
  assert.match(index, /customer-info\.ts/);
});

test("flat details are derived from published floor and unit data", () => {
  assert.match(info, /sceneSettings<FloorSettings>\(experience, "typical-floor"\)/);
  assert.match(info, /unitNumberForFloor/);
  assert.match(info, /selectedFloor\(stage\)/);
  assert.match(info, /selectedFlat\(stage\)/);
  assert.match(info, /areaSqFt\.toLocaleString\("en-IN"\)/);
  assert.match(info, /floorSettings\.mediaKey/);
});

test("project info uses configured project, location, amenity and nearby data", () => {
  assert.match(info, /sceneSettings<ProjectSettings>/);
  assert.match(info, /sceneSettings<AmenitySettings>/);
  assert.match(info, /sceneSettings<LocationSettings>/);
  assert.match(info, /experience\.project\.name/);
  assert.match(info, /experience\.project\.location/);
  assert.match(info, /brochurePrice/);
  assert.match(info, /google\.com\/maps\/search/);
});

test("Phase 5 does not hardcode customer-specific sales facts", () => {
  assert.doesNotMatch(info, /Jyoti|Paradise|972|949|940/i);
  assert.match(info, /Only published project information is shown/);
});

test("customer information UI is responsive and isolated from authoring controls", () => {
  assert.match(ui, /\.twin-flat-detail-card/);
  assert.match(ui, /\.twin-project-info-card/);
  assert.match(ui, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(info, /AutoBuild|CAD reconstruction|review queue/i);
});
