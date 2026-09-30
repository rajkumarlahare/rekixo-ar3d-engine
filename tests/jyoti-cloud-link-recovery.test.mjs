import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Engine Admin status emits contract-safe relative model URLs", () => {
  const worker = read("workers/admin.mjs");
  assert.match(worker, /\/3Dprojects\/api\/models\//);
  assert.doesNotMatch(worker, /https:\/\/ar3dstudio\.in\/3Dprojects\/api\/models\//);
});

test("Studio surfaces a safe existing-cloud identity action", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const storage = read("apps/admin/src/studio/storage.ts");

  assert.match(studio, /Attach current local design to cloud identity/);
  assert.match(studio, /before-cloud-adoption\.rekixo\.json/);
  assert.match(studio, /Existing public releases are not changed/);
  assert.match(studio, /matchingCloudProject\.draftRevision/);
  assert.match(storage, /adoptExistingCloudIdentity/);
  assert.match(storage, /local backup/);
  assert.match(storage, /transaction\(\["projects", "assets"\], "readwrite"\)/);
});
