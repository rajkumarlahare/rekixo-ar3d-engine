import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "apps/public/src/viewer/floorGeometry.ts",
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const mod = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);

const {
  floorForElevation,
  floorGeometryFor,
  floorGeometryFromBoundaries,
  floorEyeElevation,
  resolveFloorGeometry,
} = mod;

test("profile floor geometry supports arbitrary floor counts without seven-level assumptions", () => {
  const floors = [-2, 0, 3, 9];
  const boundaries = [-6, -3, 0, 4.2, 9.7];
  const geometry = floorGeometryFromBoundaries(floors, boundaries);
  assert.deepEqual(
    geometry.map((item) => [
      item.floor,
      item.elevationM,
      item.topElevationM,
      item.source,
    ]),
    [
      [-2, -6, -3, "profile"],
      [0, -3, 0, "profile"],
      [3, 0, 4.2, "profile"],
      [9, 4.2, 9.7, "profile"],
    ],
  );
});

test("explicit scene elevations override a profile and preserve sparse IDs", () => {
  const profile = floorGeometryFromBoundaries(
    [0, 1, 2],
    [0, 3, 6, 9],
  );
  const geometry = resolveFloorGeometry({
    floorIds: [-1, 2, 8],
    minY: -4,
    maxY: 14,
    profile,
    scene: [
      { floor: -1, elevationM: -4, topElevationM: -0.5 },
      { floor: 2, elevationM: 1.25, topElevationM: 5.5 },
      { floor: 8, elevationM: 9, topElevationM: 14 },
    ],
  });

  assert.deepEqual(
    geometry.map((item) => item.floor),
    [-1, 2, 8],
  );
  assert.equal(floorGeometryFor(geometry, 2)?.elevationM, 1.25);
  assert.equal(floorGeometryFor(geometry, 8)?.topElevationM, 14);
  assert.ok(geometry.every((item) => item.source === "scene"));
});

test("missing source elevations fail closed instead of dividing the model into equal bands", () => {
  const geometry = resolveFloorGeometry({
    floorIds: [-3, 4, 20],
    minY: -9,
    maxY: 12,
  });
  assert.deepEqual(geometry, []);
});

test("floor lookup uses physical elevation rather than floor array index", () => {
  const geometry = resolveFloorGeometry({
    floorIds: [0, 2, 7],
    minY: 0,
    maxY: 12,
    scene: [
      { floor: 0, elevationM: 0, topElevationM: 2.8 },
      { floor: 2, elevationM: 4.4, topElevationM: 7.1 },
      { floor: 7, elevationM: 10.2, topElevationM: 12 },
    ],
  });

  assert.equal(floorForElevation(geometry, 1)?.floor, 0);
  assert.equal(floorForElevation(geometry, 5)?.floor, 2);
  assert.equal(floorForElevation(geometry, 11)?.floor, 7);
  assert.equal(floorForElevation(geometry, 8), undefined);
});

test("walk eye elevation stays inside the selected physical floor band", () => {
  const level = {
    floor: 42,
    elevationM: 30,
    topElevationM: 31.8,
    source: "scene",
  };
  const eye = floorEyeElevation(level);
  assert.ok(eye > level.elevationM);
  assert.ok(eye < level.topElevationM);
});

test("runtime no longer carries the fixed G+5 slicing formula", () => {
  const realism = fs.readFileSync(
    "apps/public/src/viewer/realism.ts",
    "utf8",
  );
  const walkthrough = fs.readFileSync(
    "apps/public/src/viewer/walkthrough.ts",
    "utf8",
  );
  const viewer = fs.readFileSync(
    "apps/public/src/viewer/Viewer3D.tsx",
    "utf8",
  );

  assert.doesNotMatch(realism, /levels\.length === 7|0\.132|ratio < 0\.12|clamp\([\s\S]*1,[\s\S]*5/);
  assert.doesNotMatch(walkthrough, /0\.132|lowerRatio|upperRatio/);
  assert.doesNotMatch(viewer, /floorIndex|floorIndex \+ 1/);
  assert.match(viewer, /resolveFloorGeometry/);
  assert.match(viewer, /floorGeometryFor\(resolvedFloorGeometry, floor\)/);
  assert.match(viewer, /floorFocusElevation/);
});

test("walk collision is resolved through a dedicated collider abstraction", () => {
  const walkthrough = fs.readFileSync(
    "apps/public/src/viewer/walkthrough.ts",
    "utf8",
  );
  const viewer = fs.readFileSync(
    "apps/public/src/viewer/Viewer3D.tsx",
    "utf8",
  );
  assert.match(walkthrough, /collectWalkColliders/);
  assert.match(walkthrough, /walkCollision === false/);
  assert.match(walkthrough, /walkCollision === true/);
  assert.match(viewer, /walkColliders = collectWalkColliders/);
  assert.doesNotMatch(
    viewer,
    /const obstacles: THREE\.Object3D\[\] = \[\][\s\S]*traverseVisible/,
  );
});
