import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const range = await import(
  new URL("../workers/http-range.mjs", import.meta.url)
);
const storage = await import(
  new URL("../workers/storage-boundary.mjs", import.meta.url)
);

test("single byte range parser supports open, bounded and suffix ranges", () => {
  assert.deepEqual(range.parseSingleByteRange("bytes=0-99", 1000), {
    error: false,
    offset: 0,
    length: 100,
    start: 0,
    end: 99,
  });
  assert.deepEqual(range.parseSingleByteRange("bytes=900-", 1000), {
    error: false,
    offset: 900,
    length: 100,
    start: 900,
    end: 999,
  });
  assert.deepEqual(range.parseSingleByteRange("bytes=-100", 1000), {
    error: false,
    offset: 900,
    length: 100,
    start: 900,
    end: 999,
  });
  assert.equal(range.parseSingleByteRange("bytes=1000-", 1000).status, 416);
  assert.equal(range.parseSingleByteRange("bytes=0-1,4-5", 1000).status, 416);
});

test("R2 helper emits proper 206 and 416 video responses", async () => {
  const bytes = new TextEncoder().encode("0123456789");
  const bucket = {
    async head(key) {
      assert.equal(key, "projects/demo/media/demo.mp4");
      return {
        size: bytes.length,
        httpEtag: '"etag"',
        writeHttpMetadata(headers) {
          headers.set("Content-Type", "video/mp4");
        },
      };
    },
    async get(_key, options) {
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? bytes.length;
      return {
        body: bytes.slice(offset, offset + length),
      };
    },
  };
  const request = new Request("https://example.com/video.mp4", {
    headers: { Range: "bytes=2-5" },
  });
  const served = await range.serveR2Object(
    bucket,
    "projects/demo/media/demo.mp4",
    request,
    { mimeType: "video/mp4", allowRange: true },
  );
  assert.equal(served.response.status, 206);
  assert.equal(served.response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(served.response.headers.get("content-length"), "4");
  assert.equal(await served.response.text(), "2345");

  const invalid = await range.serveR2Object(
    bucket,
    "projects/demo/media/demo.mp4",
    new Request("https://example.com/video.mp4", {
      headers: { Range: "bytes=50-" },
    }),
    { mimeType: "video/mp4", allowRange: true },
  );
  assert.equal(invalid.response.status, 416);
  assert.equal(invalid.response.headers.get("content-range"), "bytes */10");
});

test("storage guards reject cross-project and malformed R2 keys", () => {
  assert.equal(
    storage.assertProjectAssetKey(
      "garden-heights",
      "projects/garden-heights/models/exterior-v1.glb",
      "models",
    ),
    "projects/garden-heights/models/exterior-v1.glb",
  );
  assert.throws(
    () =>
      storage.assertProjectAssetKey(
        "garden-heights",
        "projects/other/models/exterior-v1.glb",
        "models",
      ),
    /escapes its project storage prefix/,
  );
  assert.equal(
    storage.assertDraftAssetKey(
      "garden-heights",
      "asset_12345678",
      "projects/garden-heights/draft-assets/asset_12345678",
    ),
    "projects/garden-heights/draft-assets/asset_12345678",
  );
  assert.throws(
    () =>
      storage.assertReleaseAssetKey(
        "garden-heights",
        "release_12345678",
        "media",
        "video.mp4",
        "projects/garden-heights/releases/release_other/media/video.mp4",
      ),
    /does not match release ownership/,
  );
});

test("Admin legacy registry/status reads require dedicated Engine Admin authorization", () => {
  const admin = fs.readFileSync("workers/admin.mjs", "utf8");
  const auth = fs.readFileSync("workers/admin-cloud.mjs", "utf8");
  assert.match(admin, /engineAdminReadAccess\(request, env\)/);
  assert.match(auth, /export async function engineAdminReadAccess/);
  assert.match(auth, /Engine Admin sign-in required/);
  assert.match(admin, /\/api\/integration\/projects\//);
});

test("Admin model availability is paginated and active model is checked first", () => {
  const admin = fs.readFileSync("workers/admin.mjs", "utf8");
  assert.match(admin, /modelLimit/);
  assert.match(admin, /modelOffset/);
  assert.match(admin, /ORDER BY is_active DESC/);
  assert.match(admin, /if \(activeRow\) \{/);
  assert.match(admin, /for \(let index = 0; index < rowsToCheck\.length; index \+= 20\)/);
  assert.doesNotMatch(admin, /rows\.slice\(0, 20\)/);
  assert.match(admin, /modelPage:/);
});

test("runtime DB JSON corruption is surfaced instead of silently defaulted", () => {
  const admin = fs.readFileSync("workers/admin.mjs", "utf8");
  const publicWorker = fs.readFileSync("workers/public.mjs", "utf8");
  assert.doesNotMatch(admin, /function parseJson\(value, fallback\)/);
  assert.doesNotMatch(publicWorker, /function parseJson\(value, fallback\)/);
  assert.match(admin, /contains malformed JSON/);
  assert.match(publicWorker, /contains malformed JSON/);
  assert.match(publicWorker, /Published 3D project data is corrupted/);
  assert.match(admin, /3D project status data is corrupted/);
});

test("public and release workers enforce R2 ownership and video range support", () => {
  const publicWorker = fs.readFileSync("workers/public.mjs", "utf8");
  const release = fs.readFileSync("workers/release-runtime.mjs", "utf8");
  const publisher = fs.readFileSync("workers/release-publish.mjs", "utf8");
  assert.match(publicWorker, /assertProjectAssetKey/);
  assert.match(publicWorker, /allowRange: mimeType === "video\/mp4"/);
  assert.match(release, /assertReleaseAssetKey/);
  assert.match(release, /allowRange: kind === "media" && mimeType === "video\/mp4"/);
  assert.match(publisher, /assertDraftAssetKey/);
  assert.match(publisher, /assertReleaseAssetKey/);
});

test("Phase 6 migration adds uniqueness, JSON and tenant-reference guards", () => {
  const migration = fs.readFileSync(
    "database/migrations/0022_worker_db_security_v1.sql",
    "utf8",
  );
  assert.match(migration, /idx_models_3d_project_version_unique/);
  assert.match(migration, /idx_models_3d_asset_key_unique/);
  assert.match(migration, /idx_camera_presets_3d_project_name_unique/);
  assert.match(migration, /trg_models_3d_storage_prefix_insert/);
  assert.match(migration, /trg_scenes_3d_model_owner_insert/);
  assert.match(migration, /trg_scenes_3d_camera_owner_insert/);
  assert.match(migration, /trg_scenes_3d_json_insert/);
  assert.match(migration, /trg_studio_assets_3d_storage_prefix_insert/);
});

test("frontend contracts reject malformed worker payloads before rendering", async () => {
  const source = fs.readFileSync(
    "packages/contracts/src/runtime-validation.ts",
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const validators = await import(
    "data:text/javascript;base64," + Buffer.from(js).toString("base64"),
  );

  const publicPayload = {
    project: {
      id: "project_12345678",
      slug: "garden-heights",
      name: "Garden Heights",
      status: "published",
    },
    scenes: [],
    mediaBaseUrl: "/3Dprojects/api/projects/garden-heights/media",
  };
  assert.doesNotThrow(() =>
    validators.assertPublic3DExperiencePayload(publicPayload),
  );
  assert.throws(
    () =>
      validators.assertPublic3DExperiencePayload({
        ...publicPayload,
        project: { ...publicPayload.project, slug: "../escape" },
      }),
    /Invalid project payload/,
  );
});
