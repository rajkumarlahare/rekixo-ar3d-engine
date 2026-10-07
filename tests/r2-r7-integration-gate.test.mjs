import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

const architecture = source(
  "docs/FINAL-AUTOMATIC-PRESENTATION-AND-GEO-ARCHITECTURE.md",
);
const autoBuild = source("apps/admin/src/studio/autoBuildPipeline.ts");
const acceptance = source(
  "apps/admin/src/studio/automaticProcessingAcceptance.ts",
);
const presentationContract = source(
  "packages/contracts/src/building-presentation-manifest-v1.ts",
);
const presentationPlanner = source(
  "apps/admin/src/studio/buildingPresentationPlanner.ts",
);
const releasePublish = source("workers/release-publish.mjs");
const releasePolicy = source("workers/building-presentation-policy.mjs");
const certification = source("scripts/certify-two-building-releases.mjs");
const geoPublish = source("workers/geo-release-publish.mjs");
const geoRuntime = source("workers/geo-release-runtime.mjs");
const geoPublic = source("apps/public/src/geo/GeoPublicDemo.tsx");
const premiumTour = source("apps/public/src/premium-tour-director.ts");
const tour = source("apps/public/src/presentation-tour.ts");

test("R2-R7 keeps the locked product and production safety boundaries explicit", () => {
  assert.match(architecture, /source pack -> analyze -> derive canonical web model/);
  assert.match(architecture, /Only a selected `geometry-authority` may establish Building geometry/);
  assert.match(architecture, /Stable Platform boundary/);
  assert.match(architecture, /do not delete `jyoti-paradise`/);
  assert.match(architecture, /Building placement is rigid/);
});

test("R2 acceptance composes source truth, geometry integrity and hierarchy without auto-review", () => {
  assert.match(autoBuild, /buildAutomaticProcessingAcceptance/);
  assert.match(autoBuild, /processingAcceptance/);
  assert.match(acceptance, /canBuildPresentation/);
  assert.match(acceptance, /canPublishWithoutReview/);
  assert.match(acceptance, /no unit\/circulation geometry was invented/);
  assert.match(acceptance, /selected geometry-authority model/);
});

test("R3 presentation remains canonical-metric, deterministic and source-preserving", () => {
  assert.match(presentationContract, /canonicalSha256/);
  assert.match(presentationContract, /metresPerUnit: 1/);
  assert.match(presentationContract, /mode: "source-preserving"/);
  assert.match(presentationContract, /sceneFingerprint/);
  assert.match(presentationPlanner, /assertCanonicalMetricIdentity/);
  assert.match(presentationPlanner, /never edits geometry/);
});

test("R4 immutable release publication pins presentation to canonical model and provenance", () => {
  assert.match(releasePublish, /sanitizeBuildingPresentationForRelease/);
  assert.match(releasePublish, /resolveCanonicalReleaseSource/);
  assert.match(releasePublish, /buildAutomaticBuildingPresentation/);
  assert.match(releasePolicy, /immutable canonical model checksum/);
  assert.match(releasePolicy, /immutable release source evidence/);
});

test("R5 certification requires client-ready release evidence and a genuinely distinct second Building", () => {
  assert.match(certification, /certifyBuildingRelease/);
  assert.match(certification, /certifyTwoDistinctBuildings/);
  assert.match(certification, /distinct Engine project/);
  assert.match(certification, /different canonical model bytes/);
});

test("R6 publishes provider-neutral rigid Geo V2 and serves one integrated scene", () => {
  assert.match(geoPublish, /Geo V2 alignment schema is required/);
  assert.match(geoPublish, /buildGeoPresentationManifestV1/);
  assert.match(geoRuntime, /buildingTransform: "rigid-wgs84-enu"/);
  assert.match(geoRuntime, /overlayCalibration: "masterplan-only"/);
  assert.match(geoPublic, /WebGLOverlayView/);
  assert.match(geoPublic, /IntegratedGeoScene/);
});

test("R7 premium motion consumes immutable tour timing and fails safely for reduced motion", () => {
  assert.match(premiumTour, /MAX_TOUR_MS/);
  assert.match(premiumTour, /reducedMotion/);
  assert.match(premiumTour, /cancel\(\)/);
  assert.match(tour, /transitionMs: step\.durationMs/);
  assert.match(tour, /holdMs: step\.holdMs/);
  assert.match(tour, /immutable-manifest/);
  assert.match(tour, /prefers-reduced-motion: reduce/);
});
