function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 300) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function id(value) {
  return text(value, 120) && /^[A-Za-z0-9_-]+$/.test(value);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function finite(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function color(value) {
  return typeof value === "string" && /^#[a-fA-F0-9]{6}$/.test(value);
}

function uniqueText(value, maxItems) {
  return Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((entry) => text(entry, 240)) &&
    new Set(value).size === value.length;
}

function sameTextSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function assertVec3(value, label) {
  if (!object(value) ||
    !finite(value.x, -100000, 100000) ||
    !finite(value.y, -100000, 100000) ||
    !finite(value.z, -100000, 100000))
    throw Error(`Invalid ${label}.`);
}

function assertBounds(value) {
  if (!object(value)) throw Error("Invalid Building presentation bounds.");
  assertVec3(value.min, "Building presentation bounds min");
  assertVec3(value.max, "Building presentation bounds max");
  const dx = value.max.x - value.min.x;
  const dy = value.max.y - value.min.y;
  const dz = value.max.z - value.min.z;
  if (!finite(dx, 0.01, 2000) || !finite(dy, 0.01, 2000) || !finite(dz, 0.01, 2000))
    throw Error("Building presentation bounds are not plausible canonical metres.");
}

function assertMaterial(value) {
  if (!object(value) ||
    !text(value.materialName, 300) ||
    !["source-recovered", "reference-reviewed", "operator"].includes(value.source) ||
    (value.baseColor !== undefined && !color(value.baseColor)) ||
    (value.roughness !== undefined && !finite(value.roughness, 0, 1)) ||
    (value.metalness !== undefined && !finite(value.metalness, 0, 1)) ||
    (value.opacity !== undefined && !finite(value.opacity, 0, 1)) ||
    (value.emissive !== undefined && !color(value.emissive)) ||
    (value.emissiveIntensity !== undefined && !finite(value.emissiveIntensity, 0, 20)))
    throw Error("Invalid Building presentation material override.");
}

export function sanitizeBuildingPresentationForRelease(
  value,
  { modelSha256, sourceEvidence },
) {
  if (!object(value) || value.format !== "rekixo-building-presentation" || value.version !== 1)
    throw Error("Unsupported Building presentation manifest.");

  if (!object(value.model) ||
    !sha256(value.model.canonicalSha256) ||
    value.model.metresPerUnit !== 1 ||
    !sha256(modelSha256) ||
    value.model.canonicalSha256 !== String(modelSha256).toLowerCase())
    throw Error("Building presentation is not pinned to the immutable canonical model checksum.");
  assertBounds(value.model.bounds);

  const hierarchy = value.hierarchy;
  if (!object(hierarchy) ||
    !Number.isInteger(hierarchy.floorCount) || hierarchy.floorCount < 0 || hierarchy.floorCount > 500 ||
    !Number.isInteger(hierarchy.unitCount) || hierarchy.unitCount < 0 || hierarchy.unitCount > 10000 ||
    !Number.isInteger(hierarchy.circulationCoreCount) || hierarchy.circulationCoreCount < 0 || hierarchy.circulationCoreCount > 2000)
    throw Error("Invalid Building presentation hierarchy summary.");

  const appearance = value.appearance;
  if (!object(appearance) ||
    !["source-reference", "day", "evening", "night"].includes(appearance.mood) ||
    !finite(appearance.exposure, 0.1, 5) ||
    !finite(appearance.sunIntensity, 0, 20) ||
    !finite(appearance.hemisphereIntensity, 0, 20) ||
    !color(appearance.background) ||
    typeof appearance.referenceVisual !== "boolean")
    throw Error("Invalid Building presentation appearance.");

  const materials = value.materials;
  if (!object(materials) || materials.mode !== "source-preserving" ||
    !Array.isArray(materials.overrides) || materials.overrides.length > 1000)
    throw Error("Invalid Building presentation materials.");
  const materialNames = new Set();
  for (const override of materials.overrides) {
    assertMaterial(override);
    if (materialNames.has(override.materialName))
      throw Error("Duplicate Building presentation material override.");
    materialNames.add(override.materialName);
  }

  const environment = value.environment;
  if (!object(environment) ||
    !["source-backed", "presentation-default", "minimal"].includes(environment.mode) ||
    typeof environment.sourceBacked !== "boolean" ||
    typeof environment.genericDressing !== "boolean" ||
    (environment.sourceBacked && environment.mode !== "source-backed") ||
    (environment.mode === "source-backed" && !environment.sourceBacked))
    throw Error("Invalid Building presentation environment policy.");

  const cameras = value.cameras;
  if (!object(cameras) || !id(cameras.defaultShotId) ||
    !Array.isArray(cameras.shots) || cameras.shots.length < 1 || cameras.shots.length > 20)
    throw Error("Invalid Building presentation cameras.");
  const shotIds = new Set();
  for (const shot of cameras.shots) {
    if (!object(shot) || !id(shot.id) ||
      !["hero", "front", "corner", "entrance", "aerial"].includes(shot.kind) ||
      !finite(shot.fov, 15, 90))
      throw Error("Invalid Building presentation camera shot.");
    assertVec3(shot.position, "Building presentation camera position");
    assertVec3(shot.target, "Building presentation camera target");
    if (shotIds.has(shot.id)) throw Error("Duplicate Building presentation camera shot.");
    shotIds.add(shot.id);
  }
  if (!shotIds.has(cameras.defaultShotId))
    throw Error("Building presentation default camera shot is missing.");

  const tour = value.tour;
  if (!object(tour) || typeof tour.enabled !== "boolean" ||
    !Array.isArray(tour.steps) || tour.steps.length > 50)
    throw Error("Invalid Building presentation tour.");
  for (const step of tour.steps) {
    if (!object(step) || !id(step.shotId) || !shotIds.has(step.shotId) ||
      !Number.isInteger(step.durationMs) || step.durationMs < 250 || step.durationMs > 30000 ||
      !Number.isInteger(step.holdMs) || step.holdMs < 0 || step.holdMs > 30000)
      throw Error("Invalid Building presentation tour step.");
  }
  if (tour.enabled && tour.steps.length === 0)
    throw Error("Enabled Building presentation tour requires at least one step.");

  const interactions = value.interactions;
  if (!object(interactions) ||
    typeof interactions.orbit !== "boolean" ||
    typeof interactions.floorExplorer !== "boolean" ||
    typeof interactions.walkthrough !== "boolean")
    throw Error("Invalid Building presentation interactions.");

  const provenance = value.provenance;
  const expectedSourceIds = Array.isArray(sourceEvidence?.sourcePackSourceIds)
    ? sourceEvidence.sourcePackSourceIds
    : [];
  const expectedClaimIds = Array.isArray(sourceEvidence?.sourceClaimIds)
    ? sourceEvidence.sourceClaimIds
    : [];
  if (!object(provenance) || !sha256(provenance.sceneFingerprint) ||
    !uniqueText(provenance.sourcePackSourceIds, 1000) ||
    !uniqueText(provenance.sourceClaimIds, 5000) ||
    !sameTextSet(provenance.sourcePackSourceIds, expectedSourceIds) ||
    !sameTextSet(provenance.sourceClaimIds, expectedClaimIds))
    throw Error("Building presentation provenance does not match immutable release source evidence.");

  return structuredClone(value);
}
