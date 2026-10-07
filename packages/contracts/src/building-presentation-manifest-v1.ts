export type BuildingPresentationMoodV1 =
  | "source-reference"
  | "day"
  | "evening"
  | "night";

export type BuildingCameraKindV1 =
  | "hero"
  | "front"
  | "corner"
  | "entrance"
  | "aerial";

export type BuildingEnvironmentModeV1 =
  | "source-backed"
  | "presentation-default"
  | "minimal";

export interface BuildingVec3V1 {
  x: number;
  y: number;
  z: number;
}

export interface BuildingBoundsV1 {
  min: BuildingVec3V1;
  max: BuildingVec3V1;
}

export interface BuildingMaterialOverrideV1 {
  materialName: string;
  baseColor?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  source: "source-recovered" | "reference-reviewed" | "operator";
}

export interface BuildingCameraShotV1 {
  id: string;
  kind: BuildingCameraKindV1;
  position: BuildingVec3V1;
  target: BuildingVec3V1;
  fov: number;
}

export interface BuildingTourStepV1 {
  shotId: string;
  durationMs: number;
  holdMs: number;
}

export interface BuildingPresentationManifestV1 {
  format: "rekixo-building-presentation";
  version: 1;
  model: {
    canonicalSha256: string;
    metresPerUnit: 1;
    bounds: BuildingBoundsV1;
  };
  hierarchy: {
    floorCount: number;
    unitCount: number;
    circulationCoreCount: number;
  };
  appearance: {
    mood: BuildingPresentationMoodV1;
    exposure: number;
    sunIntensity: number;
    hemisphereIntensity: number;
    background: string;
    referenceVisual: boolean;
  };
  materials: {
    mode: "source-preserving";
    overrides: BuildingMaterialOverrideV1[];
  };
  environment: {
    mode: BuildingEnvironmentModeV1;
    sourceBacked: boolean;
    genericDressing: boolean;
  };
  cameras: {
    defaultShotId: string;
    shots: BuildingCameraShotV1[];
  };
  tour: {
    enabled: boolean;
    steps: BuildingTourStepV1[];
  };
  interactions: {
    orbit: boolean;
    floorExplorer: boolean;
    walkthrough: boolean;
  };
  provenance: {
    sceneFingerprint: string;
    sourcePackSourceIds: string[];
    sourceClaimIds: string[];
  };
}

const text = (value: unknown, max = 300) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const id = (value: unknown) =>
  text(value, 120) && /^[A-Za-z0-9_-]+$/.test(value as string);
const sha256 = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const finite = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const color = (value: unknown) =>
  typeof value === "string" && /^#[a-fA-F0-9]{6}$/.test(value);
const uniqueText = (value: unknown, maxItems: number) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((entry) => text(entry, 240)) &&
  new Set(value).size === value.length;

function assertVec3(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`Invalid ${label}.`);
  const row = value as Record<string, unknown>;
  if (
    !finite(row.x, -100000, 100000) ||
    !finite(row.y, -100000, 100000) ||
    !finite(row.z, -100000, 100000)
  )
    throw Error(`Invalid ${label}.`);
}

function assertBounds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Building bounds.");
  const bounds = value as Record<string, any>;
  assertVec3(bounds.min, "Building bounds min");
  assertVec3(bounds.max, "Building bounds max");
  const dx = bounds.max.x - bounds.min.x;
  const dy = bounds.max.y - bounds.min.y;
  const dz = bounds.max.z - bounds.min.z;
  if (
    !finite(dx, 0.01, 2000) ||
    !finite(dy, 0.01, 2000) ||
    !finite(dz, 0.01, 2000)
  )
    throw Error("Building bounds must be positive canonical metres.");
}

function assertMaterialOverride(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Building material override.");
  const row = value as Record<string, unknown>;
  if (
    !text(row.materialName, 300) ||
    !["source-recovered", "reference-reviewed", "operator"].includes(
      row.source as string,
    ) ||
    (row.baseColor !== undefined && !color(row.baseColor)) ||
    (row.roughness !== undefined && !finite(row.roughness, 0, 1)) ||
    (row.metalness !== undefined && !finite(row.metalness, 0, 1)) ||
    (row.opacity !== undefined && !finite(row.opacity, 0, 1)) ||
    (row.emissive !== undefined && !color(row.emissive)) ||
    (row.emissiveIntensity !== undefined &&
      !finite(row.emissiveIntensity, 0, 20))
  )
    throw Error("Invalid Building material override.");
}

export function assertBuildingPresentationManifestV1(
  value: unknown,
): asserts value is BuildingPresentationManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Building presentation manifest.");
  const manifest = value as Record<string, any>;
  if (
    manifest.format !== "rekixo-building-presentation" ||
    manifest.version !== 1
  )
    throw Error("Unsupported Building presentation manifest.");

  if (
    !manifest.model ||
    !sha256(manifest.model.canonicalSha256) ||
    manifest.model.metresPerUnit !== 1
  )
    throw Error("Building presentation is not pinned to canonical metric model truth.");
  assertBounds(manifest.model.bounds);

  const hierarchy = manifest.hierarchy;
  if (
    !hierarchy ||
    !Number.isInteger(hierarchy.floorCount) ||
    hierarchy.floorCount < 0 ||
    hierarchy.floorCount > 500 ||
    !Number.isInteger(hierarchy.unitCount) ||
    hierarchy.unitCount < 0 ||
    hierarchy.unitCount > 10000 ||
    !Number.isInteger(hierarchy.circulationCoreCount) ||
    hierarchy.circulationCoreCount < 0 ||
    hierarchy.circulationCoreCount > 2000
  )
    throw Error("Invalid Building hierarchy summary.");

  const appearance = manifest.appearance;
  if (
    !appearance ||
    !["source-reference", "day", "evening", "night"].includes(
      appearance.mood,
    ) ||
    !finite(appearance.exposure, 0.1, 5) ||
    !finite(appearance.sunIntensity, 0, 20) ||
    !finite(appearance.hemisphereIntensity, 0, 20) ||
    !color(appearance.background) ||
    typeof appearance.referenceVisual !== "boolean"
  )
    throw Error("Invalid Building appearance.");

  const materials = manifest.materials;
  if (
    !materials ||
    materials.mode !== "source-preserving" ||
    !Array.isArray(materials.overrides) ||
    materials.overrides.length > 1000
  )
    throw Error("Invalid Building materials.");
  const materialNames = new Set<string>();
  for (const override of materials.overrides) {
    assertMaterialOverride(override);
    if (materialNames.has(override.materialName))
      throw Error("Duplicate Building material override.");
    materialNames.add(override.materialName);
  }

  const environment = manifest.environment;
  if (
    !environment ||
    !["source-backed", "presentation-default", "minimal"].includes(
      environment.mode,
    ) ||
    typeof environment.sourceBacked !== "boolean" ||
    typeof environment.genericDressing !== "boolean" ||
    (environment.sourceBacked && environment.mode !== "source-backed") ||
    (environment.mode === "source-backed" && !environment.sourceBacked)
  )
    throw Error("Invalid Building environment policy.");

  const cameras = manifest.cameras;
  if (
    !cameras ||
    !id(cameras.defaultShotId) ||
    !Array.isArray(cameras.shots) ||
    cameras.shots.length < 1 ||
    cameras.shots.length > 20
  )
    throw Error("Invalid Building cameras.");
  const shotIds = new Set<string>();
  for (const shot of cameras.shots) {
    if (
      !shot ||
      !id(shot.id) ||
      !["hero", "front", "corner", "entrance", "aerial"].includes(shot.kind) ||
      !finite(shot.fov, 15, 90)
    )
      throw Error("Invalid Building camera shot.");
    assertVec3(shot.position, "Building camera position");
    assertVec3(shot.target, "Building camera target");
    if (shotIds.has(shot.id)) throw Error("Duplicate Building camera shot.");
    shotIds.add(shot.id);
  }
  if (!shotIds.has(cameras.defaultShotId))
    throw Error("Building default camera shot is missing.");

  const tour = manifest.tour;
  if (
    !tour ||
    typeof tour.enabled !== "boolean" ||
    !Array.isArray(tour.steps) ||
    tour.steps.length > 50
  )
    throw Error("Invalid Building tour.");
  for (const step of tour.steps) {
    if (
      !step ||
      !id(step.shotId) ||
      !shotIds.has(step.shotId) ||
      !Number.isInteger(step.durationMs) ||
      step.durationMs < 250 ||
      step.durationMs > 30000 ||
      !Number.isInteger(step.holdMs) ||
      step.holdMs < 0 ||
      step.holdMs > 30000
    )
      throw Error("Invalid Building tour step.");
  }
  if (tour.enabled && tour.steps.length === 0)
    throw Error("Enabled Building tour requires at least one step.");

  const interactions = manifest.interactions;
  if (
    !interactions ||
    typeof interactions.orbit !== "boolean" ||
    typeof interactions.floorExplorer !== "boolean" ||
    typeof interactions.walkthrough !== "boolean"
  )
    throw Error("Invalid Building interactions.");

  const provenance = manifest.provenance;
  if (
    !provenance ||
    !sha256(provenance.sceneFingerprint) ||
    !uniqueText(provenance.sourcePackSourceIds, 1000) ||
    !uniqueText(provenance.sourceClaimIds, 5000)
  )
    throw Error("Invalid Building presentation provenance.");
}
