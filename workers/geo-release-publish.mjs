import {
  geoReleaseSchemaReady,
  geoReleaseInternals,
} from "./geo-release-admin.mjs";
import {
  assertGeoBuildingSource,
  requireGeoDraftReady,
} from "./geo-release-verify.mjs";

const {
  GEO_RELEASE_FORMAT,
  GEO_RELEASE_VERSION,
  digestHex,
  geoContext,
  verificationForCurrentDraft,
} = geoReleaseInternals;

function manifestFor(project, context, source, releaseId, version, createdAt) {
  return {
    format: GEO_RELEASE_FORMAT,
    version: GEO_RELEASE_VERSION,
    release: {
      id: releaseId,
      experienceId: context.experienceId,
      projectId: project.id,
      projectSlug: project.slug,
      version,
      sourceDraftRevision: Number(context.revision),
      createdAt,
    },
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      ...(project.location ? { location: project.location } : {}),
    },
    sourceBuilding: {
      releaseId: source.id,
      version: source.version,
      manifestSha256: source.manifestSha256,
    },
    placement: {
      longitude: Number(context.longitude),
      latitude: Number(context.latitude),
      altitudeM: Number(context.altitudeM || 0),
      headingDeg: Number(context.headingDeg || 0),
      pitchDeg: Number(context.pitchDeg || 0),
      rollDeg: Number(context.rollDeg || 0),
      scale: Number(context.scale || 1),
    },
  };
}

export async function publishGeoRelease(
  env,
  actor,
  project,
  expectedDraftRevision,
) {
  if (!(await geoReleaseSchemaReady(env)))
    throw Error("Immutable Geo release schema is not installed.");
  if (project.status === "archived")
    throw Error("Restore the project before publishing Geo.");

  const context = await geoContext(env, project);
  requireGeoDraftReady(context);
  if (Number(context.revision) !== Number(expectedDraftRevision))
    throw Error("Geo draft changed before publish.");

  const verification = await verificationForCurrentDraft(env, project, context);
  if (!verification)
    throw Error("Verify the current Geo preview before publishing.");

  const source = await assertGeoBuildingSource(env, project, context);
  const next = await env.DB.prepare(
    `SELECT COALESCE(MAX(version),0)+1 AS version
       FROM geo_releases_3d
      WHERE experience_id=? AND project_id=?`,
  ).bind(context.experienceId, project.id).first();
  const version = Number(next?.version || 1);
  const releaseId = `geo_release_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const manifest = manifestFor(
    project,
    context,
    source,
    releaseId,
    version,
    createdAt,
  );
  const manifestJson = JSON.stringify(manifest);
  const manifestSha256 = await digestHex(manifestJson);
  const previousReleaseId = context.activeGeoReleaseId || null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geo_releases_3d
        (id,experience_id,project_id,version,manifest_json,manifest_sha256,
         source_draft_revision,source_building_release_id,
         source_building_release_version,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      releaseId,
      context.experienceId,
      project.id,
      version,
      manifestJson,
      manifestSha256,
      Number(context.revision),
      source.id,
      source.version,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO geo_experience_active_releases_3d
        (experience_id,project_id,geo_release_id,updated_by,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(experience_id) DO UPDATE SET
         project_id=excluded.project_id,
         geo_release_id=excluded.geo_release_id,
         updated_by=excluded.updated_by,
         updated_at=excluded.updated_at`,
    ).bind(
      context.experienceId,
      project.id,
      releaseId,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO geo_release_activations_3d
        (id,experience_id,project_id,geo_release_id,previous_geo_release_id,
         action,actor_email,created_at)
       VALUES (?,?,?,?,?,'publish',?,?)`,
    ).bind(
      crypto.randomUUID(),
      context.experienceId,
      project.id,
      releaseId,
      previousReleaseId,
      actor.email,
      createdAt,
    ),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "geo.release_published",
      project.id,
      releaseId,
      JSON.stringify({
        version,
        manifestSha256,
        sourceDraftRevision: Number(context.revision),
        sourceBuildingReleaseId: source.id,
        sourceBuildingReleaseVersion: source.version,
        previousGeoReleaseId: previousReleaseId,
      }),
      createdAt,
    ),
  ]);

  return {
    id: releaseId,
    experienceId: context.experienceId,
    projectId: project.id,
    version,
    manifestSha256,
    sourceDraftRevision: Number(context.revision),
    sourceBuildingReleaseId: source.id,
    sourceBuildingReleaseVersion: source.version,
    createdBy: actor.email,
    createdAt,
    active: true,
  };
}
