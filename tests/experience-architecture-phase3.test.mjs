import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 3 dashboard is Building-first and Geo is optional", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /Create → Design → Publish → Building Live/);
  assert.match(dashboard, /3D Building Website/);
  assert.match(dashboard, /PRIMARY PRODUCT/);
  assert.match(dashboard, /OPTIONAL ADD-ON/);
  assert.match(dashboard, /\+ Add 3D Geo Experience/);
  assert.match(dashboard, /Building Website uske bina bhi complete hai/);
  assert.doesNotMatch(dashboard, /Create → Edit → Map → Live/);
});

test("Geo Experience creation requires an active immutable Building release", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /releaseItems\.find\(\(release\) => release\.active\)/);
  assert.match(dashboard, /createGeoExperience\(selectedSlug, activeRelease\.id\)/);
  assert.match(dashboard, /Building release required/);
  assert.match(dashboard, /Publish Building first/);
  assert.match(
    dashboard,
    /3D Geo Experience add karne se pehle Building ko immutable release ke roop me publish karein/,
  );
});

test("Building and Geo expose independent canonical customer URLs", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /publicProjectPath\(status\.project\.slug\)/);
  assert.match(dashboard, /geoPublicProjectPath\(status\.project\.slug\)/);
  assert.match(dashboard, /Open Building Live/);
  assert.match(dashboard, /Open Geo Live/);
});

test("Geo source upgrades are visible but never automatic from the dashboard", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /geoNeedsSourceUpgrade/);
  assert.match(dashboard, /New Building v\$\{activeBuildingRelease\?\.version\} available — preview before upgrade/);
  assert.doesNotMatch(dashboard, /createGeoExperience\(selectedSlug, activeBuildingRelease\.id\)/);
});

test("dashboard loads Experience, release and Geo placement state through Engine-owned APIs", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const cloud = read("apps/admin/src/studio/cloud.ts");

  assert.match(dashboard, /experiences\(selectedSlug\)/);
  assert.match(dashboard, /releases\(selectedSlug\)/);
  assert.match(dashboard, /geoPlacement\(selectedSlug\)/);
  assert.match(cloud, /\/experiences/);
  assert.doesNotMatch(dashboard, /rekixo-ar3d-platform|tiyansh-production|tiyansh-gallery-production/);
});

test("Phase 3 UI styles preserve responsive two-card and one-card Experience layouts", () => {
  const css = read("apps/admin/src/dashboard/engine-dashboard.css");

  assert.match(css, /\.engine-experience-grid/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /\.engine-experience-grid \{\s*grid-template-columns: 1fr/);
});

test("project creation modal explains Geo as a later optional add-on", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");

  assert.match(dashboard, /Building design karke immutable release Publish karein/);
  assert.match(dashboard, /Geo baad me optional add-on ke roop me add karein/);
  assert.doesNotMatch(dashboard, /3D Jio Mapper me real location set karein/);
});
