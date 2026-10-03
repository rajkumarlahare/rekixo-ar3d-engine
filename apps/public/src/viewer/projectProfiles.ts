import * as THREE from "three";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  type ModelProfileRuntime,
} from "./modelProfiles";
import type { ExperienceFeature, ExperienceMode } from "./experienceTypes";
import { createSemanticStudioExperience } from "./semanticStudioExperience";

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
 * Generic data-driven experience loader. Repository-baked project interiors are
 * not allowed here; reviewed immutable Studio geometry is the reusable source.
 */
export async function loadProfileExperience(
  _profile: ModelProfileRuntime | undefined,
  bounds: THREE.Box3,
  context: ModelProfileContext,
): Promise<ExperienceRuntime | undefined> {
  const semantic = createSemanticStudioExperience(bounds, context.mobile);
  if (semantic) semantic.replaceSourceModelInInterior = true;
  return semantic;
}
