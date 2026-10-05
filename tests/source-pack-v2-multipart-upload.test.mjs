import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sourceUpload = await import(
  new URL("../workers/source-upload.mjs", import.meta.url)
);

const {
  SOURCE_UPLOAD_PART_SIZE,
  SOURCE_UPLOAD_MAX_PARTS,
  SOURCE_UPLOAD_MAX_BYTES,
  sourceFileKey,
  sourcePartPlan,
  expectedSourcePartSize,
} = sourceUpload;

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

test("multipart planning rejects invalid sizes and more than 10,000 parts", () => {
  assert.throws(() => sourcePartPlan(0), /positive safe integer/);
  assert.throws(() => sourcePartPlan(Number.MAX_SAFE_INTEGER + 1), /positive safe integer/);
  assert.throws(
    () => sourcePartPlan(SOURCE_UPLOAD_MAX_BYTES + 1),
    /more than 10,000 multipart parts/,
  );
  assert.throws(
    () => expectedSourcePartSize(100, SOURCE_UPLOAD_PART_SIZE, 2),
    /Invalid multipart part number/,
  );
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

test("mutations are same-origin, deletion-job aware and Jyoti benchmark locked", () => {
  const worker = fs.readFileSync("workers/source-upload.mjs", "utf8");
  assert.match(
    worker,
    /new URL\(origin\)\.origin === new URL\(request\.url\)\.origin/,
  );
  assert.match(worker, /activeDeletionJob\(env\)/);
  assert.match(worker, /LOCKED_SOURCE_MUTATION_SLUGS = new Set\(\["jyoti-paradise"\]\)/);
  assert.match(worker, /status: 423/);
  assert.match(worker, /Source originals cannot be mutated or deleted through this route/);
  assert.doesNotMatch(worker, /request\.method === "DELETE"/);
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
  assert.match(worker, /Completed R2 source object does not match the registered source metadata/);
  assert.match(worker, /source\.upload_state === "uploaded"/);
  assert.match(worker, /replayed: true/);
});
