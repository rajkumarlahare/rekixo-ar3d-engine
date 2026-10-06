import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FBX_PROCESSOR_CONTRACT,
  FBX_PROCESSOR_EXECUTION,
  FBX_PROCESSOR_VERSION,
  MAX_FBX_BYTES,
  inspectGlbBuffer,
  validateFbxRequestHeaders,
} from "../services/model-processor/server.mjs";
import {
  FBX_SCALE_SANITY_POLICY,
  MAX_CANONICAL_BUILDING_MAX_DIMENSION_M,
  MIN_CANONICAL_BUILDING_MAX_DIMENSION_M,
  assessCanonicalBuildingScale,
  metreScaleFromFbxUnitScaleFactor,
  reviewedMetresPerSourceUnit,
} from "../scripts/asset-pipeline/convert-source-fbx.mjs";

function validHeaders() {
  return new Headers({
    "x-rekixo-source-file-id": "source_test_12345",
    "x-rekixo-source-pack-id": "pack_test_12345",
    "x-rekixo-processing-job-id": "job_test_12345",
    "x-rekixo-source-sha256": "a".repeat(64),
    "x-rekixo-source-name": encodeURIComponent("Building authority.fbx"),
  });
}

function minimalGlb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" } }));
  const padding = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const total = 12 + 8 + jsonChunk.length;
  const glb = Buffer.alloc(total);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonChunk.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(glb, 20);
  return glb;
}

test("FBX processor contract pins V4 source/job provenance and reviewed-scale execution", () => {
  const identity = validateFbxRequestHeaders(validHeaders());
  assert.equal(identity.sourceFileId, "source_test_12345");
  assert.equal(identity.sourcePackId, "pack_test_12345");
  assert.equal(identity.processingJobId, "job_test_12345");
  assert.equal(identity.sourceSha256, "a".repeat(64));
  assert.equal(identity.sourceName, "Building authority.fbx");
  assert.equal(identity.scaleDecision, null);
  assert.equal(FBX_PROCESSOR_CONTRACT, "rekixo-fbx-canonical-glb");
  assert.equal(FBX_PROCESSOR_VERSION, 4);
  assert.equal(FBX_PROCESSOR_EXECUTION, "serialized-node-fbx-v4-reviewed-scale");
  assert.equal(MAX_FBX_BYTES, 64 * 1024 * 1024);
});

test("FBX processor accepts reviewed scale only as a complete pinned decision pair", () => {
  const headers = validHeaders();
  headers.set("x-rekixo-scale-decision-id", "scale_review_12345");
  headers.set("x-rekixo-reviewed-metres-per-source-unit", "1");
  const identity = validateFbxRequestHeaders(headers);
  assert.deepEqual(identity.scaleDecision, {
    decisionId: "scale_review_12345",
    metresPerSourceUnit: 1,
  });

  const missingScale = validHeaders();
  missingScale.set("x-rekixo-scale-decision-id", "scale_review_12345");
  assert.throws(
    () => validateFbxRequestHeaders(missingScale),
    (error) => error?.code === "INVALID_SCALE_DECISION",
  );

  const missingId = validHeaders();
  missingId.set("x-rekixo-reviewed-metres-per-source-unit", "1");
  assert.throws(
    () => validateFbxRequestHeaders(missingId),
    (error) => error?.code === "INVALID_SCALE_DECISION",
  );
});

test("FBX processor rejects malformed identity, digest, and filenames", () => {
  const badId = validHeaders();
  badId.set("x-rekixo-source-file-id", "short");
  assert.throws(() => validateFbxRequestHeaders(badId), /Source Pack file ID/);

  const badHash = validHeaders();
  badHash.set("x-rekixo-source-sha256", "not-a-sha");
  assert.throws(() => validateFbxRequestHeaders(badHash), /SHA-256/);

  const badName = validHeaders();
  badName.set("x-rekixo-source-name", encodeURIComponent("model.obj"));
  assert.throws(() => validateFbxRequestHeaders(badName), /FBX source filename/);
});

test("FBX UnitScaleFactor converts deterministically from centimetres to canonical metres", () => {
  assert.equal(metreScaleFromFbxUnitScaleFactor(1), 0.01);
  assert.equal(metreScaleFromFbxUnitScaleFactor(100), 1);
  assert.equal(metreScaleFromFbxUnitScaleFactor(30.48), 0.3048);
  assert.equal(metreScaleFromFbxUnitScaleFactor("2.54"), 0.0254);

  for (const invalid of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "bad"]) {
    assert.throws(
      () => metreScaleFromFbxUnitScaleFactor(invalid),
      (error) => error?.code === "FBX_UNIT_METADATA_INVALID",
    );
  }
});

test("reviewed metres-per-source-unit is explicit, bounded and never inferred", () => {
  assert.equal(reviewedMetresPerSourceUnit(1), 1);
  assert.equal(reviewedMetresPerSourceUnit("0.3048"), 0.3048);
  assert.equal(reviewedMetresPerSourceUnit(0.000001), 0.000001);
  assert.equal(reviewedMetresPerSourceUnit(1000000), 1000000);
  for (const invalid of [undefined, null, 0, -1, 0.0000001, 1000001, Number.NaN, "bad"]) {
    assert.throws(
      () => reviewedMetresPerSourceUnit(invalid),
      (error) => error?.code === "FBX_REVIEWED_SCALE_INVALID",
    );
  }
});

test("metric sanity fails closed when declared FBX units would create a miniature Building", () => {
  const assessment = assessCanonicalBuildingScale({
    rawDimensions: [26, 21, 28],
    canonicalDimensionsM: [0.26, 0.21, 0.28],
    sourceUnitScaleFactorCmPerUnit: 1,
    appliedMetreScale: 0.01,
  });

  assert.equal(assessment.status, "review-required");
  assert.equal(assessment.reason, "canonical-bounds-too-small");
  assert.equal(assessment.policy, FBX_SCALE_SANITY_POLICY);
  assert.equal(assessment.scaleBasis, "declared-fbx-unit");
  assert.equal(assessment.minLargestDimensionM, MIN_CANONICAL_BUILDING_MAX_DIMENSION_M);
});

test("reviewed scale is still subject to the same broad Building metric sanity gate", () => {
  const reviewed = assessCanonicalBuildingScale({
    rawDimensions: [26, 21, 28],
    canonicalDimensionsM: [26, 21, 28],
    sourceUnitScaleFactorCmPerUnit: 1,
    appliedMetreScale: 1,
    scaleBasis: "reviewed-operator",
  });
  assert.equal(reviewed.status, "pass");
  assert.equal(reviewed.scaleBasis, "reviewed-operator");

  const invalidReview = assessCanonicalBuildingScale({
    rawDimensions: [26, 21, 28],
    canonicalDimensionsM: [0.26, 0.21, 0.28],
    sourceUnitScaleFactorCmPerUnit: 1,
    appliedMetreScale: 0.01,
    scaleBasis: "reviewed-operator",
  });
  assert.equal(invalidReview.status, "review-required");
  assert.equal(invalidReview.reason, "canonical-bounds-too-small");
});

test("metric sanity accepts broad plausible Building bounds and rejects extreme giant bounds", () => {
  const plausible = assessCanonicalBuildingScale({
    rawDimensions: [26, 21, 28],
    canonicalDimensionsM: [26, 21, 28],
    sourceUnitScaleFactorCmPerUnit: 100,
    appliedMetreScale: 1,
  });
  assert.equal(plausible.status, "pass");
  assert.equal(plausible.reason, null);

  const giant = assessCanonicalBuildingScale({
    rawDimensions: [2600, 2100, 2800],
    canonicalDimensionsM: [2600, 2100, 2800],
    sourceUnitScaleFactorCmPerUnit: 100,
    appliedMetreScale: 1,
  });
  assert.equal(giant.status, "review-required");
  assert.equal(giant.reason, "canonical-bounds-too-large");
  assert.equal(giant.maxLargestDimensionM, MAX_CANONICAL_BUILDING_MAX_DIMENSION_M);
});

test("FBX processor accepts only structurally valid self-contained GLB 2.x output", () => {
  const glb = minimalGlb();
  assert.deepEqual(inspectGlbBuffer(glb), {
    version: 2,
    byteSize: glb.length,
    assetVersion: "2.0",
  });

  const wrongLength = Buffer.from(glb);
  wrongLength.writeUInt32LE(glb.length + 4, 8);
  assert.throws(() => inspectGlbBuffer(wrongLength), /invalid GLB 2.0 header/);

  const external = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "model.bin" }] }),
  );
  const padding = (4 - (external.length % 4)) % 4;
  const jsonChunk = Buffer.concat([external, Buffer.alloc(padding, 0x20)]);
  const total = 20 + jsonChunk.length;
  const externalGlb = Buffer.alloc(total);
  externalGlb.writeUInt32LE(0x46546c67, 0);
  externalGlb.writeUInt32LE(2, 4);
  externalGlb.writeUInt32LE(total, 8);
  externalGlb.writeUInt32LE(jsonChunk.length, 12);
  externalGlb.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(externalGlb, 20);
  assert.throws(() => inspectGlbBuffer(externalGlb), /self-contained/);
});

test("model processor remains dormant until explicit Container wiring", () => {
  const wrangler = fs.readFileSync("wrangler.admin.jsonc", "utf8");
  const adminEntry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
  assert.doesNotMatch(wrangler, /MODEL_PROCESSOR|model-processor/i);
  assert.doesNotMatch(adminEntry, /fbx-to-glb|MODEL_PROCESSOR/);
});

test("model processor opts into canonical metres, reviewed decisions and metric sanity while legacy converter default stays unchanged", () => {
  const dockerfile = fs.readFileSync("services/model-processor/Dockerfile", "utf8");
  const server = fs.readFileSync("services/model-processor/server.mjs", "utf8");
  const converter = fs.readFileSync("scripts/asset-pipeline/convert-source-fbx.mjs", "utf8");
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /convert-source-fbx\.mjs/);
  assert.match(server, /convert-source-fbx\.mjs/);
  assert.match(server, /normalizeUnitsToMeters:\s*true/);
  assert.match(server, /metresPerSourceUnitOverride:/);
  assert.match(server, /fbx-reviewed-scale-normalized-to-metres/);
  assert.match(server, /"x-rekixo-output-units": "metre"/);
  assert.match(server, /"x-rekixo-scale-basis": unitReport\.scaleBasis/);
  assert.match(server, /reviewedScaleDecisions: "supported"/);
  assert.match(converter, /FBX_SCALE_REVIEW_REQUIRED/);
  assert.match(converter, /normalizeUnitsToMeters = false/);
  assert.match(converter, /Source units preserved/);
  assert.match(converter, /--canonical-metres/);
});
