import type {
  BuildingBoundsV1,
  BuildingCameraKindV1,
  BuildingCameraShotV1,
  BuildingPresentationManifestV1,
  CanonicalModelManifestV1,
} from "@rekixo/3d-contracts";
import {
  DEFAULT_SCENE_APPEARANCE,
  type Scene,
} from "./domain";
import type { CirculationHierarchyReport } from "./circulationHierarchy";
import type { UnitHierarchyReport } from "./unitHierarchy";

export interface BuildingPresentationPlannerInput {
  canonicalModel: CanonicalModelManifestV1;
  bounds: BuildingBoundsV1;
  scene: Scene;
  sceneFingerprint: string;
  circulationHierarchy: CirculationHierarchyReport;
  unitHierarchy: UnitHierarchyReport;
  sourcePackSourceIds: readonly string[];
  sourceClaimIds: readonly string[];
}

function finite(value: number) {
  return Number.isFinite(value);
}

function dimensions(bounds: BuildingBoundsV1) {
  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const depth = bounds.max.z - bounds.min.z;
  if (
    !finite(width) ||
    !finite(height) ||
    !finite(depth) ||
    width < 0.01 ||
    height < 0.01 ||
    depth < 0.01 ||
    Math.max(width, height, depth) > 2000
  )
    throw Error("Building presentation requires plausible canonical metre bounds.");
  return { width, height, depth };
}

function center(bounds: BuildingBoundsV1) {
  return {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  };
}

function rotateY(x: number, z: number, radians: number) {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

function cameraShot(
  kind: BuildingCameraKindV1,
  bounds: BuildingBoundsV1,
  orientation: number,
): BuildingCameraShotV1 {
  const size = dimensions(bounds);
  const target = center(bounds);
  target.y = bounds.min.y + size.height * (kind === "entrance" ? 0.24 : 0.46);

  const radius = Math.max(
    1,
    Math.hypot(size.width, size.height, size.depth) / 2,
  );
  const directions: Record<BuildingCameraKindV1, [number, number, number]> = {
    hero: [1, 0.12, 1],
    front: [0, 0.04, 1],
    corner: [1, 0.08, 0.72],
    entrance: [0, -0.02, 1],
    aerial: [0.72, 0.95, 0.72],
  };
  const [rawX, rawY, rawZ] = directions[kind];
  const horizontal = rotateY(rawX, rawZ, orientation);
  const length = Math.hypot(horizontal.x, rawY, horizontal.z) || 1;
  const x = horizontal.x / length;
  const y = rawY / length;
  const z = horizontal.z / length;
  const fov = kind === "entrance" ? 46 : 42;
  const distanceMultiplier =
    kind === "entrance" ? 2.35 : kind === "aerial" ? 3.9 : 3.55;
  const distance = radius * distanceMultiplier;

  return {
    id: kind,
    kind,
    position: {
      x: target.x + x * distance,
      y: target.y + y * distance,
      z: target.z + z * distance,
    },
    target,
    fov,
  };
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}

function visualMood(scene: Scene): BuildingPresentationManifestV1["appearance"]["mood"] {
  const evidence = scene.referenceImageEvidenceSet?.length
    ? scene.referenceImageEvidenceSet
    : scene.referenceImageEvidence
      ? [scene.referenceImageEvidence]
      : [];
  if (!evidence.length) return "day";
  const strongest = [...evidence].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];
  return strongest.lightingMood === "day" ||
    strongest.lightingMood === "evening" ||
    strongest.lightingMood === "night"
    ? strongest.lightingMood
    : "source-reference";
}

function sourceBackedEnvironment(scene: Scene) {
  return (scene.siteElements ?? []).some(
    (element) => element.origin === "cad-auto" || element.origin === "model-cad-auto",
  );
}

function materialOverrides(scene: Scene): BuildingPresentationManifestV1["materials"]["overrides"] {
  return [...(scene.materialOverrides ?? [])]
    .sort((left, right) => left.materialName.localeCompare(right.materialName))
    .map((override) => ({
      materialName: override.materialName,
      ...(override.baseColor ? { baseColor: override.baseColor } : {}),
      ...(override.roughness !== undefined
        ? { roughness: override.roughness }
        : {}),
      ...(override.metalness !== undefined
        ? { metalness: override.metalness }
        : {}),
      ...(override.opacity !== undefined ? { opacity: override.opacity } : {}),
      ...(override.emissive ? { emissive: override.emissive } : {}),
      ...(override.emissiveIntensity !== undefined
        ? { emissiveIntensity: override.emissiveIntensity }
        : {}),
      source: "operator" as const,
    }));
}

function assertCanonicalMetricIdentity(
  canonicalModel: CanonicalModelManifestV1,
  bounds: BuildingBoundsV1,
) {
  if (
    canonicalModel.model.coordinateSystem.units !== "metre" ||
    canonicalModel.model.coordinateSystem.upAxis !== "+Y" ||
    canonicalModel.model.coordinateSystem.handedness !== "right"
  )
    throw Error("Building presentation requires canonical metre/+Y/right-handed model truth.");

  const size = dimensions(bounds);
  const declared = canonicalModel.model.validation.canonicalDimensionsM;
  if (declared?.length === 3) {
    const actual = [size.width, size.height, size.depth];
    for (let index = 0; index < 3; index += 1) {
      const expected = declared[index];
      if (!finite(expected) || expected <= 0) continue;
      const error = Math.abs(actual[index] - expected) / Math.max(expected, 0.01);
      if (error > 0.035)
        throw Error("Building presentation bounds drift from canonical model dimensions.");
    }
  }
}

/**
 * Produces a deterministic presentation manifest from canonical metric truth and
 * already-derived scene evidence. It never edits geometry, unit membership,
 * materials in the source model, or review state.
 */
export function buildBuildingPresentationManifestV1(
  input: BuildingPresentationPlannerInput,
): BuildingPresentationManifestV1 {
  assertCanonicalMetricIdentity(input.canonicalModel, input.bounds);
  if (!/^[a-f0-9]{64}$/.test(input.sceneFingerprint))
    throw Error("Building presentation requires a normalized scene fingerprint.");

  const appearance = input.scene.appearance ?? DEFAULT_SCENE_APPEARANCE;
  const sourceEnvironment = sourceBackedEnvironment(input.scene);
  const orientation = input.scene.modelTransform?.rotationY ?? 0;
  if (!finite(orientation)) throw Error("Building presentation model orientation is invalid.");

  const shotKinds: BuildingCameraKindV1[] = [
    "hero",
    "front",
    "corner",
    "entrance",
    "aerial",
  ];
  const shots = shotKinds.map((kind) =>
    cameraShot(kind, input.bounds, orientation),
  );

  return {
    format: "rekixo-building-presentation",
    version: 1,
    model: {
      canonicalSha256: input.canonicalModel.model.sha256,
      metresPerUnit: 1,
      bounds: structuredClone(input.bounds),
    },
    hierarchy: {
      floorCount: input.scene.floors.length,
      unitCount: input.unitHierarchy.counts.sourceBackedUnits,
      circulationCoreCount: input.circulationHierarchy.counts.boundCores,
    },
    appearance: {
      mood: visualMood(input.scene),
      exposure: appearance.exposure,
      sunIntensity: appearance.sunIntensity,
      hemisphereIntensity: appearance.hemisphereIntensity,
      background: appearance.background,
      referenceVisual: appearance.referenceVisual,
    },
    materials: {
      mode: "source-preserving",
      overrides: materialOverrides(input.scene),
    },
    environment: sourceEnvironment
      ? {
          mode: "source-backed",
          sourceBacked: true,
          genericDressing: false,
        }
      : {
          mode: "presentation-default",
          sourceBacked: false,
          genericDressing: true,
        },
    cameras: {
      defaultShotId: "hero",
      shots,
    },
    tour: {
      enabled: true,
      steps: [
        { shotId: "hero", durationMs: 2600, holdMs: 900 },
        { shotId: "front", durationMs: 2200, holdMs: 700 },
        { shotId: "corner", durationMs: 2200, holdMs: 700 },
        { shotId: "entrance", durationMs: 2000, holdMs: 700 },
        { shotId: "aerial", durationMs: 2600, holdMs: 1000 },
      ],
    },
    interactions: {
      orbit: true,
      floorExplorer: input.scene.floors.length > 1,
      walkthrough:
        input.scene.rooms.length > 0 &&
        (input.scene.openings ?? []).some(
          (opening) =>
            opening.kind === "door" &&
            opening.reviewed === true &&
            opening.roomIds.length === 2,
        ),
    },
    provenance: {
      sceneFingerprint: input.sceneFingerprint,
      sourcePackSourceIds: unique(input.sourcePackSourceIds),
      sourceClaimIds: unique(input.sourceClaimIds),
    },
  };
}
