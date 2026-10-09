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
  assert.doesNotMatch(projectNavigation, /project-overview|BuildingDetails|Project gallery|PROJECT OVERVIEW/);
  assert.match(publicApp, /client-showcase--viewer-only/);
  assert.match(publicApp, /project-header--viewer-only/);
  assert.match(publicApp, /<nav hidden className="module-nav"/);
  assert.doesNotMatch(publicApp, /<footer>/);
});

test("the viewer exposes the configured project location beside its existing camera presets", () => {
  assert.match(viewer, /projectLocation\?: string/);
  assert.match(viewer, /allowWalkControls && !clientPresentation/);
  assert.match(viewer, /allowInteriorControls && !clientPresentation/);
  assert.match(viewer, /allowInteriorControls && !clientPresentation && <div className="viewer-floor-controls"/);
  assert.match(viewer, /className="client-camera-views"/);
  assert.match(viewer, /className="client-camera-location"/);
  assert.match(viewer, /<span>Location<\/span>/);
  assert.match(viewer, /Open \$\{projectLocation\} in Google Maps/);
  assert.match(viewer, /\["hero", "front", "corner", "entrance", "aerial"\] as ExteriorView\[\]/);
  for (const label of ["Overview", "Entry view", "Location"]) {
    assert.ok(viewer.includes(label), `Expected camera control label ${label}`);
  }
});

test("viewer-only page layout stays compact and responsive", () => {
  assert.match(styles, /height: min\\(calc\\(100dvh - 70px\\), 1000px\\)/);
  assert.match(styles, /height: calc\\(100dvh - 58px\\)/);
  assert.match(styles, /\.client-showcase--viewer-only/);
  assert.match(styles, /\.project-header--viewer-only/);
  assert.match(styles, /\.client-hero-overlay/);
  assert.match(styles, /\.client-camera-location/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});
