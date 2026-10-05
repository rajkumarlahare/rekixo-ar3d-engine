import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

function asDataUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

function transpile(path) {
  return ts.transpileModule(fs.readFileSync(path, "utf8"), {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

async function loadGestureKernel() {
  const pointerUrl = asDataUrl(
    transpile("packages/engine-core/src/editor/pointer.ts"),
  );
  const gestureJs = transpile("packages/engine-core/src/editor/gesture.ts").replace(
    '"./pointer"',
    JSON.stringify(pointerUrl),
  );
  return import(asDataUrl(gestureJs));
}

test("Phase 4 gesture ownership prevents secondary touch from stealing an edit", async () => {
  const { beginPointerGesture, updatePointerGesture, finishPointerGesture } =
    await loadGestureKernel();
  const session = beginPointerGesture({
    pointerId: 11,
    pointerType: "touch",
    clientX: 100,
    clientY: 100,
  });
  const foreign = updatePointerGesture(session, {
    pointerId: 12,
    pointerType: "touch",
    clientX: 180,
    clientY: 150,
  });
  assert.equal(foreign.accepted, false);
  assert.equal(foreign.session, session);
  assert.equal(
    finishPointerGesture(session, {
      pointerId: 12,
      pointerType: "touch",
      clientX: 180,
      clientY: 150,
    }).kind,
    "ignored",
  );
});

test("Phase 4 keeps touch tap tolerance while activating deliberate drags", async () => {
  const { beginPointerGesture, updatePointerGesture, finishPointerGesture } =
    await loadGestureKernel();
  const start = {
    pointerId: 7,
    pointerType: "touch",
    clientX: 20,
    clientY: 20,
  };
  const session = beginPointerGesture(start);
  assert.equal(session.activationThreshold, 12);

  const jitter = updatePointerGesture(session, {
    ...start,
    clientX: 28,
  });
  assert.equal(jitter.session.activated, false);
  assert.equal(
    finishPointerGesture(jitter.session, { ...start, clientX: 28 }).kind,
    "tap",
  );

  const drag = updatePointerGesture(session, {
    ...start,
    clientX: 33,
  });
  assert.equal(drag.accepted, true);
  assert.equal(drag.session.activated, true);
  assert.equal(drag.activatedNow, true);
  assert.equal(
    finishPointerGesture(drag.session, { ...start, clientX: 33 }).kind,
    "drag",
  );
});

test("Phase 4 pointer cancellation is a non-committing terminal state", async () => {
  const { beginPointerGesture, finishPointerGesture } = await loadGestureKernel();
  const start = {
    pointerId: 3,
    pointerType: "pen",
    clientX: 42,
    clientY: 51,
  };
  const session = beginPointerGesture(start);
  const completion = finishPointerGesture(
    session,
    { ...start, clientX: 80, clientY: 90 },
    { cancelled: true },
  );
  assert.equal(completion.accepted, true);
  assert.equal(completion.kind, "cancel");
});

test("shared gesture kernel stays exported after legacy canvas controller retirement", () => {
  const editorIndex = fs.readFileSync(
    "packages/engine-core/src/editor/index.ts",
    "utf8",
  );
  assert.match(editorIndex, /export \* from "\.\/gesture"/);
  assert.equal(
    fs.existsSync("apps/admin/src/studio/sceneCanvasArchitectureController.ts"),
    false,
  );
});
