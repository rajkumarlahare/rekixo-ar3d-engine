import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Geo manifest uses provider-independent WGS84 + ENU metre placement", () => {
  const contract = read(
    "packages/contracts/src/geo-presentation-manifest-v1.ts",
  );
  const index = read("packages/contracts/src/index.ts");

  assert.match(contract, /GEO_COORDINATE_REFERENCE_SYSTEM = "WGS84"/);
  assert.match(contract, /GEO_LOCAL_FRAME = "ENU"/);
  assert.match(contract, /GEO_MODEL_UNITS = "m"/);
  assert.match(contract, /eastOffsetM: number/);
  assert.match(contract, /northOffsetM: number/);
  assert.match(contract, /verticalOffsetM: number/);
  assert.match(contract, /headingDeg: number/);
  assert.match(contract, /pitchDeg: number/);
  assert.match(contract, /rollDeg: number/);
  assert.match(contract, /scale: number/);
  assert.match(index, /export \* from "\.\/geo-presentation-manifest-v1"/);
});

test("Geo manifest pins an immutable Building release and explicit model anchor", () => {
  const contract = read(
    "packages/contracts/src/geo-presentation-manifest-v1.ts",
  );

  assert.match(contract, /sourceBuilding:/);
  assert.match(contract, /releaseId: string/);
  assert.match(contract, /manifestSha256: string/);
  assert.match(contract, /modelAnchor: GeoModelAnchorV1/);
  assert.match(contract, /localPositionM: GeoLocalPositionMetresV1/);
  assert.match(contract, /variant: "geo-optimized" \| "building"/);
});

test("Masterplan calibration is separate from rigid Building placement", () => {
  const contract = read(
    "packages/contracts/src/geo-presentation-manifest-v1.ts",
  );

  assert.match(contract, /must never warp or rebuild Building geometry/);
  assert.match(contract, /GeoMasterplanOverlayV1/);
  assert.match(contract, /sourceUv: \[number, number\]/);
  assert.match(contract, /algorithm: "homography-v1"/);
  assert.match(contract, /rmsErrorM: number/);
  assert.match(contract, /maxErrorM: number/);
  assert.match(contract, /status: GeoCalibrationStatus/);
});

test("Geo height behavior is explicit and independent of map-provider pixels", () => {
  const contract = read(
    "packages/contracts/src/geo-presentation-manifest-v1.ts",
  );

  assert.match(contract, /"ground-clamped"/);
  assert.match(contract, /"ground-relative"/);
  assert.match(contract, /"absolute"/);
  assert.match(contract, /map-provider\s*\n \* independent/);
  assert.doesNotMatch(contract, /googlePixel|mapPixel|screenPixel/i);
});
