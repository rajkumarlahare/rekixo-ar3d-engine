import * as THREE from "three";

export interface ModelProfileFloorGeometryLevel {
  floor: number;
  elevationM: number;
  topElevationM: number;
  source: "profile";
}

export interface ModelProfileExteriorRuntime {
  daylightSky: THREE.Texture;
  eveningSky: THREE.Texture;
  setNight(night: boolean): void;
  dispose(): void;
}

export type ModelProfileMaterialEnhancer = (
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  referenceVisual?: boolean,
) => boolean | void;

export interface ModelProfileRuntime {
  id: string;
  exterior?: ModelProfileExteriorRuntime;
  cameraBounds?: THREE.Box3;
  floorGeometry?: ModelProfileFloorGeometryLevel[];
  defaultInteriorRoomId?: string;
}

/**
 * Clean generic registry. Project-specific profiles are created only from
 * newly ingested/reviewed project sources, never from repository hardcoding.
 */
export function applyModelProfileExterior(
  _object: THREE.Object3D,
  _enabled = true,
): ModelProfileRuntime | undefined {
  return undefined;
}

export async function loadModelProfileMaterialEnhancer(
  _profile: ModelProfileRuntime | undefined,
): Promise<ModelProfileMaterialEnhancer | undefined> {
  return undefined;
}
