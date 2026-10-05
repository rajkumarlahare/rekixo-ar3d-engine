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

test("shared plan snap kernel preserves precise grid, vertex, midpoint and edge authoring", async () => {
  const { resolvePlanSnap } = await loadTs(
    "packages/engine-core/src/editor/snap.ts",
  );

  assert.deepEqual(
    resolvePlanSnap([1.04, 2.06], { gridSize: 0.1 }).point.map((v) =>
      Number(v.toFixed(3)),
    ),
    [1, 2.1],
  );

  const vertex = resolvePlanSnap([1.031, 2.031], {
    segments: [{ id: "wall-a", start: [1.03, 2.03], end: [4, 2.03] }],
  });
  assert.equal(vertex.kind, "vertex");
  assert.equal(vertex.sourceId, "wall-a");

  const midpoint = resolvePlanSnap([1.002, 0.002], {
    segments: [{ id: "wall-b", start: [0, 0], end: [2, 0] }],
  });
  assert.equal(midpoint.kind, "midpoint");

  const edge = resolvePlanSnap([0.47, 0.031], {
    segments: [{ id: "wall-c", start: [0, 0.03], end: [2, 0.03] }],
  });
  assert.equal(edge.kind, "edge");
  assert.deepEqual(
    edge.point.map((v) => Number(v.toFixed(3))),
    [0.47, 0.03],
  );
});

test("pointer gesture kernel gives touch a practical tap tolerance without changing mouse precision", async () => {
  const { isPointerTap, pointerActivationThreshold } = await loadTs(
    "packages/engine-core/src/editor/pointer.ts",
  );

  assert.equal(pointerActivationThreshold("mouse"), 5);
  assert.equal(pointerActivationThreshold("pen"), 7);
  assert.equal(pointerActivationThreshold("touch"), 12);
  assert.equal(
    isPointerTap(
      { clientX: 100, clientY: 100 },
      { clientX: 108, clientY: 100, pointerType: "touch" },
    ),
    true,
  );
  assert.equal(
    isPointerTap(
      { clientX: 100, clientY: 100 },
      { clientX: 108, clientY: 100, pointerType: "mouse" },
    ),
    false,
  );
});

test("bounded snapshot history keeps existing 40-step editor semantics behind one kernel", async () => {
  const { SnapshotHistory } = await loadTs(
    "packages/engine-core/src/editor/history.ts",
  );
  const history = new SnapshotHistory(2);
  history.record("v1");
  history.record("v2");
  history.record("v3");

  assert.equal(history.undoDepth, 2);
  assert.equal(history.undo("v4"), "v3");
  assert.equal(history.undo("v3"), "v2");
  assert.equal(history.canUndo, false);
  assert.equal(history.redo("v2"), "v3");
  history.record("branch");
  assert.equal(history.canRedo, false);
});

test("authoring document establishes wall-hosted openings without replacing current scene storage", async () => {
  const { createAuthoringDocument } = await loadTs(
    "packages/engine-core/src/editor/authoring.ts",
  );
  const document = createAuthoringDocument("jyoti-paradise");

  assert.equal(document.schema, "rekixo-authoring-v1");
  assert.equal(document.projectId, "jyoti-paradise");
  assert.deepEqual(document.walls, []);
  assert.deepEqual(document.openings, []);

  const source = fs.readFileSync(
    "packages/engine-core/src/editor/authoring.ts",
    "utf8",
  );
  assert.match(source, /wallId: AuthoringId/);
  assert.match(source, /offset: number/);
  assert.match(source, /placement: "floor" \| "wall" \| "ceiling" \| "site"/);
});

test("tool state machine covers reusable building and interior authoring primitives", async () => {
  const {
    createEditorToolState,
    beginEditorToolGesture,
    cancelEditorToolGesture,
  } = await loadTs("packages/engine-core/src/editor/toolState.ts");

  const armed = createEditorToolState("wall");
  assert.equal(armed.phase, "armed");
  const drawing = beginEditorToolGesture(armed, 7, [1, 2]);
  assert.equal(drawing.phase, "drawing");
  assert.equal(drawing.pointerId, 7);
  assert.equal(cancelEditorToolGesture(drawing).phase, "armed");

  const source = fs.readFileSync(
    "packages/engine-core/src/editor/toolState.ts",
    "utf8",
  );
  for (const tool of ["wall", "room-rectangle", "room-polygon", "door", "window", "furniture", "site-object", "measure"])
    assert.match(source, new RegExp(`"${tool}"`));
});

test("shared pointer kernel remains wired into read-only presentation while authoring kernels stay standalone", () => {
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/PresentationCanvas.tsx",
    "utf8",
  );
  const core = fs.readFileSync("packages/engine-core/src/index.ts", "utf8");

  assert.match(core, /export \* from "\.\/editor"/);
  assert.match(canvas, /isPointerTap/);
  assert.doesNotMatch(canvas, /resolvePlanSnap/);
  assert.doesNotMatch(canvas, /type PlanSegment/);
});
