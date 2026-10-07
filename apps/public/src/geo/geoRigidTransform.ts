import * as THREE from "three";

export type GeoLocalPosition = { x: number; y: number; z: number };

export type GeoRigidPlacement = {
  eastOffsetM: number;
  northOffsetM: number;
  verticalOffsetM: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  scale: number;
};

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

/**
 * Build one rigid transform for a canonical +Y Building inside Google's local
 * WebGL frame. No non-uniform scale, shear or homography is permitted here.
 *
 * Google WebGL overlay local axes are treated as X=east, Y=north, Z=up. The
 * canonical Building stays +Y-up, so conversion is a fixed +90deg X rotation:
 * model +Y -> geo +Z and model +Z -> geo -Y. Heading is clockwise from north,
 * hence the negative Z rotation in a right-handed ENU frame.
 */
export function applyRigidBuildingPlacement(
  container: THREE.Object3D,
  model: THREE.Object3D,
  anchor: GeoLocalPosition,
  placement: GeoRigidPlacement,
) {
  const scale = finite(placement.scale, "Geo scale");
  if (scale <= 0) throw new Error("Geo scale must be positive.");

  container.position.set(
    finite(placement.eastOffsetM, "Geo east offset"),
    finite(placement.northOffsetM, "Geo north offset"),
    finite(placement.verticalOffsetM, "Geo vertical offset"),
  );
  container.rotation.order = "ZYX";
  container.rotation.set(
    THREE.MathUtils.degToRad(finite(placement.pitchDeg, "Geo pitch")),
    THREE.MathUtils.degToRad(finite(placement.rollDeg, "Geo roll")),
    THREE.MathUtils.degToRad(-finite(placement.headingDeg, "Geo heading")),
  );
  container.scale.setScalar(scale);

  const yUpToEnu = new THREE.Group();
  yUpToEnu.name = "rekixo-y-up-to-enu";
  yUpToEnu.rotation.x = Math.PI / 2;

  const anchorOffset = new THREE.Group();
  anchorOffset.name = "rekixo-building-anchor-offset";
  anchorOffset.position.set(
    -finite(anchor.x, "Model anchor X"),
    -finite(anchor.y, "Model anchor Y"),
    -finite(anchor.z, "Model anchor Z"),
  );
  anchorOffset.add(model);
  yUpToEnu.add(anchorOffset);
  container.add(yUpToEnu);

  return { yUpToEnu, anchorOffset };
}

export function enuDistanceFromPlacement(placement: GeoRigidPlacement) {
  return Math.hypot(
    placement.eastOffsetM,
    placement.northOffsetM,
    placement.verticalOffsetM,
  );
}
