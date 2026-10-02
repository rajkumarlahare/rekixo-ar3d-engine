import * as THREE from "three";
import { applyJyotiReferenceExterior } from "./referenceExterior";
import {
  JYOTI_SOURCE_FLOOR_LEVELS_M,
  JYOTI_SOURCE_MODEL_SHA256,
} from "./referenceSourceRuntime";

export interface ModelProfileFloorGeometryLevel {
  floor: number;
  elevationM: number;
  topElevationM: number;
  source: "profile";
}

type ExteriorRuntime = NonNullable<
  ReturnType<typeof applyJyotiReferenceExterior>
>;

export interface ModelProfileRuntime {
  id: string;
  exterior?: ExteriorRuntime;
  cameraBounds?: THREE.Box3;
  floorGeometry?: ModelProfileFloorGeometryLevel[];
  defaultInteriorRoomId?: string;
}

function floorGeometryFromBoundaries(
  floors: readonly number[],
  boundaries: readonly number[],
): ModelProfileFloorGeometryLevel[] {
  if (
    floors.length === 0 ||
    boundaries.length !== floors.length + 1 ||
    boundaries.some((value) => !Number.isFinite(value))
  )
    return [];

  for (let index = 1; index < boundaries.length; index += 1)
    if (!(boundaries[index] > boundaries[index - 1])) return [];

  return floors.map((floor, index) => ({
    floor,
    elevationM: boundaries[index],
    topElevationM: boundaries[index + 1],
    source: "profile",
  }));
}

export function applyModelProfileExterior(
  object: THREE.Object3D,
  enabled = true,
): ModelProfileRuntime | undefined {
  let matched = false;
  object.traverse((node) => {
    if (node.userData.sourceGeometry?.sha256 === JYOTI_SOURCE_MODEL_SHA256)
      matched = true;
  });
  if (!matched) return undefined;

  const exterior = enabled ? applyJyotiReferenceExterior(object) : undefined;
  const floorLevels = exterior?.floorLevels ?? JYOTI_SOURCE_FLOOR_LEVELS_M;

  return {
    id: "reference-source-v9",
    exterior,
    cameraBounds: new THREE.Box3(
      new THREE.Vector3(5.62, 0, -23.82),
      new THREE.Vector3(22.52, 20.86, -2.73),
    ),
    floorGeometry: floorGeometryFromBoundaries(
      floorLevels.slice(0, -1).map((_, index) => index),
      floorLevels,
    ),
    defaultInteriorRoomId: "101-living",
  };
}

export async function loadModelProfileMaterialEnhancer(
  profile: ModelProfileRuntime | undefined,
) {
  if (profile?.id !== "reference-source-v9") return undefined;
  const { enhanceReferenceSourceV9Model } = await import("./referenceMaterials");
  return enhanceReferenceSourceV9Model;
}

export {
  JYOTI_SOURCE_FLOOR_LEVELS_M,
  JYOTI_SOURCE_MODEL_SHA256,
} from "./referenceSourceRuntime";
