import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { handleSourceVerificationRequest } from "../workers/source-verification.mjs";

const read = (file) => fs.readFileSync(file, "utf8");

test("source verification is a dedicated route ahead of the upload router", () => {
  const entry = read("workers/admin-entry.mjs");
  assert.match(entry, /handleSourceVerificationRequest/);
  assert.match(entry, /handleSourceUploadRequest/);
  assert.ok(
    entry.indexOf("handleSourceVerificationRequest(") <
      entry.indexOf("handleSourceUploadRequest(request"),
  );
});

test("source verification streams SHA-256 without buffering the original", () => {
  const worker = read("workers/source-verification.mjs");
  assert.match(worker, /crypto\.DigestStream\("SHA-256"\)/);
  assert.match(worker, /object\.body\.pipeTo\(digestStream\)/);
  assert.match(worker, /await digestStream\.digest/);
  assert.doesNotMatch(worker, /arrayBuffer\(\)/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.put/);
  assert.doesNotMatch(worker, /MODEL_ASSETS\.delete/);
});

test("verification checks R2 identity before promoting uploaded to verified", () => {
  const worker = read("workers/source-verification.mjs");
  assert.match(worker, /Number\(object\.size\) !== Number\(source\.byte_size\)/);
  assert.match(worker, /metadata\.projectId !== project\.id/);
  assert.match(worker, /metadata\.sourceFileId !== source\.id/);
  assert.match(worker, /metadata\.sha256 !== source\.sha256/);
  assert.match(worker, /etag !== String\(source\.source_etag\)/);
  assert.match(worker, /digest !== String\(source\.sha256\)\.toLowerCase\(\)/);
  assert.match(worker, /SET upload_state='verified',failure_reason=NULL/);
  assert.match(worker, /AND upload_state='uploaded'/);
  assert.match(worker, /source\.verification_failed/);
  assert.match(worker, /source\.verified/);
});

test("verification keeps project protections tenant-neutral", () => {
  const worker = read("workers/source-verification.mjs");
  assert.match(worker, /projectOperationLockReason\(env, project\.id, "source-write"\)/);
  assert.match(worker, /activeDeletionJob\(env\)/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(worker, /status: 423/);
  assert.doesNotMatch(worker, /jyoti-paradise|Jyoti Paradise/i);
});

test("verification handler ignores unrelated routes and rejects non-POST verification", async () => {
  const unrelated = await handleSourceVerificationRequest(
    new Request("https://admin.example/3Dprojects/api/projects"),
    {},
  );
  assert.equal(unrelated, null);

  const response = await handleSourceVerificationRequest(
    new Request(
      "https://admin.example/3Dprojects/api/cloud/projects/garden-heights/source-files/source_12345678/verify",
      { method: "GET" },
    ),
    {},
  );
  assert.equal(response.status, 405);
});
