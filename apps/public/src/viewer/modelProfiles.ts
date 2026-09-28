import * as THREE from "three";
import { applyJyotiReferenceExterior } from "./jyotiReferenceExterior";
import { enhanceReferenceSourceV9Model } from "./referenceSourceV9Materials";

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
 * Apply source/project-specific material restoration only when its verified
 * source profile matches. Generic models never inherit Reference Source V9
 * textures or tints by material-name coincidence.
 */
export function enhanceModelProfileMaterials(
  object: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  referenceVisual = false,
) {
  return enhanceReferenceSourceV9Model(object, renderer, referenceVisual);
}
