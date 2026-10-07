import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const engineSource = fs.readFileSync(
  "packages/engine-core/src/geo-guided-rigid-alignment.ts",
  "utf8",
);
const mapperSource = fs.readFileSync("apps/admin/src/geo/GeoMapper3DV2.tsx", "utf8");
const mapSource = fs.readFileSync("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx", "utf8");
const panelSource = fs.readFileSync("apps/admin/src/geo/GeoGuidedRigidAlignment.tsx", "utf8");
const topReferenceSource = fs.readFileSync("apps/admin/src/geo/GeoBuildingTopReference.tsx", "utf8");

async function loadSolver() {
  const output = ts.transpileModule(engineSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const EARTH_RADIUS_M = 6378137;
const radians = Math.PI / 180;

function latLngFromEnu(origin, east, north) {
  const latitude = origin.latitude + (north / EARTH_RADIUS_M) / radians;
  const meanLatitude = (origin.latitude + latitude) * 0.5 * radians;
  const longitude = origin.longitude +
    (east / (EARTH_RADIUS_M * Math.max(1e-7, Math.cos(meanLatitude)))) / radians;
  return { latitude, longitude };
}

function targetFor(source, headingDeg, scale, eastOffsetM, northOffsetM, origin) {
  const sourceEast = source.x;
  const sourceNorth = -source.z;
  const theta = -headingDeg * radians;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const east = eastOffsetM + scale * (cos * sourceEast - sin * sourceNorth);
  const north = northOffsetM + scale * (sin * sourceEast + cos * sourceNorth);
  return latLngFromEnu(origin, east, north);
}

test("guided rigid solver recovers heading and ENU translation without warping Building geometry", async () => {
  const { solveGeoGuidedRigidAlignment } = await loadSolver();
  const origin = { latitude: 21.9948, longitude: 82.9545 };
  const sourcePoints = [
    { x: -8, y: 0, z: -12 },
    { x: 8, y: 0, z: -12 },
    { x: 8, y: 0, z: 12 },
    { x: -8, y: 0, z: 12 },
  ];
  const pairs = sourcePoints.map((source, index) => ({
    id: `P${index + 1}`,
    source,
    target: targetFor(source, 31.75, 1, 4.25, -2.5, origin),
  }));

  const solved = solveGeoGuidedRigidAlignment(
    origin,
    { x: 0, y: 0, z: 0 },
    pairs,
  );
  assert.equal(solved.scale, 1);
  assert.ok(Math.abs(solved.headingDeg - 31.75) < 1e-6, `${solved.headingDeg}`);
  assert.ok(Math.abs(solved.eastOffsetM - 4.25) < 1e-5, `${solved.eastOffsetM}`);
  assert.ok(Math.abs(solved.northOffsetM + 2.5) < 1e-5, `${solved.northOffsetM}`);
  assert.ok(solved.rmsErrorM < 1e-5, `${solved.rmsErrorM}`);
  assert.ok(solved.maxErrorM < 1e-5, `${solved.maxErrorM}`);
});

test("uniform scale is opt-in and constrained while diagnostics stay explicit", async () => {
  const { solveGeoGuidedRigidAlignment } = await loadSolver();
  const origin = { latitude: 21.9948, longitude: 82.9545 };
  const sourcePoints = [
    { x: -10, y: 0, z: -10 },
    { x: 10, y: 0, z: -10 },
    { x: 10, y: 0, z: 10 },
    { x: -10, y: 0, z: 10 },
  ];
  const pairs = sourcePoints.map((source, index) => ({
    id: `P${index + 1}`,
    source,
    target: targetFor(source, -12.5, 1.1, 3, 6, origin),
  }));

  const fixedScale = solveGeoGuidedRigidAlignment(origin, { x: 0, y: 0, z: 0 }, pairs);
  assert.equal(fixedScale.scale, 1);
  assert.ok(fixedScale.maxErrorM > 1);

  const solvedScale = solveGeoGuidedRigidAlignment(
    origin,
    { x: 0, y: 0, z: 0 },
    pairs,
    { allowScale: true },
  );
  assert.ok(Math.abs(solvedScale.scale - 1.1) < 1e-6, `${solvedScale.scale}`);
  assert.ok(Math.abs(solvedScale.headingDeg + 12.5) < 1e-6, `${solvedScale.headingDeg}`);
  assert.ok(solvedScale.maxErrorM < 1e-5, `${solvedScale.maxErrorM}`);
  assert.equal(solvedScale.pointCount, 4);
  assert.equal(solvedScale.points.length, 4);
});

test("guided authoring is four-point, fail-safe, map-capture aware, and never introduces Building homography", () => {
  assert.match(mapperSource, /GUIDED_POINT_IDS\s*=\s*\["P1",\s*"P2",\s*"P3",\s*"P4"\]/);
  assert.match(mapperSource, /Save Geo V2 Draft/);
  assert.match(panelSource, /Apply rigid solution to current form/);
  assert.match(panelSource, /RMS/);
  assert.match(panelSource, /Worst/);
  assert.match(panelSource, /coarse \? 1 : 0\.25/);
  assert.match(panelSource, /coarse \? 0\.1 : 0\.02/);
  assert.match(panelSource, /Allow uniform scale solve/);
  assert.match(topReferenceSource, /Raycaster/);
  assert.match(topReferenceSource, /screen right = \+X/);
  assert.match(mapSource, /if \(captureId\) \{\s*alignmentTargetCaptureRef\.current\(captureId, next\.lat, next\.lng\);\s*return;/s);
  assert.match(mapSource, /setDraggable\(!alignmentCaptureId\)/);
  assert.doesNotMatch(engineSource, /solveHomography|applyHomography/);
  assert.match(engineSource, /let scale = 1/);
});
