import { handleCloudAdminRequest } from "./admin-cloud.mjs";
const BASE_PATH = "/3Dprojects";
const BUCKET_NAME = "rekixo-3d-assets";
const PLATFORM_ENGINE_CONTRACT_VERSION = 1;

const SECURITY_HEADERS = {
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS)) headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
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

async function listProjects(env) {
  const result = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key,
            COUNT(DISTINCT m.id) AS model_count,
            COUNT(DISTINCT s.id) AS scene_count,
            COUNT(DISTINCT CASE WHEN s.enabled = 1 THEN s.id END) AS enabled_scene_count
       FROM projects_3d p
       LEFT JOIN models_3d m ON m.project_id = p.id
       LEFT JOIN scenes_3d s ON s.project_id = p.id
      GROUP BY p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key
      ORDER BY p.created_at ASC, p.slug ASC`,
  ).all();

  return (result.results ?? []).map((project) => ({
    id: project.id,
    slug: project.slug,
    name: project.name,
    location: project.location ?? undefined,
    status: project.status,
    coverAssetKey: project.cover_asset_key ?? undefined,
    modelCount: Number(project.model_count || 0),
    sceneCount: Number(project.scene_count || 0),
    enabledSceneCount: Number(project.enabled_scene_count || 0),
  }));
}

async function getIntegrationProject(env, slug) {
  const project = await env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key,
            COUNT(DISTINCT CASE WHEN s.enabled = 1 THEN s.id END) AS enabled_scene_count,
            MAX(CASE WHEN m.is_active = 1 THEN 1 ELSE 0 END) AS has_active_model
       FROM projects_3d p
       LEFT JOIN scenes_3d s ON s.project_id = p.id
       LEFT JOIN models_3d m ON m.project_id = p.id
      WHERE p.slug = ?
      GROUP BY p.id, p.slug, p.name, p.location, p.status, p.cover_asset_key
      LIMIT 1`,
  ).bind(slug).first();

  if (!project) return null;

  let activeModelAvailable = false;
  if (project.has_active_model) {
    const model = await env.DB.prepare(
      `SELECT asset_key FROM models_3d
        WHERE project_id=? AND is_active=1
        ORDER BY version DESC LIMIT 1`,
    ).bind(project.id).first();
    if (model?.asset_key) activeModelAvailable = Boolean(await env.MODEL_ASSETS.head(model.asset_key));
  }

  return {
    contractVersion: PLATFORM_ENGINE_CONTRACT_VERSION,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    enabledSceneCount: Number(project.enabled_scene_count || 0),
    activeModelAvailable,
  };
}

async function getProjectStatus(env, slug) {
  const project = await env.DB.prepare(
    `SELECT id, slug, name, location, status, cover_asset_key
       FROM projects_3d
      WHERE slug = ?
      LIMIT 1`,
  ).bind(slug).first();

  if (!project) return null;

  const [modelResult, sceneResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, project_id, name, asset_key, source_filename, mime_type,
              byte_size, version, is_active
         FROM models_3d
        WHERE project_id = ?
        ORDER BY version DESC, created_at DESC`,
    ).bind(project.id).all(),
    env.DB.prepare(
      `SELECT id, project_id, name, type, model_id, camera_preset_id,
              settings_json, sort_order, enabled
         FROM scenes_3d
        WHERE project_id = ?
        ORDER BY sort_order ASC, id ASC`,
    ).bind(project.id).all(),
  ]);

  const rows = modelResult.results ?? [];
  const activeRow = rows.find((row) => Boolean(row.is_active));
  const availability = new Map();

  await Promise.all(
    rows.slice(0, 20).map(async (row) => {
      const object = await env.MODEL_ASSETS.head(row.asset_key);
      availability.set(row.id, object?.size ?? null);
    }),
  );

  const models = rows.map((row) => {
    const storedSize = availability.get(row.id);
    const available = typeof storedSize === "number";
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      version: Number(row.version || 1),
      byteSize: available ? storedSize : row.byte_size ?? undefined,
      sourceFilename: row.source_filename ?? undefined,
      mimeType: row.mime_type || "model/gltf-binary",
      available,
      url: available
        ? `https://ar3dstudio.in/3Dprojects/api/models/${encodeURIComponent(row.id)}/content`
        : undefined,
      active: Boolean(row.is_active),
      assetKey: row.asset_key,
    };
  });

  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      location: project.location ?? undefined,
      status: project.status,
      coverAssetKey: project.cover_asset_key ?? undefined,
    },
    scenes: (sceneResult.results ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      type: row.type,
      modelId: row.model_id ?? undefined,
      cameraPresetId: row.camera_preset_id ?? undefined,
      sortOrder: Number(row.sort_order || 0),
      enabled: Boolean(row.enabled),
      settings: parseJson(row.settings_json, {}),
    })),
    models,
    activeModel: activeRow ? models.find((model) => model.id === activeRow.id) : undefined,
    storage: {
      bucket: BUCKET_NAME,
      activeModelObjectAvailable: activeRow
        ? typeof availability.get(activeRow.id) === "number"
        : false,
    },
    uploadContract: {
      recommendedKey: `projects/${project.slug}/models/exterior-v1.glb`,
      format: "GLB 2.0",
      versionedKeysRequired: true,
      maxRecommendedMobileBytes: 25000000,
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const cloudResponse = await handleCloudAdminRequest(request, env, url);
    if (cloudResponse) return cloudResponse;

    if (url.pathname === `${BASE_PATH}/api/projects`) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }
      return json({ projects: await listProjects(env) });
    }

    if (url.pathname.startsWith(`${BASE_PATH}/api/integration/projects/`)) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }
      const slug = decodeURIComponent(
        url.pathname.slice(`${BASE_PATH}/api/integration/projects/`.length),
      ).trim().toLowerCase();
      if (!slug || slug.includes("/")) {
        return json({ error: "Valid project slug is required." }, { status: 400 });
      }
      const integration = await getIntegrationProject(env, slug);
      if (!integration) return json({ error: "3D project not found." }, { status: 404 });
      return json(integration, {
        headers: { "x-rekixo-ar3d-contract": String(PLATFORM_ENGINE_CONTRACT_VERSION) },
      });
    }

    if (url.pathname === `${BASE_PATH}/api/status`) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed." }, { status: 405 });
      }

      const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();
      if (!slug) return json({ error: "Project slug is required." }, { status: 400 });

      const status = await getProjectStatus(env, slug);
      if (!status) return json({ error: "3D project not found." }, { status: 404 });
      return json(status);
    }

    return addSecurityHeaders(await env.ASSETS.fetch(toAssetRequest(request)));
  },
};
