import { engineAdminReadAccess } from "./admin-cloud.mjs";
import { geoV2AlignmentSchemaReady } from "./geo-release-admin.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const BASE = "/3Dprojects/api/cloud/projects/";
const HEIGHT_MODES = new Set(["ground-clamped", "ground-relative", "absolute"]);
const ANCHOR_KINDS = new Set([
  "entrance",
  "main-gate",
  "site-center",
  "south-west-corner",
  "custom",
]);

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

function finite(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function token(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,180}$/.test(value);
}

function text(value, max = 240) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

async function bodyJson(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Error("JSON object body required.");
  return body;
}

async function projectForSlug(env, slug) {
  return env.DB.prepare(
    `SELECT id,slug,name,status,active_release_id
       FROM projects_3d WHERE slug=? LIMIT 1`,
  ).bind(slug).first();
}

async function geoExperience(env, projectId) {
  return env.DB.prepare(
    `SELECT id,project_id,source_building_release_id,lifecycle
       FROM experiences_3d
      WHERE project_id=? AND type='geo'
      LIMIT 1`,
  ).bind(projectId).first();
}

async function releaseForProject(env, projectId, releaseId) {
  return env.DB.prepare(
    `SELECT id,version,manifest_sha256
       FROM releases_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(releaseId, projectId).first();
}

function draftPayload(row) {
  if (!row) return null;
  return {
    experienceId: row.experience_id,
    projectId: row.project_id,
    sourceBuildingReleaseId: row.source_building_release_id,
    sourceBuildingReleaseVersion: Number(row.source_building_release_version),
    longitude: row.longitude === null ? null : Number(row.longitude),
    latitude: row.latitude === null ? null : Number(row.latitude),
    altitudeM: Number(row.altitude_m || 0),
    headingDeg: Number(row.heading_deg || 0),
    pitchDeg: Number(row.pitch_deg || 0),
    rollDeg: Number(row.roll_deg || 0),
    scale: Number(row.scale || 1),
    heightMode: row.height_mode,
    eastOffsetM: Number(row.east_offset_m || 0),
    northOffsetM: Number(row.north_offset_m || 0),
    verticalOffsetM: Number(row.vertical_offset_m || 0),
    modelAnchorId: row.model_anchor_id ?? null,
    revision: Number(row.revision),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

async function readState(env, project, experience) {
  const draft = experience
    ? await env.DB.prepare(
        `SELECT * FROM geo_experience_drafts_3d
          WHERE experience_id=? AND project_id=? LIMIT 1`,
      ).bind(experience.id, project.id).first()
    : null;
  const anchors = experience
    ? await env.DB.prepare(
        `SELECT id,source_building_release_id AS sourceBuildingReleaseId,
                source_building_release_version AS sourceBuildingReleaseVersion,
                kind,name,x_m AS xM,y_m AS yM,z_m AS zM,
                updated_by AS updatedBy,updated_at AS updatedAt
           FROM geo_model_anchors_3d
          WHERE experience_id=? AND project_id=?
          ORDER BY updated_at DESC,id ASC`,
      ).bind(experience.id, project.id).all()
    : { results: [] };
  return {
    schemaReady: true,
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      status: project.status,
      activeBuildingReleaseId: project.active_release_id ?? null,
    },
    experience: experience
      ? {
          id: experience.id,
          lifecycle: experience.lifecycle,
          sourceBuildingReleaseId: experience.source_building_release_id,
        }
      : null,
    draft: draftPayload(draft),
    anchors: (anchors.results || []).map((anchor) => ({
      ...anchor,
      sourceBuildingReleaseVersion: Number(anchor.sourceBuildingReleaseVersion),
      xM: Number(anchor.xM),
      yM: Number(anchor.yM),
      zM: Number(anchor.zM),
    })),
  };
}

function validateDraftWrite(body) {
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0)
    throw Error("Expected Geo draft revision is required.");
  if (!token(body.sourceBuildingReleaseId))
    throw Error("Valid source Building release is required.");
  if (!finite(body.longitude, -180, 180) || !finite(body.latitude, -90, 90))
    throw Error("Valid WGS84 longitude/latitude are required.");
  if (!finite(body.altitudeM, -12000, 100000) ||
    !finite(body.headingDeg, -360000, 360000) ||
    !finite(body.pitchDeg, -180, 180) ||
    !finite(body.rollDeg, -180, 180) ||
    !finite(body.scale, 0.01, 100) ||
    !HEIGHT_MODES.has(body.heightMode) ||
    !finite(body.eastOffsetM, -100000, 100000) ||
    !finite(body.northOffsetM, -100000, 100000) ||
    !finite(body.verticalOffsetM, -12000, 100000) ||
    !(body.modelAnchorId === null || body.modelAnchorId === undefined || token(body.modelAnchorId)))
    throw Error("Geo V2 rigid alignment values are invalid.");
}

async function saveDraftV2(env, actor, project, experience, body) {
  validateDraftWrite(body);
  if (!experience) throw Error("Create the optional Geo Experience first.");
  if (experience.lifecycle !== "active")
    throw Error("Restore the Geo Experience before editing alignment.");
  const source = await releaseForProject(
    env,
    project.id,
    body.sourceBuildingReleaseId,
  );
  if (!source) throw Error("Selected Building release does not belong to this project.");
  const current = await env.DB.prepare(
    `SELECT revision,source_building_release_id,model_anchor_id
       FROM geo_experience_drafts_3d
      WHERE experience_id=? AND project_id=? LIMIT 1`,
  ).bind(experience.id, project.id).first();
  if (!current) throw Error("Geo draft is missing. Recreate the Geo Experience.");
  if (Number(current.revision) !== Number(body.expectedRevision))
    throw Error("Geo draft changed. Reload before saving alignment.");

  let anchorId = body.modelAnchorId || null;
  if (anchorId) {
    const anchor = await env.DB.prepare(
      `SELECT id FROM geo_model_anchors_3d
        WHERE id=? AND experience_id=? AND project_id=?
          AND source_building_release_id=?
          AND source_building_release_version=?
        LIMIT 1`,
    ).bind(
      anchorId,
      experience.id,
      project.id,
      source.id,
      Number(source.version),
    ).first();
    if (!anchor)
      throw Error("Selected model anchor is not pinned to this Building release.");
  }

  // When switching Building releases, clear any old anchor before updating the
  // Experience ownership. The DB ownership triggers then protect every step.
  const switchingSource = current.source_building_release_id !== source.id;
  const now = new Date().toISOString();
  const statements = [];
  if (switchingSource) {
    anchorId = null;
    statements.push(
      env.DB.prepare(
        `UPDATE geo_experience_drafts_3d SET model_anchor_id=NULL
          WHERE experience_id=? AND project_id=?`,
      ).bind(experience.id, project.id),
      env.DB.prepare(
        `UPDATE experiences_3d SET source_building_release_id=?,updated_at=?
          WHERE id=? AND project_id=? AND type='geo'`,
      ).bind(source.id, now, experience.id, project.id),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE geo_experience_drafts_3d
          SET source_building_release_id=?,source_building_release_version=?,
              longitude=?,latitude=?,altitude_m=?,heading_deg=?,pitch_deg=?,roll_deg=?,scale=?,
              height_mode=?,east_offset_m=?,north_offset_m=?,vertical_offset_m=?,model_anchor_id=?,
              revision=revision+1,updated_by=?,updated_at=?
        WHERE experience_id=? AND project_id=? AND revision=?`,
    ).bind(
      source.id,
      Number(source.version),
      body.longitude,
      body.latitude,
      body.altitudeM,
      body.headingDeg,
      body.pitchDeg,
      body.rollDeg,
      body.scale,
      body.heightMode,
      body.eastOffsetM,
      body.northOffsetM,
      body.verticalOffsetM,
      anchorId,
      actor.email,
      now,
      experience.id,
      project.id,
      Number(body.expectedRevision),
    ),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "geo.v2_alignment_saved",
      project.id,
      experience.id,
      JSON.stringify({
        previousRevision: Number(body.expectedRevision),
        sourceBuildingReleaseId: source.id,
        sourceBuildingReleaseVersion: Number(source.version),
        heightMode: body.heightMode,
        modelAnchorId: anchorId,
        switchingSource,
      }),
      now,
    ),
  );
  await env.DB.batch(statements);
  return readState(env, project, {
    ...experience,
    source_building_release_id: source.id,
  });
}

async function createAnchor(env, actor, project, experience, body) {
  if (!experience) throw Error("Create the optional Geo Experience first.");
  if (!token(body.sourceBuildingReleaseId) ||
    !ANCHOR_KINDS.has(body.kind) || !text(body.name, 160) ||
    !finite(body.xM, -100000, 100000) ||
    !finite(body.yM, -100000, 100000) ||
    !finite(body.zM, -100000, 100000))
    throw Error("Model anchor values are invalid.");
  if (experience.source_building_release_id !== body.sourceBuildingReleaseId)
    throw Error("Save the selected Building release before creating its model anchor.");
  const source = await releaseForProject(env, project.id, body.sourceBuildingReleaseId);
  if (!source) throw Error("Anchor Building release does not belong to this project.");
  const id = `geo_anchor_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geo_model_anchors_3d
        (id,experience_id,project_id,source_building_release_id,
         source_building_release_version,kind,name,x_m,y_m,z_m,
         created_by,updated_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      experience.id,
      project.id,
      source.id,
      Number(source.version),
      body.kind,
      body.name.trim(),
      body.xM,
      body.yM,
      body.zM,
      actor.email,
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
      "geo.model_anchor_created",
      project.id,
      id,
      JSON.stringify({
        experienceId: experience.id,
        sourceBuildingReleaseId: source.id,
        sourceBuildingReleaseVersion: Number(source.version),
        kind: body.kind,
      }),
      now,
    ),
  ]);
  return readState(env, project, experience);
}

export async function handleGeoV2AdminRequest(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith(BASE)) return null;
  const parts = url.pathname.slice(BASE.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2 || parts[1] !== "geo-v2") return null;
  const slug = parts[0]?.trim().toLowerCase();
  if (!validProjectSlug(slug)) return json({ error: "Invalid project slug." }, { status: 400 });

  const access = await engineAdminReadAccess(request, env);
  if (!access.ok) return json({ error: access.error }, { status: access.status });
  if (!(await geoV2AlignmentSchemaReady(env)))
    return json({ error: "Geo V2 alignment schema is not installed." }, { status: 503 });
  const project = await projectForSlug(env, slug);
  if (!project) return json({ error: "Project not found." }, { status: 404 });
  const experience = await geoExperience(env, project.id);

  try {
    if (parts.length === 2 && request.method === "GET")
      return json(await readState(env, project, experience));

    if (parts.length === 2 && request.method === "PUT") {
      if (!sameOrigin(request)) return json({ error: "Same-origin request required." }, { status: 403 });
      return json(await saveDraftV2(env, access.actor, project, experience, await bodyJson(request)));
    }

    if (parts.length === 3 && parts[2] === "anchors" && request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "Same-origin request required." }, { status: 403 });
      return json(await createAnchor(env, access.actor, project, experience, await bodyJson(request)), { status: 201 });
    }

    return json({ error: "Method or Geo V2 route not found." }, { status: 405 });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Geo V2 request failed." },
      { status: 400 },
    );
  }
}
