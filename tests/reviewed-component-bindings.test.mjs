import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  normalizeReviewedBindings,
  validateCatalogIdentity,
  validateStoredBindingTargets,
} from "../workers/reviewed-component-bindings.mjs";

const worker = fs.readFileSync("workers/reviewed-component-bindings.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
const client = fs.readFileSync(
  "apps/admin/src/studio/componentBindingsCloud.ts",
  "utf8",
);

const canonicalSha = "a".repeat(64);
const catalogSha = "b".repeat(64);
const sourcePackSha = "c".repeat(64);
const outputManifestSha = "d".repeat(64);
const project = {
  id: "project-1234",
  slug: "binding-test",
  name: "Binding Test",
  status: "draft",
};
const identity = {
  job: {
    id: "job-1234",
    project_id: project.id,
    source_pack_id: "pack-1234",
    source_pack_version: 3,
    source_pack_manifest_sha256: sourcePackSha,
    processor_version: "canonical-building-v1",
    state: "succeeded",
    output_manifest_sha256: outputManifestSha,
  },
  model: {
    id: "model-artifact-1234",
    processing_job_id: "job-1234",
    project_id: project.id,
    r2_key: "projects/binding-test/processing/model.glb",
    sha256: canonicalSha,
  },
  catalogArtifact: {
    id: "catalog-artifact-1234",
    processing_job_id: "job-1234",
    project_id: project.id,
    r2_key: "projects/binding-test/processing/node-catalog.json",
    sha256: catalogSha,
  },
};
const catalog = {
  format: "rekixo-node-catalog",
  version: 1,
  project: { id: project.id, slug: project.slug },
  sourcePack: {
    id: identity.job.source_pack_id,
    version: identity.job.source_pack_version,
    manifestSha256: sourcePackSha,
  },
  processingJob: {
    id: identity.job.id,
    processorVersion: identity.job.processor_version,
  },
  canonicalModel: {
    r2Key: identity.model.r2_key,
    sha256: canonicalSha,
  },
  nodes: [
    {
      id: `node:${canonicalSha}:0`,
      index: 0,
      selectable: true,
    },
    {
      id: `node:${canonicalSha}:1`,
      index: 1,
      selectable: false,
    },
  ],
};
const draft = {
  scene: {
    floors: [{ id: "floor-1", name: "Ground" }],
    rooms: [
      { id: "room-1", floorId: "floor-1", unit: "Unit A" },
      { id: "room-2", floorId: "floor-1", unit: "Unit B" },
    ],
  },
};

test("verified node catalog identity is pinned to project, job, pack and canonical model SHA", () => {
  assert.equal(validateCatalogIdentity(catalog, project, identity), catalog);
  assert.throws(
    () =>
      validateCatalogIdentity(
        { ...catalog, project: { ...catalog.project, slug: "other-project" } },
        project,
        identity,
      ),
    /does not match the selected canonical processing output/i,
  );
  assert.throws(
    () =>
      validateCatalogIdentity(
        {
          ...catalog,
          nodes: [
            {
              id: `node:${"f".repeat(64)}:0`,
              index: 0,
              selectable: true,
            },
          ],
        },
        project,
        identity,
      ),
    /invalid canonical node identity/i,
  );
});

test("reviewed bindings normalize room targets and only accept selectable canonical node IDs", () => {
  const bindings = normalizeReviewedBindings(draft, catalog, [
    {
      nodeId: `node:${canonicalSha}:0`,
      roomId: "room-1",
      semantic: "wall",
    },
  ]);
  assert.deepEqual(bindings, [
    {
      nodeId: `node:${canonicalSha}:0`,
      floorId: "floor-1",
      unit: "Unit A",
      roomId: "room-1",
      semantic: "wall",
    },
  ]);
  assert.throws(
    () =>
      normalizeReviewedBindings(draft, catalog, [
        { nodeId: `node:${canonicalSha}:1`, semantic: "wall" },
      ]),
    /selectable/i,
  );
  assert.throws(
    () =>
      normalizeReviewedBindings(draft, catalog, [
        { nodeId: `node:${canonicalSha}:0`, roomId: "missing-room" },
      ]),
    /missing room/i,
  );
});

test("stored reviewed bindings fail closed when semantic draft targets drift", () => {
  const block = {
    format: "rekixo-reviewed-component-bindings",
    version: 1,
    bindings: [
      {
        nodeId: `node:${canonicalSha}:0`,
        floorId: "floor-1",
        unit: "Unit A",
        roomId: "room-1",
        semantic: "wall",
      },
    ],
  };
  assert.equal(validateStoredBindingTargets(draft, block), block);
  assert.throws(
    () =>
      validateStoredBindingTargets(
        {
          scene: {
            ...draft.scene,
            rooms: [{ id: "room-1", floorId: "floor-1", unit: "Renamed Unit" }],
          },
        },
        block,
      ),
    /room\/unit identity is inconsistent/i,
  );
});

test("bindings API is authenticated, same-origin, optimistic and read-only against canonical artifacts", () => {
  assert.match(worker, /engineAdminReadAccess/);
  assert.match(worker, /sameOrigin/);
  assert.match(worker, /activeDeletionJob/);
  assert.match(worker, /processing_jobs_3d/);
  assert.match(worker, /processing_artifacts_3d/);
  assert.match(worker, /MODEL_ASSETS\.get\(catalogArtifact\.r2_key\)/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.(put|delete)/);
  assert.match(worker, /WHERE project_id=\? AND revision=\?/);
  assert.match(worker, /revision=revision\+1/);
  assert.match(worker, /component_bindings\.reviewed/);
  assert.match(worker, /component_bindings\.cleared/);
  assert.doesNotMatch(worker, /UPDATE\s+source_packs_3d/i);
  assert.doesNotMatch(worker, /UPDATE\s+releases_3d/i);
  assert.doesNotMatch(worker, /UPDATE\s+geo_releases_3d/i);
});

test("generic Studio draft saves cannot forge, replace or silently remove reviewed bindings", () => {
  assert.match(worker, /route\.kind === "draft"/);
  assert.match(worker, /request\.clone\(\)/);
  assert.match(worker, /Reviewed component bindings are protected/);
  assert.match(worker, /validateStoredBindingTargets\(body\.draft, current\)/);
  assert.match(worker, /Update or clear reviewed bindings before changing their floor\/unit\/room targets/);
});

test("Admin entry registers reviewed bindings guard before legacy cloud fallback", () => {
  const bindingIndex = entry.indexOf("handleReviewedComponentBindingsRequest");
  const fallbackIndex = entry.indexOf("return adminWorker.fetch");
  assert.ok(bindingIndex >= 0);
  assert.ok(fallbackIndex > bindingIndex);
});

test("typed Admin client exposes GET, optimistic PUT and explicit clear", () => {
  assert.match(client, /reviewedComponentBindings\(slug: string\)/);
  assert.match(client, /saveReviewedComponentBindings/);
  assert.match(client, /expectedRevision/);
  assert.match(client, /processingJobId/);
  assert.match(client, /clearReviewedComponentBindings/);
  assert.match(client, /method: "DELETE"/);
  assert.match(client, /rekixo-reviewed-component-bindings/);
});
