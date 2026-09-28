import * as THREE from "three";
import { applyJyotiReferenceExterior } from "./jyotiReferenceExterior";

type ExteriorRuntime = NonNullable<
  ReturnType<typeof applyJyotiReferenceExterior>
>;

export interface ModelProfileRuntime {
  id: string;
  exterior?: ExteriorRuntime;
  cameraBounds?: THREE.Box3;
  defaultInteriorRoomId?: string;
}

/**
 * Exterior-only registry shared by Viewer and Studio. Keep authored interiors
 * out of this module so the Admin building preview does not pull project
 * experience code or furniture textures into its bundle.
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
    cameraBounds: new THREE.Box3(
      new THREE.Vector3(5.62, 0, -23.82),
      new THREE.Vector3(22.52, 20.86, -2.73),
    ),
    defaultInteriorRoomId: "101-living",
  };
}


/**
 * Resolve source/project-specific material restoration only after a verified
 * profile match. The dynamic import keeps source textures out of unrelated
 * project bundles.
 */
export async function loadModelProfileMaterialEnhancer(
  profile: ModelProfileRuntime | undefined,
) {
  if (profile?.id !== "reference-source-v9") return undefined;

  const { enhanceReferenceSourceV9Model } =
    await import("./referenceSourceV9Materials");
  return enhanceReferenceSourceV9Model;
}
