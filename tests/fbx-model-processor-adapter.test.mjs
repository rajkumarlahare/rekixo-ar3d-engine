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

function identity() {
  return {
    sourceFileId: "source_test_12345",
    sourcePackId: "pack_test_12345",
    processingJobId: "job_test_12345",
    sourceSha256: "a".repeat(64),
    sourceName: "Building authority.fbx",
    byteSize: 4,
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
    "x-rekixo-source-unit-scale-factor": "1",
    "x-rekixo-applied-metre-scale": "0.01",
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
  assert.doesNotMatch(canonical, /convertFbxWithModelProcessor|fbx-model-processor-adapter/);
});

test("capability gate accepts only the exact v2 canonical-metre health contract", async () => {
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
  assert.equal(capability.version, 2);
  assert.equal(capability.outputUnits, "metre");

  const mismatch = {
    MODEL_PROCESSOR: {
      async fetch() {
        return new Response(JSON.stringify(healthPayload({ outputUnits: "centimetre" })));
      },
    },
  };
  assert.equal((await fbxModelProcessorCapability(mismatch)).available, false);
  assert.equal((await fbxModelProcessorCapability(mismatch)).reason, "health-contract-mismatch");
});

test("adapter forwards pinned source provenance and returns a streaming canonical GLB result", async () => {
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

  assert.equal(result.contract, FBX_MODEL_PROCESSOR_CONTRACT);
  assert.equal(result.contractVersion, 2);
  assert.equal(result.byteSize, 4);
  assert.equal(result.sha256, "b".repeat(64));
  assert.equal(result.outputUnits, "metre");
  assert.equal(result.appliedMetreScale, 0.01);
  assert.ok(result.body instanceof ReadableStream);
  assert.deepEqual(
    [...new Uint8Array(await new Response(result.body).arrayBuffer())],
    [0x67, 0x6c, 0x54, 0x46],
  );
});

test("adapter fails closed on response provenance or unit-policy mismatches", async () => {
  for (const override of [
    { "x-rekixo-contract-version": "1" },
    { "x-rekixo-source-pack-id": "pack_wrong_12345" },
    { "x-rekixo-output-units": "centimetre" },
    { "x-rekixo-coordinate-policy": "unchanged-source-coordinates" },
    { "x-rekixo-output-sha256": "not-a-sha" },
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
