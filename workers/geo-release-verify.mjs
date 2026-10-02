import {
  geoReleaseSchemaReady,
  geoReleaseInternals,
} from "./geo-release-admin.mjs";

const {
  digestHex,
  geoContext,
  buildingRelease,
  verificationForCurrentDraft,
} = geoReleaseInternals;

function assertDraftReady(context) {
  if (!context?.experienceId)
    throw Error("Optional Geo Experience does not exist.");
  if (context.lifecycle !== "active")
    throw Error("Restore the Geo Experience before publication.");
  if (
    context.longitude === null ||
    context.longitude === undefined ||
    context.latitude === null ||
    context.latitude === undefined
  )
    throw Error("Geo draft needs a saved location before preview verification.");
  if (!Number.isInteger(Number(context.revision)) || Number(context.revision) < 1)
    throw Error("Geo draft must be saved before preview verification.");
}

export async function assertGeoBuildingSource(env, project, context) {
  const source = await buildingRelease(
    env,
    project.id,
    context.sourceBuildingReleaseId,
  );
  if (!source)
    throw Error("Pinned Building release does not belong to this project.");
  if (Number(source.version) !== Number(context.sourceBuildingReleaseVersion))
    throw Error("Pinned Building release version mismatch.");

  const actualHash = await digestHex(source.manifestJson);
  if (actualHash !== String(source.manifestSha256 || "").toLowerCase())
    throw Error("Pinned Building release manifest checksum mismatch.");

  return {
    id: source.id,
    version: Number(source.version),
    manifestSha256: actualHash,
    createdAt: source.createdAt,
  };
}

export async function verifyGeoDraftPreview(
  env,
  actor,
  project,
  expectedDraftRevision,
) {
  if (!(await geoReleaseSchemaReady(env)))
    throw Error("Immutable Geo release schema is not installed.");
  if (project.status === "archived")
    throw Error("Restore the project before verifying Geo preview.");

  const context = await geoContext(env, project);
  assertDraftReady(context);
  if (Number(context.revision) !== Number(expectedDraftRevision))
    throw Error("Geo draft changed before preview verification.");

  if (project.active_release_id !== context.sourceBuildingReleaseId)
    throw Error(
      "Preview verification requires the selected source to be the current active Building release.",
    );

  const source = await assertGeoBuildingSource(env, project, context);
  const existing = await verificationForCurrentDraft(env, project, context);
  if (existing)
    return {
      draftRevision: Number(existing.draftRevision),
      sourceBuildingReleaseId: existing.sourceBuildingReleaseId,
      sourceBuildingReleaseVersion: Number(existing.sourceBuildingReleaseVersion),
      verifiedBy: existing.verifiedBy,
      verifiedAt: existing.verifiedAt,
      unchanged: true,
    };

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO geo_draft_verifications_3d
        (experience_id,project_id,draft_revision,source_building_release_id,
         source_building_release_version,verified_by,verified_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      context.experienceId,
      project.id,
      Number(context.revision),
      source.id,
      source.version,
      actor.email,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO engine_admin_audit
        (id,actor_email,action,project_id,target_id,details_json,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(),
      actor.email,
      "geo.preview_verified",
      project.id,
      context.experienceId,
      JSON.stringify({
        draftRevision: Number(context.revision),
        sourceBuildingReleaseId: source.id,
        sourceBuildingReleaseVersion: source.version,
      }),
      now,
    ),
  ]);

  return {
    draftRevision: Number(context.revision),
    sourceBuildingReleaseId: source.id,
    sourceBuildingReleaseVersion: source.version,
    verifiedBy: actor.email,
    verifiedAt: now,
    unchanged: false,
  };
}

export function requireGeoDraftReady(context) {
  assertDraftReady(context);
}
