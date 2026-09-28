import * as THREE from "three";
import { applyJyotiReferenceExterior } from "./jyotiReferenceExterior";
import {
  createProjectExperience,
  type ExperienceFeature,
  type ExperienceMode,
} from "./projectExperience";

export type { ExperienceFeature, ExperienceMode };

type ExteriorRuntime = NonNullable<
  ReturnType<typeof applyJyotiReferenceExterior>
>;
type ExperienceRuntime = ReturnType<typeof createProjectExperience>;

export interface ModelProfileRuntime {
  id: string;
  exterior?: ExteriorRuntime;
  cameraBounds?: THREE.Box3;
  defaultInteriorRoomId?: string;
}

export interface ModelProfileContext {
  mobile: boolean;
  referenceVisual: boolean;
  preserveSourceSite: boolean;
}

/**
 * The generic viewer calls this registry instead of importing a customer profile
 * directly. A profile must positively identify its source model before mutating
 * materials, cameras, or geometry.
 */
export function applyModelProfileExterior(
  object: THREE.Object3D,
  enabled = true,
): ModelProfileRuntime | undefined {
  if (!enabled) return undefined;

  const exterior = applyJyotiReferenceExterior(object);
  if (!exterior) return undefined;

  return {
    id: "reference-source-v9",
    exterior,
    // Source-measured building envelope. Keeping it inside the profile prevents
    // unrelated models from inheriting a project-specific hero camera.
    cameraBounds: new THREE.Box3(
      new THREE.Vector3(5.62, 0, -23.82),
      new THREE.Vector3(22.52, 20.86, -2.73),
    ),
    defaultInteriorRoomId: "101-living",
  };
}

/**
 * Project-specific authored experiences are created only after a model profile
 * has positively matched. Generic projects therefore never receive another
 * project's reconstructed rooms, furniture, or navigation assumptions.
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
