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

const registrationUrl = asUrl(
  compile("apps/admin/src/studio/sourceRegistration.ts"),
);
const registration = await import(registrationUrl);
const graphCode = compile(
  "apps/admin/src/studio/architectureGraph.ts",
).replace(
  /from "\.\/sourceRegistration";/,
  `from "${registrationUrl}";`,
);
const graph = await import(asUrl(graphCode));
const autoReview = await import(
  asUrl(compile("apps/admin/src/studio/autoBuildingReview.ts")),
);

function baseAnalysis() {
  return {
    createdAt: new Date().toISOString(),
    sources: [],
    modelAssetId: "model",
    modelName: "building.fbx",
    meshCount: 10,
    materialCount: 2,
    bounds: { min: [0, 0, 0], max: [10, 3, 6] },
    floorCandidates: [{ elevation: 0, confidence: 0.95, evidenceCount: 5 }],
    nodeAssignments: [],
    architecturalCandidates: [],
    cadAudits: [],
    highConfidenceAssignments: 0,
    reviewAssignments: 0,
    commonAssignments: 0,
    externalTextureRefs: 0,
    matchedTextureRefs: 0,
    issues: [],
  };
}

function cadAudit() {
  return {
    assetId: "cad-1",
    name: "ground-floor.dwg",
    kind: "dwg",
    semanticReady: true,
    layerHints: [{ layer: "A-WALL", kind: "wall" }],
    unitName: "metre",
    metresPerUnit: 1,
    geometryReady: true,
    semanticSegments: [
      { kind: "wall", layer: "A-WALL", start: [0, 0], end: [10, 0], sourceEntity: "LINE", confidence: 0.97 },
      { kind: "wall", layer: "A-WALL", start: [10, 0], end: [10, 6], sourceEntity: "LINE", confidence: 0.97 },
      { kind: "wall", layer: "A-WALL", start: [10, 6], end: [0, 6], sourceEntity: "LINE", confidence: 0.97 },
      { kind: "wall", layer: "A-WALL", start: [0, 6], end: [0, 0], sourceEntity: "LINE", confidence: 0.97 },
      { kind: "wall", layer: "A-WALL", start: [2, 0], end: [2, 2], sourceEntity: "LINE", confidence: 0.97 },
    ],
    textLabels: [{ text: "GROUND FLOOR", point: [0, 0] }],
    note: "fixture",
  };
}

test("Phase 4 footprint-only registration stays reviewable instead of claiming orientation certainty", () => {
  const analysis = baseAnalysis();
  const audit = cadAudit();
  const result = registration.estimateCadModelRegistration(
    analysis,
    audit,
    0,
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );

  assert.equal(result.compatible, true);
  assert.equal(result.mode, "footprint");
  assert.equal(result.ambiguous, true);
  assert.ok(result.confidence <= 0.72);
  assert.match(result.reason, /orientation is not fully disambiguated/i);
});

test("Phase 4 semantic source registration can disambiguate a 180-degree CAD orientation", () => {
  const analysis = baseAnalysis();
  analysis.architecturalCandidates = [
    { nodeName: "w1", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [5, 1, 6], size: [10, 2.8, 0.2], reasons: [] },
    { nodeName: "w2", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [0, 1, 3], size: [0.2, 2.8, 6], reasons: [] },
    { nodeName: "w3", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [5, 1, 0], size: [10, 2.8, 0.2], reasons: [] },
    { nodeName: "w4", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [10, 1, 3], size: [0.2, 2.8, 6], reasons: [] },
    { nodeName: "w5", occurrence: 1, kind: "wall", confidence: 0.98, floorIndex: 0, position: [8, 1, 5], size: [0.2, 2.8, 2], reasons: [] },
  ];
  const result = registration.estimateCadModelRegistration(
    analysis,
    cadAudit(),
    0,
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );

  assert.equal(result.compatible, true);
  assert.equal(result.mode, "semantic");
  assert.equal(result.sourceRotationDeg, 180);
  assert.equal(result.ambiguous, false);
  assert.ok(result.semanticMatches >= 5);
  assert.ok(result.confidence > 0.9);
});

test("Phase 4 CAD graph records registration confidence and never marks automatic walls human-reviewed", () => {
  const analysis = baseAnalysis();
  analysis.architecturalCandidates = [
    { nodeName: "w1", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [5, 1, 6], size: [10, 2.8, 0.2], reasons: [] },
    { nodeName: "w2", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [0, 1, 3], size: [0.2, 2.8, 6], reasons: [] },
    { nodeName: "w3", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [5, 1, 0], size: [10, 2.8, 0.2], reasons: [] },
    { nodeName: "w4", occurrence: 1, kind: "wall", confidence: 0.95, floorIndex: 0, position: [10, 1, 3], size: [0.2, 2.8, 6], reasons: [] },
    { nodeName: "w5", occurrence: 1, kind: "wall", confidence: 0.98, floorIndex: 0, position: [8, 1, 5], size: [0.2, 2.8, 2], reasons: [] },
  ];
  analysis.cadAudits = [cadAudit()];

  const result = graph.deriveCadWallGraph(
    analysis,
    [{ id: "ground", name: "Ground", elevation: 0 }],
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );

  assert.equal(result.compatible, true);
  assert.equal(result.rotationDeg, 180);
  assert.equal(result.registrationMode, "semantic");
  assert.ok(result.registrationConfidence > 0.9);
  assert.equal(result.ambiguous, false);
  assert.equal(result.walls.length, 5);
  assert.ok(result.walls.every((wall) => wall.origin === "cad-auto"));
  assert.ok(result.walls.every((wall) => wall.reviewed === false));
  assert.ok(result.walls.every((wall) => wall.reviewState !== "human_reviewed"));
});

test("Phase 4 wall fusion makes strong CAD authoritative per floor while preserving model-only floors", () => {
  const cad = [0, 1, 2, 3].map((index) => ({
    id: `cad-${index}`,
    floorId: "f0",
    roomIds: [],
    start: [index, 0],
    end: [index, 4],
    thickness: 0.2,
    height: 2.8,
    reviewed: false,
    origin: "cad-auto",
    confidence: 0.9,
  }));
  const model = [
    {
      id: "model-f0-a",
      floorId: "f0",
      roomIds: [],
      start: [0, 0],
      end: [4, 0],
      thickness: 0.15,
      height: 2.8,
      reviewed: false,
      origin: "model-auto",
      confidence: 0.95,
    },
    {
      id: "model-f0-b",
      floorId: "f0",
      roomIds: [],
      start: [0, 4],
      end: [4, 4],
      thickness: 0.15,
      height: 2.8,
      reviewed: false,
      origin: "model-auto",
      confidence: 0.95,
    },
    {
      id: "model-f1-a",
      floorId: "f1",
      roomIds: [],
      start: [0, 0],
      end: [4, 0],
      thickness: 0.15,
      height: 2.8,
      reviewed: false,
      origin: "model-auto",
      confidence: 0.95,
    },
  ];

  const fused = graph.fuseSourceWallGraphs(cad, model);
  assert.deepEqual(fused.cadAuthoritativeFloors, ["f0"]);
  assert.equal(fused.cadWalls, 4);
  assert.equal(fused.modelWalls, 1);
  assert.equal(fused.suppressedModelWalls, 2);
  assert.equal(fused.walls.filter((wall) => wall.floorId === "f0").length, 4);
  assert.equal(fused.walls.filter((wall) => wall.floorId === "f1").length, 1);
});

test("Phase 4 fast review can explicitly approve registered CAD walls", () => {
  const scene = {
    floors: [{ id: "f0", name: "Ground", elevation: 0 }],
    rooms: [],
    furniture: [],
    walls: [
      {
        id: "cad-ready",
        floorId: "f0",
        roomIds: [],
        start: [0, 0],
        end: [4, 0],
        thickness: 0.2,
        height: 2.8,
        reviewed: false,
        origin: "cad-auto",
        confidence: 0.91,
        reviewState: "auto_ready",
      },
    ],
    openings: [],
    scale: 1,
  };

  const counts = autoReview.autoBuildingReviewCounts(scene);
  assert.equal(counts.readyWalls, 1);
  assert.equal(counts.wallReview, 0);

  const approved = autoReview.approveReadyModelWalls(scene);
  assert.equal(approved.approved, 1);
  assert.equal(approved.scene.walls[0].reviewed, true);
  assert.equal(approved.scene.walls[0].reviewState, "human_reviewed");
});

test("Phase 4 Smart Draft uses source fusion instead of the old CAD fallback", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/smartDraftBuilder.ts",
    "utf8",
  );
  assert.match(builder, /fuseSourceWallGraphs/);
  assert.match(builder, /const cadGraph = deriveCadWallGraph/);
  assert.doesNotMatch(builder, /modelWalls\.length < 3/);
  assert.match(builder, /\["model-auto", "cad-auto"\]/);
});
