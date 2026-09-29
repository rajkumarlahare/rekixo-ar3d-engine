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

export function publicRoomCenter(room: PublicWalkthroughRoom) {
  const minX = Math.min(...room.boundary.map((point) => point[0]));
  const maxX = Math.max(...room.boundary.map((point) => point[0]));
  const minZ = Math.min(...room.boundary.map((point) => point[1]));
  const maxZ = Math.max(...room.boundary.map((point) => point[1]));
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  if (publicRoomContains(room, center.x, center.z)) return center;
  const average = {
    x:
      room.boundary.reduce((sum, point) => sum + point[0], 0) /
      room.boundary.length,
    z:
      room.boundary.reduce((sum, point) => sum + point[1], 0) /
      room.boundary.length,
  };
  return average;
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
  const center = publicRoomCenter(room);
  if (publicRoomContains(room, center.x, center.z, 0.18 / graph.metresPerUnit))
    return center;
  for (const point of room.boundary) {
    const candidate = {
      x: (point[0] + center.x) / 2,
      z: (point[1] + center.z) / 2,
    };
    if (
      publicRoomContains(
        room,
        candidate.x,
        candidate.z,
        0.18 / graph.metresPerUnit,
      )
    )
      return candidate;
  }
  return center;
}
