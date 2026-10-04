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
  /** Whether reviewed Studio geometry should replace the source model in interior mode. */
  replaceSourceModelInInterior?: boolean;
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
 * Demo Launch Phase 1 rule: the imported FBX/GLB is the public visual source of
 * truth. Do not replace it with reconstructed Studio geometry while the demo is
 * being prepared. Reviewed semantic interiors remain stored in the immutable
 * Studio release and can be re-enabled deliberately in the later walkthrough
 * phase after the source model presentation is locked.
 *
 * This keeps the public customer experience model-first: source geometry first,
 * verified metadata second, generated/reconstructed geometry only when an
 * explicit later phase enables it.
 */
export async function loadProfileExperience(
  _profile: ModelProfileRuntime | undefined,
  _bounds: THREE.Box3,
  _context: ModelProfileContext,
): Promise<ExperienceRuntime | undefined> {
  return undefined;
}
