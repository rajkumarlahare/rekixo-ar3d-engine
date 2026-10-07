const GEO_RELEASE_FORMAT = "rekixo-geo-release";
const GEO_RELEASE_VERSION = 1;
const GEO_PRESENTATION_FORMAT = "rekixo.geo-presentation";
const GEO_PRESENTATION_VERSION = 1;
const encoder = new TextEncoder();

async function digestHex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (item) => item.toString(16).padStart(2, "0")).join("");
}

async function schemaObjects(env, names) {
  try {
    const placeholders = names.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table' AND name IN (${placeholders})`,
    ).bind(...names).all();
    return new Set((rows.results || []).map((row) => row.name));
  } catch {
    return new Set();
  }
}

export async function geoReleaseSchemaReady(env) {
  const required = [
    "geo_draft_verifications_3d",
    "geo_releases_3d",
    "geo_experience_active_releases_3d",
    "geo_release_activations_3d",
  ];
  const found = await schemaObjects(env, required);
  return required.every((name) => found.has(name));
}

export async function geoV2AlignmentSchemaReady(env) {
  const required = [
    "geo_model_anchors_3d",
    "geo_overlays_3d",
    "geo_control_points_3d",
    "geo_calibration_reports_3d",
    "geo_site_boundaries_3d",
  ];
  const found = await schemaObjects(env, required);
  if (!required.every((name) => found.has(name))) return false;
  try {
    const rows = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('geo_experience_drafts_3d')
        WHERE name IN (
          'height_mode','east_offset_m','north_offset_m',
          'vertical_offset_m','model_anchor_id'
        )`,
    ).all();
    return new Set((rows.results || []).map((row) => row.name)).size === 5;
  } catch {
    return false;
  }
}

async function geoContext(env, project) {
  if (await geoV2AlignmentSchemaReady(env)) {
    return env.DB.prepare(
      `SELECT e.id AS experienceId,e.lifecycle,
              d.source_building_release_id AS sourceBuildingReleaseId,
              d.source_building_release_version AS sourceBuildingReleaseVersion,
              d.longitude,d.latitude,d.altitude_m AS altitudeM,
              d.heading_deg AS headingDeg,d.pitch_deg AS pitchDeg,
              d.roll_deg AS rollDeg,d.scale,d.revision,
              d.height_mode AS heightMode,
              d.east_offset_m AS eastOffsetM,
              d.north_offset_m AS northOffsetM,
              d.vertical_offset_m AS verticalOffsetM,
              d.model_anchor_id AS modelAnchorId,
              a.kind AS modelAnchorKind,a.name AS modelAnchorName,
              a.x_m AS modelAnchorXM,a.y_m AS modelAnchorYM,a.z_m AS modelAnchorZM,
              ar.geo_release_id AS activeGeoReleaseId
         FROM experiences_3d e
         LEFT JOIN geo_experience_drafts_3d d
           ON d.experience_id=e.id AND d.project_id=e.project_id
         LEFT JOIN geo_model_anchors_3d a
           ON a.id=d.model_anchor_id
          AND a.experience_id=e.id
          AND a.project_id=e.project_id
          AND a.source_building_release_id=d.source_building_release_id
          AND a.source_building_release_version=d.source_building_release_version
         LEFT JOIN geo_experience_active_releases_3d ar
           ON ar.experience_id=e.id AND ar.project_id=e.project_id
        WHERE e.project_id=? AND e.type='geo'
        LIMIT 1`,
    ).bind(project.id).first();
  }

  const legacy = await env.DB.prepare(
    `SELECT e.id AS experienceId,e.lifecycle,
            d.source_building_release_id AS sourceBuildingReleaseId,
            d.source_building_release_version AS sourceBuildingReleaseVersion,
            d.longitude,d.latitude,d.altitude_m AS altitudeM,
            d.heading_deg AS headingDeg,d.pitch_deg AS pitchDeg,
            d.roll_deg AS rollDeg,d.scale,d.revision,
            ar.geo_release_id AS activeGeoReleaseId
       FROM experiences_3d e
       LEFT JOIN geo_experience_drafts_3d d
         ON d.experience_id=e.id AND d.project_id=e.project_id
       LEFT JOIN geo_experience_active_releases_3d ar
         ON ar.experience_id=e.id AND ar.project_id=e.project_id
      WHERE e.project_id=? AND e.type='geo'
      LIMIT 1`,
  ).bind(project.id).first();
  if (!legacy) return legacy;
  return {
    ...legacy,
    heightMode: "ground-relative",
    eastOffsetM: 0,
    northOffsetM: 0,
    verticalOffsetM: Number(legacy.altitudeM || 0),
    modelAnchorId: null,
    modelAnchorKind: null,
    modelAnchorName: null,
    modelAnchorXM: null,
    modelAnchorYM: null,
    modelAnchorZM: null,
  };
}

async function buildingRelease(env, projectId, releaseId) {
  return env.DB.prepare(
    `SELECT id,version,manifest_json AS manifestJson,
            manifest_sha256 AS manifestSha256,created_at AS createdAt
       FROM releases_3d
      WHERE id=? AND project_id=?
      LIMIT 1`,
  ).bind(releaseId, projectId).first();
}

function releaseSummary(row) {
  return {
    id: row.id,
    experienceId: row.experienceId,
    projectId: row.projectId,
    version: Number(row.version),
    manifestSha256: row.manifestSha256,
    sourceDraftRevision: Number(row.sourceDraftRevision),
    sourceBuildingReleaseId: row.sourceBuildingReleaseId,
    sourceBuildingReleaseVersion: Number(row.sourceBuildingReleaseVersion),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    active: Boolean(row.active),
  };
}

async function verificationForCurrentDraft(env, project, context) {
  if (!context?.experienceId || context.revision === null) return null;
  return env.DB.prepare(
    `SELECT draft_revision AS draftRevision,
            source_building_release_id AS sourceBuildingReleaseId,
            source_building_release_version AS sourceBuildingReleaseVersion,
            verified_by AS verifiedBy,verified_at AS verifiedAt
       FROM geo_draft_verifications_3d
      WHERE experience_id=? AND project_id=? AND draft_revision=?
        AND source_building_release_id=?
        AND source_building_release_version=?
      LIMIT 1`,
  ).bind(
    context.experienceId,
    project.id,
    Number(context.revision),
    context.sourceBuildingReleaseId,
    Number(context.sourceBuildingReleaseVersion),
  ).first();
}

export async function listGeoReleases(env, project) {
  if (!(await geoReleaseSchemaReady(env)))
    throw Error("Immutable Geo release schema is not installed.");
  const context = await geoContext(env, project);
  if (!context?.experienceId)
    return {
      schemaReady: true,
      v2AlignmentReady: await geoV2AlignmentSchemaReady(env),
      experienceId: null,
      draftRevision: null,
      previewVerified: false,
      previewVerification: null,
      activeRelease: null,
      releases: [],
    };

  const rows = await env.DB.prepare(
    `SELECT gr.id,gr.experience_id AS experienceId,
            gr.project_id AS projectId,gr.version,
            gr.manifest_sha256 AS manifestSha256,
            gr.source_draft_revision AS sourceDraftRevision,
            gr.source_building_release_id AS sourceBuildingReleaseId,
            gr.source_building_release_version AS sourceBuildingReleaseVersion,
            gr.created_by AS createdBy,gr.created_at AS createdAt,
            CASE WHEN ar.geo_release_id=gr.id THEN 1 ELSE 0 END AS active
       FROM geo_releases_3d gr
       LEFT JOIN geo_experience_active_releases_3d ar
         ON ar.experience_id=gr.experience_id AND ar.project_id=gr.project_id
      WHERE gr.experience_id=? AND gr.project_id=?
      ORDER BY gr.version DESC`,
  ).bind(context.experienceId, project.id).all();
  const releases = (rows.results || []).map(releaseSummary);
  const verification = await verificationForCurrentDraft(env, project, context);

  return {
    schemaReady: true,
    v2AlignmentReady: await geoV2AlignmentSchemaReady(env),
    experienceId: context.experienceId,
    draftRevision:
      context.revision === null || context.revision === undefined
        ? null
        : Number(context.revision),
    previewVerified: Boolean(verification),
    previewVerification: verification
      ? {
          draftRevision: Number(verification.draftRevision),
          sourceBuildingReleaseId: verification.sourceBuildingReleaseId,
          sourceBuildingReleaseVersion: Number(verification.sourceBuildingReleaseVersion),
          verifiedBy: verification.verifiedBy,
          verifiedAt: verification.verifiedAt,
        }
      : null,
    activeRelease: releases.find((item) => item.active) || null,
    releases,
  };
}

export const geoReleaseInternals = {
  GEO_RELEASE_FORMAT,
  GEO_RELEASE_VERSION,
  GEO_PRESENTATION_FORMAT,
  GEO_PRESENTATION_VERSION,
  digestHex,
  geoContext,
  buildingRelease,
  releaseSummary,
  verificationForCurrentDraft,
  geoV2AlignmentSchemaReady,
};
