import { assertReleaseAssetKey } from "./storage-boundary.mjs";
import { serveR2Object } from "./http-range.mjs";
const BASE_PATH = "/3Dprojects";
const RELEASE_BASE = `${BASE_PATH}/api/releases`;

const SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS))
    headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function validSlug(value) {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function validToken(value, max = 180) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

async function digestHex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function releaseSchemaReady(env) {
  try {
    const tables = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'releases_3d',
            'release_assets_3d',
            'release_activations_3d'
          )`,
    ).first();
    const column = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM pragma_table_info('projects_3d')
        WHERE name='active_release_id'`,
    ).first();
    return Number(tables?.total || 0) === 3 && Number(column?.total || 0) === 1;
  } catch {
    return false;
  }
}

function finiteVector3(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function validManifestScene(scene, projectId) {
  return (
    scene &&
    typeof scene === "object" &&
    !Array.isArray(scene) &&
    validToken(scene.id) &&
    scene.projectId === projectId &&
    typeof scene.name === "string" &&
    scene.name.trim().length > 0 &&
    [
      "project-navigation",
      "section",
      "wing-distance",
      "balcony",
      "typical-floor",
      "amenity",
    ].includes(scene.type) &&
    Number.isInteger(scene.sortOrder) &&
    typeof scene.enabled === "boolean" &&
    (scene.settings === undefined ||
      (scene.settings &&
        typeof scene.settings === "object" &&
        !Array.isArray(scene.settings)))
  );
}

function validateManifestShape(manifest, row) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.format !== "rekixo-release-manifest" ||
    manifest.version !== 1 ||
    !manifest.release ||
    !manifest.project ||
    !manifest.experience ||
    !Array.isArray(manifest.experience.scenes) ||
    !Array.isArray(manifest.experience.mediaFiles) ||
    !Array.isArray(manifest.assets) ||
    manifest.release.id !== row.active_release_id ||
    manifest.release.projectId !== row.project_id ||
    manifest.release.projectSlug !== row.slug ||
    Number(manifest.release.version) !== Number(row.release_version) ||
    manifest.project.id !== row.project_id ||
    manifest.project.slug !== row.slug ||
    manifest.project.status !== "published" ||
    typeof manifest.project.name !== "string" ||
    !manifest.project.name.trim()
  )
    throw Error("Active release manifest identity is invalid.");

  if (
    manifest.experience.scenes.length > 5000 ||
    manifest.experience.scenes.some(
      (scene) => !validManifestScene(scene, row.project_id),
    )
  )
    throw Error("Active release scene payload is invalid.");

  const mediaFiles = manifest.experience.mediaFiles;
  if (
    mediaFiles.length > 5000 ||
    new Set(mediaFiles).size !== mediaFiles.length ||
    mediaFiles.some(
      (file) =>
        typeof file !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,140}$/.test(file),
    )
  )
    throw Error("Active release media list is invalid.");

  const assetIds = new Set();
  const assetKeys = new Set();
  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset !== "object" ||
      Array.isArray(asset) ||
      !validToken(asset.id) ||
      !["model", "media", "studio"].includes(asset.kind) ||
      !validToken(asset.logicalId, 500) ||
      typeof asset.name !== "string" ||
      !asset.name.trim() ||
      typeof asset.mimeType !== "string" ||
      !asset.mimeType.trim() ||
      !Number.isSafeInteger(asset.byteSize) ||
      asset.byteSize < 0 ||
      (asset.sha256 !== undefined &&
        (typeof asset.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(asset.sha256)))
    )
      throw Error("Active release asset manifest is invalid.");
    const logicalKey = `${asset.kind}:${asset.logicalId}`;
    if (assetIds.has(asset.id) || assetKeys.has(logicalKey))
      throw Error("Active release contains duplicate assets.");
    assetIds.add(asset.id);
    assetKeys.add(logicalKey);
  }

  const model = manifest.experience.model;
  if (
    model &&
    (!validToken(model.id) ||
      model.projectId !== row.project_id ||
      typeof model.name !== "string" ||
      !model.name.trim() ||
      !Number.isInteger(model.version) ||
      model.version < 1 ||
      typeof model.mimeType !== "string" ||
      !validToken(model.releaseAssetId) ||
      !assetIds.has(model.releaseAssetId))
  )
    throw Error("Active release model payload is invalid.");

  const camera = manifest.experience.camera;
  if (
    camera &&
    (!validToken(camera.id) ||
      camera.projectId !== row.project_id ||
      typeof camera.name !== "string" ||
      !camera.name.trim() ||
      !finiteVector3(camera.position) ||
      !finiteVector3(camera.target) ||
      (camera.fov !== undefined &&
        (typeof camera.fov !== "number" ||
          !Number.isFinite(camera.fov) ||
          camera.fov <= 0 ||
          camera.fov > 180)))
  )
    throw Error("Active release camera payload is invalid.");

  const studioProject = manifest.studio?.project;
  if (
    studioProject &&
    (studioProject.schema !== 1 ||
      studioProject.id !== row.project_id ||
      studioProject.slug !== row.slug ||
      !Array.isArray(studioProject.assets) ||
      studioProject.assets.some((assetId) => !validToken(assetId)))
  )
    throw Error("Active release Studio payload is invalid.");
}

export async function activeReleaseState(env, slug) {
  if (!validSlug(slug)) return { state: "invalid-slug" };
  if (!(await releaseSchemaReady(env))) return { state: "schema-missing" };

  const row = await env.DB.prepare(
    `SELECT p.id AS project_id,p.slug,p.name,p.status,p.active_release_id,
            r.version AS release_version,r.manifest_json,r.manifest_sha256,
            r.created_at AS release_created_at
       FROM projects_3d p
       LEFT JOIN releases_3d r
         ON r.id=p.active_release_id AND r.project_id=p.id
      WHERE p.slug=?
      LIMIT 1`,
  ).bind(slug).first();

  if (!row) return { state: "project-missing" };
  if (row.status !== "published") return { state: "unpublished", project: row };
  if (!row.active_release_id) return { state: "no-active", project: row };
  if (!row.manifest_json || !row.manifest_sha256)
    return { state: "corrupt", project: row, reason: "Active release row is missing." };

  const actualHash = await digestHex(row.manifest_json);
  if (actualHash !== String(row.manifest_sha256).toLowerCase())
    return {
      state: "corrupt",
      project: row,
      reason: "Active release manifest checksum mismatch.",
    };

  let manifest;
  try {
    manifest = JSON.parse(row.manifest_json);
    validateManifestShape(manifest, row);
  } catch (error) {
    return {
      state: "corrupt",
      project: row,
      reason:
        error instanceof Error
          ? error.message
          : "Active release manifest is invalid.",
    };
  }

  return {
    state: "ok",
    project: row,
    manifest,
    manifestSha256: actualHash,
  };
}

function publicExperience(manifest, manifestSha256) {
  const release = manifest.release;
  const frozen = manifest.experience;
  const model = frozen.model
    ? {
        ...frozen.model,
        available: true,
        url: `${RELEASE_BASE}/${encodeURIComponent(release.id)}/models/${encodeURIComponent(
          frozen.model.id,
        )}/content?v=${encodeURIComponent(String(release.version))}`,
      }
    : undefined;
  if (model) delete model.releaseAssetId;

  return {
    project: manifest.project,
    scene: frozen.scenes[0],
    scenes: frozen.scenes,
    camera: frozen.camera,
    model,
    mediaBaseUrl: `${RELEASE_BASE}/${encodeURIComponent(release.id)}/media`,
    release: {
      id: release.id,
      version: release.version,
      manifestSha256,
      createdAt: release.createdAt,
    },
  };
}

async function releaseCatalog(env) {
  if (!(await releaseSchemaReady(env)))
    return json({ releases: [], releaseSchemaReady: false });
  const rows = await env.DB.prepare(
    `SELECT p.slug,p.name,p.active_release_id AS releaseId,
            r.version,r.manifest_json,r.created_at AS createdAt
       FROM projects_3d p
       JOIN releases_3d r
         ON r.id=p.active_release_id AND r.project_id=p.id
      WHERE p.status='published'
      ORDER BY r.created_at DESC,p.slug ASC`,
  ).all();

  return json({
    releaseSchemaReady: true,
    releases: (rows.results || []).map((row) => {
      let studioAvailable = false;
      try {
        studioAvailable = Boolean(JSON.parse(row.manifest_json)?.studio?.project);
      } catch {
        studioAvailable = false;
      }
      return {
        slug: row.slug,
        name: row.name,
        releaseId: row.releaseId,
        version: Number(row.version || 1),
        createdAt: row.createdAt,
        studioAvailable,
      };
    }),
  });
}

async function activeProjectRelease(env, slug) {
  const state = await activeReleaseState(env, slug);
  if (state.state === "schema-missing" || state.state === "no-active")
    return json(
      { error: "This project does not have an immutable active release." },
      { status: 404 },
    );
  if (state.state === "project-missing" || state.state === "unpublished")
    return json({ error: "Published project not found." }, { status: 404 });
  if (state.state !== "ok")
    return json(
      {
        error: "Active release is corrupted.",
        diagnostic: state.reason || state.state,
      },
      { status: 500 },
    );

  return json({
    release: {
      id: state.manifest.release.id,
      version: state.manifest.release.version,
      createdAt: state.manifest.release.createdAt,
      manifestSha256: state.manifestSha256,
    },
    experience: publicExperience(state.manifest, state.manifestSha256),
    studioAvailable: Boolean(state.manifest.studio?.project),
  });
}

async function activeStudioRelease(env, slug) {
  const state = await activeReleaseState(env, slug);
  if (state.state !== "ok") {
    const status =
      state.state === "corrupt" ? 500 : 404;
    return json(
      {
        error:
          state.state === "corrupt"
            ? "Active release is corrupted."
            : "Published Studio release not found.",
        ...(state.reason ? { diagnostic: state.reason } : {}),
      },
      { status },
    );
  }
  const project = state.manifest.studio?.project;
  if (!project)
    return json({ error: "This release has no Studio snapshot." }, { status: 404 });

  const assets = state.manifest.assets
    .filter((asset) => asset.kind === "studio")
    .map((asset) => ({
      id: asset.logicalId,
      name: asset.name,
      type: asset.mimeType,
      size: asset.byteSize,
      hash: asset.sha256,
      contentUrl: `${RELEASE_BASE}/${encodeURIComponent(
        state.manifest.release.id,
      )}/assets/${encodeURIComponent(asset.logicalId)}/content`,
    }));

  return json({
    format: "rekixo-release-studio-1",
    release: {
      id: state.manifest.release.id,
      version: state.manifest.release.version,
      createdAt: state.manifest.release.createdAt,
      manifestSha256: state.manifestSha256,
    },
    project,
    assets,
  });
}

function releaseAssetKind(pathKind) {
  if (pathKind === "models") return "model";
  if (pathKind === "media") return "media";
  if (pathKind === "assets") return "studio";
  return "";
}

export async function serveReleaseAsset(env, releaseId, pathKind, logicalId, request) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!validToken(releaseId) || !validToken(logicalId, 500))
    return json({ error: "Invalid release asset route." }, { status: 400 });
  const kind = releaseAssetKind(pathKind);
  if (!kind)
    return json({ error: "Unknown release asset kind." }, { status: 404 });
  if (!(await releaseSchemaReady(env)))
    return json({ error: "Release runtime is not installed." }, { status: 404 });

  const row = await env.DB.prepare(
    `SELECT a.r2_key,a.mime_type,a.byte_size,a.name,a.sha256,a.source_etag,
            p.status,p.slug
       FROM release_assets_3d a
       JOIN releases_3d r ON r.id=a.release_id AND r.project_id=a.project_id
       JOIN projects_3d p ON p.id=r.project_id
      WHERE a.release_id=? AND a.kind=? AND a.logical_id=?
      LIMIT 1`,
  ).bind(releaseId, kind, logicalId).first();

  if (!row || row.status !== "published")
    return json({ error: "Release asset not found." }, { status: 404 });

  try {
    assertReleaseAssetKey(
      row.slug,
      releaseId,
      kind,
      logicalId,
      row.r2_key,
    );
  } catch (error) {
    return json(
      {
        error: "Immutable release storage ownership is corrupted.",
        diagnostic:
          error instanceof Error
            ? error.message
            : "Invalid immutable release storage key.",
      },
      { status: 500 },
    );
  }

  const mimeType = row.mime_type || "application/octet-stream";
  const served = await serveR2Object(
    env.MODEL_ASSETS,
    row.r2_key,
    request,
    {
      mimeType,
      cacheControl: "public, max-age=31536000, immutable",
      expectedSize: Number(row.byte_size),
      sha256: row.sha256 || undefined,
      allowRange: kind === "media" && mimeType === "video/mp4",
    },
  );
  if (served.corruption)
    return json(
      {
        error: "Immutable release asset is corrupted.",
        diagnostic: served.corruption,
      },
      { status: 500 },
    );
  if (served.missing)
    return json(
      { error: "Immutable release asset is missing from storage." },
      { status: 500 },
    );
  return served.response;
}

export async function handleReleaseReadRequest(
  request,
  env,
  url = new URL(request.url),
) {
  if (!url.pathname.startsWith(RELEASE_BASE)) return null;

  if (url.pathname === RELEASE_BASE || url.pathname === `${RELEASE_BASE}/`) {
    if (request.method !== "GET")
      return json({ error: "Method not allowed." }, { status: 405 });
    return releaseCatalog(env);
  }

  const relative = url.pathname.slice(RELEASE_BASE.length);
  const parts = relative.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "projects" && parts[1]) {
    const slug = String(parts[1]).trim().toLowerCase();
    if (!validSlug(slug))
      return json({ error: "Valid project slug is required." }, { status: 400 });
    if (parts.length === 2) {
      if (request.method !== "GET")
        return json({ error: "Method not allowed." }, { status: 405 });
      return activeProjectRelease(env, slug);
    }
    if (parts.length === 3 && parts[2] === "studio") {
      if (request.method !== "GET")
        return json({ error: "Method not allowed." }, { status: 405 });
      return activeStudioRelease(env, slug);
    }
    return json({ error: "Unknown release project route." }, { status: 404 });
  }

  if (
    parts.length === 4 &&
    ["models", "media"].includes(parts[1]) &&
    parts[2] &&
    (parts[1] === "media" ? true : parts[3] === "content")
  ) {
    if (parts[1] === "media") {
      // /{releaseId}/media/{fileName} has three path segments, handled below.
    } else {
      return serveReleaseAsset(env, parts[0], parts[1], parts[2], request);
    }
  }

  if (parts.length === 3 && parts[1] === "media")
    return serveReleaseAsset(env, parts[0], "media", parts[2], request);

  if (
    parts.length === 4 &&
    parts[1] === "assets" &&
    parts[3] === "content"
  )
    return serveReleaseAsset(env, parts[0], "assets", parts[2], request);

  if (
    parts.length === 4 &&
    parts[1] === "models" &&
    parts[3] === "content"
  )
    return serveReleaseAsset(env, parts[0], "models", parts[2], request);

  return json({ error: "Release route not found." }, { status: 404 });
}

export function experienceFromActiveReleaseState(state) {
  if (state?.state !== "ok") return undefined;
  return publicExperience(state.manifest, state.manifestSha256);
}
