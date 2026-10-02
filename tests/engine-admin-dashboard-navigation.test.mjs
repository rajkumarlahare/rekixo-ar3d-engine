import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine home exposes a clear project workflow and primary destinations", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(dashboard, /Project se live 3D tak sab ek jagah/);
  assert.match(dashboard, />Projects</);
  assert.match(dashboard, />Design Studio</);
  assert.match(dashboard, />3D Jio Mapper</);
  assert.match(dashboard, /\+ Create project/);
  assert.match(dashboard, /Create & open Studio/);
  assert.match(dashboard, /Place on map/);
  assert.match(dashboard, /Open live/);
});

test("Engine project context is carried from dashboard into Studio and 3D Jio Mapper", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const geo = read("apps/admin/src/geo/GeoMapper3D.tsx");

  assert.match(dashboard, /projectUrl\("studio", selectedSlug\)/);
  assert.match(dashboard, /projectUrl\("geo-mapper", selectedSlug\)/);
  assert.match(dashboard, /\?project=\$\{encodeURIComponent\(slug\)\}/);
  assert.match(studio, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(studio, /requestedCloudProjectRef/);
  assert.match(studio, /openCloudProject\(requested\)/);
  assert.match(geo, /\/3Dprojects\/studio\?project=/);
});

test("Engine home creates isolated projects through existing cloud contract", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(dashboard, /newProject\(name\)/);
  assert.match(dashboard, /projectSlug\(project\)/);
  assert.match(dashboard, /await ensureProject\(project\)/);
  assert.match(dashboard, /window\.location\.assign/);
  assert.doesNotMatch(dashboard, /DELETE FROM|DROP TABLE|geo_placements_3d/);
});

test("Admin router keeps existing Studio, Jio Mapper, login and showcase routes", () => {
  const main = read("apps/admin/src/main.tsx");
  assert.match(main, /\/3Dprojects\/studio/);
  assert.match(main, /\/3Dprojects\/geo-mapper/);
  assert.match(main, /\/3Dprojects\/login/);
  assert.match(main, /\/3Dprojects\/showcase\//);
  assert.match(main, /<EngineDashboard \/>/);
});
