import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const slugPolicyUrl =
  "data:text/javascript;base64," +
  Buffer.from(fs.readFileSync("shared/project-slug-policy.js", "utf8")).toString("base64");

const domainCode = ts
  .transpileModule(fs.readFileSync("apps/admin/src/studio/domain.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace("../../../../shared/project-slug-policy.js", slugPolicyUrl);
const domainUrl =
  "data:text/javascript;base64," + Buffer.from(domainCode).toString("base64");

const helperCode = ts
  .transpileModule(
    fs.readFileSync("apps/admin/src/studio/demoInterior.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replace("./domain", domainUrl);
const helper = await import(
  "data:text/javascript;base64," + Buffer.from(helperCode).toString("base64")
);

const room = (id, name, unit, floorId, width, depth) => ({
  id,
  name,
  unit,
  floorId,
  x: 0,
  z: 0,
  width,
  depth,
  height: 2.8,
  color: "#dddddd",
  source: "Reviewed brochure layout",
  verified: true,
});

const makeId = (() => {
  let index = 0;
  return () => `demo-${++index}`;
})();

test("typical-floor demo interior preserves existing living furniture and fills supported room types", () => {
  const living = room("living", "Living", "101", "f1", 4.95, 3.05);
  const bedroom = room("bed", "Bed Room", "101", "f1", 3.4, 3.2);
  const dining = room("dining", "Dining", "101", "f1", 1.265, 1.023);
  const balcony = room("balcony", "Balcony", "101", "f1", 1.5, 1.4);
  const kitchen = room("kitchen", "Kitchen", "101", "f1", 3.2, 2.1);
  const scene = {
    scale: 1,
    floors: [{ id: "f1", name: "Floor 1", elevation: 3.048 }],
    rooms: [living, bedroom, dining, balcony, kitchen],
    furniture: [
      {
        id: "sofa-existing",
        kind: "sofa",
        roomId: living.id,
        x: -1,
        z: -0.8,
        rotation: 0,
        color: "#b9a58d",
      },
      {
        id: "table-existing",
        kind: "table",
        roomId: living.id,
        x: 0.6,
        z: 0.5,
        rotation: 0,
        color: "#93684c",
      },
    ],
    openings: [],
  };

  const result = helper.buildTypicalFloorDemoInterior(scene, "f1", makeId);
  assert.equal(
    result.furniture.filter((item) => item.roomId === living.id && item.kind === "sofa").length,
    1,
  );
  assert.equal(
    result.furniture.filter((item) => item.roomId === living.id && item.kind === "table").length,
    1,
  );
  assert.ok(result.created.some((item) => item.roomId === living.id && item.kind === "plant"));
  assert.ok(result.created.some((item) => item.roomId === bedroom.id && item.kind === "bed"));
  assert.ok(result.created.some((item) => item.roomId === bedroom.id && item.kind === "wardrobe"));
  assert.ok(result.created.some((item) => item.roomId === dining.id && item.kind === "table"));
  assert.ok(result.created.some((item) => item.roomId === balcony.id && item.kind === "plant"));
  assert.equal(result.created.some((item) => item.roomId === kitchen.id), false);
  assert.ok(result.created.every((item) => item.origin === "demo-auto"));

  const rerun = helper.buildTypicalFloorDemoInterior(
    { ...scene, furniture: result.furniture },
    "f1",
    makeId,
  );
  assert.equal(rerun.created.length, 0);
});

test("repeated interior only copies to reviewed matching rooms and stays idempotent", () => {
  const sourceLiving = room("living-101", "Living", "101", "f1", 4.95, 3.05);
  const sourceBed = room("bed-101", "Bed Room", "101", "f1", 3.4, 3.2);
  const targetLiving = room("living-201", "Living", "201", "f2", 4.95, 3.05);
  const targetBed = room("bed-201", "Bed Room", "201", "f2", 3.4, 3.2);
  const scene = {
    scale: 1,
    floors: [
      { id: "f1", name: "Floor 1", elevation: 3.048 },
      { id: "f2", name: "Floor 2", elevation: 6.0452 },
    ],
    rooms: [sourceLiving, sourceBed, targetLiving, targetBed],
    furniture: [
      {
        id: "sofa",
        kind: "sofa",
        roomId: sourceLiving.id,
        x: -1,
        z: -0.8,
        rotation: 0,
        color: "#b9a58d",
      },
      {
        id: "bed",
        kind: "bed",
        roomId: sourceBed.id,
        x: -0.3,
        z: 0,
        rotation: 0,
        color: "#d9d3c4",
      },
    ],
    openings: [],
  };
  const rows = [
    {
      key: "101:f2:201",
      sourceFloorId: "f1",
      sourceFloorName: "Floor 1",
      sourceUnit: "101",
      sourceRoomCount: 2,
      targetFloorId: "f2",
      targetFloorName: "Floor 2",
      targetUnit: "201",
      status: "existing",
      reason: "Target already exists",
    },
  ];

  const result = helper.buildRepeatedDemoInterior(scene, rows, makeId);
  assert.equal(result.created.length, 2);
  assert.ok(result.created.some((item) => item.roomId === targetLiving.id && item.kind === "sofa"));
  assert.ok(result.created.some((item) => item.roomId === targetBed.id && item.kind === "bed"));

  const rerun = helper.buildRepeatedDemoInterior(
    { ...scene, furniture: result.furniture },
    rows,
    makeId,
  );
  assert.equal(rerun.created.length, 0);

  const blocked = helper.buildRepeatedDemoInterior(
    {
      ...scene,
      rooms: [sourceLiving, sourceBed, targetLiving, { ...targetBed, verified: false }],
    },
    rows,
    makeId,
  );
  assert.equal(blocked.created.length, 0);
});


test("demo interior audit detects and repairs incompatible furniture without touching supported rooms", () => {
  const living = room("living-audit", "Living", "101", "f1", 4.95, 3.05);
  const bedroom = room("bed-audit", "Bed Room", "101", "f1", 3.4, 3.2);
  const kitchen = room("kitchen-audit", "Kitchen", "101", "f1", 3.2, 2.1);
  const scene = {
    scale: 1,
    floors: [{ id: "f1", name: "Floor 1", elevation: 3.048 }],
    rooms: [living, bedroom, kitchen],
    furniture: [
      { id: "living-sofa", kind: "sofa", roomId: living.id, x: 0, z: 0, rotation: 0, color: "#aaa" },
      { id: "living-bed-wrong", kind: "bed", roomId: living.id, x: 0, z: 0, rotation: 0, color: "#bbb" },
      { id: "living-wardrobe-wrong", kind: "wardrobe", roomId: living.id, x: 0, z: 0, rotation: 0, color: "#ccc" },
      { id: "bed-bed", kind: "bed", roomId: bedroom.id, x: 0, z: 0, rotation: 0, color: "#ddd" },
      { id: "kitchen-table-custom", kind: "table", roomId: kitchen.id, x: 0, z: 0, rotation: 0, color: "#eee" },
    ],
    openings: [],
  };

  const issues = helper.auditDemoInterior(scene);
  assert.deepEqual(
    issues.map((issue) => issue.furnitureId).sort(),
    ["living-bed-wrong", "living-wardrobe-wrong"],
  );

  const repaired = helper.repairDemoInterior(scene);
  assert.equal(repaired.removed.length, 2);
  assert.ok(repaired.furniture.some((item) => item.id === "living-sofa"));
  assert.ok(repaired.furniture.some((item) => item.id === "bed-bed"));
  assert.ok(repaired.furniture.some((item) => item.id === "kitchen-table-custom"));
  assert.equal(repaired.furniture.some((item) => item.id === "living-bed-wrong"), false);
  assert.equal(repaired.furniture.some((item) => item.id === "living-wardrobe-wrong"), false);
});

test("repeat automation never propagates incompatible furniture from a source room", () => {
  const sourceLiving = room("living-source-filter", "Living", "101", "f1", 4.95, 3.05);
  const targetLiving = room("living-target-filter", "Living", "201", "f2", 4.95, 3.05);
  const scene = {
    scale: 1,
    floors: [
      { id: "f1", name: "Floor 1", elevation: 3.048 },
      { id: "f2", name: "Floor 2", elevation: 6.0452 },
    ],
    rooms: [sourceLiving, targetLiving],
    furniture: [
      { id: "source-sofa", kind: "sofa", roomId: sourceLiving.id, x: 0, z: 0, rotation: 0, color: "#aaa" },
      { id: "source-bed-wrong", kind: "bed", roomId: sourceLiving.id, x: 0, z: 0, rotation: 0, color: "#bbb" },
    ],
    openings: [],
  };
  const rows = [
    {
      key: "101:f2:201",
      sourceFloorId: "f1",
      sourceFloorName: "Floor 1",
      sourceUnit: "101",
      sourceRoomCount: 1,
      targetFloorId: "f2",
      targetFloorName: "Floor 2",
      targetUnit: "201",
      status: "existing",
      reason: "Target already exists",
    },
  ];

  const result = helper.buildRepeatedDemoInterior(scene, rows, makeId);
  assert.ok(result.created.some((item) => item.kind === "sofa"));
  assert.equal(result.created.some((item) => item.kind === "bed"), false);
  assert.ok(result.created.every((item) => item.origin === "demo-repeat"));
});

test("reconcileDemoInterior removes wrong-role items, restores missing typical items, repeats safely, and is idempotent", () => {
  const sourceLiving = room("reconcile-living-101", "Living", "101", "f1", 4.95, 3.05);
  const sourceBed = room("reconcile-bed-101", "Bed Room", "101", "f1", 3.4, 3.2);
  const targetLiving = room("reconcile-living-201", "Living", "201", "f2", 4.95, 3.05);
  const targetBed = room("reconcile-bed-201", "Bed Room", "201", "f2", 3.4, 3.2);
  const scene = {
    scale: 1,
    floors: [
      { id: "f1", name: "Floor 1", elevation: 3.048 },
      { id: "f2", name: "Floor 2", elevation: 6.0452 },
    ],
    rooms: [sourceLiving, sourceBed, targetLiving, targetBed],
    furniture: [
      { id: "wrong-bed", kind: "bed", roomId: sourceLiving.id, x: 0, z: 0, rotation: 0, color: "#aaa" },
      { id: "existing-sofa", kind: "sofa", roomId: sourceLiving.id, x: -1, z: -0.8, rotation: 0, color: "#bbb" },
    ],
    openings: [],
  };
  const rows = [
    {
      key: "101:f2:201",
      sourceFloorId: "f1",
      sourceFloorName: "Floor 1",
      sourceUnit: "101",
      sourceRoomCount: 2,
      targetFloorId: "f2",
      targetFloorName: "Floor 2",
      targetUnit: "201",
      status: "existing",
      reason: "Target already exists",
    },
  ];

  const result = helper.reconcileDemoInterior(scene, "f1", rows, makeId);
  assert.equal(result.removed.length, 1);
  assert.equal(result.furniture.some((item) => item.id === "wrong-bed"), false);
  assert.ok(result.furniture.some((item) => item.roomId === sourceBed.id && item.kind === "bed"));
  assert.ok(result.furniture.some((item) => item.roomId === targetLiving.id && item.kind === "sofa"));
  assert.ok(result.furniture.some((item) => item.roomId === targetBed.id && item.kind === "bed"));

  const rerun = helper.reconcileDemoInterior(
    { ...scene, furniture: result.furniture },
    "f1",
    rows,
    makeId,
  );
  assert.equal(rerun.removed.length, 0);
  assert.equal(rerun.createdTypical.length, 0);
  assert.equal(rerun.createdRepeated.length, 0);
});

test("Studio exposes the two-step interior automation instead of a bulk blind rollout", () => {
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  assert.match(studio, /Prepare demo interior/);
  assert.match(studio, /Repeat interior to upper floors/);
  assert.match(studio, /Demo interior ready ✓/);
  assert.match(studio, /Fix misplaced furniture/);
  assert.match(studio, /auditDemoInterior\(p\.scene\)/);
  assert.match(studio, /reconcileDemoInterior\(/);
  assert.match(studio, /interiorAutomation\?\.autoReconcile/);
  assert.match(studio, /quickSourceSetup\.interiorAutomation\?\.enabled/);
  assert.doesNotMatch(studio, /jyoti-paradise/i);
});


test("Jyoti profile opts into generic interior automation capability", () => {
  const profiles = fs.readFileSync(
    "project-profiles/studio-source-profiles.ts",
    "utf8",
  );
  const setup = fs.readFileSync(
    "apps/admin/src/studio/sourcePackSetup.ts",
    "utf8",
  );
  assert.match(profiles, /interiorAutomation: \{ enabled: true, autoReconcile: true \}/);
  assert.match(setup, /interiorAutomation\?: ProfileInteriorAutomation/);
  assert.match(setup, /autoReconcile\?: boolean/);
  assert.match(setup, /interiorAutomation: profile\.interiorAutomation/);
});
