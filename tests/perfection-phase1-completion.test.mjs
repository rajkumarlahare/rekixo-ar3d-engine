import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const fingerprintSource = fs.readFileSync(
  "apps/admin/src/studio/sceneReplayFingerprint.ts",
  "utf8",
);
const integritySource = fs.readFileSync(
  "apps/admin/src/studio/sceneGeometryIntegrity.ts",
  "utf8",
);
const queueSource = fs.readFileSync(
  "apps/admin/src/studio/actionableReviewQueue.ts",
  "utf8",
);
const pipelineSource = fs.readFileSync(
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "utf8",
);
const readinessSource = fs.readFileSync(
  "apps/admin/src/studio/readiness.ts",
  "utf8",
);
const publishSource = fs.readFileSync(
  "apps/admin/src/studio/StudioPublish.tsx",
  "utf8",
);

function transpile(source, fileName, jsx = false) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")),
    [],
  );
  return result.outputText;
}

async function importFingerprintModule() {
  const output = transpile(fingerprintSource, "sceneReplayFingerprint.ts");
  const url = `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  return import(url);
}

function sceneProject(ids, reverse = false) {
  const floor = { id: ids.floor, name: "Ground", elevation: 0 };
  const room = {
    id: ids.room,
    name: "Living",
    floorId: ids.floor,
    unit: "Flat A",
    x: 2,
    z: 2,
    width: 4,
    depth: 4,
    height: 3,
    color: "#d8e8e2",
    source: "test evidence",
    verified: false,
  };
  const wallA = {
    id: ids.wallA,
    floorId: ids.floor,
    roomIds: [ids.room],
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    height: 3,
    reviewed: false,
    origin: "cad-auto",
    reviewState: "auto_ready",
  };
  const wallB = {
    id: ids.wallB,
    floorId: ids.floor,
    roomIds: [ids.room],
    start: [4, 4],
    end: [0, 4],
    thickness: 0.2,
    height: 3,
    reviewed: false,
    origin: "cad-auto",
    reviewState: "auto_ready",
  };
  return {
    schema: 1,
    id: ids.project,
    name: "Replay test",
    updated: ids.updated,
    assets: [],
    releases: [],
    scene: {
      scale: 1,
      floors: [floor],
      rooms: [room],
      furniture: [
        {
          id: ids.furniture,
          kind: "table",
          roomId: ids.room,
          x: 0,
          z: 0,
          rotation: 0,
          color: "#93684c",
          origin: "source-auto",
        },
      ],
      walls: reverse ? [wallB, wallA] : [wallA, wallB],
      openings: [],
      siteElements: [],
      referenceLayers: [],
      modelNodeTags: [],
    },
  };
}

test("P1.5 normalized fingerprint ignores volatile IDs/order but changes with geometry", async () => {
  const module = await importFingerprintModule();
  const left = sceneProject({
    project: "project-a",
    floor: "floor-a",
    room: "room-a",
    wallA: "wall-a1",
    wallB: "wall-a2",
    furniture: "furniture-a",
    updated: "2026-10-03T00:00:00Z",
  });
  const right = sceneProject(
    {
      project: "project-b",
      floor: "floor-b",
      room: "room-b",
      wallA: "wall-b1",
      wallB: "wall-b2",
      furniture: "furniture-b",
      updated: "2030-01-01T00:00:00Z",
    },
    true,
  );

  const first = await module.buildNormalizedSceneFingerprint(left);
  const second = await module.buildNormalizedSceneFingerprint(right);
  assert.equal(first.hash, second.hash);
  assert.equal(first.normalization, "scene-v1");
  assert.match(first.hash, /^[a-f0-9]{64}$/);

  const changed = structuredClone(right);
  changed.scene.rooms[0].width = 4.25;
  const third = await module.buildNormalizedSceneFingerprint(changed);
  assert.notEqual(first.hash, third.hash);

  assert.equal(
    module.certifyDeterministicReplay([first, second]).state,
    "passed",
  );
  assert.equal(
    module.certifyDeterministicReplay([first, third]).state,
    "blocked",
  );
  assert.equal(module.certifyDeterministicReplay([first]).state, "pending");
});

test("P1.6 whole-scene validator is cross-entity and fail-closed", () => {
  transpile(integritySource, "sceneGeometryIntegrity.ts");
  assert.match(integritySource, /validateWholeSceneGeometry/);
  assert.match(integritySource, /floor-elevation-collision/);
  assert.match(integritySource, /floor-repeat-cycle/);
  assert.match(integritySource, /duplicate-room-geometry/);
  assert.match(integritySource, /duplicate-wall-geometry/);
  assert.match(integritySource, /wall-room-boundary-mismatch/);
  assert.match(integritySource, /opening-without-host-wall/);
  assert.match(integritySource, /opening-wider-than-wall/);
  assert.match(integritySource, /opening-room-host-mismatch/);
  assert.match(integritySource, /severity: opening\.reviewed \? "blocker" : "review"/);
  assert.match(integritySource, /This deliberately does not claim structural\/code compliance/);
});

test("P1.7 review queue is actionable and publish readiness consumes integrity blockers", () => {
  transpile(queueSource, "actionableReviewQueue.ts");
  transpile(readinessSource, "readiness.ts");
  transpile(publishSource, "StudioPublish.tsx", true);

  assert.match(queueSource, /buildActionableReviewQueue/);
  assert.match(queueSource, /action:/);
  assert.match(queueSource, /row\.status === "blocked" \? "blocker" : "review"/);
  assert.match(queueSource, /if \(room\.verified\) continue/);
  assert.match(queueSource, /if \(wall\.reviewed\) continue/);
  assert.match(queueSource, /if \(opening\.reviewed\) continue/);

  assert.match(readinessSource, /validateWholeSceneGeometry\(project\)/);
  assert.match(readinessSource, /buildActionableReviewQueue/);
  assert.match(readinessSource, /id: "scene-integrity"/);
  assert.match(readinessSource, /id: "actionable-review-queue"/);
  assert.match(readinessSource, /severity: "blocker"/);
  assert.match(readinessSource, /publishable: valid && blockers\.length === 0/);

  assert.match(publishSource, /data-testid="actionable-review-queue"/);
  assert.match(publishSource, /disabled=\{busy \|\| !readiness\.publishable\}/);
  assert.match(publishSource, /<strong>Next:<\/strong> \{item\.action\}/);
});

test("shared AutoBuild emits fingerprint, integrity report and actionable queue every run", () => {
  transpile(pipelineSource, "autoBuildPipeline.ts");
  assert.match(pipelineSource, /sceneFingerprint: NormalizedSceneFingerprint/);
  assert.match(pipelineSource, /geometryIntegrity: SceneGeometryIntegrityReport/);
  assert.match(pipelineSource, /reviewQueue: ActionableReviewQueue/);
  assert.match(pipelineSource, /await buildNormalizedSceneFingerprint/);
  assert.match(pipelineSource, /validateWholeSceneGeometry\(structured\.project\)/);
  assert.match(pipelineSource, /buildActionableReviewQueue/);
  assert.match(pipelineSource, /sceneFingerprint,/);
  assert.match(pipelineSource, /geometryIntegrity,/);
  assert.match(pipelineSource, /reviewQueue,/);
});
