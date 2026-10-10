import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicApp = await readFile(new URL("../apps/public/src/main.tsx", import.meta.url), "utf8");
const viewer = await readFile(new URL("../apps/public/src/viewer/Viewer3D.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../apps/public/src/styles.css", import.meta.url), "utf8");

test("customer Building page keeps only its compact brand header and primary 3D viewer", () => {
  const start = publicApp.indexOf("function ProjectNavigation(");
  const end = publicApp.indexOf("\nfunction unitNumberForFloor", start);
  assert.ok(start >= 0 && end > start, "ProjectNavigation must exist");
  const projectNavigation = publicApp.slice(start, end);

  assert.match(projectNavigation, /<Viewer3D/);
  assert.match(projectNavigation, /projectLocation=\{project\.location\}/);
  assert.doesNotMatch(projectNavigation, /project-overview|BuildingDetails|Project gallery|PROJECT OVERVIEW|client-hero-overlay|EXPLORE THE BUILDING/);
  assert.match(publicApp, /client-showcase--viewer-only/);
  assert.match(publicApp, /project-header--viewer-only/);
  assert.doesNotMatch(publicApp, /<nav[^>]*className="module-nav"/);
  assert.doesNotMatch(publicApp, /<footer>/);
});

test("the viewer shows a Location-only link while retaining the configured Google Maps destination", () => {
  assert.match(viewer, /projectLocation\?: string/);
  assert.match(viewer, /allowWalkControls && !clientPresentation/);
  assert.match(viewer, /allowInteriorControls && !clientPresentation/);
  assert.match(viewer, /allowInteriorControls && !clientPresentation && <div className="viewer-floor-controls"/);
  assert.match(viewer, /className="client-camera-views"/);
  assert.match(viewer, /className="client-camera-location"/);
  assert.match(viewer, /href=\{\`https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=\$\{encodeURIComponent\(projectLocation\)\}\`\}/);
  assert.match(viewer, /aria-label=\{`Open \$\{projectLocation\} in Google Maps`\}/);
  assert.match(viewer, /<span>Location<\/span>/);
  assert.doesNotMatch(viewer, /<strong>\{projectLocation\}<\/strong>/);
  assert.doesNotMatch(styles, /\.client-camera-location > strong/);
  assert.match(viewer, /\["hero", "front", "corner", "entrance", "aerial"\] as ExteriorView\[\]/);
  for (const label of ["Overview", "Entry view", "Location"]) {
    assert.ok(viewer.includes(label), `Expected camera control label ${label}`);
  }
});

test("viewer-only Building page fits its complete header and 3D controls inside the viewport", () => {
  assert.match(styles, /html:has\(main\.client-showcase--viewer-only\)[\s\S]*body:has\(main\.client-showcase--viewer-only\)\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(styles, /\.client-showcase--viewer-only\s*\{[\s\S]*height:\s*100dvh;[\s\S]*min-height:\s*0 !important;[\s\S]*overflow:\s*hidden/);
  assert.match(styles, /\.client-showcase--viewer-only \.module-stage\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0/);
  assert.match(styles, /\.client-showcase--viewer-only \.viewer-section\s*\{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0/);
  assert.match(styles, /\.client-showcase--viewer-only \.viewer-shell:not\(:fullscreen\)\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0/);
  assert.match(styles, /\.project-header--viewer-only/);
  assert.doesNotMatch(styles, /\.client-hero-overlay|\.client-hero-kicker/);
  assert.match(styles, /\.client-camera-location/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /@media \(max-height: 520px\)/);
});


test("Building customer header uses the configured project location as subtitle", () => {
  assert.match(publicApp, /experience\.project\.location \|\| \(branding\?\.logoUrl/);
  assert.match(styles, /main\.client-showcase--viewer-only \.project-header--viewer-only \.brand small\s*\{[\s\S]*display:\s*block !important/);
});

test("Building customer content starts at the top and the viewer fills only the remaining viewport", () => {
  assert.match(styles, /main\.client-showcase--viewer-only\.experience\s*\{[\s\S]*justify-content:\s*flex-start;[\s\S]*height:\s*100dvh;[\s\S]*padding:\s*5px 0 6px !important/);
  assert.match(styles, /main\.client-showcase--viewer-only \.module-stage\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*min-height:\s*0/);
  assert.match(styles, /main\.client-showcase--viewer-only \.viewer-section\s*\{[\s\S]*flex:\s*1 1 0;[\s\S]*margin:\s*0/);
});

test("Building customer top action buttons center their labels consistently on mobile", () => {
  assert.match(styles, /main\.client-showcase--viewer-only \.viewer-actions \.viewer-action\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;[\s\S]*line-height:\s*1\.1/);
  assert.match(styles, /main\.client-showcase--viewer-only \.viewer-actions \.viewer-action,[\s\S]*\.viewer-action:first-child\s*\{[\s\S]*display:\s*inline-flex !important/);
});


test("customer Building floor isolation waits for source-backed model geometry", () => {
  assert.match(publicApp, /configuredFloorIdsOf\(floorSettings\)/);
  assert.doesNotMatch(publicApp, /DEFAULT_CLIENT_FLOORS/);
  assert.match(viewer, /deriveFloorGeometryFromModel\(\{/);
  assert.match(viewer, /clientFloorControlsReady && clientFloorIds\.length > 0/);
  assert.match(viewer, /showClientFloorControls=\{true\}|showClientFloorControls\s*\n/);
  assert.match(viewer, /aria-label="Select building floor"/);
  assert.match(viewer, /aria-label="Show roof only"/);
  assert.match(viewer, /clientFloorViewRef\.current\?\.\("roof"\)/);
  assert.ok(!publicApp.includes("const DEFAULT_CLIENT_FLOORS = [0, 1, 2, 3, 4, 5];"));
});

test("floor selection clips to configured level geometry and frames it from above", () => {
  assert.match(viewer, /renderer\.clippingPlanes = \[/);
  assert.match(viewer, /floorGeometryFor\(resolvedFloorGeometry, selection\)/);
  assert.match(viewer, /floorFocusElevation\(level\)/);
  assert.match(viewer, /const fov = 34/);
  assert.match(viewer, /duration: 750/);
  assert.match(viewer, /clientFloorViewRef\.current = \(selection\)/);
  assert.match(viewer, /title="Top-down view of the complete model; roof is not isolated as a separate floor"/);
});

test("customer exterior camera and reset controls always exit floor isolation", () => {
  assert.match(viewer, /floorRef\.current\?\.\(null\);[\s\S]*setSelectedFloor\(null\);[\s\S]*setClientFloorSelection\(null\);[\s\S]*exteriorViewRef\.current\?\.\(view\)/);
  assert.match(viewer, /if \(clientPresentation && exteriorViewRef\.current\) \{[\s\S]*applyFloor\(null\);[\s\S]*setClientFloorSelection\(null\)/);
});

test("customer floor strip stays usable on desktop, mobile and short viewports", () => {
  assert.match(styles, /\.client-floor-controls\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*10px/);
  assert.match(styles, /\.client-floor-controls\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /@media \(max-width: 700px\)\s*\{[\s\S]*\.client-floor-controls\s*\{[\s\S]*top:\s*51px/);
  assert.match(styles, /@media \(max-height: 520px\)\s*\{[\s\S]*\.client-floor-controls\s*\{[\s\S]*top:\s*46px/);
});

test("customer-facing Building viewer does not show instructional gesture footer", () => {
  assert.match(viewer, /!compactUi && !clientPresentation && <div className="viewer-help"/);
  assert.match(viewer, /Drag to rotate · Two-finger\/secondary drag to pan · Pinch or wheel to zoom/);
});
