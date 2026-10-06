import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeBuildingPresentationForRelease } from "../workers/building-presentation-policy.mjs";
import {
  certifyBuildingRelease,
  certifyTwoDistinctBuildings,
} from "../scripts/certify-two-building-releases.mjs";

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const fingerprint = "c".repeat(64);

function presentation(sha, sourceId) {
  return {
    format: "rekixo-building-presentation",
    version: 1,
    model: {
      canonicalSha256: sha,
      metresPerUnit: 1,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 24, z: 18 } },
    },
    hierarchy: { floorCount: 7, unitCount: 24, circulationCoreCount: 2 },
    appearance: {
      mood: "evening",
      exposure: 0.9,
      sunIntensity: 1.7,
      hemisphereIntensity: 0.7,
      background: "#65798f",
      referenceVisual: true,
    },
    materials: { mode: "source-preserving", overrides: [] },
    environment: {
      mode: "presentation-default",
      sourceBacked: false,
      genericDressing: true,
    },
    cameras: {
      defaultShotId: "hero",
      shots: [
        { id: "hero", kind: "hero", position: { x: 40, y: 20, z: 35 }, target: { x: 15, y: 10, z: 9 }, fov: 42 },
        { id: "front", kind: "front", position: { x: 15, y: 10, z: 50 }, target: { x: 15, y: 10, z: 9 }, fov: 42 },
        { id: "aerial", kind: "aerial", position: { x: 45, y: 50, z: 42 }, target: { x: 15, y: 10, z: 9 }, fov: 42 },
      ],
    },
    tour: {
      enabled: true,
      steps: [
        { shotId: "hero", durationMs: 1800, holdMs: 500 },
        { shotId: "front", durationMs: 1600, holdMs: 400 },
        { shotId: "aerial", durationMs: 1800, holdMs: 500 },
      ],
    },
    interactions: { orbit: true, floorExplorer: true, walkthrough: true },
    provenance: {
      sceneFingerprint: fingerprint,
      sourcePackSourceIds: [sourceId],
      sourceClaimIds: [],
    },
  };
}

function release(slug, projectId, releaseId, sha, sourceId) {
  return {
    format: "rekixo-release-manifest",
    version: 1,
    release: {
      id: releaseId,
      projectId,
      projectSlug: slug,
      version: 1,
      createdAt: "2026-10-06T00:00:00.000Z",
    },
    project: { id: projectId, slug, name: slug, status: "published" },
    experience: {
      scenes: [],
      mediaFiles: [],
      model: {
        id: "building-model",
        projectId,
        name: "Building",
        version: 1,
        mimeType: "model/gltf-binary",
        releaseAssetId: `asset-${releaseId}`,
      },
      buildingPresentation: presentation(sha, sourceId),
    },
    sourceEvidence: { sourcePackSourceIds: [sourceId], sourceClaimIds: [] },
    assets: [
      {
        id: `asset-${releaseId}`,
        kind: "model",
        logicalId: "building-model",
        name: "Building",
        mimeType: "model/gltf-binary",
        byteSize: 1024,
        sha256: sha,
      },
    ],
  };
}

test("R4 release policy pins presentation to immutable model and source evidence", () => {
  const value = presentation(shaA, "source-a");
  const sanitized = sanitizeBuildingPresentationForRelease(value, {
    modelSha256: shaA,
    sourceEvidence: { sourcePackSourceIds: ["source-a"], sourceClaimIds: [] },
  });
  assert.deepEqual(sanitized, value);
  assert.notEqual(sanitized, value);

  assert.throws(
    () => sanitizeBuildingPresentationForRelease(value, {
      modelSha256: shaB,
      sourceEvidence: { sourcePackSourceIds: ["source-a"], sourceClaimIds: [] },
    }),
    /canonical model checksum/,
  );
  assert.throws(
    () => sanitizeBuildingPresentationForRelease(value, {
      modelSha256: shaA,
      sourceEvidence: { sourcePackSourceIds: ["other-source"], sourceClaimIds: [] },
    }),
    /provenance/,
  );
});

test("R5 certifies one client-ready Building release", () => {
  const report = certifyBuildingRelease(
    release("garden-heights", "project-a", "release-a", shaA, "source-a"),
  );
  assert.equal(report.slug, "garden-heights");
  assert.equal(report.cameraCount, 3);
  assert.equal(report.tourStepCount, 3);
});

test("R5 second-building gate requires a distinct project and canonical model", () => {
  const report = certifyTwoDistinctBuildings(
    release("garden-heights", "project-a", "release-a", shaA, "source-a"),
    release("river-view", "project-b", "release-b", shaB, "source-b"),
  );
  assert.equal(report.genericity, "passed");

  assert.throws(
    () => certifyTwoDistinctBuildings(
      release("garden-heights", "project-a", "release-a", shaA, "source-a"),
      release("garden-heights", "project-a", "release-b", shaB, "source-b"),
    ),
    /distinct Engine project/,
  );
  assert.throws(
    () => certifyTwoDistinctBuildings(
      release("garden-heights", "project-a", "release-a", shaA, "source-a"),
      release("river-view", "project-b", "release-b", shaA, "source-b"),
    ),
    /different canonical model bytes/,
  );
});
