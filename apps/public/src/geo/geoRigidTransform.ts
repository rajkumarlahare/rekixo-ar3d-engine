import {
  buildGeoRigidPlacementPlan,
  type GeoLocalPosition,
  type GeoRigidPlacement,
} from "@rekixo/3d-engine-core";
import * as THREE from "three";

export type { GeoLocalPosition, GeoRigidPlacement } from "@rekixo/3d-engine-core";
export { enuDistanceFromPlacement } from "@rekixo/3d-engine-core";

/**
 * Apply the shared Rekixo rigid placement plan to a canonical +Y-up Building
 * inside Google's local WebGL frame. The numeric transform is owned by
 * @rekixo/3d-engine-core so Admin authoring and Public runtime cannot drift.
 */
export function applyRigidBuildingPlacement(
  container: THREE.Object3D,
  model: THREE.Object3D,
  anchor: GeoLocalPosition,
  placement: GeoRigidPlacement,
) {
  const plan = buildGeoRigidPlacementPlan(anchor, placement);

  container.position.set(plan.positionM.x, plan.positionM.y, plan.positionM.z);
  container.rotation.order = "ZYX";
  container.rotation.set(
    plan.rotationRad.x,
    plan.rotationRad.y,
    plan.rotationRad.z,
  );
  container.scale.setScalar(plan.scale);

  const yUpToEnu = new THREE.Group();
  yUpToEnu.name = "rekixo-y-up-to-enu";
  yUpToEnu.rotation.x = plan.yUpToEnuRotationXRad;

  const anchorOffset = new THREE.Group();
  anchorOffset.name = "rekixo-building-anchor-offset";
  anchorOffset.position.set(
    plan.anchorOffsetM.x,
    plan.anchorOffsetM.y,
    plan.anchorOffsetM.z,
  );
  anchorOffset.add(model);
  yUpToEnu.add(anchorOffset);
  container.add(yUpToEnu);

  return { yUpToEnu, anchorOffset };
}
