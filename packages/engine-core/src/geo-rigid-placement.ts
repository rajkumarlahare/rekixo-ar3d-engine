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

export type GeoRigidPlacementPlan = {
  positionM: GeoLocalPosition;
  rotationRad: GeoLocalPosition;
  scale: number;
  yUpToEnuRotationXRad: number;
  anchorOffsetM: GeoLocalPosition;
};

function finite(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function radians(value: number, label: string) {
  return finite(value, label) * Math.PI / 180;
}

/**
 * Canonical rigid Building placement shared by Admin Geo authoring and Public
 * Geo runtime. The returned plan contains only rigid translation/rotation plus
 * one uniform scale: no shear, homography or non-uniform scaling can enter the
 * Building transform through this helper.
 *
 * The Google local WebGL frame is treated as X=east, Y=north, Z=up. Rekixo
 * canonical Buildings are +Y-up, so the fixed +90deg X rotation converts the
 * Building frame into ENU. Heading is clockwise from north, therefore it is a
 * negative Z rotation in this right-handed ENU frame.
 */
export function buildGeoRigidPlacementPlan(
  anchor: GeoLocalPosition,
  placement: GeoRigidPlacement,
): GeoRigidPlacementPlan {
  const scale = finite(placement.scale, "Geo scale");
  if (scale <= 0) throw new Error("Geo scale must be positive.");

  return {
    positionM: {
      x: finite(placement.eastOffsetM, "Geo east offset"),
      y: finite(placement.northOffsetM, "Geo north offset"),
      z: finite(placement.verticalOffsetM, "Geo vertical offset"),
    },
    rotationRad: {
      x: radians(placement.pitchDeg, "Geo pitch"),
      y: radians(placement.rollDeg, "Geo roll"),
      z: -radians(placement.headingDeg, "Geo heading"),
    },
    scale,
    yUpToEnuRotationXRad: Math.PI / 2,
    anchorOffsetM: {
      x: -finite(anchor.x, "Model anchor X"),
      y: -finite(anchor.y, "Model anchor Y"),
      z: -finite(anchor.z, "Model anchor Z"),
    },
  };
}

export function enuDistanceFromPlacement(placement: GeoRigidPlacement) {
  return Math.hypot(
    finite(placement.eastOffsetM, "Geo east offset"),
    finite(placement.northOffsetM, "Geo north offset"),
    finite(placement.verticalOffsetM, "Geo vertical offset"),
  );
}
