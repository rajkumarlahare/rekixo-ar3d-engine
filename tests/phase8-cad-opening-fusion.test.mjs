import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const code = ts.transpileModule(
  fs.readFileSync("apps/admin/src/studio/cadOpeningFusion.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const fusion = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
);

function scene() {
  return {
    floors: [{ id: "floor-1", name: "Ground", elevation: 0 }],
    rooms: [
      {
        id: "left",
        name: "Living Room",
        floorId: "floor-1",
        unit: "Flat 101",
        x: -2,
        z: 0,
        width: 4,
        depth: 4,
        height: 2.8,
        color: "#dddddd",
        source: "Auto draft.",
        verified: false,
      },
      {
        id: "right",
        name: "Bedroom",
        floorId: "floor-1",
        unit: "Flat 101",
        x: 2,
        z: 0,
        width: 4,
        depth: 4,
        height: 2.8,
        color: "#dddddd",
        source: "Auto draft.",
        verified: false,
      },
    ],
    furniture: [],
    walls: [],
    openings: [],
    scale: 1,
  };
}

function registration(overrides = {}) {
  return {
    compatible: true,
    rotationDeg: 0,
    sourceRotationDeg: 0,
    sourceCentre: [0, 0],
    targetCentre: [0, 0],
    confidence: 0.95,
    mode: "semantic",
    semanticMatches: 6,
    footprintError: 0.02,
    score: 0.04,
    ambiguous: false,
    ...overrides,
  };
}

function audit(segments) {
  return {
    assetId: "cad-1",
    name: "ground-floor.dwg",
    kind: "dwg",
    semanticReady: true,
    layerHints: [],
    geometryReady: true,
    semanticSegments: segments,
    textLabels: [],
    note: "normalized",
  };
}

const modelDoor = {
  key: "Door_101\u00001",
  sourceNodeName: "Door_101",
  sourceOccurrence: 1,
  kind: "door",
  floorId: "floor-1",
  roomIds: ["left", "right"],
  position: [0.04, 1.05, 0.02],
  width: 0.88,
  height: 2.1,
  rotationY: -90,
  wallDistance: 0.04,
  confidence: 0.91,
  ready: true,
  reasons: ["3D door candidate"],
};

test("Phase 8 corroborates a 3D door with normalized CAD plan evidence", () => {
  const result = fusion.fuseCadOpeningEvidence(
    [modelDoor],
    audit([
      {
        id: "door-cad",
        kind: "door",
        layer: "A-DOOR",
        start: [0, -0.45],
        end: [0, 0.45],
        sourceEntity: "LINE",
        confidence: 0.96,
      },
    ]),
    "floor-1",
    0,
    scene(),
    registration(),
  );

  assert.equal(result.cadEvidence, 1);
  assert.equal(result.matched, 1);
  assert.equal(result.cadOnlyReview, 0);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].sourceNodeName, "Door_101");
  assert.equal(result.suggestions[0].ready, true);
  assert.equal(result.suggestions[0].width, 0.9);
  assert.deepEqual(
    new Set(result.suggestions[0].roomIds),
    new Set(["left", "right"]),
  );
  assert.ok(
    result.suggestions[0].reasons.some((reason) =>
      reason.includes("CAD plan corroborates"),
    ),
  );
});

test("Phase 8 keeps CAD-only opening evidence review-only without inventing vertical dimensions", () => {
  const result = fusion.fuseCadOpeningEvidence(
    [],
    audit([
      {
        id: "door-cad",
        kind: "door",
        layer: "A-DOOR",
        start: [0, -0.5],
        end: [0, 0.5],
        sourceEntity: "LINE",
        confidence: 0.95,
      },
    ]),
    "floor-1",
    0,
    scene(),
    registration(),
  );

  assert.equal(result.cadEvidence, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.cadOnlyReview, 1);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].ready, false);
  assert.match(result.suggestions[0].sourceNodeName, /^CAD:/);
  assert.ok(
    result.suggestions[0].reasons.some((reason) =>
      reason.includes("vertical opening dimensions require 3D corroboration"),
    ),
  );
});

test("Phase 8 rejects ambiguous CAD/model registration for automatic fusion", () => {
  const result = fusion.fuseCadOpeningEvidence(
    [modelDoor],
    audit([
      {
        id: "door-cad",
        kind: "door",
        layer: "A-DOOR",
        start: [0, -0.45],
        end: [0, 0.45],
        sourceEntity: "LINE",
        confidence: 0.96,
      },
    ]),
    "floor-1",
    0,
    scene(),
    registration({ ambiguous: true, confidence: 0.65 }),
  );

  assert.equal(result.cadEvidence, 0);
  assert.equal(result.matched, 0);
  assert.equal(result.cadOnlyReview, 0);
  assert.deepEqual(result.suggestions, [modelDoor]);
});

test("Phase 8 deduplicates duplicate CAD opening lines before review", () => {
  const duplicate = {
    kind: "window",
    layer: "A-WINDOW",
    start: [-3, -0.6],
    end: [-3, 0.6],
    sourceEntity: "LINE",
    confidence: 0.9,
  };
  const result = fusion.fuseCadOpeningEvidence(
    [],
    audit([
      { ...duplicate, id: "window-1" },
      { ...duplicate, id: "window-2", confidence: 0.95 },
    ]),
    "floor-1",
    0,
    scene(),
    registration(),
  );

  assert.equal(result.cadEvidence, 1);
  assert.equal(result.cadOnlyReview, 1);
  assert.equal(result.suggestions.length, 1);
});
