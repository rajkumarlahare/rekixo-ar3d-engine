import * as THREE from "three";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  type ModelProfileRuntime,
} from "./modelProfiles";
import type { ExperienceFeature, ExperienceMode } from "./experienceTypes";

export { applyModelProfileExterior, loadModelProfileMaterialEnhancer };
export type { ExperienceFeature, ExperienceMode, ModelProfileRuntime };

export interface ExperienceRuntime {
  root: THREE.Object3D;
  rooms: ExperienceFeature[];
  features: ExperienceFeature[];
  roomEntry(id: string):
    | { point: THREE.Vector3; bounds: THREE.Box3; scale: number }
    | undefined;
  setWalk(enabled: boolean): void;
  setMode(mode: ExperienceMode): void;
  setNight(night: boolean): void;
  focus(mode: ExperienceMode): { box: THREE.Box3; target: THREE.Vector3 };
  dispose(): void;
}

export interface ModelProfileContext {
  mobile: boolean;
  referenceVisual: boolean;
  preserveSourceSite: boolean;
}

/**
 * Clean generic registry: there are no repository-baked project experiences.
 * Future project experiences must come from newly ingested/reviewed project data.
 */
export async function loadProfileExperience(
  _profile: ModelProfileRuntime | undefined,
  _bounds: THREE.Box3,
  _context: ModelProfileContext,
): Promise<ExperienceRuntime | undefined> {
  return undefined;
}
