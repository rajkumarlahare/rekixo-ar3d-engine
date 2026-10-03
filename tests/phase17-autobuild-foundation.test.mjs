import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function transpiledModule(path) {
  const source = fs.readFileSync(path, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
}

const sourcePlan = await transpiledModule(
  "apps/admin/src/studio/autoBuildSourcePlan.ts",
);
const roomFusion = await transpiledModule(
  "apps/admin/src/studio/roomSheetFusion.ts",
);

function asset(id, name) {
  return {
    id,
    projectId: "project",
    name,
    type: "application/octet-stream",
    size: 1,
    hash: id.padEnd(64, "a").slice(0, 64),
    blob: new Blob(["x"]),
  };
}

function project(rooms = []) {
  return {
    schema: 1,
    id: "project",
    name: "Fixture",
    updated: "2026-10-03T00:00:00.000Z",
    assets: [],
    releases: [],
    scene: {
      floors: [
        { id: "ground", name: "Ground", elevation: 0 },
        { id: "floor-1", name: "Floor 1", elevation: 3 },
      ],
      rooms,
      furniture: [],
      scale: 1,
    },
  };
}

function room(overrides = {}) {
  return {
    id: "room-1",
    name: "Living",
    floorId: "floor-1",
    unit: "101",
    x: 5,
    z: 4,
    width: 4.9,
    depth: 3.02,
    height: 2.8,
    color: "#cccccc",
    source: "auto reconstructed room",
    verified: false,
    ...overrides,
  };
}

function csvRow(overrides = {}) {
  return {
    key: "csv:2:floor1-101-living",
    assetId: "csv",
    assetName: "rooms.csv",
    rowNumber: 2,
    floorLabel: "First Floor",
    unit: "101",
    name: "Living",
    width: 4.954,
    depth: 3.05,
    height: 2.8,
    sourceNote: "Client room schedule",
    origin: "csv",
    ...overrides,
  };
}

test("shared source plan classifies six support roles plus optional CSV without treating textures as facade references", () => {
  const files = [
    asset("model", "building.fbx"),
    asset("cad", "first-floor.dwg"),
    asset("skp", "building.skb"),
    asset("pdf", "brochure.pdf"),
    asset("visual", "final-elevation.jpg"),
    asset("texture", "marble_diffuse.jpg"),
    asset("drs", "render.drs"),
    asset("csv", "rooms.csv"),
  ];
  const plan = sourcePlan.buildAutoBuildSourcePlan(project(), files);
  assert.equal(plan.mode, "model-backed");
  assert.equal(plan.completeSixRoleSupportPack, true);
  assert.equal(plan.structuredEvidenceCount, 1);
  assert.equal(plan.planningIssues.length, 0);
  assert.equal(
    plan.groups.find((entry) => entry.role === "visual").names[0],
    "final-elevation.jpg",
  );
  assert.deepEqual(
    plan.groups.find((entry) => entry.role === "texture").names,
    ["marble_diffuse.jpg"],
  );
});

test("shared source plan routes model-less CAD projects through the CAD-only foundation", () => {
  const plan = sourcePlan.buildAutoBuildSourcePlan(project(), [
    asset("cad", "ground-floor.dxf"),
    asset("csv", "rooms.csv"),
  ]);
  assert.equal(plan.mode, "cad-only");
  assert.equal(plan.structuredEvidenceCount, 1);
  assert.equal(plan.planningIssues.length, 0);
});

test("CSV snaps only a nearby unverified rectangular AutoBuild room to exact supplied dimensions", () => {
  const original = room();
  const result = roomFusion.fuseRoomSheetEvidence(
    project([original]),
    [csvRow()],
  );
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.applied, 1);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.project.scene.rooms[0].width, 4.954);
  assert.equal(result.project.scene.rooms[0].depth, 3.05);
  assert.equal(result.project.scene.rooms[0].verified, false);
  assert.equal(result.project.scene.rooms[0].x, original.x);
  assert.equal(result.project.scene.rooms[0].z, original.z);
  assert.match(result.project.scene.rooms[0].source, /^\[room-sheet:/);
  assert.match(result.project.scene.rooms[0].source, /prior: auto reconstructed room/);
});

test("CSV accepts width/depth orientation swap while preserving the reconstructed room orientation", () => {
  const result = roomFusion.fuseRoomSheetEvidence(
    project([room({ width: 3.02, depth: 4.9 })]),
    [csvRow()],
  );
  assert.equal(result.summary.applied, 1);
  assert.equal(result.project.scene.rooms[0].width, 3.05);
  assert.equal(result.project.scene.rooms[0].depth, 4.954);
});

test("CSV never rewrites reviewed rooms or large geometry conflicts", () => {
  const reviewed = room({ id: "reviewed", verified: true });
  const conflict = room({
    id: "conflict",
    unit: "102",
    width: 7,
    depth: 6,
  });
  const result = roomFusion.fuseRoomSheetEvidence(
    project([reviewed, conflict]),
    [
      csvRow(),
      csvRow({
        key: "csv:3:floor1-102-living",
        rowNumber: 3,
        unit: "102",
      }),
    ],
  );
  assert.equal(result.summary.verifiedMatches, 1);
  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.summary.applied, 0);
  assert.equal(result.project.scene.rooms.find((entry) => entry.id === "reviewed").width, 4.9);
  assert.equal(result.project.scene.rooms.find((entry) => entry.id === "conflict").width, 7);
});

test("CSV does not invent placement for unmatched, ambiguous, or polygon rooms", () => {
  const polygon = room({
    id: "polygon",
    unit: "103",
    polygon: [
      [0, 0],
      [4.9, 0],
      [4.9, 3.02],
      [0, 3.02],
    ],
  });
  const duplicateA = room({ id: "dup-a", unit: "104", floorId: "ground" });
  const duplicateB = room({ id: "dup-b", unit: "104", floorId: "floor-1" });
  const result = roomFusion.fuseRoomSheetEvidence(
    project([polygon, duplicateA, duplicateB]),
    [
      csvRow({ key: "polygon", rowNumber: 4, unit: "103" }),
      csvRow({
        key: "ambiguous",
        rowNumber: 5,
        floorLabel: "Typical",
        unit: "104",
      }),
      csvRow({
        key: "missing",
        rowNumber: 6,
        unit: "999",
        name: "Bedroom",
      }),
    ],
  );
  assert.equal(result.summary.polygonReview, 1);
  assert.equal(result.summary.ambiguous, 1);
  assert.equal(result.summary.unmatched, 1);
  assert.equal(result.summary.applied, 0);
  assert.equal(result.project.scene.rooms.length, 3);
});

test("AutoBuild wrapper uses the common source plan and structured evidence reconciliation for both routes", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  assert.match(source, /buildAutoBuildSourcePlan\(project, files\)/);
  assert.match(source, /sourcePlan\.mode === "model-backed"/);
  assert.match(source, /parseRoomSheetAssets\(\[\.\.\.files\]\)/);
  assert.match(source, /fuseRoomSheetEvidence/);
  assert.match(source, /structuredEvidence:/);
  assert.match(source, /planningIssues/);
});
