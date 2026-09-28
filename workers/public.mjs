import {
  activeReleaseState,
  experienceFromActiveReleaseState,
  handleReleaseReadRequest,
  serveReleaseAsset,
} from "./release-runtime.mjs";
const BASE_PATH = "/3Dprojects";
const MODEL_ROUTE_PREFIX = `${BASE_PATH}/api/models/`;
const PROJECT_ROUTE_PREFIX = `${BASE_PATH}/api/projects/`;

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
  for (const [key, item] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, item);
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function addSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toAssetRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === BASE_PATH || url.pathname === `${BASE_PATH}/`) {
    url.pathname = "/";
  } else if (url.pathname.startsWith(`${BASE_PATH}/`)) {
    url.pathname = url.pathname.slice(BASE_PATH.length) || "/";
  }
  return new Request(url.toString(), request);
}

function mapScene(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    modelId: row.model_id ?? undefined,
    cameraPresetId: row.camera_preset_id ?? undefined,
    sortOrder: Number(row.sort_order || 0),
    enabled: Boolean(row.enabled),
    settings: parseJson(row.settings_json, {}),
  };
}

async function getProjectExperience(env, slug) {
  const release = await activeReleaseState(env, slug);
  if (release.state === "ok")
    return experienceFromActiveReleaseState(release);
  if (release.state === "corrupt")
    return {
      __releaseCorrupt: true,
      diagnostic: release.reason || "Active immutable release is invalid.",
    };
  if (release.state === "unpublished" || release.state === "project-missing")
    return null;

  const project = await env.DB.prepare(
    `SELECT id, slug, name, location, status, cover_asset_key
       FROM projects_3d
      WHERE slug = ? AND status = 'published'
      LIMIT 1`,
  )
    .bind(slug)
    .first();

  if (!project) return null;

  const [sceneResult, defaultCamera, model] = await Promise.all([
    env.DB.prepare(
      `SELECT id, project_id, name, type, model_id, camera_preset_id,
              settings_json, sort_order, enabled
         FROM scenes_3d
        WHERE project_id = ? AND enabled = 1
        ORDER BY sort_order ASC, id ASC`,
    )
      .bind(project.id)
      .all(),
    env.DB.prepare(
      `SELECT id, project_id, name, position_json, target_json, fov
         FROM camera_presets_3d
        WHERE project_id = ? AND is_default = 1
        LIMIT 1`,
    )
      .bind(project.id)
      .first(),
    env.DB.prepare(
      `SELECT id, project_id, name, asset_key, source_filename, mime_type,
              byte_size, version
         FROM models_3d
        WHERE project_id = ? AND is_active = 1
        ORDER BY version DESC
        LIMIT 1`,
    )
      .bind(project.id)
      .first(),
  ]);

  const scenes = (sceneResult.results ?? []).map(mapScene);
  const scene = scenes[0];
  let modelPayload;

  if (model) {
    const object = await env.MODEL_ASSETS.head(model.asset_key);
    const available = Boolean(object);
    modelPayload = {
      id: model.id,
      projectId: model.project_id,
      name: model.name,
      version: Number(model.version || 1),
      byteSize: object?.size ?? model.byte_size ?? undefined,
      sourceFilename: model.source_filename ?? undefined,
      mimeType: model.mime_type || "model/gltf-binary",
      available,
      url: available
        ? `${BASE_PATH}/api/models/${encodeURIComponent(model.id)}/content?v=${encodeURIComponent(String(model.version || 1))}`
        : undefined,
    };
  }

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    scene,
    scenes,
    camera: defaultCamera
      ? {
          id: defaultCamera.id,
          projectId: defaultCamera.project_id,
          name: defaultCamera.name,
          position: parseJson(defaultCamera.position_json, [6, 4, 8]),
          target: parseJson(defaultCamera.target_json, [0, 0, 0]),
          fov: Number(defaultCamera.fov || 45),
        }
      : undefined,
    model: modelPayload,
    mediaBaseUrl: `${BASE_PATH}/api/projects/${encodeURIComponent(project.slug)}/media`,
  };
}

async function serveModel(env, modelId, request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const model = await env.DB.prepare(
    `SELECT m.asset_key, m.mime_type, m.version, m.byte_size,
              p.slug
       FROM models_3d m
       JOIN projects_3d p ON p.id = m.project_id
      WHERE m.id = ?
        AND m.is_active = 1
        AND p.status = 'published'
      LIMIT 1`,
  )
    .bind(modelId)
    .first();

  if (!model) {
    return json({ error: "Model not found." }, { status: 404 });
  }

  const release = await activeReleaseState(env, model.slug);
  if (release.state === "ok") {
    if (release.manifest.experience.model?.id !== modelId)
      return json({ error: "Model is not part of the active release." }, { status: 404 });
    return serveReleaseAsset(
      env,
      release.manifest.release.id,
      "models",
      modelId,
      request,
    );
  }
  if (release.state === "corrupt")
    return json(
      { error: "The active immutable release is corrupted." },
      { status: 500 },
    );

  const object =
    request.method === "HEAD"
      ? await env.MODEL_ASSETS.head(model.asset_key)
      : await env.MODEL_ASSETS.get(model.asset_key);

  if (!object) {
    return json({ error: "Model asset is not available." }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("Content-Type", model.mime_type || "model/gltf-binary");
  headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  return new Response(object.body, { status: 200, headers });
}

function mediaType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

async function serveProjectMedia(env, slug, fileName, request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,140}$/i.test(fileName)) {
    return json({ error: "Invalid media name." }, { status: 400 });
  }

  const project = await env.DB.prepare(
    `SELECT id FROM projects_3d WHERE slug = ? AND status = 'published' LIMIT 1`,
  )
    .bind(slug)
    .first();
  if (!project) return json({ error: "Project not found." }, { status: 404 });

  const release = await activeReleaseState(env, slug);
  if (release.state === "ok") {
    if (!release.manifest.experience.mediaFiles.includes(fileName))
      return json({ error: "Media is not part of the active release." }, { status: 404 });
    return serveReleaseAsset(
      env,
      release.manifest.release.id,
      "media",
      fileName,
      request,
    );
  }
  if (release.state === "corrupt")
    return json(
      { error: "The active immutable release is corrupted." },
      { status: 500 },
    );

  const key = `projects/${slug}/media/${fileName}`;
  const object =
    request.method === "HEAD"
      ? await env.MODEL_ASSETS.head(key)
      : await env.MODEL_ASSETS.get(key);
  if (!object) return json({ error: "Media asset is not available." }, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", mediaType(fileName));
  headers.set("Cache-Control", "public, max-age=300, must-revalidate");
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const releaseResponse = await handleReleaseReadRequest(request, env, url);
    if (releaseResponse) return releaseResponse;

    if (
      url.pathname.startsWith(MODEL_ROUTE_PREFIX) &&
      url.pathname.endsWith("/content")
    ) {
      const modelId = decodeURIComponent(
        url.pathname
          .slice(MODEL_ROUTE_PREFIX.length, -"/content".length)
          .replace(/\/+$/, ""),
      );
      if (!modelId) return json({ error: "Model id is required." }, { status: 400 });
      return serveModel(env, modelId, request);
    }

    if (url.pathname.startsWith(PROJECT_ROUTE_PREFIX)) {
      const remainder = url.pathname.slice(PROJECT_ROUTE_PREFIX.length);
      const parts = remainder.split("/").filter(Boolean).map(decodeURIComponent);
      const slug = parts[0]?.trim();
      if (!slug) return json({ error: "Project slug is required." }, { status: 400 });

      if (parts[1] === "media" && parts[2]) {
        return serveProjectMedia(env, slug, parts[2], request);
      }

      if (parts.length > 1) {
        return json({ error: "Unknown project API route." }, { status: 404 });
      }
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }

      const experience = await getProjectExperience(env, slug);
      if (!experience) {
        return json(
          { error: "This 3D project is not currently published." },
          { status: 404 },
        );
      }
      if (experience.__releaseCorrupt) {
        return json(
          {
            error: "The active immutable release is corrupted.",
            diagnostic: experience.diagnostic,
          },
          { status: 500 },
        );
      }
      return json(experience);
    }

    return addSecurityHeaders(await env.ASSETS.fetch(toAssetRequest(request)));
  },
};
