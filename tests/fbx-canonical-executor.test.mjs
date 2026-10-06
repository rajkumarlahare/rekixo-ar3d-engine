import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  executeCanonicalProcessingJob,
  geometryAuthorityFormat,
} from "../workers/canonical-glb-processor.mjs";

const processor = fs.readFileSync("workers/canonical-glb-processor.mjs", "utf8");
const contract = fs.readFileSync(
  "packages/contracts/src/canonical-model-manifest-v1.ts",
  "utf8",
);
const wrangler = fs.readFileSync("wrangler.admin.jsonc", "utf8");

function fakeDb(job, context) {
  const audits = [];
  return {
    audits,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/SELECT \* FROM processing_jobs_3d WHERE id=\?/.test(sql))
                return { ...job };
              if (/FROM projects_3d project/.test(sql)) return { ...context };
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
            async run() {
              if (/SET state='running'/.test(sql)) {
                if (job.state !== "queued") return { meta: { changes: 0 } };
                job.state = "running";
                job.started_at = args[0];
                job.heartbeat_at = args[1];
                return { meta: { changes: 1 } };
              }
              if (/SET heartbeat_at=\?,updated_at=\?/.test(sql))
                return { meta: { changes: job.state === "running" ? 1 : 0 } };
              if (/SET state='failed'/.test(sql)) {
                if (job.state !== "running") return { meta: { changes: 0 } };
                job.state = "failed";
                job.failure_code = args[0];
                job.failure_reason = args[1];
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO engine_admin_audit/.test(sql)) {
                audits.push(args);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected run SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

test("geometry authority routing recognizes GLB and FBX but not unsupported formats", () => {
  assert.equal(
    geometryAuthorityFormat({ filename: "tower.GLB", media_type: "application/octet-stream" }),
    "glb",
  );
  assert.equal(
    geometryAuthorityFormat({ filename: "tower.FBX", media_type: "application/octet-stream" }),
    "fbx",
  );
  assert.equal(
    geometryAuthorityFormat({ filename: "tower.bin", media_type: "model/gltf-binary" }),
    "glb",
  );
  assert.equal(
    geometryAuthorityFormat({ filename: "tower.skp", media_type: "application/octet-stream" }),
    null,
  );
});

test("FBX processing fails closed when the optional processor capability is absent", async () => {
  const sha256 = "a".repeat(64);
  const sourceFileId = "source_fbx_001";
  const sourcePackId = "source_pack_001";
  const projectId = "project_001";
  const job = {
    id: "processing_job_001",
    project_id: projectId,
    source_pack_id: sourcePackId,
    source_pack_version: 1,
    source_pack_manifest_sha256: "b".repeat(64),
    processor_version: "canonical-building-v1",
    attempt: 1,
    state: "queued",
    artifact_prefix: "projects/alpha-site/processing/source_pack_001/canonical-building-v1/attempt-1/",
    requested_by: "operator@example.com",
    requested_at: "2026-10-06T00:00:00.000Z",
  };
  const context = {
    project_slug: "alpha-site",
    project_name: "Alpha Site",
    source_pack_status: "ready",
    source_pack_operator_approved: 1,
    geometry_authority_file_id: sourceFileId,
    current_pack_manifest_sha256: job.source_pack_manifest_sha256,
    source_id: sourceFileId,
    filename: "tower.fbx",
    media_type: "application/octet-stream",
    byte_size: 1024,
    sha256,
    r2_key: `projects/alpha-site/source-files/${sourceFileId}/${sha256}`,
    upload_state: "verified",
    source_etag: "\"source-etag\"",
  };
  const DB = fakeDb(job, context);
  const env = {
    DB,
    MODEL_ASSETS: {
      async head(key) {
        assert.equal(key, context.r2_key);
        return {
          size: context.byte_size,
          httpEtag: context.source_etag,
          customMetadata: {
            projectId,
            sourceFileId,
            sha256,
          },
        };
      },
    },
  };

  const result = await executeCanonicalProcessingJob(env, job.id);
  assert.deepEqual(
    { executed: result.executed, state: result.state, failureCode: result.failureCode },
    {
      executed: true,
      state: "failed",
      failureCode: "FBX_PROCESSOR_UNAVAILABLE",
    },
  );
  assert.equal(job.state, "failed");
  assert.equal(job.failure_code, "FBX_PROCESSOR_UNAVAILABLE");
  assert.match(job.failure_reason, /not-configured/);
  assert.equal(DB.audits.length, 1);
});

test("FBX derived output is checksum-enforced and keeps source identity separate", () => {
  assert.match(processor, /fbxModelProcessorCapability\(env\)/);
  assert.match(processor, /convertFbxWithModelProcessor/);
  assert.match(processor, /sha256: conversion\.sha256/);
  assert.match(processor, /objectSha256\(stored\) !== conversion\.sha256/);
  assert.match(processor, /canonicalSha256: conversion\.sha256/);
  assert.match(processor, /geometryTransform: "unit-normalized"/);
  assert.match(processor, /byteSize: Number\(canonical\.byteSize\)/);
  assert.match(processor, /sha256: canonical\.sha256/);
  assert.match(processor, /sourceSha256: context\.sha256/);
  assert.match(contract, /geometryTransform: "preserved" \| "unit-normalized"/);
  assert.match(contract, /sourceUnitScaleFactorCmPerUnit\?: number/);
  assert.match(contract, /appliedMetreScale\?: number/);
});

test("Phase 5E does not silently activate a production model processor binding", () => {
  assert.doesNotMatch(wrangler, /MODEL_PROCESSOR/);
});
