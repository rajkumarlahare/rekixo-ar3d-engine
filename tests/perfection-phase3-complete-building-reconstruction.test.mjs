import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const reconstruction = fs.readFileSync(
  "apps/admin/src/studio/buildingReconstructionPlan.ts",
  "utf8",
);
const pipeline = fs.readFileSync(
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "utf8",
);

test("Phase 3 plans building reconstruction floor-by-floor from explicit CAD identities", () => {
  assert.match(reconstruction, /buildBuildingReconstructionPlan/);
  assert.match(reconstruction, /cad\.geometryReady && cad\.floorIndices\.length === 1/);
  assert.match(reconstruction, /sourceLevel/);
  assert.match(reconstruction, /targetFloorId/);
  assert.match(reconstruction, /wallSegments/);
  assert.match(reconstruction, /openingSegments/);
  assert.match(reconstruction, /structuralEvidence/);
});

test("Phase 3 never silently chooses competing or ambiguous CAD geometry", () => {
  assert.match(reconstruction, /Multiple normalized CAD sources explicitly claim this floor/);
  assert.match(reconstruction, /no explicit single-floor identity/);
  assert.match(reconstruction, /will not duplicate one drawing across them automatically/);
  assert.match(reconstruction, /candidates\.length !== 1/);
  assert.match(reconstruction, /"review"/);
});

test("Phase 3 preserves reviewed and manual floor content", () => {
  assert.match(reconstruction, /Human-reviewed\/manual content already exists/);
  assert.match(reconstruction, /room\.verified/);
  assert.match(reconstruction, /wall\.reviewed/);
  assert.match(reconstruction, /wall\.origin === "manual"/);
  assert.match(reconstruction, /opening\.reviewed/);
  assert.match(reconstruction, /entry\.origin === "manual" \|\| entry\.reviewed/);
  assert.match(reconstruction, /item\.origin === undefined/);
  assert.match(reconstruction, /"preserve-existing"/);
});

test("model-backed reconstruction requires safe CAD to model registration", () => {
  assert.match(reconstruction, /estimateCadModelRegistration/);
  assert.match(reconstruction, /registration\.confidence < 0\.68/);
  assert.match(reconstruction, /registration\.ambiguous/);
  assert.match(reconstruction, /CAD-to-model registration is not reliable enough/);
});

test("basement floor mapping stays fail-closed unless scene identity is explicit", () => {
  assert.match(reconstruction, /level >= 0/);
  assert.match(reconstruction, /basements/);
  assert.match(reconstruction, /explicit-scene-floor/);
  assert.match(reconstruction, /targetBasis: FloorTargetBasis/);
});

test("PDF pages only corroborate a metric CAD reconstruction plan", () => {
  assert.match(reconstruction, /page\.role === "floor-plan"/);
  assert.match(reconstruction, /pdfCorroboration/);
  assert.doesNotMatch(reconstruction, /geometrySourceAssetId:\s*page\.sourceAssetId/);
});

test("AutoBuild exposes reconstruction plan and routes its unresolved items into certification", () => {
  assert.match(pipeline, /buildBuildingReconstructionPlan/);
  assert.match(pipeline, /reconstructionPlan: BuildingReconstructionPlan/);
  assert.match(pipeline, /\.\.\.reconstructionPlan\.issues/);
  assert.match(pipeline, /Phase 3 reconstruction/);
  assert.match(pipeline, /buildBuildingReconstructionPlan · reconstructionPlan · auto-ready/);
});
