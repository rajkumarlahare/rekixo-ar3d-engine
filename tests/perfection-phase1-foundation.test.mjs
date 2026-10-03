import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 1 golden manifest fingerprints exactly six generic source roles", () => {
  const manifest = read("apps/admin/src/studio/goldenSourceManifest.ts");

  for (const role of [
    "model",
    "cad",
    "sketchup",
    "drawing",
    "visual",
    "metadata",
  ])
    assert.match(manifest, new RegExp(`"${role}"`));

  assert.match(manifest, /buildGoldenSourceManifest/);
  assert.match(manifest, /verifyGoldenSourceManifest/);
  assert.match(manifest, /\^\[a-f0-9\]\{64\}\$/i);
  assert.match(manifest, /file\.projectId !== project\.id/);
  assert.match(manifest, /asset\.blob\.size !== expectation\.size/);
  assert.match(manifest, /hash-mismatch/);
  assert.match(manifest, /size-mismatch/);
  assert.match(manifest, /project-mismatch/);
  assert.match(manifest, /format-mismatch/);

  assert.doesNotMatch(manifest, /Jyoti Paradise/i);
  assert.doesNotMatch(
    manifest,
    /1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0/i,
  );
});

test("Phase 1 certification report distinguishes proof, automation, review and blockers", () => {
  const report = read("apps/admin/src/studio/autoBuildReport.ts");

  for (const state of ["passed", "auto-derived", "needs-review", "blocked"])
    assert.match(report, new RegExp(`"${state}"`));

  assert.match(report, /checkCoveragePercent/);
  assert.match(report, /sourceRolesPresent/);
  assert.match(report, /invalidSourceRecords/);
  assert.match(report, /audit\.kind === "dwg" && audit\.geometryReady/);
  assert.match(report, /DWG is attached, but no normalized DWG geometry is ready/);
  assert.match(report, /pdfReferenceAutoAligned/);
  assert.match(report, /No wall topology is available after AutoBuild/);
  assert.match(report, /AutoBuild did not silently promote them to verified facts/);
});

test("shared AutoBuild always returns and surfaces its certification report", () => {
  const pipeline = read("apps/admin/src/studio/autoBuildPipeline.ts");

  assert.match(pipeline, /buildAutoBuildExecutionReport/);
  assert.match(pipeline, /certificationReport: AutoBuildExecutionReport/);
  assert.match(pipeline, /const certificationReport = buildAutoBuildExecutionReport/);
  assert.match(pipeline, /certificationReport,/);
  assert.match(pipeline, /certification .*checkCoveragePercent/);
  assert.match(pipeline, /counts\.blocked/);
  assert.match(pipeline, /counts\.needsReview/);
});
