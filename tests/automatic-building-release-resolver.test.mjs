import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanonicalReleaseSource } from "../workers/automatic-building-release.mjs";

const MODEL_SHA = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);
const PACK_SHA = "c".repeat(64);

function makeGlb() {
  const json = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-10, 0, -8], max: [10, 24, 8] }],
  });
  const jsonBytes = new TextEncoder().encode(json);
  const paddedLength = Math.ceil(jsonBytes.length / 4) * 4;
  const total = 20 + paddedLength;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length);
  return bytes;
}

function fakeEnvironment({ badManifest = false } = {}) {
  const project = { id: "project_12345678", slug: "test-project" };
  const job = {
    id: "job_12345678",
    project_id: project.id,
    source_pack_id: "pack_12345678",
    source_pack_version: 2,
    source_pack_manifest_sha256: PACK_SHA,
    processor_version: "canonical-v1",
    state: "succeeded",
    attempt: 1,
    output_manifest_sha256: MANIFEST_SHA,
  };
  const glb = makeGlb();
  const modelKey = `projects/${project.slug}/processing/${job.source_pack_id}/canonical-building-v1/attempt-1/model.glb`;
  const manifestKey = `projects/${project.slug}/processing/${job.source_pack_id}/canonical-building-v1/attempt-1/manifest.json`;
  const canonicalManifest = {
    format: "rekixo-canonical-model",
    version: 1,
    project: { id: project.id, slug: project.slug },
    sourcePack: {
      id: badManifest ? "pack_other" : job.source_pack_id,
      version: job.source_pack_version,
      manifestSha256: PACK_SHA,
    },
    processor: { version: job.processor_version },
    geometryAuthority: { filename: "building.glb" },
    model: {
      r2Key: modelKey,
      mimeType: "model/gltf-binary",
      byteSize: glb.byteLength,
      sha256: MODEL_SHA,
      coordinateSystem: {
        units: "metre",
        upAxis: "+Y",
        handedness: "right",
      },
    },
  };
  const artifacts = [
    {
      id: "artifact_model_12345678",
      processing_job_id: job.id,
      project_id: project.id,
      kind: "canonical-model",
      logical_id: "building-model",
      state: "ready",
      r2_key: modelKey,
      mime_type: "model/gltf-binary",
      byte_size: glb.byteLength,
      sha256: MODEL_SHA,
    },
    {
      id: "artifact_manifest_12345678",
      processing_job_id: job.id,
      project_id: project.id,
      kind: "canonical-model-manifest",
      logical_id: "canonical-model-manifest-v1",
      state: "ready",
      r2_key: manifestKey,
      mime_type: "application/json",
      byte_size: JSON.stringify(canonicalManifest).length,
      sha256: MANIFEST_SHA,
    },
  ];

  const DB = {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes("FROM processing_jobs_3d")) return job;
          throw new Error(`Unexpected first SQL: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM processing_artifacts_3d")) return { results: artifacts };
          throw new Error(`Unexpected all SQL: ${sql}`);
        },
      };
    },
  };

  const MODEL_ASSETS = {
    async head(key) {
      if (key !== modelKey) return null;
      return {
        size: glb.byteLength,
        customMetadata: {
          projectId: project.id,
          canonicalSha256: MODEL_SHA,
        },
      };
    },
    async get(key, options) {
      if (key === manifestKey) {
        return { async text() { return JSON.stringify(canonicalManifest); } };
      }
      if (key !== modelKey) return null;
      const offset = Number(options?.range?.offset ?? 0);
      const length = Number(options?.range?.length ?? glb.byteLength);
      const slice = glb.slice(offset, offset + length);
      return { async arrayBuffer() { return slice.buffer; } };
    },
  };

  return { env: { DB, MODEL_ASSETS }, project, job };
}

test("canonical release resolver pins a succeeded metric processing output", async () => {
  const { env, project, job } = fakeEnvironment();
  const resolved = await resolveCanonicalReleaseSource(env, project, { scene: {} });
  assert.ok(resolved);
  assert.equal(resolved.job.id, job.id);
  assert.equal(resolved.modelArtifact.sha256, MODEL_SHA);
  assert.deepEqual(resolved.bounds, {
    min: { x: -10, y: 0, z: -8 },
    max: { x: 10, y: 24, z: 8 },
  });
  assert.equal(resolved.manifest.model.coordinateSystem.units, "metre");
});

test("canonical release resolver fails closed when processing manifest provenance drifts", async () => {
  const { env, project } = fakeEnvironment({ badManifest: true });
  await assert.rejects(
    resolveCanonicalReleaseSource(env, project, { scene: {} }),
    /manifest identity or metric coordinate policy is invalid/,
  );
});
