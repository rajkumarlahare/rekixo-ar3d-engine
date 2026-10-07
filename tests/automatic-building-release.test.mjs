import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomaticBuildingPresentation,
  gltfSceneBounds,
} from "../workers/automatic-building-release.mjs";
import { sanitizeBuildingPresentationForRelease } from "../workers/building-presentation-policy.mjs";

const MODEL_SHA = "a".repeat(64);

function gltfWithNode(node) {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ ...node, mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [2, 3, 4] }],
  };
}

test("canonical GLB presentation bounds honor node translation", () => {
  const bounds = gltfSceneBounds(
    gltfWithNode({ translation: [10, 5, -2] }),
  );
  assert.deepEqual(bounds, {
    min: { x: 10, y: 5, z: -2 },
    max: { x: 12, y: 8, z: 2 },
  });
});

test("canonical GLB presentation bounds honor hierarchy, scale and rotation", () => {
  const angle = Math.PI / 4;
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { translation: [5, 0, 0], children: [1] },
      {
        mesh: 0,
        scale: [2, 1, 1],
        rotation: [0, Math.sin(angle), 0, Math.cos(angle)],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [1, 1, 1] }],
  };
  const bounds = gltfSceneBounds(gltf);
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.min.x - 5) < 1e-9);
  assert.ok(Math.abs(bounds.max.x - 6) < 1e-9);
  assert.ok(Math.abs(bounds.min.y) < 1e-9);
  assert.ok(Math.abs(bounds.max.y - 1) < 1e-9);
  assert.ok(Math.abs(bounds.min.z + 2) < 1e-9);
  assert.ok(Math.abs(bounds.max.z) < 1e-9);
});

test("canonical GLB presentation bounds fail closed without accessor min/max", () => {
  const gltf = gltfWithNode({});
  delete gltf.accessors[0].max;
  assert.equal(gltfSceneBounds(gltf), null);
});

test("automatic Building presentation is release-valid and source-preserving", async () => {
  const sourceEvidence = {
    sourcePackSourceIds: ["source-dwg", "source-fbx"],
    sourceClaimIds: ["claim-room-101"],
  };
  const canonical = {
    modelArtifact: { sha256: MODEL_SHA },
    bounds: {
      min: { x: -12, y: 0, z: -8 },
      max: { x: 12, y: 28, z: 8 },
    },
  };
  const draft = {
    scene: {
      floors: [
        { id: "floor_0", name: "Ground", elevation: 0 },
        { id: "floor_1", name: "Floor 1", elevation: 3.2 },
      ],
      rooms: [
        {
          id: "room_101_living",
          floorId: "floor_1",
          name: "Living",
          unit: "101",
          sourcePackSourceId: "source-dwg",
          sourceClaimIds: ["claim-room-101"],
          verified: false,
        },
      ],
      openings: [
        {
          id: "door_101",
          floorId: "floor_1",
          kind: "door",
          roomIds: ["room_101_living", "room_101_bed"],
          reviewed: true,
        },
      ],
      siteElements: [
        {
          id: "stair_1",
          kind: "stair",
          reviewed: true,
          origin: "model-cad-auto",
        },
      ],
      appearance: {
        exposure: 0.95,
        sunIntensity: 2.4,
        hemisphereIntensity: 1.5,
        background: "#dbe3e7",
        referenceVisual: true,
        nightMode: false,
      },
      referenceImageEvidence: {
        lightingMood: "evening",
        confidence: 0.9,
      },
      materialOverrides: [
        {
          materialName: "Facade Stone",
          baseColor: "#c7b8a5",
          roughness: 0.62,
        },
      ],
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 15 },
    },
  };

  const presentation = await buildAutomaticBuildingPresentation({
    canonical,
    draft,
    sourceEvidence,
  });

  assert.equal(presentation.model.canonicalSha256, MODEL_SHA);
  assert.equal(presentation.model.metresPerUnit, 1);
  assert.equal(presentation.hierarchy.floorCount, 2);
  assert.equal(presentation.hierarchy.unitCount, 1);
  assert.equal(presentation.hierarchy.circulationCoreCount, 1);
  assert.equal(presentation.appearance.mood, "evening");
  assert.equal(presentation.environment.mode, "source-backed");
  assert.equal(presentation.environment.genericDressing, false);
  assert.equal(presentation.materials.overrides[0].source, "operator");
  assert.deepEqual(
    presentation.cameras.shots.map((shot) => shot.kind),
    ["hero", "front", "corner", "entrance", "aerial"],
  );
  assert.equal(presentation.interactions.floorExplorer, true);
  assert.equal(presentation.interactions.walkthrough, true);
  assert.match(presentation.provenance.sceneFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(presentation.provenance.sourcePackSourceIds, [
    "source-dwg",
    "source-fbx",
  ]);

  assert.doesNotThrow(() =>
    sanitizeBuildingPresentationForRelease(presentation, {
      modelSha256: MODEL_SHA,
      sourceEvidence,
    }),
  );
});
