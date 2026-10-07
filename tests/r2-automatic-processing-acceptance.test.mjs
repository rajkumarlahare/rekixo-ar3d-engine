import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "apps/admin/src/studio/automaticProcessingAcceptance.ts",
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const acceptance = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);

function input() {
  return {
    sourcePlan: {
      mode: "model-backed",
      sourceCount: 6,
      selectedModelAssetId: "fbx-authority",
      completeSixRoleSupportPack: true,
      structuredEvidenceCount: 0,
      planningIssues: [],
      groups: [
        { role: "model", assetIds: ["fbx-authority"], names: ["building.fbx"] },
        { role: "cad", assetIds: ["cad-1"], names: ["floor.dwg"] },
      ],
    },
    certificationReport: {
      overallStatus: "passed",
      checkCoveragePercent: 100,
      sourceRolesPresent: 6,
      sourceRolesTotal: 6,
      counts: { passed: 10, autoDerived: 0, needsReview: 0, blocked: 0 },
      checks: [],
      blockers: [],
      reviewItems: [],
    },
    geometryIntegrity: {
      schema: 1,
      kind: "rekixo-scene-geometry-integrity",
      overallStatus: "passed",
      counts: { blocker: 0, review: 0 },
      issues: [],
      checked: { floors: 5, rooms: 20, walls: 80, openings: 24 },
    },
    circulationHierarchy: {
      cores: [],
      counts: {
        sourceBackedElements: 4,
        boundCores: 2,
        reviewCores: 0,
        singletonEvidence: 0,
        ambiguousBindings: 0,
        unresolvedFloorEvidence: 0,
      },
      issues: [],
    },
    unitHierarchy: {
      units: [],
      counts: {
        sourceBackedUnits: 10,
        reviewUnits: 0,
        sourceBackedRooms: 20,
        unprovenUnitRooms: 0,
        circulationLinks: 10,
        unresolvedCirculationMembers: 0,
      },
      issues: [],
    },
    sceneFingerprint: "a".repeat(64),
  };
}

test("R2 acceptance passes only fully source-backed deterministic processing", () => {
  const report = acceptance.buildAutomaticProcessingAcceptance(input());
  assert.equal(report.status, "accepted");
  assert.equal(report.canBuildPresentation, true);
  assert.equal(report.canPublishWithoutReview, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.reviewItems.length, 0);
});

test("R2 acceptance keeps unresolved hierarchy reviewable without inventing review", () => {
  const value = input();
  value.unitHierarchy.counts.unprovenUnitRooms = 2;
  value.unitHierarchy.counts.unresolvedCirculationMembers = 1;
  const report = acceptance.buildAutomaticProcessingAcceptance(value);
  assert.equal(report.status, "review-required");
  assert.equal(report.canBuildPresentation, true);
  assert.equal(report.canPublishWithoutReview, false);
  assert.match(report.reviewItems.join(" "), /3 hierarchy evidence items/);
});

test("R2 acceptance fails closed for ambiguous geometry authority or blockers", () => {
  const value = input();
  delete value.sourcePlan.selectedModelAssetId;
  value.geometryIntegrity.counts.blocker = 1;
  const report = acceptance.buildAutomaticProcessingAcceptance(value);
  assert.equal(report.status, "blocked");
  assert.equal(report.canBuildPresentation, false);
  assert.equal(report.canPublishWithoutReview, false);
  assert.equal(report.blockers.length, 2);
});

test("R2 acceptance treats CAD-only authority as review-gated, never auto-approved", () => {
  const value = input();
  value.sourcePlan.mode = "cad-only";
  delete value.sourcePlan.selectedModelAssetId;
  const report = acceptance.buildAutomaticProcessingAcceptance(value);
  assert.equal(report.status, "review-required");
  assert.equal(report.canBuildPresentation, true);
  assert.equal(report.canPublishWithoutReview, false);
  assert.match(report.reviewItems[0], /CAD-only reconstruction remains review-gated/);
});
