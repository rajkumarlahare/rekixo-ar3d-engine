import * as THREE from "three";
import type { PublicWalkthroughGraph, PublicWalkthroughRoom } from "@rekixo/3d-contracts";
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
    floor === null
      ? levels.find((item) => item.floor === 0)?.floor ?? levels[0]?.floor
      : floor;
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
const walkColliderBounds = new WeakMap<THREE.Object3D, THREE.Box3>();

export function collectWalkColliders(root: THREE.Object3D | undefined) {
  if (!root) return [] as THREE.Object3D[];

  root.updateMatrixWorld(true);
  const explicit: THREE.Object3D[] = [];
  const fallback: THREE.Object3D[] = [];
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.walkCollision === false) return;

    const bounds = new THREE.Box3().setFromObject(object);
    if (!bounds.isEmpty()) walkColliderBounds.set(object, bounds);

    fallback.push(object);
    if (object.userData.walkCollision === true) explicit.push(object);
  });
  return explicit.length ? explicit : fallback;
}

/**
 * Cheap broad phase before Three.js triangle raycasts. It keeps only colliders
 * whose world-space bounds overlap the swept walk segment plus player radius.
 * Missing/stale cache entries fail open by remaining candidates.
 */
export function walkRaycastCandidates(
  colliders: readonly THREE.Object3D[],
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  radius: number,
) {
  if (!colliders.length) return [] as THREE.Object3D[];

  const travel = Math.max(0, distance);
  const padding = Math.max(0, radius);
  const end = origin
    .clone()
    .addScaledVector(direction, travel);
  const swept = new THREE.Box3(
    new THREE.Vector3(
      Math.min(origin.x, end.x) - padding,
      Math.min(origin.y, end.y) - padding,
      Math.min(origin.z, end.z) - padding,
    ),
    new THREE.Vector3(
      Math.max(origin.x, end.x) + padding,
      Math.max(origin.y, end.y) + padding,
      Math.max(origin.z, end.z) + padding,
    ),
  );

  return colliders.filter((object) => {
    const bounds = walkColliderBounds.get(object);
    return !bounds || bounds.intersectsBox(swept);
  });
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


function pointSegmentDistance(
  x: number,
  z: number,
  left: readonly [number, number],
  right: readonly [number, number],
) {
  const dx = right[0] - left[0];
  const dz = right[1] - left[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? THREE.MathUtils.clamp(
          ((x - left[0]) * dx + (z - left[1]) * dz) / lengthSquared,
          0,
          1,
        )
      : 0;
  const px = left[0] + t * dx;
  const pz = left[1] + t * dz;
  return Math.hypot(x - px, z - pz);
}

export function publicRoomContains(
  room: PublicWalkthroughRoom,
  x: number,
  z: number,
  margin = 0,
) {
  const points = room.boundary;
  let inside = false;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const left = points[index];
    const right = points[previous];
    const crosses =
      (left[1] > z) !== (right[1] > z) &&
      x <
        ((right[0] - left[0]) * (z - left[1])) /
          (right[1] - left[1]) +
          left[0];
    if (crosses) inside = !inside;
  }
  if (!inside) return false;
  if (margin <= 0) return true;
  for (let index = 0; index < points.length; index += 1) {
    if (
      pointSegmentDistance(
        x,
        z,
        points[index],
        points[(index + 1) % points.length],
      ) < margin
    )
      return false;
  }
  return true;
}

function roomPointClearance(
  room: PublicWalkthroughRoom,
  x: number,
  z: number,
) {
  let clearance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < room.boundary.length; index += 1) {
    clearance = Math.min(
      clearance,
      pointSegmentDistance(
        x,
        z,
        room.boundary[index],
        room.boundary[(index + 1) % room.boundary.length],
      ),
    );
  }
  return clearance;
}

/**
 * Find a deterministic point inside a simple room polygon.
 *
 * Bounding-box/vertex averages can sit outside concave L/U-shaped rooms.
 * Horizontal scanlines always produce interior intervals for a valid polygon;
 * choosing the interval midpoint with the greatest wall clearance gives walk
 * mode a safe start without inventing geometry.
 */
export function publicRoomInteriorPoint(
  room: PublicWalkthroughRoom,
  margin = 0,
) {
  const minX = Math.min(...room.boundary.map((point) => point[0]));
  const maxX = Math.max(...room.boundary.map((point) => point[0]));
  const minZ = Math.min(...room.boundary.map((point) => point[1]));
  const maxZ = Math.max(...room.boundary.map((point) => point[1]));
  const average = {
    x:
      room.boundary.reduce((sum, point) => sum + point[0], 0) /
      room.boundary.length,
    z:
      room.boundary.reduce((sum, point) => sum + point[1], 0) /
      room.boundary.length,
  };
  const direct = [
    { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    average,
  ];

  let best:
    | { x: number; z: number; clearance: number }
    | undefined;
  const consider = (x: number, z: number) => {
    if (!publicRoomContains(room, x, z)) return;
    const clearance = roomPointClearance(room, x, z);
    if (!best || clearance > best.clearance)
      best = { x, z, clearance };
  };

  for (const point of direct) consider(point.x, point.z);

  const levels = [...new Set(room.boundary.map((point) => point[1]))].sort(
    (left, right) => left - right,
  );
  const scanlines = new Set<number>([
    (minZ + maxZ) / 2,
    average.z,
  ]);
  for (let index = 0; index + 1 < levels.length; index += 1) {
    if (levels[index + 1] - levels[index] > 1e-7)
      scanlines.add((levels[index] + levels[index + 1]) / 2);
  }

  for (const z of scanlines) {
    const intersections: number[] = [];
    for (let index = 0; index < room.boundary.length; index += 1) {
      const left = room.boundary[index];
      const right = room.boundary[(index + 1) % room.boundary.length];
      if (
        (left[1] <= z && right[1] > z) ||
        (right[1] <= z && left[1] > z)
      ) {
        const ratio = (z - left[1]) / (right[1] - left[1]);
        intersections.push(left[0] + ratio * (right[0] - left[0]));
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index];
      const right = intersections[index + 1];
      if (right - left <= 1e-7) continue;
      consider((left + right) / 2, z);
      if (margin > 0 && right - left > margin * 2) {
        consider(left + margin, z);
        consider(right - margin, z);
      }
    }
  }

  if (best && best.clearance >= margin)
    return { x: best.x, z: best.z };
  if (best) return { x: best.x, z: best.z };

  // Public contracts validate simple polygons, so this is only a corruption
  // fallback. Keep it deterministic and let the caller's containment check fail
  // closed rather than producing NaN coordinates.
  return { x: average.x, z: average.z };
}

export function publicRoomCenter(room: PublicWalkthroughRoom) {
  return publicRoomInteriorPoint(room);
}

export function publicWalkConnections(
  graph: PublicWalkthroughGraph,
  roomId: string,
) {
  return graph.doors.flatMap((door) => {
    if (!door.roomIds.includes(roomId)) return [];
    const toRoomId = door.roomIds.find((id) => id !== roomId);
    return toRoomId
      ? [{ openingId: door.id, fromRoomId: roomId, toRoomId }]
      : [];
  });
}

function publicDoorLanding(
  graph: PublicWalkthroughGraph,
  room: PublicWalkthroughRoom,
  door: PublicWalkthroughGraph["doors"][number],
  normalSign: 1 | -1,
) {
  const angle = THREE.MathUtils.degToRad(door.rotationY);
  const normalX = Math.sin(angle) * normalSign;
  const normalZ = Math.cos(angle) * normalSign;
  const unit = Math.max(graph.metresPerUnit, 0.0001);
  for (const metres of [0.24, 0.3, 0.38, 0.48, 0.62]) {
    const distance = metres / unit;
    const x = door.x + normalX * distance;
    const z = door.z + normalZ * distance;
    if (publicRoomContains(room, x, z, 0.12 / unit))
      return { x, z, normalX, normalZ };
  }
  return undefined;
}

export interface PublicWalkStepResult {
  roomId: string;
  x: number;
  z: number;
  openingId?: string;
}

export function resolvePublicWalkStep(
  graph: PublicWalkthroughGraph,
  room: PublicWalkthroughRoom,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): PublicWalkStepResult {
  const unit = Math.max(graph.metresPerUnit, 0.0001);
  const wallMargin = 0.18 / unit;
  if (publicRoomContains(room, toX, toZ, wallMargin))
    return { roomId: room.id, x: toX, z: toZ };

  const moveX = toX - fromX;
  const moveZ = toZ - fromZ;
  const moveLength = Math.hypot(moveX, moveZ);
  if (moveLength < 0.000001)
    return { roomId: room.id, x: fromX, z: fromZ };

  for (const door of graph.doors) {
    if (
      door.roomIds.length !== 2 ||
      !door.roomIds.includes(room.id) ||
      door.floorId !== room.floorId
    )
      continue;

    const activation = Math.max(0.5, door.width / 2 + 0.32 / unit);
    if (Math.hypot(fromX - door.x, fromZ - door.z) > activation) continue;

    const destinationId = door.roomIds.find((id) => id !== room.id);
    const destination = graph.rooms.find(
      (candidate) =>
        candidate.id === destinationId &&
        candidate.floorId === room.floorId,
    );
    if (!destination) continue;

    for (const sign of [1, -1] as const) {
      const destinationLanding = publicDoorLanding(
        graph,
        destination,
        door,
        sign,
      );
      const sourceLanding = publicDoorLanding(
        graph,
        room,
        door,
        sign === 1 ? -1 : 1,
      );
      if (!destinationLanding || !sourceLanding) continue;
      const towardDestination =
        (moveX * destinationLanding.normalX +
          moveZ * destinationLanding.normalZ) /
        moveLength;
      if (towardDestination < 0.1) continue;
      if (
        Math.hypot(
          fromX - sourceLanding.x,
          fromZ - sourceLanding.z,
        ) > Math.max(activation + 0.28 / unit, 0.9 / unit)
      )
        continue;
      return {
        roomId: destination.id,
        x: destinationLanding.x,
        z: destinationLanding.z,
        openingId: door.id,
      };
    }
  }

  return { roomId: room.id, x: fromX, z: fromZ };
}

export function publicWalkStart(
  graph: PublicWalkthroughGraph,
  room: PublicWalkthroughRoom,
) {
  const unit = Math.max(graph.metresPerUnit, 0.0001);
  const margin = 0.18 / unit;
  const candidate = publicRoomInteriorPoint(room, margin);
  if (publicRoomContains(room, candidate.x, candidate.z, margin))
    return candidate;

  const inside = publicRoomInteriorPoint(room);
  return publicRoomContains(room, inside.x, inside.z)
    ? inside
    : publicRoomCenter(room);
}
