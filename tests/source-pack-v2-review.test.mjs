import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  canonicalSourcePackManifest,
  normalizeSourcePackReviewFiles,
  sourcePackReviewReadiness,
} from "../workers/source-pack-review-policy.mjs";

const worker = fs.readFileSync("workers/source-pack-review.mjs", "utf8");
const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");

test("operator review requires exactly one geometry-capable authority", () => {
  assert.throws(
    () =>
      normalizeSourcePackReviewFiles([
        { sourceFileId: "fbx", roles: ["material-recovery"], capabilities: ["geometry"] },
      ]),
    /Exactly one geometry authority/,
  );

  assert.throws(
    () =>
      normalizeSourcePackReviewFiles([
        { sourceFileId: "fbx", roles: ["geometry-authority"], capabilities: ["geometry"] },
        { sourceFileId: "glb", roles: ["geometry-authority"], capabilities: ["geometry"] },
      ]),
    /Exactly one geometry authority/,
  );

  assert.throws(
    () =>
      normalizeSourcePackReviewFiles([
        {
          sourceFileId: "dwg",
          roles: ["geometry-authority", "evidence"],
          capabilities: ["dimensions", "floor-plan"],
        },
      ]),
    /geometry-capable source file/,
  );

  const files = normalizeSourcePackReviewFiles([
    {
      sourceFileId: "fbx",
      roles: ["material-recovery", "geometry-authority", "geometry-authority"],
      capabilities: ["textures", "geometry", "geometry"],
      notes: "Primary finished model",
    },
    {
      sourceFileId: "dwg",
      roles: ["evidence"],
      capabilities: ["dimensions", "floor-plan"],
    },
  ]);
  assert.deepEqual(files[0].roles, ["evidence"]);
  assert.deepEqual(files[1].roles, ["geometry-authority", "material-recovery"]);
  assert.deepEqual(files[1].capabilities, ["geometry", "textures"]);
});

test("review readiness rejects missing, stale or non-geometry authority mappings", () => {
  const incomplete = sourcePackReviewReadiness({
    verifiedSourceIds: ["fbx", "dwg"],
    files: [{ sourceFileId: "fbx", roles: ["geometry-authority"], capabilities: ["geometry"] }],
  });
  assert.equal(incomplete.ready, false);
  assert.deepEqual(incomplete.missingSourceIds, ["dwg"]);

  const badAuthority = sourcePackReviewReadiness({
    verifiedSourceIds: ["dwg"],
    files: [
      {
        sourceFileId: "dwg",
        roles: ["geometry-authority", "evidence"],
        capabilities: ["dimensions", "floor-plan"],
      },
    ],
  });
  assert.equal(badAuthority.ready, false);
  assert.equal(badAuthority.geometryAuthorityFileId, null);

  const complete = sourcePackReviewReadiness({
    verifiedSourceIds: ["fbx", "dwg"],
    files: [
      { sourceFileId: "fbx", roles: ["geometry-authority"], capabilities: ["geometry"] },
      { sourceFileId: "dwg", roles: ["evidence"], capabilities: ["dimensions", "floor-plan"] },
    ],
  });
  assert.equal(complete.ready, true);
  assert.equal(complete.geometryAuthorityFileId, "fbx");
});

test("sealed manifest is deterministic and keeps geometry/evidence boundaries explicit", () => {
  const input = {
    project: { id: "project_1", slug: "sample-building" },
    pack: { id: "source_pack_1", version: 2 },
    geometryAuthorityFileId: "fbx",
    files: [
      {
        sourceFileId: "pdf",
        filename: "brochure.pdf",
        mediaType: "application/pdf",
        byteSize: 200,
        sha256: "b".repeat(64),
        roles: ["content-reference", "evidence"],
        capabilities: ["marketing", "floor-plan"],
        classificationOrigin: "operator",
        classificationConfidence: 1,
        notes: null,
      },
      {
        sourceFileId: "fbx",
        filename: "building.fbx",
        mediaType: "application/octet-stream",
        byteSize: 100,
        sha256: "a".repeat(64),
        roles: ["material-recovery", "geometry-authority"],
        capabilities: ["textures", "materials", "geometry"],
        classificationOrigin: "operator",
        classificationConfidence: 1,
        notes: "Primary finished model",
      },
    ],
  };

  const first = canonicalSourcePackManifest(input);
  const second = canonicalSourcePackManifest({ ...input, files: [...input.files].reverse() });
  assert.equal(first, second);
  const manifest = JSON.parse(first);
  assert.equal(manifest.geometryAuthorityFileId, "fbx");
  assert.deepEqual(manifest.files.map((item) => item.sourceFileId), ["fbx", "pdf"]);
  assert.deepEqual(manifest.files[0].roles, ["geometry-authority", "material-recovery"]);
  assert.deepEqual(manifest.files[1].roles, ["content-reference", "evidence"]);
});

test("review draft refuses missing or stale classifier suggestions", () => {
  assert.match(worker, /SOURCE_CLASSIFIER_VERSION/);
  assert.match(worker, /s\.classifier_version/);
  assert.match(worker, /classifierVersion: row\.classifier_version/);
  assert.match(worker, /classifier_version !== SOURCE_CLASSIFIER_VERSION/);
  assert.match(worker, /missing\.length \|\| stale\.length/);
  assert.match(worker, /Refresh automatic source classification before starting review/);
});

test("operator review cannot invent engine-derived source capabilities", () => {
  assert.match(worker, /function sameCapabilities/);
  assert.match(worker, /const storedFiles = \(await packFiles\(env, project\.id, pack\.id\)\)\.map\(packFileResponse\)/);
  assert.match(worker, /!sameCapabilities\(item\.capabilities, stored\.capabilities\)/);
  assert.match(worker, /Source capabilities are engine-derived and cannot be changed during operator review/);
});

test("review API is guarded and cannot mutate presentation/public assets", () => {
  assert.match(worker, /engineAdminReadAccess/);
  assert.match(worker, /sameOrigin/);
  assert.match(worker, /projectOperationLockReason\(env, project\.id, "source-write"\)/);
  assert.match(worker, /activeDeletionJob/);
  assert.match(worker, /SEAL SOURCE PACK/);
  assert.match(worker, /manifest_sha256/);
  assert.match(worker, /status='superseded'/);
  assert.doesNotMatch(worker, /env\.ASSETS\.(put|delete)/);
  assert.doesNotMatch(worker, /active_release_id/);
  assert.doesNotMatch(worker, /UPDATE releases_3d/);
});

test("Admin entry isolates Source Pack review route before legacy fallback", () => {
  const reviewIndex = entry.indexOf("handleSourcePackReviewRequest");
  const fallbackIndex = entry.indexOf("return adminWorker.fetch");
  assert.ok(reviewIndex >= 0);
  assert.ok(fallbackIndex > reviewIndex);
});
