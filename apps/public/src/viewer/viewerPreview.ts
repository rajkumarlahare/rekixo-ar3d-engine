import * as THREE from "three";

/**
 * Launch Phase 1 fail-closed placeholder.
 *
 * The approved FBX/GLB is the customer-facing visual source of truth. If that
 * asset is missing or cannot be loaded, the viewer may still mount an empty
 * group so its controls/error UI remain stable, but it must not invent a fake
 * building that could be mistaken for customer geometry.
 */
export function createPreviewBuilding() {
  const group = new THREE.Group();
  group.name = "Rekixo AR3D source model unavailable";
  group.userData.sourceModelUnavailable = true;
  return group;
}
