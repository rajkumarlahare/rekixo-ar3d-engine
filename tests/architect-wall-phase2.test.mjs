import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

async function loadTs(path) {
  const source = fs.readFileSync(path, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64")
  );
}

test("architect angle assist snaps to global and wall-relative directions", async () => {
  const { constrainPlanAngle } = await loadTs(
    "packages/engine-core/src/editor/snap.ts",
  );

  const global = constrainPlanAngle([0, 0], [0.08, 3], {
    incrementDegrees: 15,
    toleranceDegrees: 4,
  });
  assert.equal(global.snapped, true);
  assert.equal(Math.round(global.snappedAngleDegrees), 90);
  assert.ok(Math.abs(global.point[0]) < 0.001);

  const relative = constrainPlanAngle([0, 0], [-1.48, 2.6], {
    incrementDegrees: 45,
    toleranceDegrees: 4,
    referenceAnglesDegrees: [30],
  });
  assert.equal(relative.snapped, true);
  assert.equal(Math.round(relative.snappedAngleDegrees), 120);
});

test("plan topology detects one bounded room and ignores the outside face", async () => {
  const { detectPlanFaces } = await loadTs(
    "packages/engine-core/src/editor/topology.ts",
  );
  const faces = detectPlanFaces([
    { start: [0, 0], end: [4, 0] },
    { start: [4, 0], end: [4, 3] },
    { start: [4, 3], end: [0, 3] },
    { start: [0, 3], end: [0, 0] },
  ]);
  assert.equal(faces.length, 1);
  assert.equal(faces[0].area, 12);
  assert.equal(faces[0].points.length, 4);
});

test("plan topology splits T/intersection points and detects adjacent rooms sharing walls", async () => {
  const { detectPlanFaces } = await loadTs(
    "packages/engine-core/src/editor/topology.ts",
  );
  const faces = detectPlanFaces([
    { start: [0, 0], end: [4, 0] },
    { start: [4, 0], end: [4, 3] },
    { start: [4, 3], end: [0, 3] },
    { start: [0, 3], end: [0, 0] },
    { start: [2, 0], end: [2, 3] },
  ]);
  assert.equal(faces.length, 2);
  assert.deepEqual(
    faces.map((face) => face.area).sort((a, b) => a - b),
    [6, 6],
  );
});

test("SceneCanvas has a real pointer wall authoring path with semantic snapping", () => {
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );
  const hints = fs.readFileSync(
    "apps/admin/src/studio/CanvasAuthoringHints.tsx",
    "utf8",
  );

  assert.match(canvas, /wallDraw\?:/);
  assert.match(canvas, /wallPlanePoint/);
  assert.match(canvas, /wallDraft/);
  assert.match(canvas, /onWallDraw/);
  assert.match(canvas, /constrainPlanAngle/);
  assert.match(canvas, /referenceAnglesDegrees: wallReferenceAngles/);
  assert.match(canvas, /segments: planSegmentsForFloor/);
  assert.match(canvas, /marker\.name = `Wall · \$\{wall\.origin\}`/);
  assert.match(hints, /Drag wall start/);
});

test("Studio persists validated manual walls and derives unverified room drafts from closed faces", () => {
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");

  assert.match(studio, /function commitMappedWall/);
  assert.match(studio, /origin: "manual"/);
  assert.match(studio, /reviewed: true/);
  assert.match(studio, /confidence: 1/);
  assert.match(studio, /linkWallsToRooms/);
  assert.match(studio, /function generateRoomsFromManualWalls/);
  assert.match(studio, /detectPlanFaces/);
  assert.match(studio, /\[manual-wall-face:/);
  assert.match(studio, /verified: false/);
  assert.match(studio, /validateProject\(next\)/);
  assert.match(studio, /onWallDraw=\{commitMappedWall\}/);
});

test("Architect wall UI supports sizing, safe deletion and closed-room detection", () => {
  const mapper = fs.readFileSync(
    "apps/admin/src/studio/VisualRoomMapper.tsx",
    "utf8",
  );
  const css = fs.readFileSync(
    "apps/admin/src/studio/studio-editor-core.css",
    "utf8",
  );

  assert.match(mapper, /ARCHITECT MODE · PARAMETRIC WALLS/);
  assert.match(mapper, /\+ Draw wall/);
  assert.match(mapper, /Wall thickness/);
  assert.match(mapper, /Wall height/);
  assert.match(mapper, /Detect closed rooms/);
  assert.match(mapper, /selectedWall\.origin !== "manual"/);
  assert.match(css, /\.room-mapper-architect/);
  assert.match(css, /@media \(max-width: 820px\)/);
});

test("Phase 2 remains additive to the current immutable public manifest boundary", () => {
  const manifest = fs.readFileSync(
    "apps/admin/src/studio/manifestV2.ts",
    "utf8",
  );
  const doc = fs.readFileSync(
    "docs/EDITOR-KERNEL-PHASE-1.md",
    "utf8",
  );
  assert.match(manifest, /SCENE_MANIFEST_VERSION/);
  assert.match(doc, /does not replace the current Studio `Scene` persistence/);
});
