import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const contract = await import(
  asUrl(compile("packages/contracts/src/source-pack-v2.ts"))
);

const validPack = {
  format: "rekixo-source-pack",
  version: 2,
  project: {
    id: "project_sample",
    slug: "sample-project",
    name: "Sample Project",
  },
  geometryAuthorityFileId: "source-fbx",
  operatorApproved: true,
  sources: [
    {
      id: "source-fbx",
      filename: "building/model.fbx",
      mediaType: "application/octet-stream",
      byteSize: 1000,
      sha256: "a".repeat(64),
      roles: ["geometry-authority"],
      capabilities: ["geometry", "materials", "textures"],
      classification: { origin: "operator", confidence: 1 },
    },
    {
      id: "source-skb",
      filename: "building/model.skb",
      mediaType: "application/octet-stream",
      byteSize: 900,
      sha256: "b".repeat(64),
      roles: ["material-recovery", "evidence"],
      capabilities: ["materials", "textures", "authoring-history"],
      classification: { origin: "automatic", confidence: 0.82 },
    },
    {
      id: "source-dwg",
      filename: "plans/first-floor.dwg",
      mediaType: "image/vnd.dwg",
      byteSize: 700,
      sha256: "c".repeat(64),
      roles: ["evidence"],
      capabilities: ["dimensions", "floor-plan"],
      classification: { origin: "automatic", confidence: 0.91 },
    },
    {
      id: "source-render",
      filename: "references/exterior.jpg",
      mediaType: "image/jpeg",
      byteSize: 500,
      sha256: "d".repeat(64),
      roles: ["presentation-reference"],
      capabilities: ["visual-style"],
      classification: { origin: "automatic", confidence: 0.96 },
    },
    {
      id: "source-brochure",
      filename: "content/brochure.pdf",
      mediaType: "application/pdf",
      byteSize: 600,
      sha256: "e".repeat(64),
      roles: ["content-reference", "evidence"],
      capabilities: ["marketing", "location-context", "floor-plan"],
      classification: { origin: "operator", confidence: 1 },
    },
  ],
};

test("Source Pack V2 accepts exactly one explicit geometry authority", () => {
  assert.doesNotThrow(() => contract.assertProjectSourcePackV2(validPack));
  assert.equal(validPack.geometryAuthorityFileId, "source-fbx");
});

test("Source Pack V2 rejects equal geometry truth from multiple files", () => {
  const altered = structuredClone(validPack);
  altered.sources[1].roles.push("geometry-authority");
  altered.sources[1].capabilities.push("geometry");
  assert.throws(
    () => contract.assertProjectSourcePackV2(altered),
    /exactly one declared geometry authority/,
  );
});

test("Source Pack V2 rejects authority that lacks geometry capability", () => {
  const altered = structuredClone(validPack);
  altered.sources[0].capabilities = altered.sources[0].capabilities.filter(
    (item) => item !== "geometry",
  );
  assert.throws(
    () => contract.assertProjectSourcePackV2(altered),
    /Geometry authority must declare geometry capability/,
  );
});

test("Source Pack V2 keeps classification confidence reviewable and bounded", () => {
  const altered = structuredClone(validPack);
  altered.sources[2].classification.confidence = 1.4;
  assert.throws(
    () => contract.assertProjectSourcePackV2(altered),
    /Invalid source pack V2 file/,
  );
});

test("Source Pack V2 schema is additive, sealed after ready, and prepared for resumable upload", () => {
  const migration = fs.readFileSync(
    "database/migrations/0031_source_pack_v2_foundation.sql",
    "utf8",
  );
  const verifier = fs.readFileSync(
    "scripts/verify-fresh-migrations.mjs",
    "utf8",
  );

  for (const table of [
    "source_files_3d",
    "source_packs_3d",
    "source_pack_files_3d",
    "source_upload_sessions_3d",
    "source_upload_parts_3d",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    assert.match(verifier, new RegExp(table));
  }

  assert.match(migration, /Verified source file identity is immutable/);
  assert.match(migration, /Source pack can contain only one geometry authority/);
  assert.match(migration, /Ready source pack file mapping is immutable/);
  assert.match(migration, /Ready source pack is immutable; create a new version/);
  assert.match(migration, /Create source pack as draft before sealing it ready/);
  assert.match(migration, /status IN \('ready','superseded'\)/);
  assert.match(migration, /json_type\(roles_json\)='array'/);
  assert.match(migration, /trg_source_upload_sessions_3d_owner_update/);
  assert.match(migration, /r2-multipart/);
  assert.match(migration, /geometry-authority/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+studio_assets_3d/i);
  assert.doesNotMatch(migration, /UPDATE\s+studio_assets_3d/i);
});

test("sealed Source Pack V2 can cascade only inside the exact resumable hard-delete context", () => {
  const migration = fs.readFileSync(
    "database/migrations/0031_source_pack_v2_foundation.sql",
    "utf8",
  );
  const verifier = fs.readFileSync(
    "scripts/verify-fresh-migrations.mjs",
    "utf8",
  );

  assert.match(
    migration,
    /FOREIGN KEY \(geometry_authority_file_id\) REFERENCES source_files_3d\(id\) ON DELETE NO ACTION/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(source_file_id\) REFERENCES source_files_3d\(id\) ON DELETE NO ACTION/,
  );
  assert.match(migration, /trg_source_pack_files_3d_ready_delete_block/);
  assert.match(migration, /project\.status='archived'/);
  assert.match(migration, /engine_deletion_jobs_3d job/);
  assert.match(migration, /job\.status<>'completed'/);
  assert.match(migration, /json_each\(job\.projects_json\)/);
  assert.match(
    migration,
    /json_extract\(snapshot_project\.value, '\$\.id'\)=OLD\.project_id/,
  );

  assert.match(verifier, /Verifying sealed Source Pack V2 rows can be removed only/);
  assert.match(verifier, /db_cleanup_pending/);
  assert.match(verifier, /DELETE FROM projects_3d WHERE id=/);
  assert.match(verifier, /Sealed Source Pack V2 project cascade left project-owned rows behind/);
});