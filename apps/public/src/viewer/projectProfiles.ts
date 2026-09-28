import * as THREE from "three";
import {
  applyModelProfileExterior,
  loadModelProfileMaterialEnhancer,
  type ModelProfileRuntime,
} from "./modelProfiles";
import type { ExperienceFeature, ExperienceMode } from "./experienceTypes";

export { applyModelProfileExterior, loadModelProfileMaterialEnhancer };
export type { ExperienceFeature, ExperienceMode, ModelProfileRuntime };

type ExperienceFactory =
  (typeof import("./projectExperience"))["createJyotiProjectExperience"];
export type ExperienceRuntime = ReturnType<ExperienceFactory>;

export interface ModelProfileContext {
  mobile: boolean;
  referenceVisual: boolean;
  preserveSourceSite: boolean;
}

/**
 * Authored project experiences are lazy-loaded only after a positive model
 * profile match. Generic projects therefore do not download another tenant's
 * rooms, furniture or source texture bundle.
 */
export async function loadProfileExperience(
  profile: ModelProfileRuntime | undefined,
  bounds: THREE.Box3,
  context: ModelProfileContext,
): Promise<ExperienceRuntime | undefined> {
  if (profile?.id !== "reference-source-v9") return undefined;

  const { createJyotiProjectExperience } = await import("./projectExperience");
  return createJyotiProjectExperience(
    bounds,
    context.mobile,
    context.referenceVisual,
    context.preserveSourceSite,
  );
}
