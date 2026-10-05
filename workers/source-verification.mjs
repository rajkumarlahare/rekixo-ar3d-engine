import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";
import { validSourceIdentity } from "./source-upload-policy.mjs";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;

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

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type='table'
          AND name IN ('source_files_3d','source_packs_3d','project_operation_locks_3d')`,
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

async function sourceById(env, projectId, sourceFileId) {
  return env.DB.prepare(
    `SELECT * FROM source_files_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(sourceFileId, projectId).first();
}

async function activeSourcePackDraft(env, projectId) {
  return env.DB.prepare(
    `SELECT id,version
       FROM source_packs_3d
      WHERE project_id=? AND status='draft'
      ORDER BY version DESC
      LIMIT 1`,
  ).bind(projectId).first();
}

function draftSourceSetConflict(draft) {
  return json(
    {
      error: "Finish the current Source Pack review before verifying another source original.",
      sourcePackId: draft.id,
      sourcePackVersion: Number(draft.version),
    },
    { status: 409 },
  );
}

async function projectOperationLockReason(env, projectId, operation) {
  const row = await env.DB.prepare(
    `SELECT reason
       FROM project_operation_locks_3d
      WHERE project_id=? AND operation=?
      LIMIT 1`,
  ).bind(projectId, operation).first();
  return row ? String(row.reason || "Project operation is locked.") : null;
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

function objectEtag(object) {
  return String(object?.httpEtag || object?.etag || "");
}

function objectIdentityFailure(object, project, source) {
  if (!object) return "Source object is missing from R2.";
  if (Number(object.size) !== Number(source.byte_size))
    return "Source object byte size does not match registration.";

  const metadata = object.customMetadata || {};
  if (
    metadata.projectId !== project.id ||
    metadata.sourceFileId !== source.id ||
    metadata.sha256 !== source.sha256
  )
    return "Source object ownership metadata does not match registration.";

  const etag = objectEtag(object);
  if (!source.source_etag || !etag || etag !== String(source.source_etag))
    return "Source object ETag does not match upload finalization.";

  return null;
}

async function sha256Hex(body) {
  if (!body) throw Error("Source object body is unavailable.");
  if (typeof crypto.DigestStream !== "function")
    throw Error("Streaming SHA-256 is unavailable in this Worker runtime.");

  const digestStream = new crypto.DigestStream("SHA-256");
  const pipePromise = body.pipeTo(digestStream);
  const digest = await digestStream.digest;
  await pipePromise;
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function markVerificationFailed(env, actor, project, source, failureReason) {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE source_files_3d
        SET upload_state='failed',failure_reason=?,updated_at=?
      WHERE id=? AND project_id=? AND upload_state='uploaded'`,
  ).bind(failureReason.slice(0, 500), now, source.id, project.id).run();

  const changed = Number(result?.meta?.changes || 0) > 0;
  const current = await sourceById(env, project.id, source.id);
  if (current?.upload_state === "verified")
    return json({ source: sourceResponse(current), verified: true, replayed: true });

  if (changed)
    await audit(env, actor, "source.verification_failed", project.id, source.id, {
      reason: failureReason,
      registeredSha256: source.sha256,
    });

  return json(
    {
      error: "Source integrity verification failed.",
      reason: failureReason,
      source: current ? sourceResponse(current) : undefined,
    },
    { status: 409 },
  );
}

async function verifySource(env, actor, project, sourceFileId) {
  const source = await sourceById(env, project.id, sourceFileId);
  if (!source) return json({ error: "Source file not found." }, { status: 404 });
  if (source.upload_state === "verified")
    return json({ source: sourceResponse(source), verified: true, replayed: true });
  if (source.upload_state !== "uploaded")
    return json(
      { error: "Source must be fully uploaded before integrity verification." },
      { status: 409 },
    );

  const draft = await activeSourcePackDraft(env, project.id);
  if (draft) return draftSourceSetConflict(draft);

  let object;
  try {
    object = await env.MODEL_ASSETS.get(source.r2_key);
  } catch {
    return json(
      { error: "R2 source object could not be read for verification; retry later." },
      { status: 503 },
    );
  }

  const identityFailure = objectIdentityFailure(object, project, source);
  if (identityFailure)
    return markVerificationFailed(env, actor, project, source, identityFailure);

  let digest;
  try {
    digest = await sha256Hex(object.body);
  } catch {
    return json(
      { error: "Streaming source checksum verification could not complete; retry later." },
      { status: 503 },
    );
  }

  if (digest !== String(source.sha256).toLowerCase())
    return markVerificationFailed(
      env,
      actor,
      project,
      source,
      "Source SHA-256 does not match the registered checksum.",
    );

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE source_files_3d
        SET upload_state='verified',failure_reason=NULL,updated_at=?
      WHERE id=? AND project_id=? AND upload_state='uploaded'
        AND NOT EXISTS (
          SELECT 1 FROM source_packs_3d
           WHERE project_id=? AND status='draft'
        )`,
  ).bind(now, source.id, project.id, project.id).run();
  const changed = Number(result?.meta?.changes || 0) > 0;
  const current = await sourceById(env, project.id, source.id);

  if (!current || current.upload_state !== "verified") {
    const concurrentDraft = await activeSourcePackDraft(env, project.id);
    if (concurrentDraft) return draftSourceSetConflict(concurrentDraft);
    return json(
      { error: "Source verification state changed concurrently; reload and retry." },
      { status: 409 },
    );
  }

  if (changed)
    await audit(env, actor, "source.verified", project.id, source.id, {
      sha256: digest,
      byteSize: Number(source.byte_size),
      sourceEtag: objectEtag(object),
      verificationMethod: "cloudflare-digest-stream-sha256",
    });

  return json({ source: sourceResponse(current), verified: true, replayed: !changed });
}

function parseRoute(url) {
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null;
  let parts;
  try {
    parts = url.pathname
      .slice(ROUTE_PREFIX.length)
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
  } catch {
    return { error: "Invalid source verification route encoding." };
  }
  if (parts.length !== 4 || parts[1] !== "source-files" || parts[3] !== "verify")
    return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  const sourceFileId = String(parts[2] || "").trim();
  if (!validProjectSlug(slug) || !validSourceIdentity(sourceFileId))
    return { error: "Valid project slug and source file ID are required." };
  return { slug, sourceFileId };
}

export async function handleSourceVerificationRequest(
  request,
  env,
  url = new URL(request.url),
) {
  const route = parseRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, { status: 405 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await schemaReady(env)))
    return json({ error: "Source Pack V2 verification schema is not installed." }, { status: 503 });

  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });
  if (project.status === "archived")
    return json({ error: "Restore the project before verifying source files." }, { status: 409 });

  const lockReason = await projectOperationLockReason(env, project.id, "source-write");
  if (lockReason)
    return json(
      {
        error: "Project source mutation is locked by an operational policy.",
        reason: lockReason,
      },
      { status: 423 },
    );

  if (await activeDeletionJob(env))
    return json(
      { error: "Permanent project cleanup is in progress. Source mutations are frozen until it finishes." },
      { status: 409 },
    );

  return verifySource(env, access.actor, project, route.sourceFileId);
}
