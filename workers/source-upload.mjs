import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const SOURCE_ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
export const SOURCE_UPLOAD_PART_SIZE = 16 * 1024 * 1024;
export const SOURCE_UPLOAD_MAX_PARTS = 10_000;
export const SOURCE_UPLOAD_MAX_BYTES = SOURCE_UPLOAD_PART_SIZE * SOURCE_UPLOAD_MAX_PARTS;
const SOURCE_UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 32 * 1024;
const LOCKED_SOURCE_MUTATION_SLUGS = new Set(["jyoti-paradise"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com; media-src 'self' blob:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; worker-src 'self' blob:",
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

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function validIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeText(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function sourceFileKey(slug, sourceFileId, sha256) {
  if (!validProjectSlug(slug) || !validIdentity(sourceFileId) || !validSha256(sha256))
    throw Error("Invalid Source Pack V2 storage identity.");
  return `projects/${slug}/source-files/${sourceFileId}/${sha256}`;
}

export function sourcePartPlan(byteSize, partSize = SOURCE_UPLOAD_PART_SIZE) {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0)
    throw Error("Source file byte size must be a positive safe integer.");
  if (!Number.isSafeInteger(partSize) || partSize < 5 * 1024 * 1024 || partSize > 5 * 1024 * 1024 * 1024)
    throw Error("Invalid multipart part size.");
  const partCount = Math.ceil(byteSize / partSize);
  if (partCount > SOURCE_UPLOAD_MAX_PARTS)
    throw Error("Source file requires more than 10,000 multipart parts.");
  return { partSize, partCount };
}

export function expectedSourcePartSize(byteSize, partSize, partNumber) {
  const { partCount } = sourcePartPlan(byteSize, partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount)
    throw Error("Invalid multipart part number.");
  if (partNumber < partCount) return partSize;
  return byteSize - partSize * (partCount - 1);
}

async function sourceSchemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN ('source_files_3d','source_upload_sessions_3d','source_upload_parts_3d')`,
    ).first();
    return Number(row?.total || 0) === 3;
  } catch {
    return false;
  }
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,status
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
}

async function audit(env, actor, action, projectId, targetId, details = {}) {
  await env.DB.prepare(
    `INSERT INTO engine_admin_audit
      (id,actor_email,action,project_id,target_id,details_json,created_at)
      VALUES (?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    actor.email,
    action,
    projectId,
    targetId,
    JSON.stringify(details),
    new Date().toISOString(),
  ).run();
}

function sourceResponse(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    uploadState: row.upload_state,
    sourceEtag: row.source_etag ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionResponse(row, parts = []) {
  return {
    id: row.id,
    sourceFileId: row.source_file_id,
    projectId: row.project_id,
    state: row.state,
    partSize: Number(row.part_size),
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedParts: parts.map((part) => ({
      partNumber: Number(part.part_number),
      etag: part.etag,
      byteSize: Number(part.byte_size),
    })),
  };
}

async function readSmallJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES)
    throw Object.assign(Error("Source metadata request exceeds 32 KB."), { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES)
    throw Object.assign(Error("Source metadata request exceeds 32 KB."), { status: 413 });
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Object.assign(Error("Source metadata request is not valid JSON."), { status: 400 });
  }
}

async function sourceById(env, projectId, sourceFileId) {
  return env.DB.prepare(
    `SELECT * FROM source_files_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(sourceFileId, projectId).first();
}

async function sessionById(env, projectId, sourceFileId, sessionId) {
  return env.DB.prepare(
    `SELECT * FROM source_upload_sessions_3d
      WHERE id=? AND source_file_id=? AND project_id=?
      LIMIT 1`,
  ).bind(sessionId, sourceFileId, projectId).first();
}

async function partsForSession(env, sessionId) {
  const rows = await env.DB.prepare(
    `SELECT session_id,part_number,etag,byte_size,created_at
       FROM source_upload_parts_3d
      WHERE session_id=?
      ORDER BY part_number ASC`,
  ).bind(sessionId).all();
  return rows.results || [];
}

async function listSources(env, project) {
  const rows = await env.DB.prepare(
    `SELECT * FROM source_files_3d
      WHERE project_id=?
      ORDER BY created_at ASC,id ASC`,
  ).bind(project.id).all();
  return json({ sources: (rows.results || []).map(sourceResponse) });
}

async function registerSource(request, env, actor, project, slug) {
  let body;
  try {
    body = await readSmallJson(request);
  } catch (error) {
    return json({ error: error.message }, { status: error.status || 400 });
  }

  const id = String(body.id || "").trim();
  const filename = String(body.filename || "").trim();
  const mediaType = String(body.mediaType || "application/octet-stream").trim().slice(0, 200);
  const byteSize = Number(body.byteSize);
  const sha256 = String(body.sha256 || "").trim().toLowerCase();

  if (
    !validIdentity(id) ||
    !safeText(filename, 500) ||
    !safeText(mediaType, 200) ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > SOURCE_UPLOAD_MAX_BYTES ||
    !validSha256(sha256)
  )
    return json(
      { error: "Valid source id, filename, media type, byte size and SHA-256 are required." },
      { status: 400 },
    );

  try {
    sourcePartPlan(byteSize);
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }

  const key = sourceFileKey(slug, id, sha256);
  const existing = await env.DB.prepare(
    `SELECT * FROM source_files_3d
      WHERE id=? OR r2_key=?
      LIMIT 2`,
  ).bind(id, key).all();
  const rows = existing.results || [];
  if (rows.length) {
    const exact = rows.find(
      (row) =>
        row.id === id &&
        row.project_id === project.id &&
        row.filename === filename &&
        row.media_type === mediaType &&
        Number(row.byte_size) === byteSize &&
        row.sha256 === sha256 &&
        row.r2_key === key,
    );
    if (exact) return json({ source: sourceResponse(exact), created: false });
    return json({ error: "Source file identity or storage key already exists." }, { status: 409 });
  }

  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source_files_3d
          (id,project_id,filename,media_type,byte_size,sha256,r2_key,upload_state,created_by,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,'registered',?,?,?)`,
      ).bind(id, project.id, filename, mediaType, byteSize, sha256, key, actor.email, now, now),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "source.registered",
        project.id,
        id,
        JSON.stringify({ filename, mediaType, byteSize, sha256, r2Key: key }),
        now,
      ),
    ]);
  } catch {
    return json({ error: "Source file identity or storage key already exists." }, { status: 409 });
  }

  const row = await sourceById(env, project.id, id);
  return json({ source: sourceResponse(row), created: true }, { status: 201 });
}

async function getSource(env, project, sourceFileId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  const sessions = await env.DB.prepare(
    `SELECT * FROM source_upload_sessions_3d
      WHERE source_file_id=? AND project_id=?
      ORDER BY created_at DESC`,
  ).bind(sourceFileId, project.id).all();
  return json({
    source: sourceResponse(source),
    sessions: (sessions.results || []).map((session) => sessionResponse(session)),
  });
}

async function activeSession(env, projectId, sourceFileId) {
  return env.DB.prepare(
    `SELECT * FROM source_upload_sessions_3d
      WHERE source_file_id=? AND project_id=?
        AND state IN ('initiated','uploading')
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(sourceFileId, projectId).first();
}

async function abortExpiredSession(env, source, session) {
  if (!session?.expires_at || Date.parse(session.expires_at) > Date.now()) return false;
  try {
    await env.MODEL_ASSETS.resumeMultipartUpload(source.r2_key, session.upload_id).abort();
  } catch {
    // R2 also auto-aborts stale multipart uploads. The durable session still
    // moves to aborted so a fresh retry can be created deterministically.
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='aborted',updated_at=?
        WHERE id=? AND state IN ('initiated','uploading')`,
    ).bind(now, session.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='registered',failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=? AND upload_state='uploading'`,
    ).bind(now, source.id, source.project_id),
  ]);
  return true;
}

async function initiateUpload(env, actor, project, slug, sourceFileId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  if (source.upload_state === "verified")
    return json({ error: "Verified source originals are immutable." }, { status: 409 });
  if (source.upload_state === "uploaded")
    return json({ source: sourceResponse(source), uploaded: true });

  let existing = await activeSession(env, project.id, sourceFileId);
  if (existing && (await abortExpiredSession(env, source, existing))) existing = null;
  if (existing) {
    const parts = await partsForSession(env, existing.id);
    return json({
      source: sourceResponse(source),
      session: sessionResponse(existing, parts),
      resumed: true,
      partCount: sourcePartPlan(Number(source.byte_size), Number(existing.part_size)).partCount,
    });
  }

  const { partSize, partCount } = sourcePartPlan(Number(source.byte_size));
  let multipart;
  try {
    multipart = await env.MODEL_ASSETS.createMultipartUpload(source.r2_key, {
      httpMetadata: { contentType: source.media_type },
      customMetadata: {
        projectId: project.id,
        projectSlug: slug,
        sourceFileId: source.id,
        sha256: source.sha256,
      },
    });
  } catch {
    return json({ error: "R2 multipart upload could not be initiated." }, { status: 503 });
  }

  const sessionId = `upload_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SOURCE_UPLOAD_TTL_MS).toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source_upload_sessions_3d
          (id,source_file_id,project_id,provider,upload_id,state,part_size,expires_at,created_by,created_at,updated_at)
          VALUES (?,?,?,'r2-multipart',?,'initiated',?,?,?,?,?)`,
      ).bind(sessionId, source.id, project.id, multipart.uploadId, partSize, expiresAt, actor.email, now, now),
      env.DB.prepare(
        `UPDATE source_files_3d
            SET upload_state='uploading',failure_reason=NULL,updated_at=?
          WHERE id=? AND project_id=?`,
      ).bind(now, source.id, project.id),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "source.upload_initiated",
        project.id,
        source.id,
        JSON.stringify({ sessionId, partSize, partCount, byteSize: Number(source.byte_size) }),
        now,
      ),
    ]);
  } catch (error) {
    await multipart.abort().catch(() => {});
    throw error;
  }

  const session = await sessionById(env, project.id, source.id, sessionId);
  const refreshed = await sourceById(env, project.id, source.id);
  return json(
    {
      source: sourceResponse(refreshed),
      session: sessionResponse(session),
      resumed: false,
      partCount,
    },
    { status: 201 },
  );
}

async function getUploadSession(env, project, sourceFileId, sessionId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  const session = await sessionById(env, project.id, sourceFileId, sessionId);
  if (!session) return json({ error: "Upload session not found." }, { status: 404 });
  const parts = await partsForSession(env, session.id);
  return json({
    source: sourceResponse(source),
    session: sessionResponse(session, parts),
    partCount: sourcePartPlan(Number(source.byte_size), Number(session.part_size)).partCount,
  });
}

async function uploadPart(request, env, project, sourceFileId, sessionId, partNumber) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  const session = await sessionById(env, project.id, sourceFileId, sessionId);
  if (!session) return json({ error: "Upload session not found." }, { status: 404 });
  if (!new Set(["initiated", "uploading"]).has(session.state))
    return json({ error: "Upload session is not writable." }, { status: 409 });
  if (session.expires_at && Date.parse(session.expires_at) <= Date.now())
    return json({ error: "Upload session expired. Initiate a new upload session." }, { status: 409 });

  let expectedBytes;
  try {
    expectedBytes = expectedSourcePartSize(
      Number(source.byte_size),
      Number(session.part_size),
      partNumber,
    );
  } catch (error) {
    return json({ error: error.message }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength <= 0)
    return json({ error: "Multipart part Content-Length is required." }, { status: 411 });
  if (declaredLength !== expectedBytes)
    return json(
      { error: `Multipart part must contain exactly ${expectedBytes} bytes.` },
      { status: declaredLength > expectedBytes ? 413 : 400 },
    );

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== expectedBytes)
    return json({ error: "Multipart part byte count does not match Content-Length." }, { status: 400 });

  let uploaded;
  try {
    const multipart = env.MODEL_ASSETS.resumeMultipartUpload(source.r2_key, session.upload_id);
    uploaded = await multipart.uploadPart(partNumber, bytes);
  } catch {
    return json({ error: "R2 multipart part upload failed; retry this part." }, { status: 503 });
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO source_upload_parts_3d(session_id,part_number,etag,byte_size,created_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(session_id,part_number) DO UPDATE SET
         etag=excluded.etag,
         byte_size=excluded.byte_size`,
    ).bind(session.id, partNumber, uploaded.etag, expectedBytes, now),
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='uploading',updated_at=?
        WHERE id=?`,
    ).bind(now, session.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='uploading',failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=?`,
    ).bind(now, source.id, project.id),
  ]);

  return json({
    ok: true,
    part: { partNumber, etag: uploaded.etag, byteSize: expectedBytes },
  });
}

function validateCompletedParts(source, session, parts) {
  const { partCount } = sourcePartPlan(Number(source.byte_size), Number(session.part_size));
  if (parts.length !== partCount)
    throw Error(`Upload requires ${partCount} completed parts before finalization.`);
  let totalBytes = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const partNumber = index + 1;
    const part = parts[index];
    const expectedBytes = expectedSourcePartSize(
      Number(source.byte_size),
      Number(session.part_size),
      partNumber,
    );
    if (Number(part.part_number) !== partNumber || Number(part.byte_size) !== expectedBytes || !part.etag)
      throw Error(`Multipart part ${partNumber} is missing or has an invalid byte count.`);
    totalBytes += Number(part.byte_size);
  }
  if (totalBytes !== Number(source.byte_size))
    throw Error("Multipart byte total does not match the registered source file.");
  return parts.map((part) => ({ partNumber: Number(part.part_number), etag: part.etag }));
}

function objectMetadataMatches(object, project, source) {
  const metadata = object?.customMetadata || {};
  return (
    (!metadata.projectId || metadata.projectId === project.id) &&
    (!metadata.sourceFileId || metadata.sourceFileId === source.id) &&
    (!metadata.sha256 || metadata.sha256 === source.sha256)
  );
}

async function finalizeUploadedSource(env, actor, project, source, session, object) {
  if (!object || Number(object.size) !== Number(source.byte_size) || !objectMetadataMatches(object, project, source))
    throw Error("Completed R2 source object does not match the registered source metadata.");
  const sourceEtag = String(object.httpEtag || object.etag || "") || null;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='completed',updated_at=?
        WHERE id=? AND source_file_id=? AND project_id=?`,
    ).bind(now, session.id, source.id, project.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='uploaded',source_etag=?,failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=? AND upload_state!='verified'`,
    ).bind(sourceEtag, now, source.id, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "source.upload_completed",
      project.id,
      source.id,
      JSON.stringify({ sessionId: session.id, byteSize: Number(source.byte_size), sourceEtag }),
      now,
    ),
  ]);
  return sourceById(env, project.id, source.id);
}

async function completeUpload(env, actor, project, sourceFileId, sessionId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  const session = await sessionById(env, project.id, sourceFileId, sessionId);
  if (!session) return json({ error: "Upload session not found." }, { status: 404 });
  if (session.state === "completed" && source.upload_state === "uploaded")
    return json({ source: sourceResponse(source), completed: true, replayed: true });
  if (!new Set(["initiated", "uploading", "completed"]).has(session.state))
    return json({ error: "Upload session cannot be completed." }, { status: 409 });

  const parts = await partsForSession(env, session.id);
  let completionParts;
  try {
    completionParts = validateCompletedParts(source, session, parts);
  } catch (error) {
    return json({ error: error.message }, { status: 409 });
  }

  // Recovery path for the narrow failure window where R2 completed but the D1
  // finalization batch did not commit. Never call complete() twice if the final
  // object is already present and matches the registered source identity.
  let object = await env.MODEL_ASSETS.head(source.r2_key);
  if (!object) {
    try {
      object = await env.MODEL_ASSETS
        .resumeMultipartUpload(source.r2_key, session.upload_id)
        .complete(completionParts);
    } catch {
      return json({ error: "R2 multipart completion failed; retry finalization." }, { status: 503 });
    }
  }

  try {
    const uploaded = await finalizeUploadedSource(env, actor, project, source, session, object);
    return json({ source: sourceResponse(uploaded), completed: true, replayed: false });
  } catch (error) {
    return json({ error: error.message }, { status: 409 });
  }
}

async function abortUpload(env, actor, project, sourceFileId, sessionId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  const session = await sessionById(env, project.id, sourceFileId, sessionId);
  if (!session) return json({ error: "Upload session not found." }, { status: 404 });
  if (session.state === "completed" || source.upload_state === "uploaded" || source.upload_state === "verified")
    return json({ error: "Completed or verified source uploads cannot be aborted." }, { status: 409 });
  if (session.state === "aborted") return json({ ok: true, aborted: true, replayed: true });

  try {
    await env.MODEL_ASSETS.resumeMultipartUpload(source.r2_key, session.upload_id).abort();
  } catch {
    // Treat missing/already-aborted R2 upload as an idempotent abort. D1 remains
    // the durable control-plane state and a retry starts a fresh upload id.
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='aborted',updated_at=?
        WHERE id=? AND source_file_id=? AND project_id=?`,
    ).bind(now, session.id, source.id, project.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='registered',source_etag=NULL,failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=? AND upload_state IN ('uploading','failed','registered')`,
    ).bind(now, source.id, project.id),
  ]);
  await audit(env, actor, "source.upload_aborted", project.id, source.id, { sessionId: session.id });
  return json({ ok: true, aborted: true, replayed: false });
}

function parseSourceRoute(url) {
  if (!url.pathname.startsWith(SOURCE_ROUTE_PREFIX)) return null;
  let parts;
  try {
    parts = url.pathname
      .slice(SOURCE_ROUTE_PREFIX.length)
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return { error: "Invalid source upload route encoding." };
  }
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug) || parts[1] !== "source-files") return null;
  return { slug, parts };
}

export async function handleSourceUploadRequest(request, env, url = new URL(request.url)) {
  const route = parseSourceRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  if (!(await sourceSchemaReady(env)))
    return json({ error: "Source Pack V2 upload schema is not installed." }, { status: 503 });

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });
  const { parts } = route;

  const mutating = request.method !== "GET" && request.method !== "HEAD";
  if (mutating) {
    if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
    if (project.status === "archived")
      return json({ error: "Restore the project before uploading source files." }, { status: 409 });
    if (LOCKED_SOURCE_MUTATION_SLUGS.has(route.slug))
      return json(
        { error: "Jyoti Paradise is locked as the production benchmark; source mutation is disabled." },
        { status: 423 },
      );
    if (await activeDeletionJob(env))
      return json(
        { error: "Permanent project cleanup is in progress. Source mutations are frozen until it finishes." },
        { status: 409 },
      );
  }

  if (parts.length === 2) {
    if (request.method === "GET") return listSources(env, project);
    if (request.method === "POST") return registerSource(request, env, access.actor, project, route.slug);
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  const sourceFileId = String(parts[2] || "").trim();
  if (!validIdentity(sourceFileId))
    return json({ error: "Valid source file ID is required." }, { status: 400 });

  if (parts.length === 3) {
    if (request.method === "GET") return getSource(env, project, sourceFileId);
    return json({ error: "Source originals cannot be mutated or deleted through this route." }, { status: 405 });
  }

  if (parts[3] !== "uploads") return json({ error: "Source upload route not found." }, { status: 404 });

  if (parts.length === 4) {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
    return initiateUpload(env, access.actor, project, route.slug, sourceFileId);
  }

  const sessionId = String(parts[4] || "").trim();
  if (!validIdentity(sessionId))
    return json({ error: "Valid upload session ID is required." }, { status: 400 });

  if (parts.length === 5) {
    if (request.method === "GET") return getUploadSession(env, project, sourceFileId, sessionId);
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (parts.length === 6 && parts[5] === "complete") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
    return completeUpload(env, access.actor, project, sourceFileId, sessionId);
  }

  if (parts.length === 6 && parts[5] === "abort") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, { status: 405 });
    return abortUpload(env, access.actor, project, sourceFileId, sessionId);
  }

  if (parts.length === 7 && parts[5] === "parts") {
    if (request.method !== "PUT") return json({ error: "Method not allowed." }, { status: 405 });
    const partNumber = Number(parts[6]);
    return uploadPart(request, env, project, sourceFileId, sessionId, partNumber);
  }

  return json({ error: "Source upload route not found." }, { status: 404 });
}
