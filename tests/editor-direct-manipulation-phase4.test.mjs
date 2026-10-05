import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const studioPath = (name) => path.join("apps/admin/src/studio", name);

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

test("corner resize keeps the opposite corner fixed and enforces minimum dimensions", async () => {
  const { resolvePlanCornerResize } = await loadTs(
    "packages/engine-core/src/editor/directDrag.ts",
  );

  assert.deepEqual(resolvePlanCornerResize([4, 6], "se", [3, 5]), {
    centre: [0.5, 1],
    width: 5,
    depth: 8,
    cornerPoint: [3, 5],
  });
  assert.deepEqual(
    resolvePlanCornerResize([4, 6], "nw", [1.9, 2.9], {
      minWidth: 0.5,
      minDepth: 0.5,
    }),
    {
      centre: [1.75, 2.75],
      width: 0.5,
      depth: 0.5,
      cornerPoint: [1.5, 2.5],
    },
  );
  assert.throws(
    () => resolvePlanCornerResize([0, 6], "se", [1, 1]),
    /positive/i,
  );
});

test("legacy SceneCanvas direct-manipulation controller stays retired", () => {
  assert.equal(fs.existsSync(studioPath("sceneCanvasDirectManipulation.ts")), false);
  assert.equal(fs.existsSync(studioPath("SceneCanvas.tsx")), false);
});
