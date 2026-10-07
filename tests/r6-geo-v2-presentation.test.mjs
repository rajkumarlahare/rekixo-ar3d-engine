import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const policySource = fs.readFileSync("workers/geo-presentation-policy.mjs", "utf8");
const policy = await import(
  "data:text/javascript;base64," + Buffer.from(policySource).toString("base64")
);

function manifest() {
  return {
    format: "rekixo.geo-presentation",
    version: 1,
    release: {
      id: "geo_release_123",
      experienceId: "experience_123",
      projectId: "project_123",
      projectSlug: "garden-heights",
      version: 2,
      sourceDraftRevision: 4,
      createdAt: "2026-10-07T00:00:00.000Z",
    },
    project: {
      id: "project_123",
      slug: "garden-heights",
      name: "Garden Heights",
    },
    sourceBuilding: {
      releaseId: "release_building_2",
      version: 2,
      manifestSha256: "a".repeat(64),
    },
    model: {
      id: "model_main",
      url: "/3Dprojects/api/releases/release_building_2/models/model_main/model.glb?v=2",
      mimeType: "model/gltf-binary",
      sha256: "b".repeat(64),
      variant: "building",
    },
    modelAnchor: {
      id: "anchor_entrance",
      name: "Main entrance",
      kind: "entrance",
      localPositionM: { x: 3.5, y: 0, z: -8.25 },
    },
    placement: {
      coordinateReferenceSystem: "WGS84",
      localFrame: "ENU",
      units: "m",
      anchor: { longitude: 77.391, latitude: 28.535 },
      heightMode: "ground-relative",
      eastOffsetM: 1.2,
      northOffsetM: -0.7,
      verticalOffsetM: 0.15,
      headingDeg: 33,
      pitchDeg: 0,
      rollDeg: 0,
      scale: 1,
    },
    display: {
      showMasterplanByDefault: true,
      showBoundaryByDefault: true,
      showRoadsByDefault: true,
      showLabelsByDefault: true,
    },
  };
}

test("R6 Geo V2 manifest requires WGS84 ENU rigid placement and explicit model anchor", () => {
  assert.doesNotThrow(() => policy.assertGeoPresentationManifestV1(manifest()));

  const missingAnchor = manifest();
  delete missingAnchor.modelAnchor;
  assert.throws(
    () => policy.assertGeoPresentationManifestV1(missingAnchor),
    /model anchor/i,
  );

  const nonUniform = manifest();
  nonUniform.placement.scale = [1, 1.02, 1];
  assert.throws(
    () => policy.assertGeoPresentationManifestV1(nonUniform),
    /rigid alignment/i,
  );
});

test("R6 masterplan homography is verified overlay evidence and never Building deformation", () => {
  const value = manifest();
  value.masterplanOverlay = {
    assetKey: "projects/garden-heights/media/masterplan.png",
    sourceSha256: "c".repeat(64),
    opacity: 0.7,
    controlPoints: [
      { id: "cp1", sourceUv: [0, 0], world: { longitude: 77.39, latitude: 28.53 } },
      { id: "cp2", sourceUv: [1, 0], world: { longitude: 77.40, latitude: 28.53 } },
      { id: "cp3", sourceUv: [1, 1], world: { longitude: 77.40, latitude: 28.54 } },
      { id: "cp4", sourceUv: [0, 1], world: { longitude: 77.39, latitude: 28.54 } },
    ],
    calibration: {
      algorithm: "homography-v1",
      pointCount: 4,
      rmsErrorM: 0.42,
      maxErrorM: 0.81,
      worstControlPointId: "cp3",
      status: "verified",
    },
  };
  assert.doesNotThrow(() => policy.assertGeoPresentationManifestV1(value));
  assert.match(policySource, /Building remains rigid; homography is overlay-only/);
  assert.doesNotMatch(policySource, /matrix3d|shear|non-uniform/i);
});

test("R6 publishing is V2-only while runtime preserves immutable legacy reads", () => {
  const publisher = fs.readFileSync("workers/geo-release-publish.mjs", "utf8");
  const runtime = fs.readFileSync("workers/geo-release-runtime.mjs", "utf8");
  assert.match(publisher, /Geo V2 alignment schema is required/);
  assert.match(publisher, /buildGeoPresentationManifestV1/);
  assert.match(runtime, /rekixo\.geo-presentation/);
  assert.match(runtime, /rekixo-geo-release/);
  assert.match(runtime, /buildingTransform: "rigid-wgs84-enu"/);
  assert.match(runtime, /overlayCalibration: "masterplan-only"/);
});

test("R6 public experience is one integrated WebGL map scene, not split map/model cards", () => {
  const publicGeo = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
  assert.match(publicGeo, /WebGLOverlayView/);
  assert.match(publicGeo, /applyRigidBuildingPlacement/);
  assert.match(publicGeo, /IntegratedGeoScene/);
  assert.doesNotMatch(publicGeo, /jio-public-grid/);
  assert.doesNotMatch(publicGeo, /Satellite anchor[\s\S]*Live model preview/);
});

test("R6 admin authoring requires explicit canonical model anchor before verify", () => {
  const api = fs.readFileSync("workers/geo-v2-admin.mjs", "utf8");
  const mapper = fs.readFileSync("apps/admin/src/geo/GeoMapper3DV2.tsx", "utf8");
  assert.match(api, /source_building_release_version/);
  assert.match(api, /model_anchor_id/);
  assert.match(api, /Same-origin request required/);
  assert.match(mapper, /Exact Building-local model anchor/);
  assert.match(mapper, /Verify Current Preview/);
  assert.match(mapper, /canonical metre/i);
});

test("R6 Admin Geo V2 uses one same-map WebGL Building preview and fail-closed verification", () => {
  const mapper = fs.readFileSync("apps/admin/src/geo/GeoMapper3DV2.tsx", "utf8");
  const integrated = fs.readFileSync("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx", "utf8");
  const publicTransform = fs.readFileSync("apps/public/src/geo/geoRigidTransform.ts", "utf8");
  const sharedTransform = fs.readFileSync("packages/engine-core/src/geo-rigid-placement.ts", "utf8");

  assert.match(mapper, /GeoIntegratedAuthoringMap/);
  assert.doesNotMatch(mapper, /GeoModelPreview/);
  assert.match(integrated, /WebGLOverlayView/);
  assert.match(integrated, /buildGeoRigidPlacementPlan/);
  assert.match(publicTransform, /buildGeoRigidPlacementPlan/);
  assert.match(sharedTransform, /uniform scale/i);
  assert.match(mapper, /draftMatchesForm/);
  assert.match(mapper, /previewState !== "ready"/);
  assert.match(mapper, /verificationBlocker/);
  assert.match(mapper, /configuredMapsApiKey/);
  assert.match(mapper, /Current map placement ko Save Geo V2 Draft/);
});
