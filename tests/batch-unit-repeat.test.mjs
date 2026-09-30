import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const floorSource = fs.readFileSync(
  "apps/admin/src/studio/floorSkeleton.ts",
  "utf8",
);
const floorCode = ts.transpileModule(floorSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const floorUrl =
  "data:text/javascript;base64," + Buffer.from(floorCode).toString("base64");

let repeatSource = fs.readFileSync("apps/admin/src/studio/unitRepeat.ts", "utf8");
repeatSource = repeatSource.replace(
  'from "./floorSkeleton";',
  `from "${floorUrl}";`,
);
const repeatCode = ts.transpileModule(repeatSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const repeat = await import(
  "data:text/javascript;base64," + Buffer.from(repeatCode).toString("base64"),
);

const skeleton = [
  { key: "ground", name: "Ground", sourceElevation: 0, kind: "ground" },
  { key: "floor-1", name: "Floor 1", sourceElevation: 3, kind: "residential" },
  { key: "floor-2", name: "Floor 2", sourceElevation: 6, kind: "residential" },
  { key: "floor-3", name: "Floor 3", sourceElevation: 9, kind: "residential" },
];

const plan = {
  id: "demo-series",
  label: "Demo series",
  sourceFloorKey: "floor-1",
  note: "Preview before generation.",
  series: [
    {
      sourceUnit: "101",
      expectedRoomCount: 2,
      targets: [
        { floorKey: "floor-2", targetUnit: "201" },
        { floorKey: "floor-3", targetUnit: "301" },
      ],
    },
  ],
};

function room(id, floorId, unit, name) {
  return {
    id,
    name,
    floorId,
    unit,
    x: name === "Living" ? 1 : 3,
    z: 2,
    width: 2,
    depth: 3,
    height: 2.8,
    color: "#cdbfa9",
    source: "Mapped source room",
    verified: true,
    sourceAssetId: "evidence",
    sourcePackSourceId: "source-pack",
    sourceClaimIds: ["claim"],
    mesh: "Mesh",
  };
}

function scene(rooms) {
  return {
    scale: 1,
    modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
    floors: [
      { id: "ground", name: "Ground", elevation: 0 },
      { id: "f1", name: "Floor 1", elevation: 3 },
      { id: "f2", name: "Floor 2", elevation: 6 },
      { id: "f3", name: "Floor 3", elevation: 9 },
    ],
    rooms,
    furniture: [],
    openings: [],
  };
}

test("unreviewed source rooms block generation and never alter existing rooms", () => {
  const original = scene([room("r1", "f1", "101", "Living"),
    { ...room("r2", "f1", "101", "Bedroom"), verified: false }]);
  const before = structuredClone(original);
  const result = repeat.applyBatchRepeatPlan(original, "demo", skeleton, plan);
  assert.equal(result.generatedTargets, 0);
  assert.equal(result.blockedTargets, 2);
  assert.match(result.rows[0].reason, /Accept each source room/);
  assert.deepEqual(original, before);
  original.rooms[1].verified = true;
  const accepted = repeat.applyBatchRepeatPlan(original, "demo", skeleton, plan);
  assert.equal(accepted.generatedTargets, 2);
  assert.ok(accepted.createdRooms.every((entry) => !entry.verified));
});

test("batch repeat preview blocks incomplete source units", () => {
  const preview = repeat.buildBatchRepeatPreview(
    scene([room("r1", "f1", "101", "Living")]),
    "demo",
    skeleton,
    plan,
  );
  assert.equal(preview.readyTargets, 0);
  assert.equal(preview.blockedTargets, 2);
  assert.match(preview.rows[0].reason, /1\/2 expected rooms/);
});

test("batch repeat preview skips existing target units instead of overwriting", () => {
  const rooms = [
    room("r1", "f1", "101", "Living"),
    room("r2", "f1", "101", "Bedroom"),
    room("existing", "f2", "201", "Existing"),
  ];
  const preview = repeat.buildBatchRepeatPreview(
    scene(rooms),
    "demo",
    skeleton,
    plan,
  );
  assert.equal(preview.readyTargets, 1);
  assert.equal(preview.existingTargets, 1);
  assert.equal(preview.roomsToCreate, 2);
  assert.equal(preview.rows[0].status, "existing");
  assert.equal(preview.rows[1].status, "ready");
});

test("batch repeat creates unverified drafts and clears direct evidence bindings", () => {
  const rooms = [
    {
      ...room("r1", "f1", "101", "Living"),
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
    },
    room("r2", "f1", "101", "Bedroom"),
  ];
  let index = 0;
  const result = repeat.applyBatchRepeatPlan(
    scene(rooms),
    "demo",
    skeleton,
    plan,
    () => `copy-${++index}`,
  );
  assert.equal(result.generatedTargets, 2);
  assert.equal(result.createdRooms.length, 4);
  assert.deepEqual(
    [...new Set(result.createdRooms.map((entry) => entry.unit))],
    ["201", "301"],
  );
  for (const copied of result.createdRooms) {
    assert.equal(copied.verified, false);
    assert.equal(copied.sourceAssetId, undefined);
    assert.equal(copied.sourcePackSourceId, undefined);
    assert.equal(copied.sourceClaimIds, undefined);
    assert.equal(copied.mesh, undefined);
    assert.match(copied.source, /requires visual review/);
  }
  const polygonCopy = result.createdRooms.find(
    (entry) => entry.name === "Living",
  );
  assert.notEqual(polygonCopy.polygon, rooms[0].polygon);
});

test("Jyoti repeat plan stays source-specific and excludes common rooms", () => {
  const profile = fs.readFileSync(
    "project-profiles/studio-source-profiles.ts",
    "utf8",
  );
  assert.match(profile, /jyotiRepeatPlan/);
  assert.match(profile, /sourceFloorKey: "floor-1"/);
  assert.match(profile, /targetUnit: "501"/);
  assert.match(profile, /targetUnit: "502"/);
  assert.match(profile, /targetUnit: "403"/);
  assert.doesNotMatch(profile, /sourceUnit: "Common"/);
  assert.match(profile, /not a certified legal floor schedule/);
});


test("batch repeated room identity is explicit and stable for review automation", () => {
  const generated = repeat.applyBatchRepeatPlan(
    scene([room("r1", "f1", "101", "Living"), room("r2", "f1", "101", "Bedroom")]),
    "demo",
    skeleton,
    plan,
    () => "copy",
  );
  assert.ok(generated.createdRooms.length > 0);
  assert.ok(generated.createdRooms.every((entry) => repeat.isBatchRepeatedRoom(entry)));
  assert.ok(generated.createdRooms.every((entry) =>
    entry.source.startsWith(repeat.BATCH_REPEAT_SOURCE_PREFIX)));
  assert.equal(repeat.isBatchRepeatedRoom(room("plain", "f1", "101", "Living")), false);
});
