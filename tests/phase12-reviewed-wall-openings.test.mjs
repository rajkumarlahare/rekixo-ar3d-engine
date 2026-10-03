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

const semantic = await import(
  asUrl(compile("apps/public/src/viewer/semanticInteriorRuntime.ts")),
);
const pieces = await import(
  asUrl(compile("apps/public/src/viewer/wallOpeningPieces.ts")),
);

const wall = {
  id: "wall-1",
  floorId: "floor-1",
  roomIds: ["room-a", "room-b"],
  start: [-3, 0],
  end: [3, 0],
  elevation: 0,
  thickness: 0.15,
  height: 3,
};

test("Phase 12 reviewed door becomes a real full-height wall gap below the lintel", () => {
  const result = pieces.buildReviewedWallPieces(wall, [
    {
      id: "door-1",
      floorId: "floor-1",
      kind: "door",
      roomIds: ["room-a", "room-b"],
      x: 0,
      y: 1.05,
      z: 0,
      width: 1,
      height: 2.1,
      rotationY: 0,
    },
  ]);

  assert.equal(result.length, 3);
  const lintel = result.find(
    (piece) => piece.from < 3 && piece.to > 3 && piece.bottom > 2,
  );
  assert.ok(lintel);
  assert.equal(lintel.bottom, 2.1);
  assert.equal(lintel.top, 3);
  assert.equal(
    result.some(
      (piece) =>
        piece.from < 3 &&
        piece.to > 3 &&
        piece.bottom < 2.1,
    ),
    false,
  );

  const renderedVolume = result.reduce(
    (sum, piece) =>
      sum + piece.length * piece.height * piece.thickness,
    0,
  );
  const expected = 6 * 3 * 0.15 - 1 * 2.1 * 0.15;
  assert.ok(Math.abs(renderedVolume - expected) < 1e-9);
});

test("Phase 12 reviewed window keeps wall below sill and above the opening", () => {
  const result = pieces.buildReviewedWallPieces(wall, [
    {
      id: "window-1",
      floorId: "floor-1",
      kind: "window",
      roomIds: ["room-a"],
      x: 0,
      y: 1.5,
      z: 0.02,
      width: 1.4,
      height: 1.2,
      sillHeight: 0.9,
      rotationY: 0,
    },
  ]);

  assert.ok(
    result.some(
      (piece) =>
        piece.from < 3 &&
        piece.to > 3 &&
        piece.bottom === 0 &&
        Math.abs(piece.top - 0.9) < 1e-9,
    ),
  );
  assert.ok(
    result.some(
      (piece) =>
        piece.from < 3 &&
        piece.to > 3 &&
        Math.abs(piece.bottom - 2.1) < 1e-9 &&
        piece.top === 3,
    ),
  );
});

test("Phase 12 unrelated reviewed opening cannot cut a different room wall", () => {
  const result = pieces.buildReviewedWallPieces(wall, [
    {
      id: "door-other",
      floorId: "floor-1",
      kind: "door",
      roomIds: ["room-x"],
      x: 0,
      y: 1,
      z: 0,
      width: 1,
      height: 2,
      rotationY: 0,
    },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 6);
  assert.equal(result[0].height, 3);
});

test("Phase 12 derives only reviewed walls/openings in model-local coordinates", () => {
  const runtime = semantic.deriveSemanticInteriorFromStudio({
    scene: {
      scale: 2,
      modelTransform: { x: 10, y: 2, z: 20, rotationY: 90 },
      floors: [{ id: "floor-1", name: "Ground", elevation: 4 }],
      rooms: [
        {
          id: "room-a",
          floorId: "floor-1",
          name: "Living Room",
          unit: "Flat 101",
          x: 12,
          z: 22,
          width: 4,
          depth: 4,
          height: 6,
          color: "#d8e8e2",
          verified: true,
        },
      ],
      walls: [
        {
          id: "wall-reviewed",
          floorId: "floor-1",
          roomIds: ["room-a"],
          start: [10, 20],
          end: [14, 20],
          thickness: 0.3,
          height: 6,
          reviewed: true,
        },
        {
          id: "wall-draft",
          floorId: "floor-1",
          roomIds: ["room-a"],
          start: [10, 24],
          end: [14, 24],
          thickness: 0.3,
          height: 6,
          reviewed: false,
        },
      ],
      openings: [
        {
          id: "door-reviewed",
          floorId: "floor-1",
          kind: "door",
          roomIds: ["room-a"],
          x: 12,
          y: 6,
          z: 20,
          width: 2,
          height: 4,
          rotationY: 90,
          reviewed: true,
        },
        {
          id: "window-draft",
          floorId: "floor-1",
          kind: "window",
          roomIds: ["room-a"],
          x: 13,
          y: 6,
          z: 20,
          width: 2,
          height: 2,
          sillHeight: 2,
          rotationY: 90,
          reviewed: false,
        },
      ],
    },
  });

  assert.ok(runtime);
  assert.equal(runtime.walls.length, 1);
  assert.equal(runtime.openings.length, 1);
  assert.equal(runtime.walls[0].elevation, 1);
  assert.equal(runtime.walls[0].height, 3);
  assert.equal(runtime.walls[0].thickness, 0.15);
  assert.deepEqual(runtime.walls[0].start, [0, 0]);
  assert.ok(Math.abs(runtime.walls[0].end[0]) < 1e-9);
  assert.ok(Math.abs(runtime.walls[0].end[1] - 2) < 1e-9);
  assert.equal(runtime.openings[0].width, 1);
  assert.equal(runtime.openings[0].height, 2);
});

test("Phase 12 public runtime loads semantic Studio experience without project-specific code", () => {
  const api = fs.readFileSync("apps/public/src/api.ts", "utf8");
  const profiles = fs.readFileSync(
    "apps/public/src/viewer/projectProfiles.ts",
    "utf8",
  );
  const renderer = fs.readFileSync(
    "apps/public/src/viewer/semanticStudioExperience.ts",
    "utf8",
  );

  assert.match(api, /deriveSemanticInteriorFromStudio/);
  assert.match(api, /setSemanticInteriorRuntime/);
  assert.match(profiles, /createSemanticStudioExperience/);
  assert.doesNotMatch(profiles, /jyoti-paradise/i);
  assert.match(renderer, /buildAllReviewedWallPieces/);
  assert.match(renderer, /Reviewed walls with opening cuts/);
  assert.match(renderer, /opening\.kind !== "window"/);
});
