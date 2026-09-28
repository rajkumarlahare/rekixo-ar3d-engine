import * as THREE from "three";
import {
  applyModelProfileExterior,
  type ModelProfileRuntime,
} from "./modelProfiles";
import {
  createProjectExperience,
  type ExperienceFeature,
  type ExperienceMode,
} from "./projectExperience";

export { applyModelProfileExterior };
export type { ExperienceFeature, ExperienceMode, ModelProfileRuntime };

type ExperienceRuntime = ReturnType<typeof createProjectExperience>;

export interface ModelProfileContext {
  mobile: boolean;
  referenceVisual: boolean;
  preserveSourceSite: boolean;
}

/**
 * Authored project experiences are resolved behind the model-profile boundary.
 * A generic model cannot receive another project's rooms or furniture because
 * there is no experience factory without a positive source-profile match.
 */
export function createProfileExperience(
  profile: ModelProfileRuntime | undefined,
  bounds: THREE.Box3,
  context: ModelProfileContext,
): ExperienceRuntime | undefined {
  if (profile?.id !== "reference-source-v9") return undefined;
  return createProjectExperience(
    bounds,
    context.mobile,
    context.referenceVisual,
    context.preserveSourceSite,
  );
}
