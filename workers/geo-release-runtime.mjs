import {
  experienceFromReleaseState,
  geoModelDerivativeForReleaseState,
  releaseStateById,
} from "./release-runtime.mjs";
import { validProjectSlug } from "../shared/project-slug-policy.js";

const encoder = new TextEncoder();

async function digestHex(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

function validToken(value, max = 180) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validPlacement(placement) {
  return (
    placement &&
    typeof placement === "object" &&
    !Array.isArray(placement) &&
    finite(placement.longitude) &&
    placement.longitude >= -180 &&
    placement.longitude <= 180 &&
    finite(placement.latitude) &&
    placement.latitude >= -90 &&
    placement.latitude <= 90 &&
    finite(placement.altitudeM) &&
    finite(placement.headingDeg) &&
    finite(placement.pitchDeg) &&
    finite(placement.rollDeg) &&
    finite(placement.scale) &&
    placement.scale > 0
  );
}

export async function geoPublicReleaseSchemaReady(env) {
  try {
    const rows = await env.DB.prepare(
      `SELECT name
         FROM sqlite_master
        WHERE type='table'
          AND name IN (
            'experiences_3d',
            'geo_releases_3d',
            'geo_experience_active_releases_3d'
          )`,
    ).all();
    return new Set((rows.results || []).map((row) => row.name)).size === 3;
  } catch {
    return false;
  }
}

function validateGeoManifest(manifest, row) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.format !== "rekixo-geo-release" ||
    manifest.version !== 1 ||
    !manifest.release ||
    !manifest.project ||
    !manifest.sourceBuilding ||
    !validPlacement(manifest.placement) ||
    manifest.release.id !== row.geo_release_id ||
    manifest.release.experienceId !== row.experience_id ||
    manifest.release.projectId !== row.project_id ||
    manifest.release.projectSlug !== row.slug ||
    Number(manifest.release.version) !== Number(row.geo_release_version) ||
    Number(manifest.release.sourceDraftRevision) !==
      Number(row.source_draft_revision) ||
    manifest.project.id !== row.project_id ||
    manifest.project.slug !== row.slug ||
    typeof manifest.project.name !== "string" ||
    !manifest.project.name.trim() ||
    manifest.sourceBuilding.releaseId !== row.source_building_release_id ||
    Number(manifest.sourceBuilding.version) !==
      Number(row.source_building_release_version) ||
    typeof manifest.sourceBuilding.manifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.sourceBuilding.manifestSha256)
  )
    throw Error("Active Geo release manifest identity is invalid.");
}

export async function activeGeoReleaseState(env, slug) {
  if (!validProjectSlug(slug)) return { state: "invalid-slug" };
  if (!(await geoPublicReleaseSchemaReady(env)))
    return { state: "schema-missing" };

  const project = await env.DB.prepare(
    `SELECT id,slug,name,location,status
       FROM projects_3d
      WHERE slug=?
      LIMIT 1`,
  ).bind(slug).first();
  if (!project) return { state: "project-missing" };
  if (project.status !== "published")
    return { state: "unpublished", project };

  const row = await env.DB.prepare(
    `SELECT p.id AS project_id,p.slug,p.name,p.location,p.status,
            e.id AS experience_id,e.lifecycle,
            ar.geo_release_id,
            gr.version AS geo_release_version,
            gr.manifest_json,
            gr.manifest_sha256,
            gr.source_draft_revision,
            gr.source_building_release_id,
            gr.source_building_release_version,
            gr.created_at AS geo_release_created_at
       FROM projects_3d p
       JOIN experiences_3d e
         ON e.project_id=p.id
        AND e.type='geo'
        AND e.lifecycle='active'
       JOIN geo_experience_active_releases_3d ar
         ON ar.experience_id=e.id
        AND ar.project_id=e.project_id
       JOIN geo_releases_3d gr
         ON gr.id=ar.geo_release_id
        AND gr.experience_id=e.id
        AND gr.project_id=e.project_id
      WHERE p.slug=?
      LIMIT 1`,
  ).bind(slug).first();

  if (!row) return { state: "no-active", project };
  if (
    !validToken(row.geo_release_id) ||
    !row.manifest_json ||
    !row.manifest_sha256
  )
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release row is incomplete.",
    };

  const actualHash = await digestHex(row.manifest_json);
  if (actualHash !== String(row.manifest_sha256).toLowerCase())
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release manifest checksum mismatch.",
    };

  let manifest;
  try {
    manifest = JSON.parse(row.manifest_json);
    validateGeoManifest(manifest, row);
  } catch (error) {
    return {
      state: "corrupt",
      project,
      reason:
        error instanceof Error
          ? error.message
          : "Active Geo release manifest is invalid.",
    };
  }

  const building = await releaseStateById(
    env,
    slug,
    row.source_building_release_id,
  );
  if (building.state !== "ok")
    return {
      state: "corrupt",
      project,
      reason:
        building.state === "corrupt"
          ? `Pinned Building release is corrupt: ${building.reason || "unknown"}`
          : `Pinned Building release is unavailable: ${building.state}`,
    };

  if (
    Number(building.manifest.release.version) !==
      Number(row.source_building_release_version) ||
    building.manifestSha256 !==
      String(manifest.sourceBuilding.manifestSha256).toLowerCase()
  )
    return {
      state: "corrupt",
      project,
      reason: "Active Geo release Building source integrity mismatch.",
    };

  return {
    state: "ok",
    project,
    experienceId: row.experience_id,
    manifest,
    manifestSha256: actualHash,
    building,
  };
}

export async function publicGeoExperienceFromState(env, state) {
  if (state?.state !== "ok") return undefined;

  const buildingExperience = experienceFromReleaseState(state.building);
  if (!buildingExperience?.model) return undefined;

  const derivative = await geoModelDerivativeForReleaseState(
    env,
    state.building,
  );
  const model =
    derivative?.available !== false && derivative?.url
      ? derivative
      : buildingExperience.model;

  if (
    !model?.url ||
    model.available === false ||
    model.mimeType !== "model/gltf-binary"
  )
    return undefined;

  return {
    project: buildingExperience.project,
    // Backward-compatible alias. This remains the immutable Building release.
    release: {
      id: state.building.manifest.release.id,
      version: Number(state.building.manifest.release.version),
    },
    buildingRelease: {
      id: state.building.manifest.release.id,
      version: Number(state.building.manifest.release.version),
      manifestSha256: state.building.manifestSha256,
    },
    geoRelease: {
      id: state.manifest.release.id,
      version: Number(state.manifest.release.version),
      manifestSha256: state.manifestSha256,
      sourceDraftRevision: Number(state.manifest.release.sourceDraftRevision),
      createdAt: state.manifest.release.createdAt,
    },
    placement: {
      longitude: Number(state.manifest.placement.longitude),
      latitude: Number(state.manifest.placement.latitude),
      altitudeM: Number(state.manifest.placement.altitudeM || 0),
      headingDeg: Number(state.manifest.placement.headingDeg || 0),
      pitchDeg: Number(state.manifest.placement.pitchDeg || 0),
      rollDeg: Number(state.manifest.placement.rollDeg || 0),
      scale: Number(state.manifest.placement.scale || 1),
    },
    model: {
      id: model.id,
      name: model.name,
      mimeType: model.mimeType,
      byteSize: model.byteSize,
      url: model.url,
      variant: model.variant || "source",
      sha256: model.sha256,
    },
  };
}
