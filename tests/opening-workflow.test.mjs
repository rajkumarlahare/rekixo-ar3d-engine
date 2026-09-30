import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "apps/admin/src/studio/openingWorkflow.ts",
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const workflow = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64"),
);

function scene() {
  return {
    floors: [{ id: "floor-1", name: "Floor 1", elevation: 3 }],
    rooms: [
      {
        id: "living",
        name: "Living",
        unit: "101",
        floorId: "floor-1",
        x: -2,
        z: 0,
        width: 4,
        depth: 4,
        height: 2.8,
        color: "#ddd",
        source: "mapped",
        verified: false,
      },
      {
        id: "bedroom",
        name: "Bedroom",
        unit: "101",
        floorId: "floor-1",
        x: 2,
        z: 0,
        width: 4,
        depth: 4,
        height: 2.8,
        color: "#ddd",
        source: "mapped",
        verified: false,
      },
    ],
    furniture: [],
    openings: [],
    modelNodeTags: [
      {
        nodeName: "ManualWall",
        occurrence: 1,
        semantic: "wall",
        semanticAssignment: "manual",
        semanticConfidence: 1,
      },
    ],
    modelId: "model",
    scale: 1,
  };
}

const candidates = [
  {
    nodeName: "Door_101",
    occurrence: 1,
    kind: "door",
    confidence: 0.95,
    floorIndex: 0,
    position: [0, 4.05, 0],
    size: [0.12, 2.1, 0.9],
    reasons: ["door"],
  },
  {
    nodeName: "Window_101",
    occurrence: 1,
    kind: "window",
    confidence: 0.91,
    floorIndex: 0,
    position: [-4, 4.6, 0],
    size: [0.12, 1.2, 1.2],
    reasons: ["window"],
  },
  {
    nodeName: "WeakDoor",
    occurrence: 1,
    kind: "door",
    confidence: 0.55,
    floorIndex: 0,
    position: [12, 4.05, 12],
    size: [0.12, 2.1, 0.9],
    reasons: ["weak"],
  },
];

const suggestions = [
  {
    key: "Door_101\u00001",
    sourceNodeName: "Door_101",
    sourceOccurrence: 1,
    kind: "door",
    floorId: "floor-1",
    roomIds: ["living", "bedroom"],
    position: [0, 4.05, 0],
    width: 0.9,
    height: 2.1,
    rotationY: 0,
    wallDistance: 0,
    confidence: 0.93,
    ready: true,
    reasons: ["shared wall"],
  },
  {
    key: "Window_101\u00001",
    sourceNodeName: "Window_101",
    sourceOccurrence: 1,
    kind: "window",
    floorId: "floor-1",
    roomIds: ["living"],
    position: [-4, 4.6, 0],
    width: 1.2,
    height: 1.2,
    sillHeight: 1,
    rotationY: 90,
    wallDistance: 0,
    confidence: 0.88,
    ready: true,
    reasons: ["exterior wall"],
  },
  {
    key: "WeakDoor\u00001",
    sourceNodeName: "WeakDoor",
    sourceOccurrence: 1,
    kind: "door",
    floorId: "floor-1",
    roomIds: [],
    position: [12, 4.05, 12],
    width: 0.9,
    height: 2.1,
    rotationY: 0,
    wallDistance: 9,
    confidence: 0.4,
    ready: false,
    reasons: ["no mapped wall"],
  },
];

test("one-click workflow approves only ready openings and leaves unclear candidates", () => {
  let index = 0;
  const result = workflow.applyReadyOpeningWorkflow(
    scene(),
    candidates,
    suggestions,
    () => `opening-${++index}`,
  );

  assert.equal(result.readyFound, 2);
  assert.equal(result.approved, 2);
  assert.equal(result.reviewRemaining, 1);
  assert.equal(result.scene.openings.length, 2);
  assert.deepEqual(
    result.scene.openings.map((opening) => opening.kind),
    ["door", "window"],
  );
  assert.ok(result.scene.openings.every((opening) => opening.reviewed));
  assert.equal(result.scene.openings[0].roomIds.length, 2);
  assert.equal(result.scene.openings[1].sillHeight, 1);
});

test("approved openings become manual reviewed tags while manual labels are preserved", () => {
  const result = workflow.applyReadyOpeningWorkflow(
    scene(),
    candidates,
    suggestions,
    () => "opening",
  );

  const doorTag = result.scene.modelNodeTags.find(
    (tag) => tag.nodeName === "Door_101",
  );
  const windowTag = result.scene.modelNodeTags.find(
    (tag) => tag.nodeName === "Window_101",
  );
  const manualWall = result.scene.modelNodeTags.find(
    (tag) => tag.nodeName === "ManualWall",
  );

  assert.equal(doorTag.semantic, "door");
  assert.equal(doorTag.semanticAssignment, "manual");
  assert.equal(doorTag.assignment, "manual");
  assert.equal(doorTag.unit, "101");
  assert.equal(doorTag.roomId, undefined);
  assert.equal(windowTag.semantic, "window");
  assert.equal(windowTag.roomId, "living");
  assert.equal(manualWall.semantic, "wall");
  assert.equal(manualWall.semanticAssignment, "manual");
});

test("one-click workflow is repeat-safe and never duplicates a source opening", () => {
  const first = workflow.applyReadyOpeningWorkflow(
    scene(),
    candidates,
    suggestions,
    () => "opening-first",
  );
  const second = workflow.applyReadyOpeningWorkflow(
    first.scene,
    candidates,
    suggestions,
    () => "opening-duplicate",
  );

  assert.equal(second.approved, 0);
  assert.equal(second.alreadyApproved, 2);
  assert.equal(second.scene.openings.length, 2);
  assert.equal(second.reviewRemaining, 1);
});

test("Room Mapper exposes one-click opening preparation and review fallback", () => {
  const mapper = fs.readFileSync(
    "apps/admin/src/studio/VisualRoomMapper.tsx",
    "utf8",
  );
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");

  assert.match(mapper, /DOORS \/ WINDOWS → WALKTHROUGH/);
  assert.match(mapper, /Analyze & approve ready/);
  assert.match(mapper, /Review unclear/);
  assert.match(mapper, /dimension-plausible associations/);
  assert.match(studio, /analyzeAndApproveReadyOpenings/);
  assert.match(studio, /applyReadyOpeningWorkflow/);
  assert.match(studio, /suggestOpeningAssociations\(analysis, baseProject\.scene\)/);
  assert.match(studio, /Existing reviewed openings and manual labels were preserved/);
});
