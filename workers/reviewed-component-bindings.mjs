import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { activeDeletionJob } from "./project-deletion.mjs";
import { validateStudioDraft } from "./studio-draft-validation.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE_PATH = "/3Dprojects";
const ROUTE_PREFIX = `${BASE_PATH}/api/cloud/projects/`;
const BINDING_FORMAT = "rekixo-reviewed-component-bindings";
const BINDING_VERSION = 1;
const NODE_CATALOG_FORMAT = "rekixo-node-catalog";
const NODE_CATALOG_VERSION = 1;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const MAX_BINDINGS = 5000;
const SEMANTICS = new Set(["wall", "door", "window", "opening", "ignore"]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function validToken(value, max = 200) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function nodeIdentity(value) {
  if (typeof value !== "string") return null;
  const match = /^node:([a-f0-9]{64}):(0|[1-9][0-9]{0,8})$/i.exec(value);
  if (!match) return null;
  const index = Number(match[2]);
  return Number.isSafeInteger(index) ? { sha256: match[1].toLowerCase(), index } : null;
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
    return { error: "Invalid reviewed component bindings route encoding." };
  }
  if (parts.length !== 2) return null;
  const slug = String(parts[0] || "").trim().toLowerCase();
  if (!validProjectSlug(slug)) return { error: "Valid project slug is required." };
  if (parts[1] === "component-bindings") return { kind: "bindings", slug };
  if (parts[1] === "draft") return { kind: "draft", slug };
  return null;
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw Object.assign(Error("Request body is too large."), { status: 413 });
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes)
    throw Object.assign(Error("Request body is too large."), { status: 413 });
  try {
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw Error("Valid JSON object is required.");
    return body;
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(Error("Valid JSON object is required."), { status: 400 });
  }
}

async function projectBySlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,location,status,updated_at
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
}

async function draftRow(env, projectId) {
  return env.DB.prepare(
    `SELECT revision,draft_json,updated_at
       FROM studio_drafts_3d
      WHERE project_id=?
      LIMIT 1`,
  ).bind(projectId).first();
}

function parseDraft(row) {
  if (!row) throw Object.assign(Error("Cloud draft not found."), { status: 404 });
  try {
    const draft = JSON.parse(row.draft_json);
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw Error();
    return draft;
  } catch {
    throw Object.assign(
      Error("Cloud draft is corrupted and requires recovery."),
      { status: 500 },
    );
  }
}

function bindingBlock(scene) {
  return scene && typeof scene === "object" && !Array.isArray(scene)
    ? scene.reviewedComponentBindings
    : undefined;
}

function storedBindingTargetError(draft, block) {
  if (!block || block.format !== BINDING_FORMAT || block.version !== BINDING_VERSION)
    return "Reviewed component bindings metadata is invalid.";
  if (!Array.isArray(block.bindings) || block.bindings.length < 1 || block.bindings.length > MAX_BINDINGS)
    return "Reviewed component bindings list is invalid.";

  const floors = new Set((draft?.scene?.floors || []).map((floor) => floor?.id));
  const rooms = new Map((draft?.scene?.rooms || []).map((room) => [room?.id, room]));
  const seen = new Set();
  for (const binding of block.bindings) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding))
      return "Reviewed component binding is invalid.";
    if (!nodeIdentity(binding.nodeId) || seen.has(binding.nodeId))
      return "Reviewed component node identity is invalid or duplicated.";
    seen.add(binding.nodeId);
    if (binding.floorId !== undefined && !floors.has(binding.floorId))
      return "Reviewed component binding references a missing floor.";
    if (
      binding.unit !== undefined &&
      (typeof binding.unit !== "string" || !binding.unit.trim() || binding.unit.length > 120)
    )
      return "Reviewed component binding unit is invalid.";
    if (binding.semantic !== undefined && !SEMANTICS.has(binding.semantic))
      return "Reviewed component binding semantic is invalid.";
    if (
      binding.floorId === undefined &&
      binding.unit === undefined &&
      binding.roomId === undefined &&
      binding.semantic === undefined
    )
      return "Reviewed component binding must assign at least one semantic target.";

    if (binding.roomId !== undefined) {
      const room = rooms.get(binding.roomId);
      if (!room) return "Reviewed component binding references a missing room.";
      if (binding.floorId !== undefined && room.floorId !== binding.floorId)
        return "Reviewed component binding room/floor identity is inconsistent.";
      if (
        binding.unit !== undefined &&
        String(room.unit || "").trim() !== binding.unit.trim()
      )
        return "Reviewed component binding room/unit identity is inconsistent.";
    } else if (binding.unit !== undefined) {
      const unit = binding.unit.trim();
      const unitExists = [...rooms.values()].some(
        (room) =>
          String(room?.unit || "").trim() === unit &&
          (binding.floorId === undefined || room?.floorId === binding.floorId),
      );
      if (!unitExists)
        return "Reviewed component binding unit does not exist in the current draft.";
    }
  }
  return null;
}

export function validateStoredBindingTargets(draft, block) {
  const error = storedBindingTargetError(draft, block);
  if (error) throw Error(error);
  return block;
}

async function sha256Hex(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function processingIdentity(env, project, processingJobId) {
  const job = await env.DB.prepare(
    `SELECT id,project_id,source_pack_id,source_pack_version,
            source_pack_manifest_sha256,processor_version,state,
            output_manifest_sha256
       FROM processing_jobs_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(processingJobId, project.id).first();
  if (!job || job.state !== "succeeded" || !validSha256(job.output_manifest_sha256))
    throw Object.assign(Error("Choose a succeeded canonical processing job."), { status: 409 });

  const rows = await env.DB.prepare(
    `SELECT id,processing_job_id,project_id,kind,logical_id,state,r2_key,
            byte_size,sha256
       FROM processing_artifacts_3d
      WHERE processing_job_id=? AND project_id=? AND state='ready'
        AND ((kind='canonical-model' AND logical_id='building-model')
          OR (kind='node-catalog' AND logical_id='node-catalog-v1'))
      ORDER BY kind ASC,id ASC`,
  ).bind(job.id, project.id).all();
  const artifacts = rows.results || [];
  const models = artifacts.filter(
    (item) => item.kind === "canonical-model" && item.logical_id === "building-model",
  );
  const catalogs = artifacts.filter(
    (item) => item.kind === "node-catalog" && item.logical_id === "node-catalog-v1",
  );
  if (models.length !== 1 || catalogs.length !== 1)
    throw Object.assign(
      Error("Canonical model and node catalog must each resolve to exactly one ready artifact."),
      { status: 409 },
    );
  const model = models[0];
  const catalogArtifact = catalogs[0];
  if (!validSha256(model.sha256) || !validSha256(catalogArtifact.sha256))
    throw Object.assign(Error("Canonical artifact checksum is unavailable."), { status: 409 });
  return { job, model, catalogArtifact };
}

export function validateCatalogIdentity(catalog, project, identity) {
  const { job, model, catalogArtifact } = identity;
  if (
    !catalog ||
    typeof catalog !== "object" ||
    Array.isArray(catalog) ||
    catalog.format !== NODE_CATALOG_FORMAT ||
    catalog.version !== NODE_CATALOG_VERSION ||
    catalog.project?.id !== project.id ||
    catalog.project?.slug !== project.slug ||
    catalog.sourcePack?.id !== job.source_pack_id ||
    Number(catalog.sourcePack?.version) !== Number(job.source_pack_version) ||
    String(catalog.sourcePack?.manifestSha256 || "").toLowerCase() !==
      String(job.source_pack_manifest_sha256 || "").toLowerCase() ||
    catalog.processingJob?.id !== job.id ||
    catalog.processingJob?.processorVersion !== job.processor_version ||
    String(catalog.canonicalModel?.sha256 || "").toLowerCase() !==
      String(model.sha256 || "").toLowerCase() ||
    catalog.canonicalModel?.r2Key !== model.r2_key ||
    !Array.isArray(catalog.nodes) ||
    catalog.nodes.length > 250000
  )
    throw Error("Node catalog identity does not match the selected canonical processing output.");

  const canonicalSha = String(model.sha256).toLowerCase();
  const seen = new Set();
  for (const node of catalog.nodes) {
    const identityValue = nodeIdentity(node?.id);
    if (
      !identityValue ||
      identityValue.sha256 !== canonicalSha ||
      identityValue.index !== node?.index ||
      seen.has(node.id) ||
      typeof node.selectable !== "boolean"
    )
      throw Error("Node catalog contains an invalid canonical node identity.");
    seen.add(node.id);
  }
  if (catalogArtifact.processing_job_id !== job.id || catalogArtifact.project_id !== project.id)
    throw Error("Node catalog artifact ownership mismatch.");
  return catalog;
}

async function loadVerifiedCatalog(env, project, identity) {
  const { catalogArtifact } = identity;
  const object = await env.MODEL_ASSETS.get(catalogArtifact.r2_key);
  if (!object)
    throw Object.assign(Error("Verified node catalog bytes are missing from storage."), { status: 409 });
  if (Number(object.size || 0) > MAX_CATALOG_BYTES)
    throw Object.assign(Error("Node catalog exceeds the reviewed binding safety limit."), { status: 413 });
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength > MAX_CATALOG_BYTES)
    throw Object.assign(Error("Node catalog exceeds the reviewed binding safety limit."), { status: 413 });
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== String(catalogArtifact.sha256).toLowerCase())
    throw Object.assign(Error("Node catalog checksum verification failed."), { status: 409 });
  let catalog;
  try {
    catalog = JSON.parse(decoder.decode(bytes));
  } catch {
    throw Object.assign(Error("Node catalog JSON is invalid."), { status: 409 });
  }
  try {
    return validateCatalogIdentity(catalog, project, identity);
  } catch (error) {
    throw Object.assign(
      Error(error instanceof Error ? error.message : "Node catalog identity is invalid."),
      { status: 409 },
    );
  }
}

export function normalizeReviewedBindings(draft, catalog, bindings) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > MAX_BINDINGS)
    throw Error(`Provide between 1 and ${MAX_BINDINGS} reviewed component bindings.`);

  const floors = new Set((draft?.scene?.floors || []).map((floor) => floor?.id));
  const rooms = new Map((draft?.scene?.rooms || []).map((room) => [room?.id, room]));
  const nodes = new Map(
    catalog.nodes.filter((node) => node?.selectable === true).map((node) => [node.id, node]),
  );
  const canonicalSha = String(catalog.canonicalModel.sha256).toLowerCase();
  const seen = new Set();
  const normalized = [];

  for (const raw of bindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw Error("Reviewed component binding must be an object.");
    const nodeId = String(raw.nodeId || "").trim();
    const identityValue = nodeIdentity(nodeId);
    if (
      !identityValue ||
      identityValue.sha256 !== canonicalSha ||
      !nodes.has(nodeId) ||
      seen.has(nodeId)
    )
      throw Error("Reviewed component node must be unique and selectable in the verified node catalog.");
    seen.add(nodeId);

    const roomId = raw.roomId === undefined ? undefined : String(raw.roomId || "").trim();
    const room = roomId ? rooms.get(roomId) : undefined;
    if (roomId && !room) throw Error("Reviewed component binding references a missing room.");

    let floorId = raw.floorId === undefined ? undefined : String(raw.floorId || "").trim();
    if (floorId && !floors.has(floorId))
      throw Error("Reviewed component binding references a missing floor.");
    if (room) {
      if (floorId && room.floorId !== floorId)
        throw Error("Reviewed component binding room/floor identity is inconsistent.");
      floorId = floorId || room.floorId;
    }

    let unit = raw.unit === undefined ? undefined : String(raw.unit || "").trim();
    if (unit !== undefined && (!unit || unit.length > 120))
      throw Error("Reviewed component binding unit is invalid.");
    if (room) {
      const roomUnit = String(room.unit || "").trim();
      if (unit && roomUnit !== unit)
        throw Error("Reviewed component binding room/unit identity is inconsistent.");
      unit = unit || roomUnit;
    } else if (unit) {
      const unitExists = [...rooms.values()].some(
        (candidate) =>
          String(candidate?.unit || "").trim() === unit &&
          (!floorId || candidate?.floorId === floorId),
      );
      if (!unitExists)
        throw Error("Reviewed component binding unit does not exist in the current draft.");
    }

    const semantic = raw.semantic === undefined ? undefined : String(raw.semantic || "").trim();
    if (semantic !== undefined && !SEMANTICS.has(semantic))
      throw Error("Reviewed component binding semantic is invalid.");
    if (!floorId && !unit && !roomId && !semantic)
      throw Error("Reviewed component binding must assign at least one semantic target.");

    normalized.push({
      nodeId,
      ...(floorId ? { floorId } : {}),
      ...(unit ? { unit } : {}),
      ...(roomId ? { roomId } : {}),
      ...(semantic ? { semantic } : {}),
    });
  }
  return normalized;
}

function bindingsResponse(project, row, draft) {
  const block = bindingBlock(draft?.scene);
  return {
    contractVersion: 1,
    project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    reviewedComponentBindings: block ?? null,
  };
}

async function currentBindings(env, project) {
  const row = await draftRow(env, project.id);
  const draft = parseDraft(row);
  const block = bindingBlock(draft.scene);
  if (block) {
    try {
      validateStoredBindingTargets(draft, block);
    } catch {
      return json(
        { error: "Reviewed component bindings are inconsistent with the current Studio draft and require recovery." },
        { status: 409 },
      );
    }
  }
  return json(bindingsResponse(project, row, draft));
}

async function replaceBindings(request, env, actor, project) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json({ error: "Restore the project before editing reviewed component bindings." }, { status: 409 });
  if (await activeDeletionJob(env))
    return json({ error: "Project cleanup is in progress. Reviewed bindings are temporarily locked." }, { status: 409 });

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return json({ error: error.message }, { status: error.status || 400 });
  }
  const expectedRevision = Number(body.expectedRevision);
  const processingJobId = String(body.processingJobId || "").trim();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !validToken(processingJobId))
    return json({ error: "Valid expectedRevision and processingJobId are required." }, { status: 400 });

  const row = await draftRow(env, project.id);
  if (!row) return json({ error: "Cloud draft not found." }, { status: 404 });
  if (Number(row.revision) !== expectedRevision)
    return json({ error: "Cloud draft changed elsewhere. Reload it before saving reviewed bindings." }, { status: 409 });
  const draft = parseDraft(row);

  let identity;
  let catalog;
  let bindings;
  try {
    identity = await processingIdentity(env, project, processingJobId);
    catalog = await loadVerifiedCatalog(env, project, identity);
    bindings = normalizeReviewedBindings(draft, catalog, body.bindings);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Reviewed component bindings are invalid." },
      { status: error?.status || 400 },
    );
  }

  const now = new Date().toISOString();
  const block = {
    format: BINDING_FORMAT,
    version: BINDING_VERSION,
    processingJobId: identity.job.id,
    sourcePackId: identity.job.source_pack_id,
    sourcePackVersion: Number(identity.job.source_pack_version),
    sourcePackManifestSha256: String(identity.job.source_pack_manifest_sha256).toLowerCase(),
    processorVersion: identity.job.processor_version,
    outputManifestSha256: String(identity.job.output_manifest_sha256).toLowerCase(),
    canonicalModelArtifactId: identity.model.id,
    canonicalModelSha256: String(identity.model.sha256).toLowerCase(),
    nodeCatalogArtifactId: identity.catalogArtifact.id,
    nodeCatalogSha256: String(identity.catalogArtifact.sha256).toLowerCase(),
    reviewedAgainstDraftRevision: expectedRevision,
    reviewedBy: actor.email,
    reviewedAt: now,
    bindings,
  };
  draft.scene.reviewedComponentBindings = block;
  draft.updated = now;

  try {
    validateStoredBindingTargets(draft, block);
    validateStudioDraft(draft, project);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Updated Studio draft is invalid." },
      { status: 400 },
    );
  }
  const serialized = JSON.stringify(draft);
  if (encoder.encode(serialized).byteLength > MAX_DRAFT_BYTES)
    return json({ error: "Cloud draft exceeds 2 MB after reviewed bindings are applied." }, { status: 413 });

  const updated = await env.DB.prepare(
    `UPDATE studio_drafts_3d
        SET draft_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE project_id=? AND revision=?
      RETURNING revision`,
  ).bind(serialized, actor.email, now, project.id, expectedRevision).first();
  if (!updated)
    return json({ error: "Cloud draft changed elsewhere. Reload it before saving reviewed bindings." }, { status: 409 });
  const revision = Number(updated.revision);

  await env.DB.batch([
    env.DB.prepare("UPDATE projects_3d SET updated_at=? WHERE id=?").bind(now, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "component_bindings.reviewed",
      project.id,
      identity.job.id,
      JSON.stringify({
        revision,
        bindingCount: bindings.length,
        processingJobId: identity.job.id,
        canonicalModelSha256: String(identity.model.sha256).toLowerCase(),
        nodeCatalogSha256: String(identity.catalogArtifact.sha256).toLowerCase(),
      }),
      now,
    ),
  ]);

  return json({
    ok: true,
    revision,
    updatedAt: now,
    reviewedComponentBindings: block,
  });
}

async function clearBindings(request, env, actor, project) {
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });
  if (project.status === "archived")
    return json({ error: "Restore the project before editing reviewed component bindings." }, { status: 409 });
  if (await activeDeletionJob(env))
    return json({ error: "Project cleanup is in progress. Reviewed bindings are temporarily locked." }, { status: 409 });

  let body;
  try {
    body = await readJson(request, 16 * 1024);
  } catch (error) {
    return json({ error: error.message }, { status: error.status || 400 });
  }
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    return json({ error: "Valid expectedRevision is required." }, { status: 400 });

  const row = await draftRow(env, project.id);
  if (!row) return json({ error: "Cloud draft not found." }, { status: 404 });
  if (Number(row.revision) !== expectedRevision)
    return json({ error: "Cloud draft changed elsewhere. Reload it before clearing reviewed bindings." }, { status: 409 });
  const draft = parseDraft(row);
  if (!bindingBlock(draft.scene))
    return json({ ok: true, revision: expectedRevision, updatedAt: row.updated_at, unchanged: true });

  delete draft.scene.reviewedComponentBindings;
  const now = new Date().toISOString();
  draft.updated = now;
  try {
    validateStudioDraft(draft, project);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Updated Studio draft is invalid." },
      { status: 400 },
    );
  }
  const serialized = JSON.stringify(draft);
  const updated = await env.DB.prepare(
    `UPDATE studio_drafts_3d
        SET draft_json=?,revision=revision+1,updated_by=?,updated_at=?
      WHERE project_id=? AND revision=?
      RETURNING revision`,
  ).bind(serialized, actor.email, now, project.id, expectedRevision).first();
  if (!updated)
    return json({ error: "Cloud draft changed elsewhere. Reload it before clearing reviewed bindings." }, { status: 409 });
  const revision = Number(updated.revision);
  await env.DB.batch([
    env.DB.prepare("UPDATE projects_3d SET updated_at=? WHERE id=?").bind(now, project.id),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
        VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "component_bindings.cleared",
      project.id,
      project.id,
      JSON.stringify({ revision }),
      now,
    ),
  ]);
  return json({ ok: true, revision, updatedAt: now, reviewedComponentBindings: null });
}

async function guardGenericDraftBindings(request, env, slug) {
  if (request.method !== "PUT") return null;
  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  if (!sameOrigin(request))
    return json({ error: "Invalid request origin." }, { status: 403 });

  let body;
  try {
    body = await readJson(request.clone(), MAX_DRAFT_BYTES + 64 * 1024);
  } catch {
    return null;
  }
  const incomingScene = body?.draft?.scene;
  const incomingHas = Boolean(
    incomingScene &&
      typeof incomingScene === "object" &&
      !Array.isArray(incomingScene) &&
      Object.prototype.hasOwnProperty.call(incomingScene, "reviewedComponentBindings"),
  );
  const incoming = incomingHas ? incomingScene.reviewedComponentBindings : undefined;

  const project = await projectBySlug(env, slug);
  if (!project) return null;
  const row = await draftRow(env, project.id);
  if (!row) {
    if (incomingHas)
      return json(
        { error: "Create the cloud draft first; reviewed component bindings must be written through the dedicated bindings API." },
        { status: 409 },
      );
    return null;
  }
  const currentDraft = parseDraft(row);
  const currentScene = currentDraft.scene;
  const currentHas = Boolean(
    currentScene &&
      typeof currentScene === "object" &&
      !Array.isArray(currentScene) &&
      Object.prototype.hasOwnProperty.call(currentScene, "reviewedComponentBindings"),
  );
  const current = currentHas ? currentScene.reviewedComponentBindings : undefined;

  if (currentHas !== incomingHas || (currentHas && JSON.stringify(current) !== JSON.stringify(incoming)))
    return json(
      { error: "Reviewed component bindings are protected. Use the dedicated component-bindings API to update or clear them." },
      { status: 409 },
    );
  if (currentHas) {
    try {
      validateStoredBindingTargets(body.draft, current);
    } catch (error) {
      return json(
        {
          error:
            (error instanceof Error ? error.message : "Reviewed component bindings are stale.") +
            " Update or clear reviewed bindings before changing their floor/unit/room targets.",
        },
        { status: 409 },
      );
    }
  }
  return null;
}

export async function handleReviewedComponentBindingsRequest(request, env, url = new URL(request.url)) {
  const route = parseRoute(url);
  if (!route) return null;
  if (route.error) return json({ error: route.error }, { status: 400 });
  if (route.kind === "draft")
    return guardGenericDraftBindings(request, env, route.slug);

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  const project = await projectBySlug(env, route.slug);
  if (!project) return json({ error: "Cloud project not found." }, { status: 404 });

  if (request.method === "GET") return currentBindings(env, project);
  if (request.method === "PUT")
    return replaceBindings(request, env, access.actor, project);
  if (request.method === "DELETE")
    return clearBindings(request, env, access.actor, project);
  return json({ error: "Method not allowed." }, { status: 405 });
}
