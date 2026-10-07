import {
  geoReleaseSchemaReady,
  geoReleaseInternals,
} from "./geo-release-admin.mjs";
import {
  assertGeoV2ContextReady,
  placementFromGeoContext,
} from "./geo-presentation-policy.mjs";

const {
  digestHex,
  geoContext,
  buildingRelease,
  verificationForCurrentDraft,
  geoV2AlignmentSchemaReady,
} = geoReleaseInternals;

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validMapId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

async function productionMapId(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM engine_settings_3d WHERE key='google_maps_map_id' LIMIT 1",
    ).first();
    const stored = String(row?.value || "").trim();
    if (validMapId(stored)) return stored;
  } catch {
    // Environment fallback is supported for managed production deployments.
  }
  const fallback = String(env.GOOGLE_MAPS_MAP_ID || "").trim();
  return validMapId(fallback) ? fallback : "";
}

function assertLegacyDraftReady(context) {
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

async function assertDraftReady(env, context) {
  if (await geoV2AlignmentSchemaReady(env)) {
    assertGeoV2ContextReady(context);
    // Evaluate the exact rigid placement during verification too, so NaN/range
    // failures cannot be deferred until immutable publish.
    placementFromGeoContext(context);
    return;
  }
  assertLegacyDraftReady(context);
}

function buildingModelFromManifest(manifest, releaseId, releaseVersion) {
  const model = manifest?.experience?.model;
  if (!model || model.mimeType !== "model/gltf-binary" ||
    typeof model.id !== "string" || !model.id ||
    typeof model.releaseAssetId !== "string" || !model.releaseAssetId)
    throw Error("Pinned Building release has no immutable GLB model.");
  const asset = Array.isArray(manifest.assets)
    ? manifest.assets.find((item) =>
        item?.id === model.releaseAssetId &&
        item?.kind === "model" &&
        item?.logicalId === model.id,
      )
    : undefined;
  if (!asset || !validSha256(asset.sha256))
    throw Error("Pinned Building release model is not checksum-pinned.");
  return {
    id: model.id,
    name: model.name || "Building",
    mimeType: "model/gltf-binary",
    sha256: asset.sha256,
    variant: "building",
    url: `/3Dprojects/api/releases/${encodeURIComponent(releaseId)}/models/${encodeURIComponent(model.id)}/model.glb?v=${encodeURIComponent(String(releaseVersion))}`,
  };
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

  let manifest;
  try {
    manifest = JSON.parse(source.manifestJson);
  } catch {
    throw Error("Pinned Building release manifest JSON is invalid.");
  }
  if (
    manifest?.format !== "rekixo-release-manifest" ||
    manifest?.version !== 1 ||
    manifest?.release?.id !== source.id ||
    manifest?.release?.projectId !== project.id ||
    manifest?.release?.projectSlug !== project.slug ||
    Number(manifest?.release?.version) !== Number(source.version)
  )
    throw Error("Pinned Building release manifest identity mismatch.");

  return {
    id: source.id,
    version: Number(source.version),
    manifestSha256: actualHash,
    createdAt: source.createdAt,
    model: buildingModelFromManifest(
      manifest,
      source.id,
      Number(source.version),
    ),
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
  const v2Alignment = await geoV2AlignmentSchemaReady(env);
  await assertDraftReady(env, context);
  if (v2Alignment && !(await productionMapId(env)))
    throw Error(
      "Production Google Maps JavaScript Vector Map ID save karein before Geo verification.",
    );
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
        sourceBuildingManifestSha256: source.manifestSha256,
        modelSha256: source.model.sha256,
        v2Alignment,
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

export async function requireGeoDraftReady(env, context) {
  await assertDraftReady(env, context);
}
