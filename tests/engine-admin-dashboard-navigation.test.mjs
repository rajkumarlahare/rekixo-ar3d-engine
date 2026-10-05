import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine home exposes a Building-first project workflow and optional Experiences", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(dashboard, /Create → Design → Publish → Building Live/);
  assert.match(dashboard, />Projects</);
  assert.match(dashboard, /Design Studio/);
  assert.match(dashboard, /Experiences/);
  assert.match(dashboard, /Create 3D Project/);
  assert.match(dashboard, /Create New 3D Project/);
  assert.match(dashboard, /Create & open Studio/);
  assert.match(dashboard, /3D Building Website/);
  assert.match(dashboard, /\+ Add 3D Geo Experience/);
  assert.doesNotMatch(dashboard, /Create → Edit → Map → Live/);
});

test("Engine project context crosses the compatibility Studio URL into Automatic Engine and Geo Mapper", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  const main = read("apps/admin/src/main.tsx");
  const geo = read("apps/admin/src/geo/GeoMapper3D.tsx");

  assert.match(dashboard, /projectUrl\("studio", selectedSlug\)/);
  assert.match(dashboard, /projectUrl\("geo-mapper", selectedSlug\)/);
  assert.match(dashboard, /\?project=\$\{encodeURIComponent\(slug\)\}/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
  assert.match(main, /window\.location\.replace\(`\/3Dprojects\/source-pack\$\{window\.location\.search\}`\)/);
  assert.match(main, /\/3Dprojects\/source-pack/);
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

test("Admin router keeps Automatic Engine, compatibility Studio, Geo Mapper, login and showcase routes", () => {
  const main = read("apps/admin/src/main.tsx");
  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.match(main, /\/3Dprojects\/studio/);
  assert.match(main, /\/3Dprojects\/geo-mapper/);
  assert.match(main, /\/3Dprojects\/login/);
  assert.match(main, /\/3Dprojects\/showcase\//);
  assert.match(main, /<EngineDashboard \/>/);
  assert.match(main, /<SourcePackReview \/>/);
});

test("Engine Admin keeps the golden identity on surviving primary surfaces", () => {
  const dashboardCss = read("apps/admin/src/dashboard/engine-dashboard.css");
  const geoCss = read("apps/admin/src/geo/geo-mapper.css");
  const shared = read("apps/admin/src/styles.css");

  assert.match(dashboardCss, /--engine-gold: #f4b942/);
  assert.match(dashboardCss, /Golden Engine identity/);
  assert.match(geoCss, /--geo-gold: #f4b942/);
  assert.match(geoCss, /Golden 3D Jio Mapper identity/);
  assert.match(shared, /\.eyebrow \{\s*color: #f4b942/);
});

test("project creation explains Building-first delivery and keeps Geo optional", () => {
  const dashboard = read("apps/admin/src/dashboard/EngineDashboard.tsx");
  assert.match(dashboard, /Har Engine project ka primary deliverable standalone 3D Building Website hai/);
  assert.match(dashboard, /Naya project banane ke liye yahin click karein/);
  assert.match(dashboard, /Project create hone ke baad:/);
  assert.match(dashboard, /Design Studio open hoga/);
  assert.match(dashboard, /Building Website live hogi; Geo baad me optional add-on/);
});
