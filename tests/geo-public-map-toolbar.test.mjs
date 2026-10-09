import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const geoApp = await readFile(new URL("../apps/public/src/geo/GeoPublicDemo.tsx", import.meta.url), "utf8");
const geoStyles = await readFile(new URL("../apps/public/src/geo/geo-public-demo.css", import.meta.url), "utf8");

test("Geo customer header keeps only the project logo, name, and subtitle", () => {
  const headerStart = geoApp.indexOf('<header className="jio-public-header">');
  const headerEnd = geoApp.indexOf("</header>", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, "Geo project header must exist");
  const header = geoApp.slice(headerStart, headerEnd);

  assert.match(header, /className="jio-public-branding"/);
  assert.match(header, /className="jio-public-project-logo"/);
  assert.match(header, /<h1>\{data\.project\.name\}<\/h1>/);
  assert.match(header, /data\.project\.location \|\| "Rekixo AR3D Engine"/);
  assert.doesNotMatch(header, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location|jio-public-header-actions/);
  assert.doesNotMatch(geoApp, /const mapsUrl\s*=/);
});

test("Geo map toolbar orders all camera views before the Building website link", () => {
  const toolbarStart = geoApp.indexOf('<nav className="geo-camera-toolbar"');
  const toolbarEnd = geoApp.indexOf("</nav>", toolbarStart);
  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, "Geo map toolbar must exist");
  const toolbar = geoApp.slice(toolbarStart, toolbarEnd);
  const declaredViews = geoApp.slice(geoApp.indexOf("const GEO_CAMERA_VIEWS"), geoApp.indexOf("let mapsPromise"));
  const labels = ["Overview", "Front", "Corner", "Entry view", "Aerial"];
  let previous = -1;
  for (const label of labels) {
    const position = declaredViews.indexOf(`label: "${label}"`);
    assert.ok(position > previous, `${label} should retain the requested camera order`);
    previous = position;
  }

  assert.ok(toolbar.indexOf("{GEO_CAMERA_VIEWS.map") < toolbar.indexOf('className="geo-building-link"'));
  assert.match(toolbar, /Building <span aria-hidden="true">↗<\/span>/);
  assert.doesNotMatch(geoApp.slice(geoApp.indexOf('<nav className="geo-camera-toolbar"') - 35, geoApp.indexOf('<nav className="geo-camera-toolbar"')), /!failure/);
  assert.ok(toolbar.includes('href={`/3Dprojects/${encodeURIComponent(data.project.slug)}`}'));
  assert.match(toolbar, /target="_blank"/);
  assert.match(toolbar, /rel="noopener noreferrer"/);
  assert.ok(toolbar.includes('aria-label={`Open ${data.project.name} building website in a new tab`}'));
  assert.doesNotMatch(toolbar, /Open location|Google Maps/);
});

test("Geo controls stay visible in a normal viewport, compact and anchored top-right", () => {
  const toolbarRule = geoStyles.match(/^\.geo-camera-toolbar\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
  assert.match(toolbarRule, /top: 12px/);
  assert.match(toolbarRule, /right: 12px/);
  assert.match(toolbarRule, /z-index: 10000 !important/);
  assert.match(toolbarRule, /display: flex !important/);
  assert.match(toolbarRule, /visibility: visible !important/);
  assert.match(geoStyles, /\.geo-integrated-scene > \.geo-camera-toolbar\s*\{[\s\S]*z-index:\s*2147483000 !important/);
  assert.match(toolbarRule, /left: auto/);
  assert.match(toolbarRule, /flex-wrap: nowrap/);
  assert.match(toolbarRule, /backdrop-filter: blur\(14px\)/);
  assert.match(toolbarRule, /background: rgba\(8, 22, 32, \.82\)/);
  assert.match(geoStyles, /\.geo-integrated-scene > \.geo-camera-toolbar\s*\{[\s\S]*z-index:\s*2147483000 !important/);
  assert.match(geoStyles, /\.geo-integrated-map\s*\{\s*z-index:\s*0;[\s\S]*isolation:\s*isolate;/);
  assert.match(geoStyles, /\.jio-public-header\s*\{[\s\S]*border:\s*0 !important;[\s\S]*background:\s*transparent !important;/);
  assert.match(geoStyles, /\.jio-public-header::before,\s*\.jio-public-header::after\s*\{\s*display:\s*none !important;/);
  assert.match(geoStyles, /\.geo-integrated-scene\s*\{[\s\S]*isolation:\s*isolate;/);
  assert.match(geoStyles, /@media \(max-width:\s*1100px\)[\s\S]*?\.geo-camera-toolbar\s*\{\s*top:\s*12px;/);
  assert.match(geoStyles, /@media \(max-width:\s*640px\)[\s\S]*?\.geo-camera-toolbar\s*\{[\s\S]*?top:\s*12px;[\s\S]*?left:\s*auto;/);
  assert.match(geoStyles, /\.geo-camera-toolbar button,\s*\.geo-building-link/);
  assert.match(geoStyles, /min-height: 30px/);
});
