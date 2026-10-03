export type SemanticOpeningKind = "door" | "window" | "opening";
export type SemanticPoint = [number, number];

export interface SemanticFloor {
  id: string;
  name: string;
  elevation: number;
}

export interface SemanticRoom {
  id: string;
  floorId: string;
  name: string;
  unit: string;
  boundary: SemanticPoint[];
  elevation: number;
  height: number;
  color: string;
  verified: boolean;
}

export interface SemanticWall {
  id: string;
  floorId: string;
  roomIds: string[];
  start: SemanticPoint;
  end: SemanticPoint;
  elevation: number;
  thickness: number;
  height: number;
}

export interface SemanticOpening {
  id: string;
  floorId: string;
  kind: SemanticOpeningKind;
  roomIds: string[];
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  sillHeight?: number;
  rotationY: number;
}

export interface SemanticInteriorRuntime {
  floors: SemanticFloor[];
  rooms: SemanticRoom[];
  walls: SemanticWall[];
  openings: SemanticOpening[];
}

type UnknownRecord = Record<string, unknown>;
let runtimeInterior: SemanticInteriorRuntime | undefined;

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 180 &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function sceneTransform(scene: UnknownRecord) {
  const scale = finite(scene.scale) && scene.scale > 0 ? scene.scale : 1;
  const transform = record(scene.modelTransform) ?? {};
  const tx = finite(transform.x) ? transform.x : 0;
  const ty = finite(transform.y) ? transform.y : 0;
  const tz = finite(transform.z) ? transform.z : 0;
  const rotationY = finite(transform.rotationY) ? transform.rotationY : 0;
  const angle = (rotationY * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return {
    scale,
    point(x: number, z: number): SemanticPoint {
      const dx = (x - tx) / scale;
      const dz = (z - tz) / scale;
      return [
        dx * cosine - dz * sine,
        dx * sine + dz * cosine,
      ];
    },
    y(value: number) {
      return (value - ty) / scale;
    },
    rotation(degrees: number) {
      const tangentX = Math.cos((degrees * Math.PI) / 180);
      const tangentZ = -Math.sin((degrees * Math.PI) / 180);
      const localX = tangentX * cosine - tangentZ * sine;
      const localZ = tangentX * sine + tangentZ * cosine;
      return (Math.atan2(-localZ, localX) * 180) / Math.PI;
    },
  };
}

function roomBoundary(room: UnknownRecord): SemanticPoint[] | undefined {
  if (
    Array.isArray(room.polygon) &&
    room.polygon.length >= 3 &&
    room.polygon.length <= 128 &&
    room.polygon.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(finite),
    )
  )
    return room.polygon.map((point) => [point[0], point[1]]);

  if (
    finite(room.x) &&
    finite(room.z) &&
    finite(room.width) &&
    finite(room.depth) &&
    room.width > 0 &&
    room.depth > 0
  )
    return [
      [room.x - room.width / 2, room.z - room.depth / 2],
      [room.x + room.width / 2, room.z - room.depth / 2],
      [room.x + room.width / 2, room.z + room.depth / 2],
      [room.x - room.width / 2, room.z + room.depth / 2],
    ];
  return undefined;
}

export function deriveSemanticInteriorFromStudio(
  project: unknown,
): SemanticInteriorRuntime | undefined {
  const projectRecord = record(project);
  const scene = record(projectRecord?.scene);
  if (!scene) return undefined;
  const spatial = sceneTransform(scene);

  const floors: SemanticFloor[] = [];
  const floorById = new Map<string, SemanticFloor>();
  for (const raw of Array.isArray(scene.floors) ? scene.floors : []) {
    const floor = record(raw);
    if (
      !floor ||
      !validId(floor.id) ||
      typeof floor.name !== "string" ||
      !finite(floor.elevation) ||
      floorById.has(floor.id)
    )
      continue;
    const value: SemanticFloor = {
      id: floor.id,
      name: floor.name.slice(0, 300),
      elevation: spatial.y(floor.elevation),
    };
    floors.push(value);
    floorById.set(value.id, value);
  }

  const rooms: SemanticRoom[] = [];
  const roomIds = new Set<string>();
  for (const raw of Array.isArray(scene.rooms) ? scene.rooms : []) {
    const room = record(raw);
    if (
      !room ||
      !validId(room.id) ||
      !validId(room.floorId) ||
      !floorById.has(room.floorId) ||
      roomIds.has(room.id) ||
      typeof room.name !== "string" ||
      typeof room.unit !== "string" ||
      !finite(room.height) ||
      room.height <= 0 ||
      !validColor(room.color)
    )
      continue;
    const boundary = roomBoundary(room);
    if (!boundary) continue;
    rooms.push({
      id: room.id,
      floorId: room.floorId,
      name: room.name.slice(0, 300),
      unit: room.unit.slice(0, 300),
      boundary: boundary.map(([x, z]) => spatial.point(x, z)),
      elevation: floorById.get(room.floorId)!.elevation,
      height: room.height / spatial.scale,
      color: room.color.toLowerCase(),
      verified: room.verified === true,
    });
    roomIds.add(room.id);
  }

  const walls: SemanticWall[] = [];
  const wallIds = new Set<string>();
  for (const raw of Array.isArray(scene.walls) ? scene.walls : []) {
    const wall = record(raw);
    if (
      !wall ||
      wall.reviewed !== true ||
      !validId(wall.id) ||
      !validId(wall.floorId) ||
      !floorById.has(wall.floorId) ||
      wallIds.has(wall.id) ||
      !Array.isArray(wall.start) ||
      wall.start.length !== 2 ||
      !wall.start.every(finite) ||
      !Array.isArray(wall.end) ||
      wall.end.length !== 2 ||
      !wall.end.every(finite) ||
      !finite(wall.thickness) ||
      wall.thickness <= 0 ||
      !finite(wall.height) ||
      wall.height <= 0
    )
      continue;
    const roomIdsForWall = Array.isArray(wall.roomIds)
      ? wall.roomIds.filter(
          (roomId): roomId is string =>
            typeof roomId === "string" && roomIds.has(roomId),
        )
      : [];
    walls.push({
      id: wall.id,
      floorId: wall.floorId,
      roomIds: roomIdsForWall,
      start: spatial.point(wall.start[0], wall.start[1]),
      end: spatial.point(wall.end[0], wall.end[1]),
      elevation: floorById.get(wall.floorId)!.elevation,
      thickness: wall.thickness / spatial.scale,
      height: wall.height / spatial.scale,
    });
    wallIds.add(wall.id);
  }

  const openings: SemanticOpening[] = [];
  const openingIds = new Set<string>();
  for (const raw of Array.isArray(scene.openings) ? scene.openings : []) {
    const opening = record(raw);
    if (
      !opening ||
      opening.reviewed !== true ||
      !validId(opening.id) ||
      !validId(opening.floorId) ||
      !floorById.has(opening.floorId) ||
      openingIds.has(opening.id) ||
      !["door", "window", "opening"].includes(String(opening.kind)) ||
      !finite(opening.x) ||
      !finite(opening.y) ||
      !finite(opening.z) ||
      !finite(opening.width) ||
      opening.width <= 0 ||
      !finite(opening.height) ||
      opening.height <= 0 ||
      !finite(opening.rotationY) ||
      (opening.sillHeight !== undefined &&
        (!finite(opening.sillHeight) || opening.sillHeight < 0))
    )
      continue;
    const [x, z] = spatial.point(opening.x, opening.z);
    const roomIdsForOpening = Array.isArray(opening.roomIds)
      ? opening.roomIds.filter(
          (roomId): roomId is string =>
            typeof roomId === "string" && roomIds.has(roomId),
        )
      : [];
    openings.push({
      id: opening.id,
      floorId: opening.floorId,
      kind: opening.kind as SemanticOpeningKind,
      roomIds: roomIdsForOpening,
      x,
      y: spatial.y(opening.y),
      z,
      width: opening.width / spatial.scale,
      height: opening.height / spatial.scale,
      ...(finite(opening.sillHeight)
        ? { sillHeight: opening.sillHeight / spatial.scale }
        : {}),
      rotationY: spatial.rotation(opening.rotationY),
    });
    openingIds.add(opening.id);
  }

  if (!walls.length) return undefined;
  return { floors, rooms, walls, openings };
}

export function setSemanticInteriorRuntime(
  value: SemanticInteriorRuntime | undefined,
) {
  runtimeInterior = value;
}

export function getSemanticInteriorRuntime() {
  return runtimeInterior;
}

export function clearSemanticInteriorRuntime() {
  runtimeInterior = undefined;
}
