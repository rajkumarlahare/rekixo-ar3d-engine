import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const rawSource = fs.readFileSync(
  "apps/admin/src/studio/buildingPresentationPlanner.ts",
  "utf8",
);

async function loadPlanner() {
  const executable = rawSource.replace(
    /import \{\s*DEFAULT_SCENE_APPEARANCE,[\s\S]*?\} from "\.\/domain";/,
    `const DEFAULT_SCENE_APPEARANCE = { exposure: 1, sunIntensity: 3.2, hemisphereIntensity: 2.8, background: "#dbe3e7", referenceVisual: true, nightMode: false };`,
  );
  const result = ts.transpileModule(executable, {
    fileName: "buildingPresentationPlanner.ts",
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")),
    [],
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}`
  );
}

function canonical() {
  return {
    format: "rekixo-canonical-model",
    version: 1,
    project: { id: "project-1", slug: "project-1" },
    sourcePack: { id: "pack-1", version: 1, manifestSha256: "a".repeat(64) },
    processor: { version: "4", execution: "serialized-node-fbx-v4-reviewed-scale" },
    geometryAuthority: {
      sourceFileId: "source-1",
      filename: "building.fbx",
      mediaType: "application/octet-stream",
      byteSize: 1000,
      sha256: "b".repeat(64),
    },
    model: {
      r2Key: "derived/project-1/model.glb",
      mimeType: "model/gltf-binary",
      byteSize: 900,
      sha256: "c".repeat(64),
      gltfVersion: "2.0",
      sourceGenerator: "test",
      coordinateSystem: { units: "metre", upAxis: "+Y", handedness: "right" },
      statistics: {
        sceneCount: 1,
        nodeCount: 10,
        meshCount: 5,
        materialCount: 3,
        textureCount: 2,
        imageCount: 2,
        animationCount: 0,
      },
      requiredExtensions: [],
      validation: {
        glbHeader: "validated",
        selfContained: true,
        sourceIdentity: "verified",
        geometryTransform: "unit-normalized",
        canonicalDimensionsM: [20, 28, 16],
        scaleSanity: "pass",
      },
    },
    processedAt: "2026-10-06T00:00:00Z",
  };
}

function input() {
  return {
    canonicalModel: canonical(),
    bounds: {
      min: { x: -10, y: 0, z: -8 },
      max: { x: 10, y: 28, z: 8 },
    },
    scene: {
      floors: [
        { id: "ground", name: "Ground", elevation: 0 },
        { id: "first", name: "First", elevation: 3 },
      ],
      rooms: [
        { id: "r1", name: "Living Room", floorId: "ground", unit: "Flat 1", x: 0, z: 0, width: 4, depth: 4, height: 3, color: "#fff", source: "source", verified: true },
        { id: "r2", name: "Lobby", floorId: "ground", unit: "", x: 4, z: 0, width: 2, depth: 4, height: 3, color: "#fff", source: "source", verified: true },
      ],
      furniture: [],
      openings: [
        { id: "d1", floorId: "ground", kind: "door", roomIds: ["r1", "r2"], x: 2, y: 0, z: 0, width: 1, height: 2.1, rotationY: 0, reviewed: true },
      ],
      siteElements: [
        { id: "road", kind: "road", x: 0, z: 12, width: 20, depth: 5, height: 0.1, rotation: 0, color: "#777777", reviewed: false, origin: "cad-auto" },
      ],
      scale: 1,
      appearance: {
        exposure: 1.1,
        sunIntensity: 2.7,
        hemisphereIntensity: 2.2,
        background: "#d0d7dd",
        referenceVisual: true,
        nightMode: false,
      },
      referenceImageEvidence: {
        assetId: "ref-1",
        sourceWidth: 100,
        sourceHeight: 100,
        sampledWidth: 50,
        sampledHeight: 50,
        renderedPalette: ["#aaaaaa"],
        averageLuminance: 0.4,
        warmFraction: 0.7,
        darkFraction: 0.2,
        highlightFraction: 0.1,
        averageSaturation: 0.3,
        verticalEdgeStrength: 0.4,
        horizontalEdgeStrength: 0.4,
        lightingMood: "evening",
        confidence: 0.9,
        sampleCount: 100,
      },
      materialOverrides: [
        { materialName: "Glass", roughness: 0.2, opacity: 0.8 },
      ],
      modelTransform: { x: 0, y: 0, z: 0, rotationY: Math.PI / 4 },
    },
    sceneFingerprint: "d".repeat(64),
    circulationHierarchy: {
      cores: [],
      counts: { sourceBackedElements: 2, boundCores: 1, reviewCores: 0, singletonEvidence: 0, ambiguousBindings: 0, unresolvedFloorEvidence: 0 },
      issues: [],
    },
    unitHierarchy: {
      units: [],
      counts: { sourceBackedUnits: 2, reviewUnits: 0, sourceBackedRooms: 4, unprovenUnitRooms: 0, circulationLinks: 2, unresolvedCirculationMembers: 0 },
      issues: [],
    },
    sourcePackSourceIds: ["source-2", "source-1", "source-1"],
    sourceClaimIds: ["claim-2", "claim-1"],
  };
}

test("R3 planner produces deterministic source-preserving presentation intelligence", async () => {
  const { buildBuildingPresentationManifestV1 } = await loadPlanner();
  const value = input();
  const first = buildBuildingPresentationManifestV1(value);
  const second = buildBuildingPresentationManifestV1(value);

  assert.deepEqual(second, first);
  assert.equal(first.model.metresPerUnit, 1);
  assert.equal(first.model.canonicalSha256, "c".repeat(64));
  assert.equal(first.appearance.mood, "evening");
  assert.equal(first.environment.mode, "source-backed");
  assert.equal(first.environment.genericDressing, false);
  assert.equal(first.cameras.shots.length, 5);
  assert.deepEqual(first.cameras.shots.map((shot) => shot.kind), ["hero", "front", "corner", "entrance", "aerial"]);
  assert.equal(first.interactions.floorExplorer, true);
  assert.equal(first.interactions.walkthrough, true);
  assert.deepEqual(first.provenance.sourcePackSourceIds, ["source-1", "source-2"]);
});

test("R3 planner preserves source scene and hierarchy inputs", async () => {
  const { buildBuildingPresentationManifestV1 } = await loadPlanner();
  const value = input();
  const before = JSON.stringify(value);
  buildBuildingPresentationManifestV1(value);
  assert.equal(JSON.stringify(value), before);
});

test("R3 planner fails closed when supplied bounds drift from canonical model dimensions", async () => {
  const { buildBuildingPresentationManifestV1 } = await loadPlanner();
  const value = input();
  value.bounds.max.x = 30;
  assert.throws(
    () => buildBuildingPresentationManifestV1(value),
    /bounds drift from canonical model dimensions/,
  );
});

test("R3 planner does not enable walkthrough without reviewed two-room door truth", async () => {
  const { buildBuildingPresentationManifestV1 } = await loadPlanner();
  const value = input();
  value.scene.openings[0].reviewed = false;
  const manifest = buildBuildingPresentationManifestV1(value);
  assert.equal(manifest.interactions.walkthrough, false);
});
