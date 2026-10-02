import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("apps/admin/src/studio/floorSkeleton.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const floors = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);

function scene(existing = [{ id: "ground", name: "Ground", elevation: 0 }]) {
  return {
    floors: existing,
    rooms: [],
    furniture: [],
    openings: [],
    scale: 1,
    modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
  };
}

const skeleton = [
  { key: "ground", name: "Ground", sourceElevation: 0, kind: "ground" },
  { key: "floor-1", name: "Floor 1", sourceElevation: 3.048, kind: "residential" },
  { key: "floor-2", name: "Floor 2", sourceElevation: 6.0452, kind: "residential" },
  { key: "roof", name: "Roof", sourceElevation: 9.0424, kind: "roof" },
];

test("source floor skeleton adds only missing model-derived levels", () => {
  const input = scene();
  const result = floors.applyFloorSkeleton(input, "sample-project", skeleton);
  assert.equal(result.added, 3);
  assert.equal(result.floors.length, 4);
  assert.equal(result.missing, 0);
  assert.equal(result.preferredFloorId, result.floorIdByKey["floor-1"]);
  assert.deepEqual(
    result.floors.map((floor) => floor.elevation),
    [0, 3.048, 6.0452, 9.0424],
  );
});

test("source floor skeleton is repeat-safe and tracks model scale/Y", () => {
  const first = floors.applyFloorSkeleton(
    { ...scene(), scale: 2, modelTransform: { x: 0, y: 1, z: 0, rotationY: 0 } },
    "sample-project",
    skeleton,
  );
  assert.deepEqual(
    first.floors.map((floor) => floor.elevation),
    [1, 7.096, 13.0904, 19.0848],
  );
  const repeated = floors.applyFloorSkeleton(
    {
      ...scene(first.floors),
      scale: 2,
      modelTransform: { x: 0, y: 1, z: 0, rotationY: 0 },
    },
    "sample-project",
    skeleton,
  );
  assert.equal(repeated.added, 0);
  assert.equal(repeated.floors.length, 4);
  assert.equal(repeated.missing, 0);
});

test("source skeleton never deletes existing manual floors", () => {
  const input = scene([
    { id: "ground", name: "Ground", elevation: 0 },
    { id: "manual", name: "Client mezzanine", elevation: 1.6 },
  ]);
  const result = floors.applyFloorSkeleton(input, "sample-project", skeleton);
  assert.ok(result.floors.some((floor) => floor.id === "manual"));
  assert.equal(result.floors.length, 5);
});

test("generic Smart Draft prepares model-derived floors without source profiles", () => {
  const smartDraft = fs.readFileSync(
    "apps/admin/src/studio/smartDraftBuilder.ts",
    "utf8",
  );
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );

  assert.match(smartDraft, /analysis\.floorCandidates/);
  assert.match(smartDraft, /suggestedElevations/);
  assert.match(smartDraft, /detectRepeatedFloors/);
  assert.match(builder, /Build automatically/);
  assert.doesNotMatch(builder, /SOURCE LOCK DETECTED/);
  assert.doesNotMatch(builder, /Exact SHA-256 source matches/);
});
