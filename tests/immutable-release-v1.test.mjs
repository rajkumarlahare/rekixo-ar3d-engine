import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const contractSource = fs.readFileSync(
  "packages/contracts/src/release-manifest-v1.ts",
  "utf8",
);
const contractJs = ts.transpileModule(contractSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const contract = await import(
  "data:text/javascript;base64," +
    Buffer.from(contractJs).toString("base64")
);
const runtime = await import(
  new URL("../workers/release-runtime.mjs", import.meta.url)
);

const baseManifest = () => ({
  format: "rekixo-release-manifest",
  version: 1,
  release: {
    id: "release_12345678",
    projectId: "project_12345678",
    projectSlug: "garden-heights",
    version: 3,
    createdAt: "2026-09-28T00:00:00.000Z",
    sourceDraftRevision: 7,
  },
  project: {
    id: "project_12345678",
    slug: "garden-heights",
    name: "Garden Heights",
    status: "published",
  },
  experience: {
    scenes: [{
      id: "scene_main",
      projectId: "project_12345678",
      name: "Project Navigation",
      type: "project-navigation",
      sortOrder: 10,
      enabled: true,
      settings: {},
    }],
    model: {
      id: "model_main",
      projectId: "project_12345678",
      name: "Building",
      version: 2,
      mimeType: "model/gltf-binary",
      releaseAssetId: "asset_release_model",
    },
    mediaFiles: ["cover.webp"],
  },
  studio: {
    project: {
      schema: 1,
      id: "project_12345678",
      slug: "garden-heights",
      name: "Garden Heights",
      updated: "2026-09-28T00:00:00.000Z",
      assets: ["asset_local_model"],
      scene: {},
      releases: [],
    },
  },
  sourceEvidence: {
    sourcePackSourceIds: ["source-dwg"],
    sourceClaimIds: [],
  },
  assets: [
    {
      id: "asset_release_model",
      kind: "model",
      logicalId: "model_main",
      name: "Building",
      mimeType: "model/gltf-binary",
      byteSize: 1024,
    },
    {
      id: "asset_release_studio",
      kind: "studio",
      logicalId: "asset_local_model",
      name: "Building",
      mimeType: "model/gltf-binary",
      byteSize: 1024,
      sha256: "a".repeat(64),
    },
  ],
});

test("release manifest V1 validates project identity, assets and Studio snapshot", () => {
  const manifest = baseManifest();
  assert.doesNotThrow(() => contract.assertReleaseManifestV1(manifest));

  const wrongProject = structuredClone(manifest);
  wrongProject.project.slug = "other";
  assert.throws(
    () => contract.assertReleaseManifestV1(wrongProject),
    /project snapshot/,
  );

  const missingStudioAsset = structuredClone(manifest);
  missingStudioAsset.assets = missingStudioAsset.assets.filter(
    (asset) => asset.kind !== "studio",
  );
  assert.throws(
    () => contract.assertReleaseManifestV1(missingStudioAsset),
    /Studio asset is missing/,
  );
});

async function sha256(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

function dbForActiveRelease(row) {
  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("sqlite_master")) return { total: 3 };
          if (sql.includes("pragma_table_info")) return { total: 1 };
          if (sql.includes("FROM projects_3d p")) return row;
          throw new Error("Unexpected first SQL: " + sql);
        },
      };
    },
  };
}

test("active release state verifies manifest checksum before exposing it", async () => {
  const manifest = baseManifest();
  const manifestJson = JSON.stringify(manifest);
  const hash = await sha256(manifestJson);
  const row = {
    project_id: manifest.project.id,
    slug: manifest.project.slug,
    name: manifest.project.name,
    status: "published",
    active_release_id: manifest.release.id,
    release_version: manifest.release.version,
    manifest_json: manifestJson,
    manifest_sha256: hash,
    release_created_at: manifest.release.createdAt,
  };

  const state = await runtime.activeReleaseState(
    { DB: dbForActiveRelease(row) },
    manifest.project.slug,
  );
  assert.equal(state.state, "ok");
  assert.equal(state.manifestSha256, hash);

  const experience = runtime.experienceFromActiveReleaseState(state);
  assert.equal(experience.release.id, manifest.release.id);
  assert.equal(experience.release.version, 3);
  assert.match(
    experience.model.url,
    /\/api\/releases\/release_12345678\/models\/model_main\/content\?v=3$/,
  );
  assert.equal(
    experience.mediaBaseUrl,
    "/3Dprojects/api/releases/release_12345678/media",
  );

  const corrupt = await runtime.activeReleaseState(
    {
      DB: dbForActiveRelease({
        ...row,
        manifest_sha256: "0".repeat(64),
      }),
    },
    manifest.project.slug,
  );
  assert.equal(corrupt.state, "corrupt");
  assert.match(corrupt.reason, /checksum mismatch/);
});

test("public corrupt-release errors hide internal diagnostics and expose a request ID", async () => {
  const manifest = baseManifest();
  const row = {
    project_id: manifest.project.id,
    slug: manifest.project.slug,
    name: manifest.project.name,
    status: "published",
    active_release_id: manifest.release.id,
    release_version: manifest.release.version,
    manifest_json: JSON.stringify(manifest),
    manifest_sha256: "0".repeat(64),
    release_created_at: manifest.release.createdAt,
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await runtime.handleReleaseReadRequest(
      new Request(
        "https://ar3dstudio.in/3Dprojects/api/releases/projects/garden-heights",
      ),
      { DB: dbForActiveRelease(row) },
    );
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, "Active release is unavailable.");
    assert.equal(typeof body.requestId, "string");
    assert.ok(body.requestId.length >= 16);
    assert.equal(Object.hasOwn(body, "diagnostic"), false);
  } finally {
    console.error = originalError;
  }
});

test("public release runtime logs diagnostics server-side instead of returning them", () => {
  const releaseRuntime = fs.readFileSync("workers/release-runtime.mjs", "utf8");
  const publicWorker = fs.readFileSync("workers/public.mjs", "utf8");
  assert.match(releaseRuntime, /function serverError\(error, diagnostic\)/);
  assert.match(publicWorker, /function serverError\(error, diagnostic\)/);
  assert.match(releaseRuntime, /console\.error\(/);
  assert.match(publicWorker, /console\.error\(/);
  assert.doesNotMatch(
    releaseRuntime,
    /return json\([\s\S]{0,220}diagnostic:/,
  );
  assert.doesNotMatch(
    publicWorker,
    /return json\([\s\S]{0,220}diagnostic:/,
  );
});

test("release migration creates immutable release and activation tables", () => {
  const migration = fs.readFileSync(
    "database/migrations/0021_immutable_release_v1.sql",
    "utf8",
  );
  assert.match(migration, /ALTER TABLE projects_3d ADD COLUMN active_release_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS releases_3d/);
  assert.match(migration, /UNIQUE \(project_id, version\)/);
  assert.match(migration, /UNIQUE \(project_id, manifest_sha256\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS release_assets_3d/);
  assert.match(migration, /r2_key TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS release_activations_3d/);
  assert.match(migration, /FOREIGN KEY \(release_id\) REFERENCES releases_3d/);
});

test("publisher freezes R2 objects under collision-proof release IDs and flips one active pointer", () => {
  const publisher = fs.readFileSync(
    "workers/release-publish.mjs",
    "utf8",
  );
  assert.match(
    publisher,
    /projects\/\$\{currentProject\.slug\}\/releases\/\$\{releaseId\}\/models/,
  );
  assert.match(
    publisher,
    /projects\/\$\{currentProject\.slug\}\/releases\/\$\{releaseId\}\/media/,
  );
  assert.doesNotMatch(
    publisher,
    /projects\/\$\{currentProject\.slug\}\/releases\/v\$\{version\}/,
  );
  assert.match(publisher, /INSERT INTO releases_3d/);
  assert.match(publisher, /INSERT INTO release_assets_3d/);
  assert.match(
    publisher,
    /SET active_release_id=\?,status='published',updated_at=\?/,
  );
  assert.match(publisher, /INSERT INTO release_activations_3d/);
  assert.match(publisher, /"publish"/);
  assert.match(publisher, /"rollback"/);
});

test("public release strips private authoring references from Studio snapshot", () => {
  const publisher = fs.readFileSync(
    "workers/release-publish.mjs",
    "utf8",
  );
  const sanitizer = fs.readFileSync(
    "workers/studio-draft-validation.mjs",
    "utf8",
  );
  assert.match(publisher, /publicStudioSnapshot/);
  assert.match(publisher, /studio: \{ project: publicStudioProject \}/);
  assert.match(sanitizer, /export function publicStudioSnapshot\(draft\)/);
  assert.match(sanitizer, /referenceLayers: \[\]/);
  assert.match(sanitizer, /modelNodeTags: \[\]/);
  assert.match(sanitizer, /releases: \[\]/);
  assert.doesNotMatch(sanitizer, /\.\.\.structuredClone\(draft\)/);
});

test("public runtime prefers active immutable release and refuses corrupt release fallback", () => {
  const worker = fs.readFileSync("workers/public.mjs", "utf8");
  assert.match(worker, /const release = await activeReleaseState\(env, slug\)/);
  assert.match(worker, /experienceFromActiveReleaseState\(release\)/);
  assert.match(worker, /__releaseCorrupt: true/);
  assert.match(worker, /serveReleaseAsset/);
  assert.match(worker, /Model is not part of the active release/);
  assert.match(worker, /Media is not part of the active release/);
  assert.doesNotMatch(
    worker,
    /Cache-Control", "public, max-age=31536000, immutable"/,
  );
});

test("immutable asset route exposes only the currently active release", async () => {
  const source = fs.readFileSync("workers/release-runtime.mjs", "utf8");
  assert.match(source, /p\.active_release_id=r\.id/);

  const DB = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("sqlite_master")) return { total: 3 };
          if (sql.includes("pragma_table_info")) return { total: 1 };
          if (sql.includes("FROM release_assets_3d")) return null;
          throw new Error("Unexpected first SQL: " + sql);
        },
      };
    },
  };
  const response = await runtime.serveReleaseAsset(
    {
      DB,
      MODEL_ASSETS: {
        async head() {
          throw new Error("Inactive release must not reach R2.");
        },
      },
    },
    "release_old",
    "models",
    "model_main",
    new Request(
      "https://ar3dstudio.in/3Dprojects/api/releases/release_old/models/model_main/content",
    ),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Release asset not found." });
});

test("Published Showcase prefers immutable active release and keeps legacy static fallback", () => {
  const published = fs.readFileSync(
    "apps/admin/src/studio/published.ts",
    "utf8",
  );
  assert.match(published, /\/3Dprojects\/api\/releases/);
  assert.match(published, /loadReleasePublished/);
  assert.match(published, /return release \?\? loadLegacyPublished\(slug\)/);
  assert.match(published, /\/3Dprojects\/published\/catalog\.json/);
  assert.match(published, /Published release checksum mismatch/);
});

test("release publish and rollback mutations stay behind Engine Admin auth and same-origin checks", () => {
  const admin = fs.readFileSync("workers/admin-cloud.mjs", "utf8");
  assert.match(admin, /sessionFor\(request, env\)/);
  assert.match(admin, /parts\[1\] === "releases"/);
  assert.match(admin, /sameOrigin\(request\)/);
  assert.match(admin, /buildAndActivateRelease/);
  assert.match(admin, /activateExistingRelease/);
});


test("public immutable experience exposes only reviewed two-room door graph in model coordinates", () => {
  const manifest = baseManifest();
  manifest.studio.project.scene = {
    scale: 2,
    modelTransform: { x: 10, y: 4, z: -6, rotationY: 0 },
    floors: [{ id: "floor_1", name: "Floor 1", elevation: 4 }],
    rooms: [
      {
        id: "room_left",
        floorId: "floor_1",
        name: "Living",
        unit: "101",
        x: 8,
        z: -6,
        width: 4,
        depth: 4,
        height: 2.8,
      },
      {
        id: "room_right",
        floorId: "floor_1",
        name: "Bedroom",
        unit: "101",
        x: 12,
        z: -6,
        width: 4,
        depth: 4,
        height: 2.8,
      },
    ],
    openings: [
      {
        id: "door_reviewed",
        floorId: "floor_1",
        kind: "door",
        roomIds: ["room_left", "room_right"],
        x: 10,
        y: 6.1,
        z: -6,
        width: 0.9,
        height: 2.1,
        rotationY: -90,
        reviewed: true,
      },
      {
        id: "door_unreviewed",
        floorId: "floor_1",
        kind: "door",
        roomIds: ["room_left", "room_right"],
        x: 10,
        y: 6.1,
        z: -5,
        width: 0.9,
        height: 2.1,
        rotationY: -90,
        reviewed: false,
      },
      {
        id: "window_reviewed",
        floorId: "floor_1",
        kind: "window",
        roomIds: ["room_left", "room_right"],
        x: 10,
        y: 6,
        z: -4,
        width: 1.2,
        height: 1.2,
        rotationY: -90,
        reviewed: true,
      },
    ],
  };

  const experience = runtime.experienceFromActiveReleaseState({
    state: "ok",
    manifest,
    manifestSha256: "b".repeat(64),
  });

  assert.equal(experience.walkthrough.version, 1);
  assert.equal(experience.walkthrough.metresPerUnit, 2);
  assert.equal(experience.walkthrough.rooms.length, 2);
  assert.equal(experience.walkthrough.doors.length, 1);
  assert.equal(experience.walkthrough.doors[0].id, "door_reviewed");
  assert.deepEqual(experience.walkthrough.doors[0].roomIds, [
    "room_left",
    "room_right",
  ]);
  assert.equal(experience.walkthrough.doors[0].x, 0);
  assert.equal(experience.walkthrough.doors[0].z, 0);
  assert.equal(experience.walkthrough.doors[0].width, 0.45);
  assert.equal(experience.walkthrough.rooms[0].elevation, 0);
});
