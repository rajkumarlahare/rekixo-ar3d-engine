import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sourceUploadPolicy = await import(
  new URL("../workers/source-upload-policy.mjs", import.meta.url)
);

const {
  SOURCE_UPLOAD_PART_SIZE,
  SOURCE_UPLOAD_MAX_PARTS,
  SOURCE_UPLOAD_MAX_BYTES,
  validSourceIdentity,
  validSourceSha256,
  sourceFileKey,
  sourcePartPlan,
  expectedSourcePartSize,
} = sourceUploadPolicy;

test("Source Pack V2 uses bounded 16 MiB multipart chunks", () => {
  assert.equal(SOURCE_UPLOAD_PART_SIZE, 16 * 1024 * 1024);
  assert.equal(SOURCE_UPLOAD_MAX_PARTS, 10_000);
  assert.equal(
    SOURCE_UPLOAD_MAX_BYTES,
    SOURCE_UPLOAD_PART_SIZE * SOURCE_UPLOAD_MAX_PARTS,
  );

  assert.deepEqual(sourcePartPlan(1), {
    partSize: SOURCE_UPLOAD_PART_SIZE,
    partCount: 1,
  });
  assert.deepEqual(sourcePartPlan(SOURCE_UPLOAD_PART_SIZE), {
    partSize: SOURCE_UPLOAD_PART_SIZE,
    partCount: 1,
  });
  assert.deepEqual(sourcePartPlan(SOURCE_UPLOAD_PART_SIZE + 7), {
    partSize: SOURCE_UPLOAD_PART_SIZE,
    partCount: 2,
  });
  assert.deepEqual(sourcePartPlan(SOURCE_UPLOAD_MAX_BYTES), {
    partSize: SOURCE_UPLOAD_PART_SIZE,
    partCount: SOURCE_UPLOAD_MAX_PARTS,
  });
  assert.equal(
    expectedSourcePartSize(
      SOURCE_UPLOAD_PART_SIZE + 7,
      SOURCE_UPLOAD_PART_SIZE,
      1,
    ),
    SOURCE_UPLOAD_PART_SIZE,
  );
  assert.equal(
    expectedSourcePartSize(
      SOURCE_UPLOAD_PART_SIZE + 7,
      SOURCE_UPLOAD_PART_SIZE,
      2,
    ),
    7,
  );
});

test("multipart planning rejects invalid sizes, part sizes, counts and part numbers", () => {
  assert.throws(() => sourcePartPlan(0), /positive safe integer/);
  assert.throws(
    () => sourcePartPlan(Number.MAX_SAFE_INTEGER + 1),
    /positive safe integer/,
  );
  assert.throws(
    () => sourcePartPlan(100, 5 * 1024 * 1024 - 1),
    /Invalid multipart part size/,
  );
  assert.throws(
    () => sourcePartPlan(100, 5 * 1024 * 1024 * 1024 + 1),
    /Invalid multipart part size/,
  );
  assert.throws(
    () => sourcePartPlan(100, 5 * 1024 * 1024 + 0.5),
    /Invalid multipart part size/,
  );
  assert.throws(
    () => sourcePartPlan(SOURCE_UPLOAD_MAX_BYTES + 1),
    /more than 10,000 multipart parts/,
  );
  assert.throws(
    () => expectedSourcePartSize(100, SOURCE_UPLOAD_PART_SIZE, 0),
    /Invalid multipart part number/,
  );
  assert.throws(
    () => expectedSourcePartSize(100, SOURCE_UPLOAD_PART_SIZE, 1.5),
    /Invalid multipart part number/,
  );
  assert.throws(
    () => expectedSourcePartSize(100, SOURCE_UPLOAD_PART_SIZE, 2),
    /Invalid multipart part number/,
  );
});

test("source identity and SHA-256 validators stay strict", () => {
  assert.equal(validSourceIdentity("source_12345678"), true);
  assert.equal(validSourceIdentity("short"), false);
  assert.equal(validSourceIdentity("../source_12345678"), false);
  assert.equal(validSourceIdentity(null), false);
  assert.equal(validSourceSha256("a".repeat(64)), true);
  assert.equal(validSourceSha256("A".repeat(64)), false);
  assert.equal(validSourceSha256("a".repeat(63)), false);
  assert.equal(validSourceSha256(null), false);
});

test("source originals use project-scoped content-addressed keys", () => {
  const sha256 = "a".repeat(64);
  assert.equal(
    sourceFileKey("garden-heights", "source_12345678", sha256),
    `projects/garden-heights/source-files/source_12345678/${sha256}`,
  );
  assert.throws(() => sourceFileKey("../escape", "source_12345678", sha256));
  assert.throws(() => sourceFileKey("garden-heights", "../source", sha256));
  assert.throws(() => sourceFileKey("garden-heights", "source_12345678", "bad"));
});

test("runtime worker consumes the isolated upload policy instead of redefining it", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(worker, /from "\.\/source-upload-policy\.mjs"/);
  assert.match(worker, /SOURCE_UPLOAD_PART_SIZE/);
  assert.match(worker, /SOURCE_UPLOAD_MAX_BYTES/);
  assert.match(worker, /sourceFileKey/);
  assert.match(worker, /sourcePartPlan/);
  assert.match(worker, /expectedSourcePartSize/);
  assert.doesNotMatch(worker, /export function sourcePartPlan/);
  assert.doesNotMatch(worker, /export function sourceFileKey/);
});

test("new source route is intercepted before the legacy Cloud Studio router", () => {
  const entry = fs.readFileSync("workers/admin-entry.mjs", "utf8");
  assert.match(entry, /handleSourceUploadRequest/);
  assert.match(entry, /if \(sourceResponse\) return sourceResponse/);
  assert.match(entry, /return adminWorker\.fetch/);
});

test("Source Pack V2 upload API remains additive and never mutates legacy Studio assets", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(worker, /source_files_3d/);
  assert.match(worker, /source_upload_sessions_3d/);
  assert.match(worker, /source_upload_parts_3d/);
  assert.match(worker, /createMultipartUpload/);
  assert.match(worker, /resumeMultipartUpload/);
  assert.match(worker, /uploadPart/);
  assert.match(worker, /\.complete\(completionParts\)/);
  assert.match(worker, /\.abort\(\)/);
  assert.doesNotMatch(worker, /studio_assets_3d/);
  assert.doesNotMatch(worker, /studio_drafts_3d/);
});

test("completion stops at uploaded and cannot silently promote a source to verified", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(worker, /SET upload_state='uploaded'/);
  assert.doesNotMatch(worker, /SET upload_state='verified'/);
  assert.match(worker, /upload_state === "verified"/);
  assert.match(worker, /Verified source originals are immutable/);
});

test("source mutations are same-origin, deletion-job aware and protected by generic operation locks", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  const migration = fs.readFileSync(
    "database/migrations/0033_project_operation_locks.sql",
    "utf8",
  );

  assert.match(
    worker,
    /new URL\(origin\)\.origin === new URL\(request\.url\)\.origin/,
  );
  assert.match(worker, /activeDeletionJob\(env\)/);
  assert.match(worker, /projectOperationLockReason/);
  assert.match(worker, /project_operation_locks_3d/);
  assert.match(worker, /"source-write"/);
  assert.match(worker, /status: 423/);
  assert.doesNotMatch(worker, /jyoti-paradise|Jyoti Paradise/i);
  assert.match(
    worker,
    /Source originals cannot be mutated or deleted through this route/,
  );
  assert.doesNotMatch(worker, /request\.method === "DELETE"/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS project_operation_locks_3d/);
  assert.match(migration, /PRIMARY KEY \(project_id, operation\)/);
  assert.match(migration, /'source-write'/);
  assert.match(migration, /WHERE slug='jyoti-paradise'/);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
});

test("multipart part uploads require exact Content-Length and completion validates every part", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(worker, /Multipart part Content-Length is required/);
  assert.match(worker, /declaredLength !== expectedBytes/);
  assert.match(worker, /bytes\.byteLength !== expectedBytes/);
  assert.match(worker, /parts\.length !== partCount/);
  assert.match(worker, /Number\(part\.part_number\) !== partNumber/);
  assert.match(worker, /totalBytes !== Number\(source\.byte_size\)/);
});

test("multipart completion has a D1 recovery path after an R2 success", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  const headIndex = worker.indexOf("MODEL_ASSETS.head(source.r2_key)");
  const completeIndex = worker.indexOf(".complete(completionParts)");
  assert.ok(headIndex >= 0);
  assert.ok(completeIndex > headIndex);
  assert.match(
    worker,
    /Completed R2 source object does not match the registered source metadata/,
  );
  assert.match(worker, /source\.upload_state === "uploaded"/);
  assert.match(worker, /replayed: true/);
});

test("concurrent initiations abort the losing R2 upload and resume the winning D1 session", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(worker, /await multipart\.abort\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(worker, /const winner = await activeSession/);
  assert.match(worker, /winner\.id !== sessionId/);
  assert.match(worker, /resumed: true/);
});

test("D1 permits only one active multipart session for each source original", () => {
  const migration = fs.readFileSync(
    "database/migrations/0032_source_upload_one_active_session.sql",
    "utf8",
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_source_upload_sessions_3d_one_active/,
  );
  assert.match(migration, /ON source_upload_sessions_3d\(source_file_id\)/);
  assert.match(migration, /WHERE state IN \('initiated','uploading'\)/);
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM/i);
});
