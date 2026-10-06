import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateReviewedBindingsForRelease } from "../workers/release-publish.mjs";

const canonicalSha = "a".repeat(64);
const catalogSha = "b".repeat(64);
const sourcePackSha = "c".repeat(64);
const outputManifestSha = "d".repeat(64);

const project = {
  id: "project-release-gate",
  slug: "release-gate",
  name: "Release Gate",
  status: "draft",
};

const job = {
  id: "job-release-gate",
  project_id: project.id,
  source_pack_id: "pack-release-gate",
  source_pack_version: 4,
  source_pack_manifest_sha256: sourcePackSha,
  processor_version: "canonical-building-v1",
  state: "succeeded",
  output_manifest_sha256: outputManifestSha,
};

const artifacts = [
  {
    id: "artifact-canonical-model",
    processing_job_id: job.id,
    project_id: project.id,
    kind: "canonical-model",
    logical_id: "building-model",
    state: "ready",
    sha256: canonicalSha,
  },
  {
    id: "artifact-node-catalog",
    processing_job_id: job.id,
    project_id: project.id,
    kind: "node-catalog",
    logical_id: "node-catalog-v1",
    state: "ready",
    sha256: catalogSha,
  },
];

function bindingBlock(overrides = {}) {
  return {
    format: "rekixo-reviewed-component-bindings",
    version: 1,
    processingJobId: job.id,
    sourcePackId: job.source_pack_id,
    sourcePackVersion: job.source_pack_version,
    sourcePackManifestSha256: sourcePackSha,
    processorVersion: job.processor_version,
    outputManifestSha256,
    canonicalModelArtifactId: artifacts[0].id,
    canonicalModelSha256: canonicalSha,
    nodeCatalogArtifactId: artifacts[1].id,
    nodeCatalogSha256: catalogSha,
    reviewedAgainstDraftRevision: 7,
    reviewedBy: "operator@rekixo.com",
    reviewedAt: "2026-10-06T08:00:00.000Z",
    bindings: [
      {
        nodeId: `node:${canonicalSha}:0`,
        floorId: "floor-1",
        unit: "Unit A",
        roomId: "room-1",
        semantic: "wall",
      },
    ],
    ...overrides,
  };
}

function draftWith(block = bindingBlock()) {
  return {
    scene: {
      floors: [{ id: "floor-1", name: "Ground" }],
      rooms: [{ id: "room-1", floorId: "floor-1", unit: "Unit A" }],
      reviewedComponentBindings: block,
    },
  };
}

function environment({ durableJob = job, durableArtifacts = artifacts } = {}) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind() {
            if (sql.includes("FROM processing_jobs_3d")) {
              return { first: async () => durableJob };
            }
            if (sql.includes("FROM processing_artifacts_3d")) {
              return { all: async () => ({ results: durableArtifacts }) };
            }
            throw new Error(`Unexpected release-gate query: ${sql}`);
          },
        };
      },
    },
  };
}

test("release gate accepts reviewed bindings only when durable processing provenance still matches", async () => {
  const block = bindingBlock();
  assert.equal(
    await validateReviewedBindingsForRelease(
      environment(),
      project,
      draftWith(block),
    ),
    block,
  );
});

test("release gate is a no-op for drafts without reviewed component bindings", async () => {
  const env = {
    DB: {
      prepare() {
        throw new Error("DB should not be touched when no reviewed bindings exist.");
      },
    },
  };
  assert.equal(
    await validateReviewedBindingsForRelease(env, project, {
      scene: { floors: [], rooms: [] },
    }),
    undefined,
  );
});

test("release gate fails closed when the processing job identity drifts", async () => {
  await assert.rejects(
    () =>
      validateReviewedBindingsForRelease(
        environment({
          durableJob: {
            ...job,
            output_manifest_sha256: "e".repeat(64),
          },
        }),
        project,
        draftWith(),
      ),
    /processing provenance no longer matches durable processing state/i,
  );
});

test("release gate fails closed when canonical artifact identity drifts", async () => {
  await assert.rejects(
    () =>
      validateReviewedBindingsForRelease(
        environment({
          durableArtifacts: [
            { ...artifacts[0], sha256: "f".repeat(64) },
            artifacts[1],
          ],
        }),
        project,
        draftWith(),
      ),
    /canonical artifact provenance no longer matches durable processing state/i,
  );
});

test("release gate rejects canonical node IDs that no longer match the pinned model checksum", async () => {
  const block = bindingBlock({
    bindings: [
      {
        nodeId: `node:${"e".repeat(64)}:0`,
        floorId: "floor-1",
        unit: "Unit A",
        roomId: "room-1",
        semantic: "wall",
      },
    ],
  });
  await assert.rejects(
    () =>
      validateReviewedBindingsForRelease(
        environment(),
        project,
        draftWith(block),
      ),
    /node identity no longer matches the canonical model checksum/i,
  );
});

test("cloud release creation executes the provenance gate before immutable asset copying", () => {
  const source = fs.readFileSync("workers/release-publish.mjs", "utf8");
  const gateCall = source.indexOf(
    "await validateReviewedBindingsForRelease(env, project, draft)",
  );
  const releaseCopy = source.indexOf("async function copyImmutableObject");
  assert.ok(gateCall >= 0);
  assert.ok(releaseCopy > gateCall);

  const gateStart = source.indexOf(
    "export async function validateReviewedBindingsForRelease",
  );
  const gateEnd = source.indexOf("function safeSegment", gateStart);
  const gateSource = source.slice(gateStart, gateEnd);
  assert.doesNotMatch(gateSource, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(gateSource, /MODEL_ASSETS\.(?:put|delete)/);
});
