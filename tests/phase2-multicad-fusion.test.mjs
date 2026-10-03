import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const fusion = fs.readFileSync(
  "apps/admin/src/studio/phase2CadFusion.ts",
  "utf8",
);
const pipeline = fs.readFileSync(
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "utf8",
);

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")),
    [],
  );
}

test("Phase 2 CAD fusion compiles and is wired after mature AutoBuild", () => {
  transpile(fusion, "phase2CadFusion.ts");
  transpile(pipeline, "autoBuildPipeline.ts");
  assert.match(pipeline, /applyPhase2CadFusion\(base\.project, base\.analysis\)/);
  assert.match(pipeline, /fuseRoomSheetEvidence\(\s*phase2\.project/);
  assert.match(pipeline, /phase2CadFusion: phase2\.summary/);
});

test("multi-CAD fusion stays fail-closed on duplicate floors and weak registration", () => {
  assert.match(fusion, /seenFloors\.has\(floorIndex\)/);
  assert.match(fusion, /will not silently mix competing floor plans/);
  assert.match(fusion, /registration\.ambiguous/);
  assert.match(fusion, /registration\.confidence < 0\.68/);
  assert.match(fusion, /cross-source fusion stayed review-only/);
});

test("each resolved CAD floor can contribute room semantics and stair-lift evidence", () => {
  assert.match(fusion, /semanticEvidenceForFloor/);
  assert.match(fusion, /classifyRoomSemanticText/);
  assert.match(fusion, /entry\.kind === "stair" \|\| entry\.kind === "lift"/);
  assert.match(fusion, /roomName: entry\.kind === "lift" \? "Lift" : "Stair"/);
  assert.match(fusion, /applyRoomSemanticEvidence\(scene, semanticEvidence\)/);
});

test("door-window fusion spans resolved CAD floors without overwriting human review", () => {
  assert.match(fusion, /for \(const row of resolution\.resolved\)/);
  assert.match(fusion, /fuseCadOpeningEvidence/);
  assert.match(fusion, /applyReadyOpeningWorkflow/);
  assert.match(fusion, /opening\.reviewed/);
  assert.match(fusion, /suggestion\.confidence \+ 0\.001 < \(opening\.confidence \?\? 0\)/);
});

test("ground/site and structural fusion remain source-backed and review gated", () => {
  assert.match(fusion, /groundSiteRows\.length === 1/);
  assert.match(fusion, /deriveSourceBackedSiteLandscape/);
  assert.match(fusion, /groundSiteRows\.length > 1/);
  assert.match(fusion, /applySourceBackedStructuralPrimitives/);
  assert.match(fusion, /structuralFootprints/);
  assert.match(fusion, /CAD\+3D|source-backed structural envelope/);
  assert.match(fusion, /did not invent missing height, footprint, orientation or source correspondence/);
});
