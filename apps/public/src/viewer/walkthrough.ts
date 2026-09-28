import * as THREE from "three";
import {
  floorEyeElevation,
  floorGeometryFor,
  resolveFloorGeometry,
  type FloorGeometryLevel,
} from "./floorGeometry";

export type WalkDirection = "forward" | "back" | "left" | "right";

function fallbackFloorGeometry(bounds: THREE.Box3, floor: number | null) {
  return resolveFloorGeometry({
    floorIds: [floor ?? 0],
    minY: bounds.min.y,
    maxY: bounds.max.y,
  });
}

export function floorEyeY(
  bounds: THREE.Box3,
  floor: number | null,
  geometry?: readonly FloorGeometryLevel[],
) {
  const levels =
    geometry?.length ? geometry : fallbackFloorGeometry(bounds, floor);
  const targetFloor =
    floor === null ? levels[0]?.floor : floor;
  const level =
    targetFloor === undefined ? undefined : floorGeometryFor(levels, targetFloor);

  return level
    ? floorEyeElevation(level)
    : bounds.min.y + Math.min(1.65, Math.max(bounds.max.y - bounds.min.y, 1) * 0.06);
}

export function clampWalkPosition(position: THREE.Vector3, bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3());
  const marginX = Math.max(size.x * 0.025, 0.25);
  const marginZ = Math.max(size.z * 0.025, 0.25);

  position.x = THREE.MathUtils.clamp(
    position.x,
    bounds.min.x - marginX,
    bounds.max.x + marginX,
  );
  position.z = THREE.MathUtils.clamp(
    position.z,
    bounds.min.z - marginZ,
    bounds.max.z + marginZ,
  );
  return position;
}

export function walkStartPosition(
  bounds: THREE.Box3,
  floor: number | null,
  geometry?: readonly FloorGeometryLevel[],
) {
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  return clampWalkPosition(
    new THREE.Vector3(
      center.x,
      floorEyeY(bounds, floor, geometry),
      center.z + Math.max(size.z * 0.28, 1.5),
    ),
    bounds,
  );
}

/**
 * Navigation geometry is resolved separately from visual rendering. Projects
 * can opt meshes into/out of collision with userData.walkCollision. If a model
 * has no explicit collider tags, visible meshes remain a compatibility fallback.
 */
export function collectWalkColliders(root: THREE.Object3D | undefined) {
  if (!root) return [] as THREE.Object3D[];

  const explicit: THREE.Object3D[] = [];
  const fallback: THREE.Object3D[] = [];
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.walkCollision === false) return;
    fallback.push(object);
    if (object.userData.walkCollision === true) explicit.push(object);
  });
  return explicit.length ? explicit : fallback;
}

export function walkDelta(
  yaw: number,
  direction: WalkDirection,
  distance: number,
) {
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  if (direction === "forward") return forward.multiplyScalar(distance);
  if (direction === "back") return forward.multiplyScalar(-distance);
  if (direction === "left") return right.multiplyScalar(-distance);
  return right.multiplyScalar(distance);
}
