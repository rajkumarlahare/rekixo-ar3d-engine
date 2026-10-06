import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "apps/admin/src/studio/unitHierarchy.ts",
  "utf8",
);

async function loadModule() {
  const result = ts.transpileModule(source, {
    fileName: "unitHierarchy.ts",
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
  const encoded = Buffer.from(result.outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

function room({ id, floorId, name, unit = "", x, z, source }) {
  return {
    id,
    floorId,
    name,
    unit,
    x,
    z,
    width: 3,
    depth: 3,
    height: 3,
    color: "#ffffff",
    source,
    verified: false,
  };
}

function fixture() {
  const note = "Auto semantics matched from aligned uploaded source evidence.";
  return {
    scene: {
      floors: [
        { id: "ground", name: "Ground", elevation: 0 },
        { id: "first", name: "First", elevation: 3 },
      ],
      rooms: [
        room({ id: "g-stair", floorId: "ground", name: "Stair", x: 0, z: 0, source: "CAD" }),
        room({ id: "g-lobby", floorId: "ground", name: "Lobby", x: 3, z: 0, source: "CAD" }),
        room({ id: "g-flat", floorId: "ground", name: "Living Room", unit: "Flat 101", x: 6, z: 0, source: note }),
        room({ id: "f-stair", floorId: "first", name: "Stair", x: 0, z: 0, source: "CAD" }),
        room({ id: "f-lobby", floorId: "first", name: "Lobby", x: 3, z: 0, source: "CAD" }),
        room({ id: "f-flat", floorId: "first", name: "Living Room", unit: "Flat 201", x: 6, z: 0, source: note }),
        room({ id: "manual-unit", floorId: "ground", name: "Bedroom", unit: "Flat 999", x: 12, z: 0, source: "Typed manually" }),
      ],
      furniture: [],
      openings: [
        { id: "g-stair-lobby", floorId: "ground", kind: "door", roomIds: ["g-stair", "g-lobby"], x: 1.5, y: 0, z: 0, width: 1, height: 2.1, rotationY: 0, reviewed: true },
        { id: "g-lobby-flat", floorId: "ground", kind: "door", roomIds: ["g-lobby", "g-flat"], x: 4.5, y: 0, z: 0, width: 1, height: 2.1, rotationY: 0, reviewed: true },
        { id: "f-stair-lobby", floorId: "first", kind: "door", roomIds: ["f-stair", "f-lobby"], x: 1.5, y: 3, z: 0, width: 1, height: 2.1, rotationY: 0, reviewed: true },
        { id: "f-lobby-flat", floorId: "first", kind: "door", roomIds: ["f-lobby", "f-flat"], x: 4.5, y: 3, z: 0, width: 1, height: 2.1, rotationY: 0, reviewed: true },
      ],
      scale: 1,
    },
    circulation: {
      cores: [
        {
          id: "circulation-stair-main",
          kind: "stair",
          status: "auto-ready",
          confidence: 0.94,
          reason: "source-backed",
          members: [
            { elementId: "stair-0", kind: "stair", floorId: "ground", floorName: "Ground", floorIndex: 0, x: 0, z: 0, width: 2, depth: 2, confidence: 0.95, reviewed: false, reviewState: "auto_ready", sourceRef: "cad:stair:0" },
            { elementId: "stair-1", kind: "stair", floorId: "first", floorName: "First", floorIndex: 1, x: 0, z: 0, width: 2, depth: 2, confidence: 0.94, reviewed: false, reviewState: "auto_ready", sourceRef: "cad:stair:1" },
          ],
        },
      ],
      counts: {
        sourceBackedElements: 2,
        boundCores: 1,
        reviewCores: 0,
        singletonEvidence: 0,
        ambiguousBindings: 0,
        unresolvedFloorEvidence: 0,
      },
      issues: [],
    },
  };
}

test("R2 unit hierarchy module transpiles and executes without runtime authoring imports", async () => {
  const module = await loadModule();
  assert.equal(typeof module.buildUnitHierarchy, "function");
});

test("R2 derives only source-backed floor-scoped units and leaves typed labels unproven", async () => {
  const { buildUnitHierarchy } = await loadModule();
  const { scene, circulation } = fixture();
  const report = buildUnitHierarchy(scene, circulation);

  assert.deepEqual(
    report.units.map((unit) => [unit.floorId, unit.label, unit.roomIds]),
    [
      ["first", "Flat 201", ["f-flat"]],
      ["ground", "Flat 101", ["g-flat"]],
    ],
  );
  assert.equal(report.counts.sourceBackedUnits, 2);
  assert.equal(report.counts.sourceBackedRooms, 2);
  assert.equal(report.counts.unprovenUnitRooms, 1);
  assert.equal(report.units.some((unit) => unit.label === "Flat 999"), false);
});

test("R2 links source-backed units to circulation only through reviewed door paths", async () => {
  const { buildUnitHierarchy } = await loadModule();
  const { scene, circulation } = fixture();
  const report = buildUnitHierarchy(scene, circulation);

  assert.equal(report.counts.circulationLinks, 2);
  for (const unit of report.units) {
    assert.deepEqual(unit.circulationCoreIds, ["circulation-stair-main"]);
    assert.equal(unit.reviewedAccessOpeningIds.length, 2);
  }

  const blocked = structuredClone(scene);
  blocked.openings.find((opening) => opening.id === "g-lobby-flat").reviewed = false;
  const blockedReport = buildUnitHierarchy(blocked, circulation);
  assert.equal(blockedReport.counts.circulationLinks, 1);
  assert.deepEqual(
    blockedReport.units.find((unit) => unit.label === "Flat 101").circulationCoreIds,
    [],
  );
});

test("R2 hierarchy derivation does not mutate source scene or circulation evidence", async () => {
  const { buildUnitHierarchy } = await loadModule();
  const { scene, circulation } = fixture();
  const beforeScene = JSON.stringify(scene);
  const beforeCirculation = JSON.stringify(circulation);

  buildUnitHierarchy(scene, circulation);

  assert.equal(JSON.stringify(scene), beforeScene);
  assert.equal(JSON.stringify(circulation), beforeCirculation);
});
