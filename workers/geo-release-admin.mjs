const GEO_RELEASE_FORMAT = "rekixo-geo-release";
const GEO_RELEASE_VERSION = 1;
const encoder = new TextEncoder();

async function digestHex(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (item) => item.toString(16).padStart(2, "0")).join("");
}

export async function geoReleaseSchemaReady(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'geo_draft_verifications_3d',
            'geo_releases_3d',
            'geo_experience_active_releases_3d',
            'geo_release_activations_3d'
          )`,
    ).all();
    return new Set((rows.results || []).map((row) => row.name)).size === 4;
  } catch {
    return false;
  }
}

async function geoContext(env, project) {
  return env.DB.prepare(
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
  digestHex,
  geoContext,
  buildingRelease,
  releaseSummary,
  verificationForCurrentDraft,
};
