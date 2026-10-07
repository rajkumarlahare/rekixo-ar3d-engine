import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "packages/contracts/src/building-presentation-manifest-v1.ts",
  "utf8",
);

async function loadContract() {
  const result = ts.transpileModule(source, {
    fileName: "building-presentation-manifest-v1.ts",
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

function manifest() {
  const sha = "a".repeat(64);
  return {
    format: "rekixo-building-presentation",
    version: 1,
    model: {
      canonicalSha256: sha,
      metresPerUnit: 1,
      bounds: {
        min: { x: -10, y: 0, z: -8 },
        max: { x: 10, y: 28, z: 8 },
      },
    },
    hierarchy: {
      floorCount: 8,
      unitCount: 24,
      circulationCoreCount: 2,
    },
    appearance: {
      mood: "source-reference",
      exposure: 1,
      sunIntensity: 3.2,
      hemisphereIntensity: 2.8,
      background: "#dbe3e7",
      referenceVisual: true,
    },
    materials: {
      mode: "source-preserving",
      overrides: [
        {
          materialName: "Facade Stone",
          baseColor: "#c8b79f",
          roughness: 0.65,
          source: "source-recovered",
        },
      ],
    },
    environment: {
      mode: "source-backed",
      sourceBacked: true,
      genericDressing: false,
    },
    cameras: {
      defaultShotId: "hero",
      shots: [
        {
          id: "hero",
          kind: "hero",
          position: { x: 32, y: 18, z: 32 },
          target: { x: 0, y: 13, z: 0 },
          fov: 42,
        },
      ],
    },
    tour: {
      enabled: true,
      steps: [{ shotId: "hero", durationMs: 2200, holdMs: 900 }],
    },
    interactions: {
      orbit: true,
      floorExplorer: true,
      walkthrough: true,
    },
    provenance: {
      sceneFingerprint: "b".repeat(64),
      sourcePackSourceIds: ["source-1"],
      sourceClaimIds: ["claim-1"],
    },
  };
}

test("Building Presentation Manifest V1 accepts bounded canonical presentation state", async () => {
  const { assertBuildingPresentationManifestV1 } = await loadContract();
  const value = manifest();
  assert.doesNotThrow(() => assertBuildingPresentationManifestV1(value));
});

test("Building Presentation Manifest V1 fails closed on non-metric or implausible model bounds", async () => {
  const { assertBuildingPresentationManifestV1 } = await loadContract();
  const nonMetric = manifest();
  nonMetric.model.metresPerUnit = 0.01;
  assert.throws(
    () => assertBuildingPresentationManifestV1(nonMetric),
    /canonical metric model truth/,
  );

  const huge = manifest();
  huge.model.bounds.max.y = 5000;
  assert.throws(() => assertBuildingPresentationManifestV1(huge), /canonical metres/);
});

test("Building Presentation Manifest V1 keeps material, environment, camera and tour state bounded", async () => {
  const { assertBuildingPresentationManifestV1 } = await loadContract();

  const duplicateMaterial = manifest();
  duplicateMaterial.materials.overrides.push({
    ...duplicateMaterial.materials.overrides[0],
  });
  assert.throws(
    () => assertBuildingPresentationManifestV1(duplicateMaterial),
    /Duplicate Building material override/,
  );

  const unsafeEnvironment = manifest();
  unsafeEnvironment.environment.mode = "source-backed";
  unsafeEnvironment.environment.sourceBacked = false;
  assert.throws(
    () => assertBuildingPresentationManifestV1(unsafeEnvironment),
    /environment policy/,
  );

  const missingShot = manifest();
  missingShot.tour.steps[0].shotId = "missing";
  assert.throws(
    () => assertBuildingPresentationManifestV1(missingShot),
    /tour step/,
  );
});

test("Building Presentation Manifest V1 pins provenance and rejects duplicate source identities", async () => {
  const { assertBuildingPresentationManifestV1 } = await loadContract();
  const value = manifest();
  value.provenance.sourcePackSourceIds.push("source-1");
  assert.throws(
    () => assertBuildingPresentationManifestV1(value),
    /presentation provenance/,
  );
});
