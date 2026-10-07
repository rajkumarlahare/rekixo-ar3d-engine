import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const motionSource = fs.readFileSync(
  "apps/public/src/viewer/premiumPresentationMotion.ts",
  "utf8",
);
const directorSource = fs.readFileSync(
  "apps/public/src/premium-tour-director.ts",
  "utf8",
);
const tourSource = fs.readFileSync(
  "apps/public/src/presentation-tour.ts",
  "utf8",
);
const viewerSource = fs.readFileSync(
  "apps/public/src/viewer/Viewer3D.tsx",
  "utf8",
);

test("R7 ambient motion is deterministic and presentation-dressing-only", () => {
  assert.match(motionSource, /presentationOnly !== true/);
  assert.match(motionSource, /Site tree/);
  assert.match(motionSource, /Site plant/);
  assert.match(motionSource, /reducedMotion/);
  assert.match(motionSource, /baseRotationX/);
  assert.match(motionSource, /baseRotationZ/);
  assert.doesNotMatch(motionSource, /Math\.random/);
  assert.doesNotMatch(motionSource, /geometry\.(?:translate|scale|rotate)/);
});

test("R7 premium tour director bounds motion timing and is cancellable", () => {
  assert.match(directorSource, /MIN_TRANSITION_MS = 250/);
  assert.match(directorSource, /MAX_TRANSITION_MS = 10_000/);
  assert.match(directorSource, /MAX_TOUR_MS = 180_000/);
  assert.match(directorSource, /reducedMotion/);
  assert.match(directorSource, /window\.clearTimeout/);
  assert.match(directorSource, /generation/);
  assert.doesNotMatch(directorSource, /Math\.random/);
});

test("R7 guided tour consumes immutable manifest timing through one director", () => {
  assert.match(tourSource, /createPremiumTourDirector/);
  assert.match(tourSource, /transitionMs: step\.durationMs/);
  assert.match(tourSource, /holdMs: step\.holdMs/);
  assert.match(tourSource, /immutable-manifest/);
  assert.match(tourSource, /semantic-fallback/);
  assert.match(tourSource, /visibilitychange/);
  assert.match(tourSource, /prefers-reduced-motion: reduce/);
});

test("R7 preserves existing viewer reduced-motion camera and sky safety", () => {
  assert.match(viewerSource, /const reducedMotion = window\.matchMedia/);
  assert.match(viewerSource, /createExteriorSky\(reducedMotion\)/);
  assert.match(viewerSource, /if \(instant \|\| reducedMotion\)/);
  assert.match(viewerSource, /cameraTween/);
});
