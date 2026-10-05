import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SOURCE_CLASSIFIER_VERSION,
  classifySourceMetadata,
  chooseGeometryAuthoritySuggestion,
} from "../workers/source-classification-policy.mjs";
import { handleSourceClassificationRequest } from "../workers/source-classification.mjs";

const read = (file) => fs.readFileSync(file, "utf8");

function classified(sourceFileId, filename, mediaType = "application/octet-stream") {
  return {
    sourceFileId,
    ...classifySourceMetadata({ filename, mediaType }),
  };
}

test("classifier maps the representative client source pack conservatively", () => {
  const fbx = classified("source_fbx", "jyoti apartment model.fbx");
  const skb = classified("source_skb", "jyoti apartment 1.skb");
  const dwg = classified("source_dwg", "FIRST FLOOR LEVEL.dwg");
  const drs = classified("source_drs", "JYOTI APPARTMENT D5.drs");
  const pdf = classified("source_pdf", "Jyoti Paradise.pdf", "application/pdf");
  const render = classified("source_jpg", "Bagde flat scheme.max+1.jpg", "image/jpeg");

  assert.equal(SOURCE_CLASSIFIER_VERSION, "source-classifier-v1");
  assert.ok(fbx.roles.includes("geometry-authority"));
  assert.ok(fbx.capabilities.includes("geometry"));
  assert.ok(fbx.geometryAuthorityScore >= 0.9);

  assert.ok(skb.roles.includes("material-recovery"));
  assert.ok(skb.capabilities.includes("authoring-history"));
  assert.ok(skb.geometryAuthorityScore < 0.85);

  assert.deepEqual(dwg.roles, ["evidence"]);
  assert.ok(dwg.capabilities.includes("dimensions"));
  assert.equal(dwg.geometryAuthorityScore, 0);

  assert.ok(drs.roles.includes("material-recovery"));
  assert.ok(drs.capabilities.includes("render-dependencies"));
  assert.equal(drs.geometryAuthorityScore, 0);

  assert.ok(pdf.roles.includes("content-reference"));
  assert.ok(pdf.capabilities.includes("marketing"));
  assert.equal(pdf.geometryAuthorityScore, 0);

  assert.deepEqual(render.roles, ["presentation-reference"]);
  assert.deepEqual(render.capabilities, ["visual-style"]);
  assert.equal(render.geometryAuthorityScore, 0);
});

test("texture image names are material recovery, not facade presentation guesses", () => {
  const texture = classified("source_texture", "textures/wall_normal.png", "image/png");
  assert.deepEqual(texture.roles, ["material-recovery"]);
  assert.ok(texture.capabilities.includes("textures"));
  assert.equal(texture.geometryAuthorityScore, 0);
});

test("unknown and CAD evidence never become automatic geometry authority", () => {
  const unknown = classified("source_unknown", "client-data.bin");
  const cad = classified("source_cad", "approved-plan.dwg");
  assert.deepEqual(unknown.roles, ["evidence"]);
  assert.equal(unknown.geometryAuthorityScore, 0);
  assert.ok(!cad.roles.includes("geometry-authority"));
  assert.equal(cad.geometryAuthorityScore, 0);
});

test("one strong FBX beats supporting SKB but two strong models require review", () => {
  const fbx = classified("source_fbx", "building.fbx");
  const skb = classified("source_skb", "building-backup.skb");
  assert.deepEqual(chooseGeometryAuthoritySuggestion([fbx, skb]), {
    status: "suggested",
    sourceFileId: "source_fbx",
    score: 0.96,
    reason: "unique-high-confidence-geometry-candidate",
  });

  const glb = classified("source_glb", "building.glb", "model/gltf-binary");
  const ambiguous = chooseGeometryAuthoritySuggestion([fbx, glb]);
  assert.equal(ambiguous.status, "operator-review-required");
  assert.equal(ambiguous.sourceFileId, null);
  assert.equal(ambiguous.reason, "multiple-high-confidence-geometry-candidates");
});

test("classification persistence is advisory and follows one source-owned cascade path", () => {
  const migration = read("database/migrations/0034_source_classification_suggestions.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS source_classification_suggestions_3d/);
  assert.match(migration, /REFERENCES source_files_3d\(id\) ON DELETE CASCADE/);
  assert.match(migration, /REFERENCES projects_3d\(id\) ON DELETE NO ACTION/);
  assert.match(migration, /upload_state='verified'/);
  assert.doesNotMatch(migration, /REFERENCES projects_3d\(id\) ON DELETE CASCADE/);
});

test("classification route is protected and cannot mutate source bytes or final source-pack authority", () => {
  const worker = read("workers/source-classification.mjs");
  assert.match(worker, /projectOperationLockReason\(env, project\.id, "source-write"\)/);
  assert.match(worker, /activeDeletionJob\(env\)/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /upload_state='verified'/);
  assert.match(worker, /advisoryOnly: true/);
  assert.match(worker, /operatorApprovalRequired: true/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.(?:put|delete)/);
  assert.doesNotMatch(worker, /INSERT INTO source_pack_files_3d|UPDATE source_pack_files_3d/i);
  assert.doesNotMatch(worker, /UPDATE source_packs_3d/i);
  assert.doesNotMatch(worker, /jyoti-paradise|Jyoti Paradise/i);
});

test("classification route is mounted before legacy source routes", () => {
  const entry = read("workers/admin-entry.mjs");
  assert.match(entry, /handleSourceClassificationRequest/);
  assert.ok(
    entry.indexOf("handleSourceClassificationRequest(") <
      entry.indexOf("handleSourceVerificationRequest("),
  );
});

test("classification handler ignores unrelated paths and rejects unsupported methods before auth", async () => {
  const unrelated = await handleSourceClassificationRequest(
    new Request("https://admin.example/3Dprojects/api/projects"),
    {},
  );
  assert.equal(unrelated, null);

  const response = await handleSourceClassificationRequest(
    new Request(
      "https://admin.example/3Dprojects/api/cloud/projects/garden-heights/source-classification",
      { method: "DELETE" },
    ),
    {},
  );
  assert.equal(response.status, 405);
});
