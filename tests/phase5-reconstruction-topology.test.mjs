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

const topology = await import(
  asUrl(compile("apps/admin/src/studio/wallTopology.ts")),
);

function wall(id, start, end, overrides = {}) {
  return {
    id,
    floorId: "f0",
    roomIds: [],
    start,
    end,
    thickness: 0.15,
    height: 2.8,
    reviewed: false,
    origin: "model-auto",
    confidence: 0.9,
    reviewState: "suggested",
    ...overrides,
  };
}

function pointKey(point) {
  return point.map((value) => value.toFixed(4)).join(",");
}

test("Phase 5 heals only small plausible endpoint gaps so room loops can close", () => {
  const result = topology.regularizeWallTopology([
    wall("bottom", [0, 0], [4, 0]),
    wall("right", [4.05, 0.04], [4, 3]),
    wall("top", [4, 3], [0, 3]),
    wall("left", [0, 3], [0, 0]),
  ]);

  assert.ok(result.snappedEndpoints >= 2);
  const bottom = result.walls.find((entry) => entry.id === "bottom");
  const right = result.walls.find((entry) => entry.id === "right");
  assert.ok(bottom);
  assert.ok(right);
  assert.equal(pointKey(bottom.end), pointKey(right.start));
});

test("Phase 5 does not collapse nearby parallel wall faces into one line", () => {
  const result = topology.regularizeWallTopology([
    wall("face-a", [0, 0], [4, 0], { origin: "cad-auto" }),
    wall("face-b", [0, 0.06], [4, 0.06], { origin: "cad-auto" }),
  ]);

  assert.equal(result.snappedEndpoints, 0);
  assert.equal(result.duplicatesRemoved, 0);
  assert.equal(result.walls.length, 2);
  assert.notEqual(
    pointKey(result.walls[0].start),
    pointKey(result.walls[1].start),
  );
});

test("Phase 5 nodes true T intersections without inventing connecting walls", () => {
  const result = topology.regularizeWallTopology([
    wall("horizontal", [0, 0], [4, 0]),
    wall("vertical", [2, -2], [2, 0]),
  ]);

  assert.equal(result.intersectionSplits, 1);
  assert.equal(result.walls.length, 3);
  const horizontalParts = result.walls.filter((entry) =>
    entry.id.startsWith("horizontal-topo-"),
  );
  assert.equal(horizontalParts.length, 2);
  assert.ok(
    horizontalParts.every(
      (entry) =>
        pointKey(entry.start) === "2.0000,0.0000" ||
        pointKey(entry.end) === "2.0000,0.0000",
    ),
  );
});

test("Phase 5 removes coincident source duplicates and keeps higher-authority CAD evidence", () => {
  const result = topology.regularizeWallTopology([
    wall("model-wall", [0, 0], [4, 0], {
      origin: "model-auto",
      confidence: 0.98,
    }),
    wall("cad-wall", [4, 0], [0, 0], {
      origin: "cad-auto",
      confidence: 0.9,
    }),
  ]);

  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.walls.length, 1);
  assert.equal(result.walls[0].id, "cad-wall");
  assert.equal(result.walls[0].origin, "cad-auto");
});

test("Phase 5 removes unsafe tiny automatic fragments", () => {
  const result = topology.regularizeWallTopology([
    wall("tiny", [0, 0], [0.04, 0]),
    wall("real", [0, 0], [4, 0]),
  ]);

  assert.equal(result.tinySegmentsRemoved, 1);
  assert.deepEqual(result.walls.map((entry) => entry.id), ["real"]);
});

test("Phase 5 Smart Draft regularizes fused source walls before automatic rooms", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/smartDraftBuilder.ts",
    "utf8",
  );
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );

  assert.match(builder, /regularizeWallTopology/);
  assert.match(builder, /const topology = regularizeWallTopology/);
  assert.match(builder, /deriveAutoRoomDrafts\(walls/);
  assert.match(builder, /topologySnappedEndpoints/);
  assert.match(pipeline, /topologyIntersectionSplits/);
  assert.match(pipeline, /topology: .*endpoint snap/);
});
