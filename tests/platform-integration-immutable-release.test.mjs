import assert from "node:assert/strict";
import test from "node:test";

import { getIntegrationProject } from "../workers/admin.mjs";

async function sha256(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

function immutableManifest() {
  return {
    format: "rekixo-release-manifest",
    version: 1,
    release: {
      id: "release_12345678901234567890",
      projectId: "project_studio_only",
      projectSlug: "studio-only",
      version: 1,
      createdAt: "2026-09-30T00:00:00.000Z",
      sourceDraftRevision: 1,
    },
    project: {
      id: "project_studio_only",
      slug: "studio-only",
      name: "Studio Only",
      status: "published",
    },
    experience: {
      scenes: [],
      model: {
        id: "studio_model_main",
        projectId: "project_studio_only",
        name: "Studio GLB",
        version: 1,
        mimeType: "model/gltf-binary",
        releaseAssetId: "release_asset_model",
      },
      mediaFiles: [],
    },
    assets: [
      {
        id: "release_asset_model",
        kind: "model",
        logicalId: "studio_model_main",
        name: "Studio GLB",
        mimeType: "model/gltf-binary",
        byteSize: 1024,
      },
    ],
  };
}

test("Platform integration resolves Studio-only immutable releases without legacy models_3d rows", async () => {
  const manifest = immutableManifest();
  const manifestJson = JSON.stringify(manifest);
  const manifestHash = await sha256(manifestJson);

  const DB = {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (sql.includes("COUNT(DISTINCT CASE WHEN s.enabled")) {
            return {
              id: "project_studio_only",
              slug: "studio-only",
              name: "Studio Only",
              location: null,
              status: "published",
              cover_asset_key: null,
              enabled_scene_count: 0,
              has_active_model: 0,
            };
          }
          if (sql.includes("sqlite_master")) return { total: 3 };
          if (sql.includes("pragma_table_info")) return { total: 1 };
          if (
            sql.includes("FROM projects_3d p") &&
            sql.includes("LEFT JOIN releases_3d r")
          ) {
            return {
              project_id: "project_studio_only",
              slug: "studio-only",
              name: "Studio Only",
              status: "published",
              active_release_id: manifest.release.id,
              release_version: 1,
              manifest_json: manifestJson,
              manifest_sha256: manifestHash,
              release_created_at: manifest.release.createdAt,
            };
          }
          throw new Error("Unexpected first SQL: " + sql);
        },
      };
      return statement;
    },
  };

  const result = await getIntegrationProject(
    {
      DB,
      MODEL_ASSETS: {
        async head() {
          throw new Error("Immutable Studio release must not require legacy model storage.");
        },
      },
    },
    "studio-only",
  );

  assert.equal(result.contractVersion, 1);
  assert.equal(result.project.slug, "studio-only");
  assert.equal(result.project.status, "published");
  assert.equal(result.activeModelAvailable, true);
  assert.equal(result.model.id, "studio_model_main");
  assert.equal(result.model.available, true);
  assert.match(
    result.model.url,
    /^\/3Dprojects\/api\/releases\/release_12345678901234567890\/models\/studio_model_main\/model\.glb\?v=1$/,
  );
  assert.equal(result.release.id, manifest.release.id);
  assert.equal(result.release.version, 1);
});

test("Platform integration keeps legacy model registry projects compatible", async () => {
  const DB = {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (sql.includes("COUNT(DISTINCT CASE WHEN s.enabled")) {
            return {
              id: "project_legacy",
              slug: "legacy-project",
              name: "Legacy Project",
              location: null,
              status: "draft",
              cover_asset_key: null,
              enabled_scene_count: 2,
              has_active_model: 1,
            };
          }
          if (sql.includes("SELECT asset_key FROM models_3d")) {
            return { asset_key: "projects/legacy-project/models/exterior-v1.glb" };
          }
          throw new Error("Unexpected first SQL: " + sql);
        },
      };
      return statement;
    },
  };

  const result = await getIntegrationProject(
    {
      DB,
      MODEL_ASSETS: {
        async head(key) {
          assert.equal(
            key,
            "projects/legacy-project/models/exterior-v1.glb",
          );
          return { size: 2048 };
        },
      },
    },
    "legacy-project",
  );

  assert.equal(result.project.id, "project_legacy");
  assert.equal(result.enabledSceneCount, 2);
  assert.equal(result.activeModelAvailable, true);
  assert.equal(result.model, undefined);
  assert.equal(result.release, undefined);
});

test("Platform integration exposes a verified optional Geo derivative without replacing source model identity", async () => {
  const manifest = immutableManifest();
  const manifestJson = JSON.stringify(manifest);
  const manifestHash = await sha256(manifestJson);
  const geoSha = "c".repeat(64);
  const geoKey =
    "projects/studio-only/releases/release_12345678901234567890/geo-models/studio_model_main/model.glb";
  const metadataKey =
    "projects/studio-only/releases/release_12345678901234567890/geo-models/studio_model_main/metadata.json";
  const metadata = {
    format: "rekixo-geo-model-derivative",
    version: 1,
    pipeline: "core-map-v2",
    projectSlug: "studio-only",
    releaseId: manifest.release.id,
    sourceModelId: "studio_model_main",
    sourceSha256: "d".repeat(64),
    geoSha256: geoSha,
    geoByteSize: 4096,
    extensionsUsed: [],
    extensionsRequired: [],
  };

  const DB = {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (sql.includes("COUNT(DISTINCT CASE WHEN s.enabled")) {
            return {
              id: "project_studio_only",
              slug: "studio-only",
              name: "Studio Only",
              location: null,
              status: "published",
              cover_asset_key: null,
              enabled_scene_count: 0,
              has_active_model: 0,
            };
          }
          if (sql.includes("sqlite_master")) return { total: 3 };
          if (sql.includes("pragma_table_info")) return { total: 1 };
          if (
            sql.includes("FROM projects_3d p") &&
            sql.includes("LEFT JOIN releases_3d r")
          ) {
            return {
              project_id: "project_studio_only",
              slug: "studio-only",
              name: "Studio Only",
              status: "published",
              active_release_id: manifest.release.id,
              release_version: 1,
              manifest_json: manifestJson,
              manifest_sha256: manifestHash,
              release_created_at: manifest.release.createdAt,
            };
          }
          throw new Error("Unexpected first SQL: " + sql);
        },
      };
      return statement;
    },
  };

  const result = await getIntegrationProject(
    {
      DB,
      MODEL_ASSETS: {
        async head(key) {
          if (key === geoKey) return { size: 4096 };
          return null;
        },
        async get(key) {
          if (key !== metadataKey) return null;
          return {
            body: new Uint8Array([1]),
            async text() {
              return JSON.stringify(metadata);
            },
          };
        },
      },
    },
    "studio-only",
  );

  assert.equal(result.model.id, "studio_model_main");
  assert.equal(result.geoModel.id, "studio_model_main");
  assert.equal(result.geoModel.variant, "geo-optimized");
  assert.equal(result.geoModel.byteSize, 4096);
  assert.equal(result.geoModel.sha256, geoSha);
  assert.match(
    result.geoModel.url,
    /^\/3Dprojects\/api\/releases\/release_12345678901234567890\/geo-models\/studio_model_main\/model\.glb\?v=1&geo=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc$/,
  );
});
