import { engineAdminReadAccess } from "./admin-cloud.mjs";

const PATH = "/3Dprojects/api/geo-v2/maps-config";
const SETTING_KEY = "google_maps_map_id";

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validMapId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

async function configuredMapId(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM engine_settings_3d WHERE key=? LIMIT 1",
    ).bind(SETTING_KEY).first();
    const stored = String(row?.value || "").trim();
    if (stored) return stored;
  } catch {
    // Environment fallback remains available during staged rollout.
  }
  return String(env.GOOGLE_MAPS_MAP_ID || "").trim();
}

export async function handleGeoMapsConfigRequest(
  request,
  env,
  url = new URL(request.url),
) {
  if (url.pathname !== PATH) return null;

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });

  if (request.method === "GET") {
    const mapId = await configuredMapId(env);
    return json({ mapId: mapId || null, configured: Boolean(mapId) });
  }

  if (request.method !== "PUT")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Same-origin request required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const mapId = String(body?.mapId || "").trim();
  if (!validMapId(mapId))
    return json(
      { error: "Valid Google Maps JavaScript Vector Map ID required." },
      { status: 400 },
    );

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO engine_settings_3d(key,value,updated_by,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`,
    ).bind(SETTING_KEY, mapId, access.actor.email, now),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      access.actor.email,
      "geo.maps_map_id_updated",
      null,
      SETTING_KEY,
      JSON.stringify({ configured: true }),
      now,
    ),
  ]);

  return json({ ok: true, mapId, configured: true });
}
