import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const SOURCE_PATH = `${BASE_PATH}/api/source-ingest/projects/`;
const PART_BYTES = 10 * 1024 * 1024;
const MAX_PARTS = 10_000;
const MAX_SOURCE_BYTES = PART_BYTES * MAX_PARTS;
const SESSION_LIFETIME_MS = 6 * 24 * 60 * 60 * 1000;

const SECURITY_HEADERS = {
  "Content-Security-Policy-Report-Only":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Referrer-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
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

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeText(value, max) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validSourceFileId(value) {
  return (
    typeof value === "string" &&
    /^source_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validUploadSessionId(value) {
  return (
    typeof value === "string" &&
    /^source_upload_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function validSourceFilename(value) {
  if (!safeText(value, 500)) return false;
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  )
    return false;
  const segments = value.split("/");
  return (
    segments.length <= 32 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment.length <= 240,
    )
  );
}

export function sourceFileKey(slug, sourceFileId) {
  if (!validProjectSlug(slug) || !validSourceFileId(sourceFileId))
    throw Error("Invalid source object identity.");
  return `projects/${slug}/sources/${sourceFileId}/original`;
}

export function sourceUploadPartSize() {
  return PART_BYTES;
}

export function sourceUploadPartCount(byteSize, partSize = PART_BYTES) {
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    !Number.isSafeInteger(partSize) ||
    partSize < 5 * 1024 * 1024
  )
    throw Error("Invalid multipart source size.");
  const count = Math.ceil(byteSize / partSize);
  if (count < 1 || count > MAX_PARTS)
    throw Error("Source requires too many multipart upload parts.");
  return count;
}

export function expectedSourcePartBytes(
  byteSize,
  partNumber,
  partSize = PART_BYTES,
) {
  const count = sourceUploadPartCount(byteSize, partSize);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count)
    throw Error("Invalid multipart part number.");
  if (partNumber < count) return partSize;
  return byteSize - partSize * (count - 1);
}

async function sourceSchemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'source_files_3d',
            'source_packs_3d',
            'source_pack_files_3d',
            'source_upload_sessions_3d',
            'source_upload_parts_3d'
          )`,
    ).first();
    return Number(row?.total || 0) === 5;
  } catch {
    return false;
  }
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,location,status
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  )
    .bind(slug)
    .first();
}

async function sourceFileById(env, projectId, sourceFileId) {
  return env.DB.prepare(
    `SELECT *
       FROM source_files_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  )
    .bind(sourceFileId, projectId)
    .first();
}

async function sourceSessionById(env, projectId, sourceFileId, sessionId) {
  return env.DB.prepare(
    `SELECT s.*
       FROM source_upload_sessions_3d s
      WHERE s.id=? AND s.project_id=? AND s.source_file_id=?
      LIMIT 1`,
  )
    .bind(sessionId, projectId, sourceFileId)
    .first();
}

async function audit(
  env,
  actor,
  action,
  projectId,
  targetId,
  details = {},
) {
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

function sourceFileResponse(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    uploadState: row.upload_state,
    etag: row.source_etag ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function sessionResponse(env, row) {
  const parts = await env.DB.prepare(
    `SELECT part_number AS partNumber,etag,byte_size AS byteSize
       FROM source_upload_parts_3d
      WHERE session_id=?
      ORDER BY part_number ASC`,
  )
    .bind(row.id)
    .all();
  return {
    id: row.id,
    sourceFileId: row.source_file_id,
    state: row.state,
    partSize: Number(row.part_size),
    expiresAt: row.expires_at ?? undefined,
    parts: (parts.results || []).map((part) => ({
      partNumber: Number(part.partNumber),
      etag: part.etag,
      byteSize: Number(part.byteSize),
    })),
  };
}

async function listSourceFiles(env, project) {
  const rows = await env.DB.prepare(
    `SELECT *
       FROM source_files_3d
      WHERE project_id=?
      ORDER BY created_at ASC,id ASC`,
  )
    .bind(project.id)
    .all();
  return json({
    files: (rows.results || []).map(sourceFileResponse),
    multipart: {
      partSize: PART_BYTES,
      maxParts: MAX_PARTS,
      maxSourceBytes: MAX_SOURCE_BYTES,
      checksumState: "verified-after-processing",
    },
  });
}

async function registerSourceFile(request, env, actor, project) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json(
      { error: "Restore the project before registering source files." },
      { status: 409 },
    );

  const body = await request.json().catch(() => ({}));
  const filename = String(body.filename || "").trim();
  const mediaType = String(body.mediaType || "application/octet-stream")
    .trim()
    .slice(0, 300);
  const byteSize = Number(body.byteSize);
  const sha256 = String(body.sha256 || "").trim().toLowerCase();

  if (
    !validSourceFilename(filename) ||
    !safeText(mediaType, 300) ||
    !Number.isSafeInteger(byteSize) ||
    byteSize <= 0 ||
    byteSize > MAX_SOURCE_BYTES ||
    !validSha256(sha256)
  )
    return json(
      {
        error:
          "Valid filename, media type, positive byte size and SHA-256 are required.",
      },
      { status: 400 },
    );

  const existing = await env.DB.prepare(
    `SELECT *
       FROM source_files_3d
      WHERE project_id=? AND filename=? AND byte_size=? AND sha256=?
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(project.id, filename, byteSize, sha256)
    .first();
  if (existing)
    return json({ file: sourceFileResponse(existing), created: false });

  const sourceFileId = `source_${crypto.randomUUID()}`;
  const r2Key = sourceFileKey(project.slug, sourceFileId);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO source_files_3d
        (id,project_id,filename,media_type,byte_size,sha256,r2_key,upload_state,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'registered',?,?,?)`,
    ).bind(
      sourceFileId,
      project.id,
      filename,
      mediaType,
      byteSize,
      sha256,
      r2Key,
      actor.email,
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
      "source.file_registered",
      project.id,
      sourceFileId,
      JSON.stringify({ filename, mediaType, byteSize, sha256 }),
      now,
    ),
  ]);

  return json(
    {
      file: {
        id: sourceFileId,
        projectId: project.id,
        filename,
        mediaType,
        byteSize,
        sha256,
        uploadState: "registered",
        createdAt: now,
        updatedAt: now,
      },
      created: true,
    },
    { status: 201 },
  );
}

async function activeSourceSession(env, projectId, sourceFileId) {
  return env.DB.prepare(
    `SELECT *
       FROM source_upload_sessions_3d
      WHERE project_id=? AND source_file_id=?
        AND state IN ('initiated','uploading')
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(projectId, sourceFileId)
    .first();
}

async function expireSessionIfNeeded(env, file, session) {
  if (!session?.expires_at) return session;
  const expiresAt = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return session;
  try {
    await env.MODEL_ASSETS.resumeMultipartUpload(
      file.r2_key,
      session.upload_id,
    ).abort();
  } catch {
    // R2 may already have auto-aborted the upload. The durable state still needs
    // to be released so a fresh upload can start.
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
    ).bind(now, file.id, file.project_id),
  ]);
  return null;
}

async function startMultipart(request, env, actor, project, file) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json(
      { error: "Restore the project before uploading source files." },
      { status: 409 },
    );
  if (file.upload_state === "verified" || file.upload_state === "uploaded")
    return json(
      { error: "Source file upload is already complete." },
      { status: 409 },
    );

  let active = await activeSourceSession(env, project.id, file.id);
  active = await expireSessionIfNeeded(env, file, active);
  if (active)
    return json({
      file: sourceFileResponse(file),
      session: await sessionResponse(env, active),
      resumed: true,
    });

  const staleObject = await env.MODEL_ASSETS.head(file.r2_key);
  if (staleObject) await env.MODEL_ASSETS.delete(file.r2_key);

  const multipart = await env.MODEL_ASSETS.createMultipartUpload(file.r2_key, {
    httpMetadata: { contentType: file.media_type },
    customMetadata: {
      projectId: project.id,
      projectSlug: project.slug,
      sourceFileId: file.id,
      declaredSha256: file.sha256,
    },
  });
  const sessionId = `source_upload_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source_upload_sessions_3d
          (id,source_file_id,project_id,provider,upload_id,state,part_size,expires_at,created_by,created_at,updated_at)
          VALUES (?,?,?,'r2-multipart',?,'initiated',?,?,?,?,?)`,
      ).bind(
        sessionId,
        file.id,
        project.id,
        multipart.uploadId,
        PART_BYTES,
        expiresAt,
        actor.email,
        now,
        now,
      ),
      env.DB.prepare(
        `UPDATE source_files_3d
            SET upload_state='uploading',failure_reason=NULL,updated_at=?
          WHERE id=? AND project_id=?`,
      ).bind(now, file.id, project.id),
      env.DB.prepare(
        `INSERT INTO engine_admin_audit
          (id,actor_email,action,project_id,target_id,details_json,created_at)
          VALUES (?,?,?,?,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        actor.email,
        "source.upload_started",
        project.id,
        file.id,
        JSON.stringify({ partSize: PART_BYTES, expiresAt }),
        now,
      ),
    ]);
  } catch (error) {
    await multipart.abort().catch(() => {});
    throw error;
  }

  return json(
    {
      file: { ...sourceFileResponse(file), uploadState: "uploading", updatedAt: now },
      session: {
        id: sessionId,
        sourceFileId: file.id,
        state: "initiated",
        partSize: PART_BYTES,
        partCount: sourceUploadPartCount(Number(file.byte_size), PART_BYTES),
        expiresAt,
        parts: [],
      },
      resumed: false,
    },
    { status: 201 },
  );
}

async function uploadPart(
  request,
  env,
  project,
  file,
  session,
  partNumber,
) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json(
      { error: "Restore the project before uploading source files." },
      { status: 409 },
    );
  if (!['initiated', 'uploading'].includes(session.state))
    return json({ error: "Source upload session is not active." }, { status: 409 });
  if (session.expires_at && Date.parse(session.expires_at) <= Date.now())
    return json(
      { error: "Source upload session expired. Start/resume again." },
      { status: 409 },
    );

  const expected = expectedSourcePartBytes(
    Number(file.byte_size),
    partNumber,
    Number(session.part_size),
  );
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength && declaredLength !== expected)
    return json(
      { error: `Part ${partNumber} must contain exactly ${expected} bytes.` },
      { status: 400 },
    );

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== expected)
    return json(
      { error: `Part ${partNumber} must contain exactly ${expected} bytes.` },
      { status: 400 },
    );

  const multipart = env.MODEL_ASSETS.resumeMultipartUpload(
    file.r2_key,
    session.upload_id,
  );
  let uploaded;
  try {
    uploaded = await multipart.uploadPart(partNumber, bytes);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "R2 multipart part upload failed.",
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO source_upload_parts_3d
        (session_id,part_number,etag,byte_size,created_at)
        VALUES (?,?,?,?,?)
        ON CONFLICT(session_id,part_number) DO UPDATE SET
          etag=excluded.etag,
          byte_size=excluded.byte_size,
          created_at=excluded.created_at`,
    ).bind(session.id, partNumber, uploaded.etag, bytes.byteLength, now),
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='uploading',updated_at=?
        WHERE id=? AND state IN ('initiated','uploading')`,
    ).bind(now, session.id),
  ]);

  return json({
    ok: true,
    part: {
      partNumber,
      etag: uploaded.etag,
      byteSize: bytes.byteLength,
    },
  });
}

async function markCompleteFromObject(env, actor, project, file, session, object) {
  if (Number(object.size) !== Number(file.byte_size)) {
    await env.MODEL_ASSETS.delete(file.r2_key).catch(() => {});
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE source_upload_sessions_3d
            SET state='failed',updated_at=?
          WHERE id=?`,
      ).bind(now, session.id),
      env.DB.prepare(
        `UPDATE source_files_3d
            SET upload_state='failed',failure_reason=?,updated_at=?
          WHERE id=? AND project_id=?`,
      ).bind("Completed source object size mismatch.", now, file.id, project.id),
    ]);
    return json(
      { error: "Completed source object size does not match registration." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='completed',updated_at=?
        WHERE id=?`,
    ).bind(now, session.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='uploaded',source_etag=?,failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=?`,
    ).bind(String(object.etag || ""), now, file.id, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "source.upload_completed",
      project.id,
      file.id,
      JSON.stringify({
        byteSize: Number(object.size),
        etag: String(object.etag || ""),
        checksumState: "pending-processing-verification",
      }),
      now,
    ),
  ]);

  return json({
    ok: true,
    file: {
      ...sourceFileResponse(file),
      uploadState: "uploaded",
      etag: String(object.etag || ""),
      failureReason: undefined,
      updatedAt: now,
    },
    checksumVerification: "pending-processing-verification",
  });
}

async function completeMultipart(request, env, actor, project, file, session) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json(
      { error: "Restore the project before completing source uploads." },
      { status: 409 },
    );

  if (session.state === "completed") {
    const object = await env.MODEL_ASSETS.head(file.r2_key);
    if (!object)
      return json({ error: "Completed source object is missing." }, { status: 409 });
    return markCompleteFromObject(env, actor, project, file, session, object);
  }
  if (!['initiated', 'uploading'].includes(session.state))
    return json({ error: "Source upload session is not active." }, { status: 409 });

  // If R2 completed successfully but the previous request failed before the D1
  // state update, recover idempotently from the already-visible object.
  const existingObject = await env.MODEL_ASSETS.head(file.r2_key);
  if (existingObject)
    return markCompleteFromObject(
      env,
      actor,
      project,
      file,
      session,
      existingObject,
    );

  const partSize = Number(session.part_size);
  const expectedCount = sourceUploadPartCount(Number(file.byte_size), partSize);
  const rows = await env.DB.prepare(
    `SELECT part_number AS partNumber,etag,byte_size AS byteSize
       FROM source_upload_parts_3d
      WHERE session_id=?
      ORDER BY part_number ASC`,
  )
    .bind(session.id)
    .all();
  const parts = rows.results || [];
  if (parts.length !== expectedCount)
    return json(
      {
        error: `Upload is incomplete: ${parts.length}/${expectedCount} parts recorded.`,
      },
      { status: 409 },
    );

  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const partNumber = index + 1;
    const expectedBytes = expectedSourcePartBytes(
      Number(file.byte_size),
      partNumber,
      partSize,
    );
    if (
      Number(part.partNumber) !== partNumber ||
      Number(part.byteSize) !== expectedBytes ||
      !safeText(String(part.etag || ""), 500)
    )
      return json(
        { error: `Multipart state is invalid at part ${partNumber}.` },
        { status: 409 },
      );
    total += Number(part.byteSize);
  }
  if (total !== Number(file.byte_size))
    return json(
      { error: "Recorded multipart byte total does not match source file." },
      { status: 409 },
    );

  const multipart = env.MODEL_ASSETS.resumeMultipartUpload(
    file.r2_key,
    session.upload_id,
  );
  let object;
  try {
    object = await multipart.complete(
      parts.map((part) => ({
        partNumber: Number(part.partNumber),
        etag: String(part.etag),
      })),
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "R2 multipart completion failed.",
      },
      { status: 409 },
    );
  }
  return markCompleteFromObject(env, actor, project, file, session, object);
}

async function abortMultipart(request, env, actor, project, file, session) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (session.state === "completed")
    return json({ error: "Completed source upload cannot be aborted." }, { status: 409 });
  if (session.state === "aborted")
    return json({ ok: true, state: "aborted" });

  try {
    await env.MODEL_ASSETS.resumeMultipartUpload(
      file.r2_key,
      session.upload_id,
    ).abort();
  } catch {
    // Treat missing/already-aborted R2 sessions as an idempotent abort. The
    // complete object is checked separately and is never deleted here.
    const object = await env.MODEL_ASSETS.head(file.r2_key);
    if (object)
      return json(
        { error: "Source object is already complete and cannot be aborted." },
        { status: 409 },
      );
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE source_upload_sessions_3d
          SET state='aborted',updated_at=?
        WHERE id=?`,
    ).bind(now, session.id),
    env.DB.prepare(
      `UPDATE source_files_3d
          SET upload_state='registered',failure_reason=NULL,updated_at=?
        WHERE id=? AND project_id=? AND upload_state='uploading'`,
    ).bind(now, file.id, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "source.upload_aborted",
      project.id,
      file.id,
      JSON.stringify({ sessionId: session.id }),
      now,
    ),
  ]);

  return json({ ok: true, state: "aborted" });
}

function parseSourceRoute(url) {
  if (!url.pathname.startsWith(SOURCE_PATH)) return null;
  const remainder = url.pathname.slice(SOURCE_PATH.length);
  const raw = remainder.split("/").filter(Boolean);
  if (!raw.length) return { error: "Project slug is missing." };
  let slug;
  let parts;
  try {
    slug = decodeURIComponent(raw[0]).trim().toLowerCase();
    parts = raw.slice(1).map((part) => decodeURIComponent(part));
  } catch {
    return { error: "Source-ingest route encoding is invalid." };
  }
  return { slug, parts };
}

export async function handleSourcePackUploadRequest(request, env, inputUrl) {
  const url = inputUrl ?? new URL(request.url);
  const route = parseSourceRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });
  if (!validProjectSlug(route.slug))
    return json({ error: "Valid project slug is required." }, { status: 400 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok)
    return json({ error: access.error }, { status: access.status });
  if (!(await sourceSchemaReady(env)))
    return json(
      { error: "Source Pack V2 schema is not installed." },
      { status: 503 },
    );

  const project = await projectBySlug(env, route.slug);
  if (!project)
    return json({ error: "3D project not found." }, { status: 404 });
  const parts = route.parts;

  if (parts.length === 1 && parts[0] === "files") {
    if (request.method === "GET") return listSourceFiles(env, project);
    if (request.method === "POST")
      return registerSourceFile(request, env, access.actor, project);
    return json({ error: "Method not allowed." }, { status: 405 });
  }

  if (parts[0] !== "files" || !validSourceFileId(parts[1]))
    return json({ error: "Source-ingest route not found." }, { status: 404 });
  const file = await sourceFileById(env, project.id, parts[1]);
  if (!file) return json({ error: "Source file not found." }, { status: 404 });
  if (file.r2_key !== sourceFileKey(project.slug, file.id))
    return json(
      { error: "Source storage key violates project isolation." },
      { status: 500 },
    );

  if (parts.length === 3 && parts[2] === "multipart") {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, { status: 405 });
    return startMultipart(request, env, access.actor, project, file);
  }

  if (
    parts.length >= 4 &&
    parts[2] === "multipart" &&
    validUploadSessionId(parts[3])
  ) {
    const session = await sourceSessionById(
      env,
      project.id,
      file.id,
      parts[3],
    );
    if (!session)
      return json({ error: "Source upload session not found." }, { status: 404 });

    if (parts.length === 4) {
      if (request.method === "GET")
        return json({ session: await sessionResponse(env, session) });
      if (request.method === "DELETE")
        return abortMultipart(
          request,
          env,
          access.actor,
          project,
          file,
          session,
        );
      return json({ error: "Method not allowed." }, { status: 405 });
    }

    if (
      parts.length === 6 &&
      parts[4] === "parts" &&
      /^\d{1,5}$/.test(parts[5])
    ) {
      if (request.method !== "PUT")
        return json({ error: "Method not allowed." }, { status: 405 });
      return uploadPart(
        request,
        env,
        project,
        file,
        session,
        Number(parts[5]),
      );
    }

    if (parts.length === 5 && parts[4] === "complete") {
      if (request.method !== "POST")
        return json({ error: "Method not allowed." }, { status: 405 });
      return completeMultipart(
        request,
        env,
        access.actor,
        project,
        file,
        session,
      );
    }
  }

  return json({ error: "Source-ingest route not found." }, { status: 404 });
}
