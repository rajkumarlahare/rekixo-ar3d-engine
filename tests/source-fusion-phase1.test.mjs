import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const sketchUrl = asUrl(
  compile("apps/admin/src/studio/sketchUpArchive.ts"),
);
const dwgUrl = asUrl(
  compile("apps/admin/src/studio/dwgEvidence.ts"),
);
const drsUrl = asUrl(
  compile("apps/admin/src/studio/drsInspector.ts"),
);
const conflictsUrl = asUrl(
  compile("apps/admin/src/studio/sourceConflicts.ts"),
);
const dwgNormalizedUrl = asUrl(
  compile("apps/admin/src/studio/dwgNormalized.ts"),
);
const sourceFusionCode = compile("apps/admin/src/studio/sourceFusion.ts")
  .replace(
    /from "\.\/sketchUpArchive"/,
    `from ${JSON.stringify(sketchUrl)}`,
  )
  .replace(
    /from "\.\/drsInspector"/,
    `from ${JSON.stringify(drsUrl)}`,
  )
  .replace(
    /from "\.\/dwgEvidence"/,
    `from ${JSON.stringify(dwgUrl)}`,
  )
  .replace(
    /from "\.\/dwgNormalized"/,
    `from ${JSON.stringify(dwgNormalizedUrl)}`,
  )
  .replace(
    /from "\.\/sourceConflicts"/,
    `from ${JSON.stringify(conflictsUrl)}`,
  );
const { buildSourceFusionReport } = await import(asUrl(sourceFusionCode));

function asset(id, name, text = "") {
  const blob = new Blob([text]);
  return {
    id,
    projectId: "project-1",
    name,
    type: "application/octet-stream",
    size: blob.size,
    hash: id.padEnd(64, "a").slice(0, 64),
    blob,
  };
}

test("source fusion keeps a six-file project generic and provenance-first", async () => {
  const files = [
    asset("fbx", "building.fbx"),
    asset("dwg", "architectural-plan.dwg"),
    asset("skb", "design-backup.skb"),
    asset("pdf", "brochure.pdf"),
    asset("jpg", "elevation.jpg"),
    asset("drs", "scene.drs", '{"texture":"materials/facade.jpg","model":"source/building.fbx"}'),
  ];
  const analysis = {
    createdAt: new Date().toISOString(),
    sources: [],
    modelAssetId: "fbx",
    modelName: "building.fbx",
    meshCount: 913,
    materialCount: 38,
    bounds: { min: [0, 0, 0], max: [40, 20, 30] },
    floorCandidates: [
      { elevation: 0, confidence: 0.9, evidenceCount: 12 },
      { elevation: 3, confidence: 0.88, evidenceCount: 11 },
    ],
    nodeAssignments: [],
    architecturalCandidates: [],
    cadAudits: [
      {
        assetId: "dwg",
        name: "architectural-plan.dwg",
        kind: "dwg",
        semanticReady: false,
        layerHints: [],
        note: "DWG requires controlled conversion.",
      },
    ],
    highConfidenceAssignments: 0,
    reviewAssignments: 0,
    commonAssignments: 0,
    externalTextureRefs: 2,
    matchedTextureRefs: 0,
    issues: [],
  };
  const report = await buildSourceFusionReport(
    files,
    analysis,
    [
      {
        assetId: "fbx",
        filename: "building.fbx",
        ascii: true,
        materialNames: ["Wall", "Glass"],
        externalTextureFiles: ["facade.jpg", "glass.jpg"],
        matchedTextureFiles: [],
        meshCount: 913,
      },
    ],
    [],
  );

  assert.equal(report.items.length, 6);
  assert.equal(report.readySources, 0);
  assert.equal(report.partialSources, 2);
  assert.equal(report.evidenceOnlySources, 2);
  assert.equal(report.needsConversionSources, 2);
  assert.ok(
    report.recommendedActions.some((item) =>
      item.includes("web GLB derivative"),
    ),
  );
  assert.ok(
    report.recommendedActions.some((item) =>
      item.includes("controlled DWG processor"),
    ),
  );
  assert.ok(
    report.facts.some(
      (entry) => entry.key === "model.mesh-count" && entry.value === 913,
    ),
  );
  const metadata = report.facts.find(
    (entry) => entry.key === "metadata.resource-refs",
  );
  assert.deepEqual(metadata?.value, [
    "materials/facade.jpg",
    "source/building.fbx",
  ]);
});

test("source fusion recognizes already-web-ready and structured inputs", async () => {
  const files = [
    asset("glb", "building.glb"),
    asset("dxf", "plan.dxf"),
    asset("csv", "rooms.csv"),
  ];
  const report = await buildSourceFusionReport(
    files,
    {
      createdAt: new Date().toISOString(),
      sources: [],
      modelAssetId: "glb",
      modelName: "building.glb",
      meshCount: 10,
      materialCount: 4,
      floorCandidates: [],
      nodeAssignments: [],
      architecturalCandidates: [],
      cadAudits: [
        {
          assetId: "dxf",
          name: "plan.dxf",
          kind: "dxf",
          semanticReady: true,
          layerHints: [
            { layer: "A-WALL", kind: "wall" },
            { layer: "A-DOOR", kind: "door" },
          ],
          note: "Readable ASCII DXF.",
        },
      ],
      highConfidenceAssignments: 0,
      reviewAssignments: 0,
      commonAssignments: 0,
      externalTextureRefs: 0,
      matchedTextureRefs: 0,
      issues: [],
    },
    [],
    [
      {
        key: "row-1",
        assetId: "csv",
        assetName: "rooms.csv",
        rowNumber: 2,
        floorLabel: "Ground",
        unit: "101",
        name: "Living",
        width: 4,
        depth: 3,
        sourceNote: "Measured",
        origin: "csv",
      },
    ],
  );

  assert.equal(report.readySources, 2);
  assert.equal(report.partialSources, 1);
  assert.ok(
    report.facts.some(
      (entry) =>
        entry.key === "cad.layer-hints" &&
        Array.isArray(entry.value) &&
        entry.value.length === 2,
    ),
  );
  assert.ok(
    report.facts.some(
      (entry) => entry.key === "room-sheet.rows" && entry.value === 1,
    ),
  );
  assert.ok(
    !report.recommendedActions.some((item) =>
      item.includes("web GLB derivative"),
    ),
  );
});

test("FBX web derivative implementation is wired for binary GLB and Studio limits", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/fbxWebModel.ts",
    "utf8",
  );
  assert.match(source, /GLTFExporter/);
  assert.match(source, /binary: true/);
  assert.match(source, /MAX_STUDIO_ASSET_BYTES/);
  assert.match(source, /browser-fbx-to-glb-v2-material-fusion/);
  assert.match(source, /resolveSketchUpMaterialTexture/);
  assert.match(source, /unresolvedExternalTextures/);
  assert.match(source, /Generated GLB exceeds the current 64 MB Studio asset limit/);
});


test("Phase 1 source fusion stays project-neutral and is wired into the guided builder", () => {
  const fusion = fs.readFileSync(
    "apps/admin/src/studio/sourceFusion.ts",
    "utf8",
  );
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );

  assert.doesNotMatch(fusion, /studio-source-profiles|sourcePackSetup|sha256.*profile/i);
  assert.match(builder, /Source Fusion/);
  assert.match(builder, /Prepare web GLB/);
  assert.match(studio, /buildSourceFusionReport/);
  assert.match(studio, /prepareSelectedWebModel/);
  assert.match(studio, /publishModelId: publishAsset\.id/);
});
