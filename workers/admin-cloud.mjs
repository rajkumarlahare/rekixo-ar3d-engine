import {
  activateExistingRelease,
  buildAndActivateRelease,
  listProjectReleases,
} from "./release-publish.mjs";
const BASE_PATH = "/3Dprojects";
const CLOUD_PATH = `${BASE_PATH}/api/cloud`;
const COOKIE = "rekixo_3d_admin";
const SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

const SECURITY_HEADERS = {
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, item] of Object.entries(SECURITY_HEADERS)) headers.set(key, item);
  return new Response(JSON.stringify(value), { ...init, headers });
}

function safeText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validSlug(value) {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    !["api", "assets", "studio", "login", "showcase", "published"].includes(value)
  );
}

function validProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

function validAssetId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function config(env) {
  return {
    email: String(env.ENGINE_ADMIN_EMAIL || "").trim().toLowerCase(),
    passwordSalt: String(env.ENGINE_ADMIN_PASSWORD_SALT || "").trim(),
    passwordHash: String(env.ENGINE_ADMIN_PASSWORD_HASH || "").trim(),
    sessionSecret: String(env.ENGINE_ADMIN_SESSION_SECRET || "").trim(),
  };
}

export function authConfigured(env) {
  const value = config(env);
  return Boolean(
    value.email &&
      value.passwordSalt &&
      value.passwordHash &&
      value.sessionSecret.length >= 32,
  );
}

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'studio_drafts_3d',
            'studio_assets_3d',
            'engine_admin_security',
            'engine_admin_audit',
            'engine_admin_login_attempts'
          )`,
    ).first();
    return Number(row?.total || 0) === 5;
  } catch {
    return false;
  }
}

function bytesFromBase64(value) {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesFromBase64Url(value) {
  const normalized =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  return bytesFromBase64(normalized);
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function signSession(body, secret) {
  const key = await hmacKey(secret, ["sign"]);
  return base64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))),
  );
}

async function verifySessionSignature(body, signature, secret) {
  try {
    const supplied = bytesFromBase64Url(signature);
    if (supplied.length !== 32) return false;
    const key = await hmacKey(secret, ["verify"]);
    return crypto.subtle.verify(
      "HMAC",
      key,
      supplied,
      encoder.encode(body),
    );
  } catch {
    return false;
  }
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return "";
}

function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=${BASE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(
    SESSION_MS / 1000,
  )}`;
}

function clearSessionCookie() {
  return `${COOKIE}=; Path=${BASE_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function verifyPassword(password, saltB64, hashB64) {
  const salt = bytesFromBase64(saltB64);
  const expected = bytesFromBase64(hashB64);
  if (!salt.length || expected.length !== 32) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 210000,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1)
    diff |= expected[index] ^ actual[index];
  return diff === 0;
}

async function digestHex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function sessionFor(request, env) {
  if (!authConfigured(env) || !(await schemaReady(env))) return null;
  const token = cookieValue(request, COOKIE);
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const cfg = config(env);
  if (!(await verifySessionSignature(body, signature, cfg.sessionSecret)))
    return null;

  let session;
  try {
    session = JSON.parse(decoder.decode(bytesFromBase64Url(body)));
  } catch {
    return null;
  }
  if (
    session?.role !== "owner" ||
    session?.email !== cfg.email ||
    !Number.isInteger(session?.sessionVersion) ||
    !Number.isFinite(session?.exp) ||
    session.exp <= Date.now()
  )
    return null;

  const security = await env.DB.prepare(
    "SELECT session_version AS sessionVersion FROM engine_admin_security WHERE id='owner' LIMIT 1",
  ).first();
  if (
    !security ||
    Number(security.sessionVersion) !== Number(session.sessionVersion)
  )
    return null;
  return session;
}

async function writeAudit(env, actor, action, projectId = null, targetId = null, details = {}) {
  await env.DB.prepare(
    `INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      actor.email,
      action,
      projectId,
      targetId,
      JSON.stringify(details),
      new Date().toISOString(),
    )
    .run();
}

async function rateKey(request, email) {
  const ip = String(request.headers.get("cf-connecting-ip") || "unknown").slice(0, 96);
  return digestHex(`engine-admin:${ip}:${email}`);
}

async function loginBlocked(env, key, now) {
  const row = await env.DB.prepare(
    "SELECT attempts, window_start AS windowStart FROM engine_admin_login_attempts WHERE attempt_key=? LIMIT 1",
  ).bind(key).first();
  if (!row) return false;
  if (now - Number(row.windowStart || 0) >= LOGIN_WINDOW_MS) return false;
  return Number(row.attempts || 0) >= LOGIN_MAX_ATTEMPTS;
}

async function recordLoginFailure(env, key, now) {
  await env.DB.prepare(
    `INSERT INTO engine_admin_login_attempts
      (attempt_key,attempts,window_start,updated_at)
      VALUES (?,1,?,?)
      ON CONFLICT(attempt_key) DO UPDATE SET
        attempts=CASE
          WHEN ? - window_start >= ? THEN 1
          ELSE attempts + 1
        END,
        window_start=CASE
          WHEN ? - window_start >= ? THEN ?
          ELSE window_start
        END,
        updated_at=?`,
  )
    .bind(
      key,
      now,
      now,
      now,
      LOGIN_WINDOW_MS,
      now,
      LOGIN_WINDOW_MS,
      now,
      now,
    )
    .run();
}

async function login(request, env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (!authConfigured(env))
    return json(
      {
        error:
          "Engine Admin authentication is not configured. Provision the dedicated Engine Admin secrets first.",
      },
      { status: 503 },
    );
  if (!(await schemaReady(env)))
    return json(
      { error: "Engine Admin cloud schema is not installed." },
      { status: 503 },
    );

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const cfg = config(env);
  const key = await rateKey(request, email);
  const now = Date.now();

  if (await loginBlocked(env, key, now))
    return json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );

  const valid =
    email === cfg.email &&
    password.length >= 8 &&
    (await verifyPassword(password, cfg.passwordSalt, cfg.passwordHash));

  if (!valid) {
    await recordLoginFailure(env, key, now);
    return json({ error: "Invalid email or password." }, { status: 401 });
  }

  await env.DB.prepare(
    "DELETE FROM engine_admin_login_attempts WHERE attempt_key=? OR updated_at<?",
  )
    .bind(key, now - 24 * 60 * 60 * 1000)
    .run();

  const security = await env.DB.prepare(
    "SELECT session_version AS sessionVersion FROM engine_admin_security WHERE id='owner' LIMIT 1",
  ).first();
  const session = {
    role: "owner",
    email: cfg.email,
    sessionVersion: Number(security?.sessionVersion || 1),
    exp: now + SESSION_MS,
  };
  const bodyBytes = encoder.encode(JSON.stringify(session));
  const encodedBody = base64Url(bodyBytes);
  const token = `${encodedBody}.${await signSession(encodedBody, cfg.sessionSecret)}`;
  return json(
    { ok: true, user: { email: cfg.email }, expiresAt: session.exp },
    { headers: { "Set-Cookie": sessionCookie(token) } },
  );
}

async function logout(request, env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  const actor = await sessionFor(request, env);
  if (actor) await writeAudit(env, actor, "auth.logout");
  return json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookie() } },
  );
}

async function sessionStatus(request, env) {
  const configured = authConfigured(env);
  const databaseReady = configured ? await schemaReady(env) : false;
  const session =
    configured && databaseReady ? await sessionFor(request, env) : null;
  return json({
    configured,
    databaseReady,
    authenticated: Boolean(session),
    user: session ? { email: session.email } : undefined,
    expiresAt: session?.exp,
  });
}

function cloudProjectRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    location: row.location ?? undefined,
    status: row.status,
    updatedAt: row.updated_at,
    draftRevision:
      row.draft_revision === null || row.draft_revision === undefined
        ? undefined
        : Number(row.draft_revision),
    assetCount: Number(row.asset_count || 0),
  };
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,location,status,updated_at,active_release_id
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
}

export function cloudAssetKey(slug, assetId) {
  if (!validSlug(slug) || !validAssetId(assetId))
    throw Error("Invalid cloud asset identity.");
  return `projects/${slug}/draft-assets/${assetId}`;
}

export function validateCloudDraft(draft, project) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    throw Error("Cloud draft must be an object.");
  if (draft.schema !== 1)
    throw Error("Unsupported Studio draft schema.");
  if (draft.id !== project.id || draft.slug !== project.slug)
    throw Error("Cloud draft project identity mismatch.");
  if (!safeText(draft.name, 200))
    throw Error("Cloud draft project name is invalid.");
  if (!Array.isArray(draft.assets) || draft.assets.length > 100)
    throw Error("Cloud draft asset list is invalid.");
  if (
    new Set(draft.assets).size !== draft.assets.length ||
    draft.assets.some((id) => !validAssetId(id))
  )
    throw Error("Cloud draft contains invalid asset IDs.");
  if (!draft.scene || typeof draft.scene !== "object" || Array.isArray(draft.scene))
    throw Error("Cloud draft scene is invalid.");
  if (
    draft.scene.modelId !== undefined &&
    !draft.assets.includes(draft.scene.modelId)
  )
    throw Error("Cloud draft model asset is missing.");
  if (draft.location !== undefined && String(draft.location).length > 180)
    throw Error("Cloud draft location is too long.");
  return draft.assets;
}

async function assertAssetsOwned(env, projectId, assetIds) {
  if (!assetIds.length) return;
  const rows = await env.DB.prepare(
    `SELECT id
       FROM studio_assets_3d
      WHERE project_id=?
        AND deleted_at IS NULL`,
  ).bind(projectId).all();
  const owned = new Set((rows.results || []).map((row) => row.id));
  const missing = assetIds.filter((id) => !owned.has(id));
  if (missing.length)
    throw Error(`Cloud draft references assets that are not uploaded: ${missing.slice(0, 3).join(", ")}`);
}

async function listCloudProjects(env, url) {
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") || "40", 10) || 40),
  );
  const offset = Math.min(
    1_000_000,
    Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0),
  );
  const q = String(url.searchParams.get("q") || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
  const status = String(url.searchParams.get("status") || "active");
  const statuses =
    status === "archived"
      ? ["archived"]
      : status === "all"
        ? ["draft", "published", "archived"]
        : ["draft", "published"];
  const placeholders = statuses.map(() => "?").join(",");
  const params = [...statuses];
  let filter = `p.status IN (${placeholders})`;
  if (q) {
    filter += " AND (lower(p.name) LIKE ? OR lower(p.slug) LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  const select = env.DB.prepare(
    `SELECT p.id,p.slug,p.name,p.location,p.status,p.updated_at,
            d.revision AS draft_revision,
            (SELECT COUNT(*) FROM studio_assets_3d a
              WHERE a.project_id=p.id AND a.deleted_at IS NULL) AS asset_count
       FROM projects_3d p
       LEFT JOIN studio_drafts_3d d ON d.project_id=p.id
      WHERE ${filter}
      ORDER BY p.updated_at DESC,p.slug ASC
      LIMIT ? OFFSET ?`,
  );
  const count = env.DB.prepare(
    `SELECT COUNT(*) AS total
       FROM projects_3d p
      WHERE ${filter}`,
  );
  const [rows, total] = await Promise.all([
    select.bind(...params, limit, offset).all(),
    count.bind(...params).first(),
  ]);
  const items = rows.results || [];
  const totalCount = Number(total?.total || 0);
  return json({
    projects: items.map(cloudProjectRow),
    total: totalCount,
    nextOffset: offset + items.length,
    hasMore: offset + items.length < totalCount,
  });
}

async function createCloudProject(request, env, actor) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const slug = String(body.slug || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const location = String(body.location || "").trim();

  if (
    !validProjectId(id) ||
    !validSlug(slug) ||
    !safeText(name, 200) ||
    location.length > 180
  )
    return json({ error: "Valid project ID, slug, name and location are required." }, { status: 400 });

  const existing = await env.DB.prepare(
    "SELECT id,slug,name,location,status,updated_at FROM projects_3d WHERE id=? OR slug=? LIMIT 2",
  ).bind(id, slug).all();
  if ((existing.results || []).length) {
    const exact = (existing.results || []).find(
      (row) => row.id === id && row.slug === slug,
    );
    if (exact)
      return json({ project: cloudProjectRow(exact), created: false });
    return json({ error: "Project ID or slug already exists." }, { status: 409 });
  }

  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO projects_3d
          (id,slug,name,location,status,created_at,updated_at)
          VALUES (?,?,?,?,'draft',?,?)`,
      ).bind(id, slug, name, location || null, now, now),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "project.created",
        id,
        id,
        JSON.stringify({ slug, name, location: location || null }),
        now,
      ),
    ]);
  } catch {
    return json({ error: "Project ID or slug already exists." }, { status: 409 });
  }

  return json(
    {
      project: {
        id,
        slug,
        name,
        location: location || undefined,
        status: "draft",
        updatedAt: now,
        assetCount: 0,
      },
      created: true,
    },
    { status: 201 },
  );
}

async function cloudDraft(request, env, actor, project, slug) {
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT revision,draft_json,updated_at
         FROM studio_drafts_3d
        WHERE project_id=?
        LIMIT 1`,
    ).bind(project.id).first();
    if (!row)
      return json({ error: "Cloud draft not found." }, { status: 404 });
    let draft;
    try {
      draft = JSON.parse(row.draft_json);
    } catch {
      return json(
        { error: "Cloud draft is corrupted and requires recovery." },
        { status: 500 },
      );
    }
    return json({
      project: cloudProjectRow(project),
      revision: Number(row.revision),
      updatedAt: row.updated_at,
      draft,
    });
  }

  if (request.method !== "PUT")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json({ error: "Restore the project before editing its cloud draft." }, { status: 409 });

  const raw = await request.text();
  if (encoder.encode(raw).byteLength > MAX_DRAFT_BYTES)
    return json({ error: "Cloud draft exceeds 2 MB." }, { status: 413 });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Cloud draft request is not valid JSON." }, { status: 400 });
  }
  const expectedRevision =
    body.expectedRevision === null || body.expectedRevision === undefined
      ? null
      : Number(body.expectedRevision);
  if (
    expectedRevision !== null &&
    (!Number.isInteger(expectedRevision) || expectedRevision < 1)
  )
    return json({ error: "Invalid cloud draft revision." }, { status: 400 });

  let assetIds;
  try {
    assetIds = validateCloudDraft(body.draft, project);
    await assertAssetsOwned(env, project.id, assetIds);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Invalid cloud draft." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  let revision;
  if (expectedRevision === null) {
    try {
      await env.DB.prepare(
        `INSERT INTO studio_drafts_3d
          (project_id,schema_version,revision,draft_json,updated_by,created_at,updated_at)
          VALUES (?,1,1,?,?,?,?)`,
      )
        .bind(project.id, JSON.stringify(body.draft), actor.email, now, now)
        .run();
      revision = 1;
    } catch {
      return json(
        { error: "Cloud draft already exists. Open the latest cloud version before saving." },
        { status: 409 },
      );
    }
  } else {
    const updated = await env.DB.prepare(
      `UPDATE studio_drafts_3d
          SET draft_json=?,
              revision=revision+1,
              updated_by=?,
              updated_at=?
        WHERE project_id=? AND revision=?
        RETURNING revision`,
    )
      .bind(
        JSON.stringify(body.draft),
        actor.email,
        now,
        project.id,
        expectedRevision,
      )
      .first();
    if (!updated)
      return json(
        { error: "Cloud draft changed elsewhere. Reload it before saving." },
        { status: 409 },
      );
    revision = Number(updated.revision);
  }

  const assetRows = await env.DB.prepare(
    "SELECT id FROM studio_assets_3d WHERE project_id=? AND deleted_at IS NULL",
  ).bind(project.id).all();
  const referenced = new Set(assetIds);
  const statements = [
    env.DB.prepare(
      "UPDATE projects_3d SET name=?,location=?,updated_at=? WHERE id=?",
    ).bind(
      body.draft.name,
      String(body.draft.location || project.location || "").trim() || null,
      now,
      project.id,
    ),
  ];
  for (const row of assetRows.results || []) {
    const active = referenced.has(row.id);
    statements.push(
      env.DB.prepare(
        `UPDATE studio_assets_3d
            SET ref_count=?,
                orphaned_at=?,
                updated_at=?
          WHERE id=? AND project_id=?`,
      ).bind(active ? 1 : 0, active ? null : now, now, row.id, project.id),
    );
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "draft.saved",
      project.id,
      project.id,
      JSON.stringify({ revision, assetCount: assetIds.length }),
      now,
    ),
  );
  await env.DB.batch(statements);

  return json({ ok: true, revision, updatedAt: now });
}

function assetResponse(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size || 0),
    sha256: row.sha256,
    refCount: Number(row.ref_count || 0),
    orphanedAt: row.orphaned_at ?? undefined,
    createdAt: row.created_at,
    contentUrl: `${CLOUD_PATH}/projects/${encodeURIComponent(row.project_slug)}/assets/${encodeURIComponent(row.id)}/content`,
  };
}

async function listAssets(env, project) {
  const result = await env.DB.prepare(
    `SELECT a.*,p.slug AS project_slug
       FROM studio_assets_3d a
       JOIN projects_3d p ON p.id=a.project_id
      WHERE a.project_id=? AND a.deleted_at IS NULL
      ORDER BY a.created_at ASC,a.id ASC`,
  ).bind(project.id).all();
  return json({ assets: (result.results || []).map(assetResponse) });
}

async function uploadAsset(request, env, actor, project, slug, url) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json({ error: "Restore the project before uploading assets." }, { status: 409 });

  const assetId = String(url.searchParams.get("id") || "").trim();
  const kind = String(url.searchParams.get("kind") || "reference").trim();
  const name = String(url.searchParams.get("name") || "").trim();
  const mimeType = String(request.headers.get("content-type") || "application/octet-stream")
    .split(";")[0]
    .trim()
    .slice(0, 200);
  const declaredSha = String(request.headers.get("x-rekixo-sha256") || "").trim().toLowerCase();
  const allowedKinds = new Set(["model", "reference", "source", "texture", "other"]);

  if (
    !validAssetId(assetId) ||
    !allowedKinds.has(kind) ||
    !safeText(name, 500) ||
    !mimeType
  )
    return json({ error: "Invalid asset identity or metadata." }, { status: 400 });
  if (declaredSha && !validSha256(declaredSha))
    return json({ error: "Invalid declared SHA-256." }, { status: 400 });

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_ASSET_BYTES)
    return json({ error: "Asset exceeds the 64 MB Studio upload limit." }, { status: 413 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_ASSET_BYTES)
    return json({ error: "Asset exceeds the 64 MB Studio upload limit." }, { status: 413 });
  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(hashBytes, (item) => item.toString(16).padStart(2, "0")).join("");
  if (declaredSha && declaredSha !== sha256)
    return json({ error: "Uploaded asset checksum does not match the local file." }, { status: 409 });

  const existing = await env.DB.prepare(
    `SELECT a.*,p.slug AS project_slug
       FROM studio_assets_3d a
       JOIN projects_3d p ON p.id=a.project_id
      WHERE a.id=?
      LIMIT 1`,
  ).bind(assetId).first();
  if (existing) {
    if (
      existing.project_id === project.id &&
      existing.deleted_at === null &&
      existing.sha256 === sha256
    )
      return json({ asset: assetResponse(existing), uploaded: false });
    return json({ error: "Asset ID already exists." }, { status: 409 });
  }

  const r2Key = cloudAssetKey(slug, assetId);
  const now = new Date().toISOString();
  await env.MODEL_ASSETS.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      projectId: project.id,
      projectSlug: slug,
      assetId,
      sha256,
      kind,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO studio_assets_3d
          (id,project_id,kind,name,mime_type,byte_size,sha256,r2_key,ref_count,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
      ).bind(
        assetId,
        project.id,
        kind,
        name,
        mimeType,
        bytes.byteLength,
        sha256,
        r2Key,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "asset.uploaded",
        project.id,
        assetId,
        JSON.stringify({ name, kind, byteSize: bytes.byteLength, sha256 }),
        now,
      ),
    ]);
  } catch (error) {
    await env.MODEL_ASSETS.delete(r2Key).catch(() => {});
    throw error;
  }

  return json(
    {
      asset: {
        id: assetId,
        projectId: project.id,
        kind,
        name,
        mimeType,
        byteSize: bytes.byteLength,
        sha256,
        refCount: 0,
        createdAt: now,
        contentUrl: `${CLOUD_PATH}/projects/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/content`,
      },
      uploaded: true,
    },
    { status: 201 },
  );
}

async function assetContent(env, project, slug, assetId) {
  const row = await env.DB.prepare(
    `SELECT *
       FROM studio_assets_3d
      WHERE id=? AND project_id=? AND deleted_at IS NULL
      LIMIT 1`,
  ).bind(assetId, project.id).first();
  if (!row) return json({ error: "Asset not found." }, { status: 404 });

  const expectedPrefix = `projects/${slug}/draft-assets/`;
  if (!String(row.r2_key || "").startsWith(expectedPrefix))
    return json({ error: "Asset storage key violates project isolation." }, { status: 500 });

  const object = await env.MODEL_ASSETS.get(row.r2_key);
  if (!object)
    return json({ error: "Asset object is missing from storage." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private,no-store");
  headers.set("Content-Disposition", `attachment; filename="${String(row.name).replace(/[\r\n"]/g, "_")}"`);
  for (const [key, value] of Object.entries(SECURITY_HEADERS))
    headers.set(key, value);
  return new Response(object.body, { headers });
}

async function deleteAsset(request, env, actor, project, slug, assetId) {
  if (request.method !== "DELETE")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });

  const row = await env.DB.prepare(
    `SELECT *
       FROM studio_assets_3d
      WHERE id=? AND project_id=? AND deleted_at IS NULL
      LIMIT 1`,
  ).bind(assetId, project.id).first();
  if (!row) return json({ error: "Asset not found." }, { status: 404 });

  const draftRow = await env.DB.prepare(
    "SELECT draft_json FROM studio_drafts_3d WHERE project_id=? LIMIT 1",
  ).bind(project.id).first();
  if (draftRow) {
    try {
      const draft = JSON.parse(draftRow.draft_json);
      if (Array.isArray(draft.assets) && draft.assets.includes(assetId))
        return json(
          { error: "Asset is still referenced by the current cloud draft." },
          { status: 409 },
        );
    } catch {
      return json(
        { error: "Cloud draft is corrupted; asset deletion is blocked." },
        { status: 409 },
      );
    }
  }

  const expectedKey = cloudAssetKey(slug, assetId);
  if (row.r2_key !== expectedKey)
    return json({ error: "Asset storage key violates project isolation." }, { status: 500 });

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE studio_assets_3d
          SET deleted_at=?,ref_count=0,updated_at=?
        WHERE id=? AND project_id=?`,
    ).bind(now, now, assetId, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "asset.deleted",
      project.id,
      assetId,
      JSON.stringify({ r2Key: expectedKey, sha256: row.sha256 }),
      now,
    ),
  ]);
  await env.MODEL_ASSETS.delete(expectedKey).catch(() => {});
  return json({ ok: true });
}

async function projectReleases(request, env, actor, project, parts) {
  if (parts.length === 2) {
    if (request.method === "GET") {
      try {
        return json({ releases: await listProjectReleases(env, project) });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Release history could not be loaded.",
          },
          { status: 503 },
        );
      }
    }

    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, { status: 405 });
    if (!sameOrigin(request))
      return json({ error: "Invalid request origin." }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    if (String(body.action || "publish") !== "publish")
      return json({ error: "Unsupported release action." }, { status: 400 });

    const expectedDraftRevision =
      body.expectedDraftRevision === null ||
      body.expectedDraftRevision === undefined
        ? undefined
        : Number(body.expectedDraftRevision);
    if (
      expectedDraftRevision !== undefined &&
      (!Number.isInteger(expectedDraftRevision) ||
        expectedDraftRevision < 1)
    )
      return json({ error: "Invalid expected draft revision." }, { status: 400 });

    try {
      const release = await buildAndActivateRelease(
        env,
        actor,
        project,
        expectedDraftRevision,
      );
      return json({ release }, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Release publish failed.";
      const status = /schema is not installed/i.test(message)
        ? 503
        : /changed before publish|already exists|missing|nothing publishable/i.test(
              message,
            )
          ? 409
          : 400;
      return json({ error: message }, { status });
    }
  }

  if (
    parts.length === 4 &&
    parts[2] &&
    parts[3] === "activate"
  ) {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, { status: 405 });
    if (!sameOrigin(request))
      return json({ error: "Invalid request origin." }, { status: 403 });
    const releaseId = String(parts[2] || "").trim();
    if (!/^release_[A-Za-z0-9-]{20,80}$/.test(releaseId))
      return json({ error: "Invalid release ID." }, { status: 400 });
    try {
      return json({
        release: await activateExistingRelease(
          env,
          actor,
          project,
          releaseId,
        ),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Release activation failed.";
      return json(
        { error: message },
        {
          status: /schema is not installed/i.test(message)
            ? 503
            : /does not belong/i.test(message)
              ? 404
              : 409,
        },
      );
    }
  }

  return json({ error: "Cloud release route not found." }, { status: 404 });
}

async function patchProject(request, env, actor, project) {
  if (request.method !== "PATCH")
    return json({ error: "Method not allowed." }, { status: 405 });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const now = new Date().toISOString();

  if (action === "archive" || action === "restore") {
    const status =
      action === "archive"
        ? "archived"
        : project.active_release_id
          ? "published"
          : "draft";
    if (
      (action === "archive" && project.status === "archived") ||
      (action === "restore" && project.status !== "archived")
    )
      return json({ ok: true, status: project.status });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE projects_3d SET status=?,updated_at=? WHERE id=?",
      ).bind(status, now, project.id),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        action === "archive" ? "project.archived" : "project.restored",
        project.id,
        project.id,
        "{}",
        now,
      ),
    ]);
    return json({ ok: true, status });
  }

  if (action === "metadata") {
    const name = String(body.name || "").trim();
    const location = String(body.location || "").trim();
    if (!safeText(name, 200) || location.length > 180)
      return json({ error: "Valid project name and location required." }, { status: 400 });
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE projects_3d SET name=?,location=?,updated_at=? WHERE id=?",
      ).bind(name, location || null, now, project.id),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "project.metadata_updated",
        project.id,
        project.id,
        JSON.stringify({ name, location: location || null }),
        now,
      ),
    ]);
    return json({ ok: true, name, location: location || undefined });
  }

  return json({ error: "Unsupported project action." }, { status: 400 });
}

async function routeProjects(request, env, actor, url) {
  const relative = url.pathname.slice(`${CLOUD_PATH}/projects`.length);
  if (!relative || relative === "/") {
    if (request.method === "GET") return listCloudProjects(env, url);
    if (request.method === "POST")
      return createCloudProject(request, env, actor);
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const parts = relative.split("/").filter(Boolean).map(decodeURIComponent);
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validSlug(slug))
    return json({ error: "Valid project slug is required." }, { status: 400 });
  const project = await projectBySlug(env, slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });

  if (parts.length === 1)
    return patchProject(request, env, actor, project);

  if (parts[1] === "draft" && parts.length === 2)
    return cloudDraft(request, env, actor, project, slug);

  if (parts[1] === "releases")
    return projectReleases(request, env, actor, project, parts);

  if (parts[1] === "assets") {
    if (parts.length === 2) {
      if (request.method === "GET") return listAssets(env, project);
      return uploadAsset(request, env, actor, project, slug, url);
    }
    const assetId = parts[2];
    if (!validAssetId(assetId))
      return json({ error: "Valid asset ID is required." }, { status: 400 });
    if (parts.length === 4 && parts[3] === "content" && request.method === "GET")
      return assetContent(env, project, slug, assetId);
    if (parts.length === 3)
      return deleteAsset(request, env, actor, project, slug, assetId);
  }

  return json({ error: "Cloud Admin route not found." }, { status: 404 });
}

export async function handleCloudAdminRequest(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith(CLOUD_PATH)) return null;

  if (url.pathname === `${CLOUD_PATH}/session`) {
    if (request.method !== "GET")
      return json({ error: "Method not allowed." }, { status: 405 });
    return sessionStatus(request, env);
  }
  if (url.pathname === `${CLOUD_PATH}/login`)
    return login(request, env);
  if (url.pathname === `${CLOUD_PATH}/logout`)
    return logout(request, env);

  if (!authConfigured(env))
    return json(
      { error: "Engine Admin authentication is not configured." },
      { status: 503 },
    );
  if (!(await schemaReady(env)))
    return json(
      { error: "Engine Admin cloud schema is not installed." },
      { status: 503 },
    );
  const actor = await sessionFor(request, env);
  if (!actor)
    return json({ error: "Engine Admin sign-in required." }, { status: 401 });

  if (url.pathname === `${CLOUD_PATH}/projects` || url.pathname.startsWith(`${CLOUD_PATH}/projects/`))
    return routeProjects(request, env, actor, url);

  if (url.pathname === `${CLOUD_PATH}/audit`) {
    if (request.method !== "GET")
      return json({ error: "Method not allowed." }, { status: 405 });
    const rows = await env.DB.prepare(
      `SELECT action,actor_email AS actorEmail,project_id AS projectId,
              target_id AS targetId,details_json AS detailsJson,created_at AS createdAt
         FROM engine_admin_audit
        ORDER BY created_at DESC
        LIMIT 100`,
    ).all();
    return json({ audits: rows.results || [] });
  }

  return json({ error: "Cloud Admin route not found." }, { status: 404 });
}
