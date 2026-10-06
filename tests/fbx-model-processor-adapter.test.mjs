import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FBX_MODEL_PROCESSOR_CONTRACT,
  FBX_MODEL_PROCESSOR_EXECUTION,
  FBX_MODEL_PROCESSOR_VERSION,
  MAX_FBX_PROCESSOR_INPUT_BYTES,
  MAX_FBX_PROCESSOR_OUTPUT_BYTES,
  convertFbxWithModelProcessor,
  fbxModelProcessorCapability,
  hasFbxModelProcessorBinding,
} from "../workers/fbx-model-processor-adapter.mjs";

function identity(overrides = {}) {
  return {
    sourceFileId: "source_test_12345",
    sourcePackId: "pack_test_12345",
    processingJobId: "job_test_12345",
    sourceSha256: "a".repeat(64),
    sourceName: "Building authority.fbx",
    byteSize: 4,
    ...overrides,
  };
}

function healthPayload(overrides = {}) {
  return {
    processor: "rekixo-model-processor",
    contract: FBX_MODEL_PROCESSOR_CONTRACT,
    version: FBX_MODEL_PROCESSOR_VERSION,
    maxFbxBytes: MAX_FBX_PROCESSOR_INPUT_BYTES,
    maxGlbBytes: MAX_FBX_PROCESSOR_OUTPUT_BYTES,
    outputUnits: "metre",
    execution: FBX_MODEL_PROCESSOR_EXECUTION,
    metricSanity: "required",
    reviewedScaleDecisions: "supported",
    ...overrides,
  };
}

function canonicalResponse(overrides = {}) {
  const source = identity();
  const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
  const headers = new Headers({
    "content-type": "model/gltf-binary",
    "content-length": String(bytes.byteLength),
    "x-rekixo-contract": FBX_MODEL_PROCESSOR_CONTRACT,
    "x-rekixo-contract-version": String(FBX_MODEL_PROCESSOR_VERSION),
    "x-rekixo-source-file-id": source.sourceFileId,
    "x-rekixo-source-pack-id": source.sourcePackId,
    "x-rekixo-processing-job-id": source.processingJobId,
    "x-rekixo-source-sha256": source.sourceSha256,
    "x-rekixo-output-sha256": "b".repeat(64),
    "x-rekixo-coordinate-policy": "fbx-unit-scale-factor-normalized-to-metres",
    "x-rekixo-output-units": "metre",
    "x-rekixo-source-unit-scale-factor": "100",
    "x-rekixo-applied-metre-scale": "1",
    "x-rekixo-scale-basis": "declared-fbx-unit",
    "x-rekixo-scale-sanity": "pass",
    "x-rekixo-scale-sanity-policy": "broad-building-bounds-v1",
    "x-rekixo-raw-bounds-dimensions": "26,21,28",
    "x-rekixo-canonical-bounds-dimensions-m": "26,21,28",
  });
  for (const [key, value] of Object.entries(overrides)) headers.set(key, String(value));
  return new Response(bytes, { status: 200, headers });
}

test("FBX Worker adapter is unavailable by default and does not imply production support", async () => {
  assert.equal(hasFbxModelProcessorBinding({}), false);
  assert.deepEqual(await fbxModelProcessorCapability({}), {
    available: false,
    reason: "not-configured",
    contract: FBX_MODEL_PROCESSOR_CONTRACT,
    version: FBX_MODEL_PROCESSOR_VERSION,
  });
  await assert.rejects(
    () => convertFbxWithModelProcessor({}, identity(), new Uint8Array([1, 2, 3, 4])),
    (error) => error?.code === "FBX_PROCESSOR_UNAVAILABLE" && error?.status === 503,
  );

  const wrangler = fs.readFileSync("wrangler.admin.jsonc", "utf8");
  const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
  const canonical = fs.readFileSync("workers/canonical-glb-processor.mjs", "utf8");
  assert.doesNotMatch(wrangler, /MODEL_PROCESSOR|model-processor/i);
  assert.doesNotMatch(entry, /MODEL_PROCESSOR|fbx-model-processor/i);
  assert.match(canonical, /fbx-model-processor-adapter/);
  assert.match(canonical, /fbxModelProcessorCapability\(env\)/);
  assert.match(canonical, /convertFbxWithModelProcessor/);
  assert.doesNotMatch(canonical, /env\.MODEL_PROCESSOR/);
});

test("capability gate accepts only the exact V4 reviewed-scale canonical-metre contract", async () => {
  const env = {
    MODEL_PROCESSOR: {
      async fetch(url) {
        assert.equal(String(url), "https://model-processor/health");
        return new Response(JSON.stringify(healthPayload()), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
  const capability = await fbxModelProcessorCapability(env);
  assert.equal(capability.available, true);
  assert.equal(capability.contract, FBX_MODEL_PROCESSOR_CONTRACT);
  assert.equal(capability.version, 4);
  assert.equal(capability.outputUnits, "metre");

  for (const override of [
    { metricSanity: "optional" },
    { reviewedScaleDecisions: "unsupported" },
    { version: 3 },
  ]) {
    const mismatch = {
      MODEL_PROCESSOR: {
        async fetch() {
          return new Response(JSON.stringify(healthPayload(override)));
        },
      },
    };
    assert.equal((await fbxModelProcessorCapability(mismatch)).available, false);
    assert.equal((await fbxModelProcessorCapability(mismatch)).reason, "health-contract-mismatch");
  }
});

test("adapter forwards pinned source provenance and returns declared-unit metric provenance", async () => {
  let captured = null;
  const env = {
    MODEL_PROCESSOR: {
      async fetch(url, init) {
        captured = { url: String(url), init };
        return canonicalResponse();
      },
    },
  };
  const source = identity();
  const result = await convertFbxWithModelProcessor(
    env,
    source,
    new Uint8Array([1, 2, 3, 4]),
  );

  assert.equal(captured.url, "https://model-processor/v1/model/fbx-to-glb");
  assert.equal(captured.init.method, "POST");
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("x-rekixo-source-file-id"), source.sourceFileId);
  assert.equal(headers.get("x-rekixo-source-pack-id"), source.sourcePackId);
  assert.equal(headers.get("x-rekixo-processing-job-id"), source.processingJobId);
  assert.equal(headers.get("x-rekixo-source-sha256"), source.sourceSha256);
  assert.equal(decodeURIComponent(headers.get("x-rekixo-source-name")), source.sourceName);
  assert.equal(headers.get("content-length"), "4");
  assert.equal(headers.get("x-rekixo-scale-decision-id"), null);

  assert.equal(result.contract, FBX_MODEL_PROCESSOR_CONTRACT);
  assert.equal(result.contractVersion, 4);
  assert.equal(result.byteSize, 4);
  assert.equal(result.sha256, "b".repeat(64));
  assert.equal(result.outputUnits, "metre");
  assert.equal(result.appliedMetreScale, 1);
  assert.equal(result.scaleBasis, "declared-fbx-unit");
  assert.equal(result.scaleDecisionId, null);
  assert.equal(result.scaleSanity, "pass");
  assert.equal(result.scaleSanityPolicy, "broad-building-bounds-v1");
  assert.deepEqual(result.rawDimensions, [26, 21, 28]);
  assert.deepEqual(result.canonicalDimensionsM, [26, 21, 28]);
  assert.ok(result.body instanceof ReadableStream);
  assert.deepEqual(
    [...new Uint8Array(await new Response(result.body).arrayBuffer())],
    [0x67, 0x6c, 0x54, 0x46],
  );
});

test("adapter forwards and verifies the exact audited reviewed scale decision", async () => {
  const decision = { id: "scale_review_12345", metresPerSourceUnit: 1 };
  let captured = null;
  const env = {
    MODEL_PROCESSOR: {
      async fetch(url, init) {
        captured = { url: String(url), init };
        return canonicalResponse({
          "x-rekixo-coordinate-policy": "fbx-reviewed-scale-normalized-to-metres",
          "x-rekixo-scale-basis": "reviewed-operator",
          "x-rekixo-scale-decision-id": decision.id,
        });
      },
    },
  };
  const result = await convertFbxWithModelProcessor(
    env,
    identity({ scaleDecision: decision }),
    new Uint8Array([1, 2, 3, 4]),
  );
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get("x-rekixo-scale-decision-id"), decision.id);
  assert.equal(headers.get("x-rekixo-reviewed-metres-per-source-unit"), "1");
  assert.equal(result.scaleBasis, "reviewed-operator");
  assert.equal(result.scaleDecisionId, decision.id);
  assert.equal(result.appliedMetreScale, 1);
  assert.equal(result.coordinatePolicy, "fbx-reviewed-scale-normalized-to-metres");
});

test("adapter fails closed on response provenance, scale-decision, or metric-sanity mismatches", async () => {
  for (const override of [
    { "x-rekixo-contract-version": "1" },
    { "x-rekixo-source-pack-id": "pack_wrong_12345" },
    { "x-rekixo-output-units": "centimetre" },
    { "x-rekixo-coordinate-policy": "unchanged-source-coordinates" },
    { "x-rekixo-output-sha256": "not-a-sha" },
    { "x-rekixo-scale-sanity": "review-required" },
    { "x-rekixo-scale-basis": "reviewed-operator" },
    { "x-rekixo-raw-bounds-dimensions": "bad" },
  ]) {
    const env = {
      MODEL_PROCESSOR: {
        async fetch() {
          return canonicalResponse(override);
        },
      },
    };
    await assert.rejects(
      () => convertFbxWithModelProcessor(env, identity(), new Uint8Array([1, 2, 3, 4])),
      (error) => error?.code === "FBX_PROCESSOR_PROVENANCE_MISMATCH" && error?.status === 502,
    );
  }

  const reviewedIdentity = identity({
    scaleDecision: { id: "scale_review_12345", metresPerSourceUnit: 1 },
  });
  const wrongDecision = {
    MODEL_PROCESSOR: {
      async fetch() {
        return canonicalResponse({
          "x-rekixo-coordinate-policy": "fbx-reviewed-scale-normalized-to-metres",
          "x-rekixo-scale-basis": "reviewed-operator",
          "x-rekixo-scale-decision-id": "scale_review_wrong",
        });
      },
    },
  };
  await assert.rejects(
    () => convertFbxWithModelProcessor(wrongDecision, reviewedIdentity, new Uint8Array([1, 2, 3, 4])),
    (error) => error?.code === "FBX_PROCESSOR_PROVENANCE_MISMATCH" && error?.status === 502,
  );
});

test("adapter preserves structured scale-review details from processor rejection", async () => {
  const details = {
    status: "review-required",
    reason: "canonical-bounds-too-small",
    policy: "broad-building-bounds-v1",
    rawDimensions: [26, 21, 28],
    canonicalDimensionsM: [0.26, 0.21, 0.28],
  };
  const env = {
    MODEL_PROCESSOR: {
      async fetch() {
        return new Response(
          JSON.stringify({
            code: "FBX_SCALE_REVIEW_REQUIRED",
            error: "Explicit scale review is required.",
            details,
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      },
    },
  };
  await assert.rejects(
    () => convertFbxWithModelProcessor(env, identity(), new Uint8Array([1, 2, 3, 4])),
    (error) =>
      error?.code === "FBX_SCALE_REVIEW_REQUIRED" &&
      error?.status === 422 &&
      error?.details?.reason === "canonical-bounds-too-small",
  );
});

test("adapter supports a future named Durable Object capability without binding it today", async () => {
  let name = null;
  const env = {
    MODEL_PROCESSOR: {
      getByName(value) {
        name = value;
        return {
          async fetch() {
            return canonicalResponse();
          },
        };
      },
    },
  };
  const result = await convertFbxWithModelProcessor(
    env,
    identity(),
    new Uint8Array([1, 2, 3, 4]),
  );
  assert.match(name, /^fbx-[01]$/);
  assert.equal(result.sha256, "b".repeat(64));
});
