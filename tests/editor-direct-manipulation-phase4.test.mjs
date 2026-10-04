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

test("direct plan drag preserves grab offset and snaps the object centre", async () => {
  const { resolveDirectPlanDrag } = await loadTs(
    "packages/engine-core/src/editor/directDrag.ts",
  );

  assert.deepEqual(
    resolveDirectPlanDrag([10, 20], [11, 21], [14, 25]),
    [13, 24],
  );
  assert.deepEqual(
    resolveDirectPlanDrag([1.03, 2.07], [1, 2], [1.18, 2.16], {
      gridSize: 0.1,
    }),
    [1.2, 2.2],
  );
  assert.throws(
    () => resolveDirectPlanDrag([0, 0], [0, 0], [1, 1], { gridSize: -1 }),
    /grid size/i,
  );
});

test("smart edge snap aligns footprint edges without changing object size", async () => {
  const { resolveEdgeSnap } = await loadTs(
    "packages/engine-core/src/editor/directDrag.ts",
  );

  assert.deepEqual(
    resolveEdgeSnap(
      [4.87, 8.12],
      [1, 2],
      { x: [6], z: [6] },
      { tolerance: 0.2 },
    ),
    { point: [5, 8], snappedX: true, snappedZ: true },
  );
  assert.deepEqual(
    resolveEdgeSnap([4.5, 8.5], [1, 2], { x: [6], z: [6] }, { tolerance: 0.2 }),
    { point: [4.5, 8.5], snappedX: false, snappedZ: false },
  );
  assert.throws(
    () => resolveEdgeSnap([0, 0], [-1, 1], { x: [], z: [] }),
    /half extents/i,
  );
});

test("direct manipulation controller is pointer-owned, cancel-safe and commits only at gesture end", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasDirectManipulation.ts",
    "utf8",
  );

  assert.match(source, /beginPointerGesture/);
  assert.match(source, /updatePointerGesture/);
  assert.match(source, /finishPointerGesture/);
  assert.match(source, /event\.type === "pointercancel"/);
  assert.match(source, /session\.previewTarget\.position\.copy\(session\.startLocal\)/);
  assert.match(source, /completion\.kind === "tap"/);
  assert.match(source, /completion\.kind === "cancel"/);

  const moveStart = source.indexOf("pointerMove(event: PointerEvent)");
  const upStart = source.indexOf("pointerUp(event: PointerEvent)", moveStart);
  assert.ok(moveStart >= 0 && upStart > moveStart);
  assert.doesNotMatch(source.slice(moveStart, upStart), /onTransformCommit/);
  assert.match(source.slice(upStart), /config\.onTransformCommit\?\.\(change\)/);
});

test("direct manipulation covers smart edge snapping and editable wall endpoint resizing", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasDirectManipulation.ts",
    "utf8",
  );
  const architecture = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasArchitecture.ts",
    "utf8",
  );

  for (const kind of ["room", "furniture", "site", "wall", "opening"])
    assert.match(source, new RegExp(`kind: "${kind}"`));

  assert.match(source, /config\.view === "walk"/);
  assert.match(source, /config\.transformMode \?\? "translate"/);
  assert.match(source, /authoringActive\(config\)/);
  assert.match(source, /options\.transform\.dragging/);
  assert.match(source, /options\.transform\.axis/);
  assert.match(source, /resolveEdgeSnap/);
  assert.match(source, /edgeSnapTargets/);
  assert.match(source, /gridSize: config\.snap && gridObject \? 0\.1 : 0/);
  assert.match(source, /wallEndpointHandle/);
  assert.match(source, /setWallEndpointPosition/);
  assert.match(source, /Wall endpoint resized/);
  assert.match(source, /Math\.hypot\(x - fixed\[0\], z - fixed\[1\]\) < 0\.2/);
  assert.match(architecture, /addWallEndpointHandle/);
  assert.match(architecture, /new T\.SphereGeometry\(0\.32/);
  assert.match(architecture, /userData\.wallEndpoint = endpoint/);
});

test("production SceneCanvas routes pointer down, move and up through direct manipulation", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );

  assert.match(source, /createDirectManipulationController/);
  assert.match(source, /snapPlanPoint: snapRoomPoint/);
  assert.match(source, /directManipulation\.pointerDown\(e\)/);
  assert.match(source, /directManipulation\.pointerMove\(e\)/);
  assert.match(source, /directManipulation\.pointerUp\(e\)/);
  assert.match(source, /addEventListener\("pointercancel", click\)/);
});
