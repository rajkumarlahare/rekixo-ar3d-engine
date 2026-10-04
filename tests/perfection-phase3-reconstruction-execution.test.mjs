import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const executor = fs.readFileSync(
  "apps/admin/src/studio/applyBuildingReconstruction.ts",
  "utf8",
);
const pipeline = fs.readFileSync(
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "utf8",
);

test("Phase 3 execution applies only model-backed auto-ready rows", () => {
  assert.match(executor, /plan\.mode !== "model-backed"/);
  assert.match(executor, /plan\.floors\.filter\(\(floor\) => floor\.status === "auto-ready"\)/);
  assert.match(executor, /sourceAudit\(analysis, row\.geometrySourceAssetId\)/);
});

test("Phase 3 executor rechecks live human ownership before mutation", () => {
  assert.match(executor, /function executionProtection/);
  assert.match(executor, /authoredRooms/);
  assert.match(executor, /wall\.reviewed \|\| wall\.origin === "manual"/);
  assert.match(executor, /opening\.reviewed \|\| !opening\.sourceNodeName/);
  assert.match(executor, /entry\.reviewed \|\| entry\.origin === "manual"/);
  assert.match(executor, /item\.origin === undefined/);
  assert.match(executor, /Phase 3 preserved/);
});

test("Phase 3 executor does not invent wall height or thickness defaults", () => {
  assert.match(executor, /function modelWallDimensions/);
  assert.match(executor, /candidate\.size\[1\] \* scale/);
  assert.match(executor, /Math\.min\(candidate\.size\[0\], candidate\.size\[2\]\) \* scale/);
  assert.match(executor, /sourceWidth \?\? dimensions\.thickness/);
  assert.match(executor, /will not invent vertical dimensions/);
  assert.doesNotMatch(executor, /height:\s*2\.8/);
  assert.doesNotMatch(executor, /thickness:\s*0\.12/);
});

test("Phase 3 executor revalidates registration and closed topology", () => {
  assert.match(executor, /estimateCadModelRegistration/);
  assert.match(executor, /registration\.confidence < 0\.68/);
  assert.match(executor, /registration\.ambiguous/);
  assert.match(executor, /regularizeWallTopology/);
  assert.match(executor, /deriveAutoRoomDrafts/);
  assert.match(executor, /did not form a safe closed room topology/);
});

test("Phase 3 retirement is limited to machine-derived dependent content", () => {
  assert.match(executor, /!opening\.reviewed &&\s*Boolean\(opening\.sourceNodeName\)/);
  assert.match(executor, /item\.origin !== undefined/);
  assert.match(executor, /oldRoomIds/);
  assert.match(executor, /retiredOpeningIds/);
  assert.match(executor, /retiredFurnitureIds/);
});

test("pipeline executes reconstruction before semantic and structured evidence fusion", () => {
  const intelligence = pipeline.indexOf("buildDeepSourceIntelligence(");
  const plan = pipeline.indexOf("buildBuildingReconstructionPlan(");
  const execute = pipeline.indexOf("applyBuildingReconstructionPlan(");
  const phase2 = pipeline.indexOf("applyPhase2CadFusion(");
  const structured = pipeline.indexOf("fuseRoomSheetEvidence(");
  assert.ok(intelligence >= 0);
  assert.ok(plan > intelligence);
  assert.ok(execute > plan);
  assert.ok(phase2 > execute);
  assert.ok(structured > phase2);
  assert.match(pipeline, /reconstructionExecution: BuildingReconstructionExecution/);
  assert.match(pipeline, /\.\.\.reconstructionExecution\.issues/);
});
