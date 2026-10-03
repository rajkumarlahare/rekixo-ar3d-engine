import {
  roomBoundaryPoints,
  type Opening,
  type OpeningKind,
  type RoomPoint,
  type Scene,
  type Wall,
} from "./domain";

export interface ManualWallDraft {
  floorId: string;
  start: RoomPoint;
  end: RoomPoint;
  thickness: number;
  height: number;
}

export interface ManualOpeningDraft {
  wallId: string;
  kind: OpeningKind;
  x: number;
  z: number;
  width: number;
  height: number;
  sillHeight?: number;
}

function finitePoint(point: RoomPoint) {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function distanceToSegment(
  point: RoomPoint,
  start: RoomPoint,
  end: RoomPoint,
) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx +
              (point[1] - start[1]) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  const x = start[0] + dx * t;
  const z = start[1] + dz * t;
  return {
    point: [x, z] as RoomPoint,
    t,
    distance: Math.hypot(point[0] - x, point[1] - z),
  };
}

function normalizedDirection(start: RoomPoint, end: RoomPoint) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const length = Math.hypot(dx, dz);
  return length > 1e-9
    ? { x: dx / length, z: dz / length, length }
    : { x: 1, z: 0, length: 0 };
}

function segmentOverlap(
  aStart: RoomPoint,
  aEnd: RoomPoint,
  bStart: RoomPoint,
  bEnd: RoomPoint,
) {
  const a = normalizedDirection(aStart, aEnd);
  if (!a.length) return 0;
  const p0 =
    (bStart[0] - aStart[0]) * a.x + (bStart[1] - aStart[1]) * a.z;
  const p1 =
    (bEnd[0] - aStart[0]) * a.x + (bEnd[1] - aStart[1]) * a.z;
  const low = Math.max(0, Math.min(p0, p1));
  const high = Math.min(a.length, Math.max(p0, p1));
  return Math.max(0, high - low);
}

function parallelScore(
  aStart: RoomPoint,
  aEnd: RoomPoint,
  bStart: RoomPoint,
  bEnd: RoomPoint,
) {
  const a = normalizedDirection(aStart, aEnd);
  const b = normalizedDirection(bStart, bEnd);
  if (!a.length || !b.length) return 0;
  return Math.abs(a.x * b.x + a.z * b.z);
}

function normalizeAngle(angle: number) {
  let normalized = angle % 360;
  if (normalized < -180) normalized += 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

function symmetricAngleDelta(a: number, b: number) {
  const delta = Math.abs(normalizeAngle(a - b));
  return Math.min(delta, Math.abs(180 - delta));
}

export function wallLength(wall: Pick<Wall, "start" | "end">) {
  return Math.hypot(
    wall.end[0] - wall.start[0],
    wall.end[1] - wall.start[1],
  );
}

export function wallMidpoint(wall: Pick<Wall, "start" | "end">): RoomPoint {
  return [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ];
}

export function wallRotationY(wall: Pick<Wall, "start" | "end">) {
  return Number(
    (
      (Math.atan2(
        -(wall.end[1] - wall.start[1]),
        wall.end[0] - wall.start[0],
      ) *
        180) /
      Math.PI
    ).toFixed(3),
  );
}

/**
 * Resolve at most two rooms whose saved boundary materially overlaps the wall.
 * This is deliberately geometry-based so manual walls do not depend on room
 * creation order or mutable display labels.
 */
export function wallRoomIds(
  scene: Scene,
  floorId: string,
  start: RoomPoint,
  end: RoomPoint,
  thickness = 0.12,
) {
  const direction = normalizedDirection(start, end);
  if (direction.length < 0.2) return [];
  const midpoint: RoomPoint = [
    (start[0] + end[0]) / 2,
    (start[1] + end[1]) / 2,
  ];
  const tolerance = Math.max(0.18, Math.min(0.45, thickness * 2.5));
  const candidates: { roomId: string; distance: number; overlap: number }[] = [];

  for (const room of scene.rooms) {
    if (room.floorId !== floorId) continue;
    const boundary = roomBoundaryPoints(room);
    let best:
      | { distance: number; overlap: number }
      | undefined;
    for (let index = 0; index < boundary.length; index += 1) {
      const left = boundary[index];
      const right = boundary[(index + 1) % boundary.length];
      if (parallelScore(start, end, left, right) < 0.93) continue;
      const overlap = segmentOverlap(start, end, left, right);
      const requiredOverlap = Math.max(
        0.12,
        Math.min(direction.length, Math.hypot(right[0] - left[0], right[1] - left[1])) *
          0.2,
      );
      if (overlap < requiredOverlap) continue;
      const hit = distanceToSegment(midpoint, left, right);
      if (hit.distance > tolerance) continue;
      if (
        !best ||
        hit.distance < best.distance - 1e-6 ||
        (Math.abs(hit.distance - best.distance) <= 1e-6 && overlap > best.overlap)
      )
        best = { distance: hit.distance, overlap };
    }
    if (best) candidates.push({ roomId: room.id, ...best });
  }

  return candidates
    .sort((left, right) =>
      left.distance !== right.distance
        ? left.distance - right.distance
        : right.overlap - left.overlap,
    )
    .slice(0, 2)
    .map((entry) => entry.roomId);
}

function openingHostedByWall(opening: Opening, wall: Wall) {
  if (opening.floorId !== wall.floorId) return false;
  if (
    wall.roomIds.length &&
    !opening.roomIds.some((roomId) => wall.roomIds.includes(roomId))
  )
    return false;
  const hit = distanceToSegment([opening.x, opening.z], wall.start, wall.end);
  if (hit.distance > Math.max(0.32, wall.thickness * 3.5)) return false;
  return symmetricAngleDelta(opening.rotationY, wallRotationY(wall)) <= 24;
}

export function hostWallForOpening(scene: Scene, opening: Opening) {
  let best: { wall: Wall; score: number } | undefined;
  for (const wall of scene.walls ?? []) {
    if (wall.floorId !== opening.floorId || wallLength(wall) < opening.width + 0.1)
      continue;
    if (
      wall.roomIds.length &&
      !opening.roomIds.some((roomId) => wall.roomIds.includes(roomId))
    )
      continue;
    const hit = distanceToSegment([opening.x, opening.z], wall.start, wall.end);
    const angle = symmetricAngleDelta(opening.rotationY, wallRotationY(wall));
    const score = hit.distance + Math.min(angle, 45) * 0.01;
    if (hit.distance > Math.max(0.8, wall.thickness * 5)) continue;
    if (!best || score < best.score) best = { wall, score };
  }
  return best?.wall;
}

function openingPlacementOnWall(
  scene: Scene,
  wall: Wall,
  opening: Pick<Opening, "x" | "z" | "width" | "height" | "kind" | "sillHeight">,
) {
  const floor = scene.floors.find((entry) => entry.id === wall.floorId);
  if (!floor) throw Error("Opening wall floor is missing.");
  const length = wallLength(wall);
  if (!(opening.width >= 0.25 && opening.width <= Math.min(8, length - 0.1)))
    throw Error("Opening width does not fit on this wall.");
  if (!(opening.height >= 0.3 && opening.height <= wall.height))
    throw Error("Opening height must fit inside the wall.");
  const sillHeight =
    opening.kind === "window" ? opening.sillHeight ?? 0.9 : 0;
  if (sillHeight < 0 || sillHeight + opening.height > wall.height + 1e-6)
    throw Error("Window sill and height must fit inside the wall.");

  const hit = distanceToSegment([opening.x, opening.z], wall.start, wall.end);
  if (hit.distance > Math.max(0.8, wall.thickness * 5))
    throw Error("Place the opening directly on its host wall.");
  const half = opening.width / 2 + 0.05;
  const minT = half / length;
  const maxT = 1 - minT;
  if (minT > maxT)
    throw Error("Opening width leaves no safe wall-end clearance.");
  const t = Math.max(minT, Math.min(maxT, hit.t));
  const x = wall.start[0] + (wall.end[0] - wall.start[0]) * t;
  const z = wall.start[1] + (wall.end[1] - wall.start[1]) * t;

  return {
    x: Number(x.toFixed(4)),
    y: Number(
      (floor.elevation + sillHeight + opening.height / 2).toFixed(4),
    ),
    z: Number(z.toFixed(4)),
    rotationY: wallRotationY(wall),
    sillHeight,
  };
}

export function createManualWall(
  scene: Scene,
  draft: ManualWallDraft,
  makeId: () => string,
): { scene: Scene; wall: Wall } {
  if (!scene.floors.some((floor) => floor.id === draft.floorId))
    throw Error("Choose a valid floor before drawing a wall.");
  if (!finitePoint(draft.start) || !finitePoint(draft.end))
    throw Error("Wall coordinates are invalid.");
  const length = Math.hypot(
    draft.end[0] - draft.start[0],
    draft.end[1] - draft.start[1],
  );
  if (length < 0.2) throw Error("Draw a wall at least 0.2 m long.");
  if (!(draft.thickness >= 0.05 && draft.thickness <= 1))
    throw Error("Wall thickness must be between 0.05 m and 1 m.");
  if (!(draft.height >= 1.8 && draft.height <= 20))
    throw Error("Wall height must be between 1.8 m and 20 m.");

  const start: RoomPoint = [
    Number(draft.start[0].toFixed(4)),
    Number(draft.start[1].toFixed(4)),
  ];
  const end: RoomPoint = [
    Number(draft.end[0].toFixed(4)),
    Number(draft.end[1].toFixed(4)),
  ];
  const wall: Wall = {
    id: makeId(),
    floorId: draft.floorId,
    roomIds: wallRoomIds(scene, draft.floorId, start, end, draft.thickness),
    start,
    end,
    thickness: Number(draft.thickness.toFixed(4)),
    height: Number(draft.height.toFixed(4)),
    reviewed: false,
    origin: "manual",
    reviewState: "suggested",
  };
  return {
    scene: { ...scene, walls: [...(scene.walls ?? []), wall] },
    wall,
  };
}

export function patchManualWall(
  scene: Scene,
  wallId: string,
  patch: Partial<Pick<Wall, "start" | "end" | "thickness" | "height">>,
) {
  const wall = (scene.walls ?? []).find((entry) => entry.id === wallId);
  if (!wall) throw Error("Wall not found.");
  const next: Wall = {
    ...wall,
    ...patch,
    origin: "manual",
    reviewed: false,
    reviewState: "suggested",
    confidence: undefined,
    sourceNodeName: undefined,
    sourceOccurrence: undefined,
  };
  if (!finitePoint(next.start) || !finitePoint(next.end) || wallLength(next) < 0.2)
    throw Error("Wall endpoints must stay at least 0.2 m apart.");
  if (!(next.thickness >= 0.05 && next.thickness <= 1))
    throw Error("Wall thickness must be between 0.05 m and 1 m.");
  if (!(next.height >= 1.8 && next.height <= 20))
    throw Error("Wall height must be between 1.8 m and 20 m.");
  next.start = [Number(next.start[0].toFixed(4)), Number(next.start[1].toFixed(4))];
  next.end = [Number(next.end[0].toFixed(4)), Number(next.end[1].toFixed(4))];
  next.thickness = Number(next.thickness.toFixed(4));
  next.height = Number(next.height.toFixed(4));
  next.roomIds = wallRoomIds(
    scene,
    next.floorId,
    next.start,
    next.end,
    next.thickness,
  );

  const openings = (scene.openings ?? []).map((opening) => {
    if (!openingHostedByWall(opening, wall)) return opening;
    try {
      const placed = openingPlacementOnWall(scene, next, opening);
      return {
        ...opening,
        ...placed,
        ...(opening.kind === "window"
          ? { sillHeight: placed.sillHeight }
          : { sillHeight: undefined }),
        roomIds: next.roomIds.length ? next.roomIds.slice(0, 2) : opening.roomIds,
        reviewed: false,
        reviewState: "suggested" as const,
        confidence: undefined,
        sourceNodeName: undefined,
        sourceOccurrence: undefined,
      };
    } catch {
      return {
        ...opening,
        reviewed: false,
        reviewState: "suggested" as const,
      };
    }
  });

  return {
    ...scene,
    walls: (scene.walls ?? []).map((entry) =>
      entry.id === wallId ? next : entry,
    ),
    openings,
  };
}

export function nearestWallForPoint(
  scene: Scene,
  floorId: string,
  point: RoomPoint,
  maxDistance = 0.55,
) {
  let best:
    | { wall: Wall; point: RoomPoint; t: number; distance: number }
    | undefined;
  for (const wall of scene.walls ?? []) {
    if (wall.floorId !== floorId) continue;
    const hit = distanceToSegment(point, wall.start, wall.end);
    if (hit.distance > maxDistance) continue;
    if (!best || hit.distance < best.distance) best = { wall, ...hit };
  }
  return best;
}

export function createManualOpening(
  scene: Scene,
  draft: ManualOpeningDraft,
  makeId: () => string,
): { scene: Scene; opening: Opening } {
  const wall = (scene.walls ?? []).find((entry) => entry.id === draft.wallId);
  if (!wall) throw Error("Choose a wall before placing an opening.");
  if (!wall.roomIds.length)
    throw Error(
      "This wall is not associated with a room yet. Review/reconstruct room boundaries before placing a door or window.",
    );
  const placed = openingPlacementOnWall(scene, wall, draft);
  const opening: Opening = {
    id: makeId(),
    floorId: wall.floorId,
    kind: draft.kind,
    roomIds: wall.roomIds.slice(0, 2),
    x: placed.x,
    y: placed.y,
    z: placed.z,
    width: Number(draft.width.toFixed(4)),
    height: Number(draft.height.toFixed(4)),
    ...(draft.kind === "window"
      ? { sillHeight: Number(placed.sillHeight.toFixed(4)) }
      : {}),
    rotationY: placed.rotationY,
    reviewed: false,
    confidence: undefined,
    reviewState: "suggested",
  };
  return {
    scene: { ...scene, openings: [...(scene.openings ?? []), opening] },
    opening,
  };
}

export function patchManualOpening(
  scene: Scene,
  openingId: string,
  patch: Partial<Pick<Opening, "kind" | "width" | "height" | "sillHeight">>,
) {
  const opening = (scene.openings ?? []).find((entry) => entry.id === openingId);
  if (!opening) throw Error("Opening not found.");
  const wall = hostWallForOpening(scene, opening);
  if (!wall) throw Error("Opening host wall could not be resolved safely.");
  const nextKind = patch.kind ?? opening.kind;
  const next = {
    ...opening,
    ...patch,
    kind: nextKind,
    ...(nextKind === "window"
      ? { sillHeight: patch.sillHeight ?? opening.sillHeight ?? 0.9 }
      : { sillHeight: undefined }),
  };
  const placed = openingPlacementOnWall(scene, wall, next);
  const updated: Opening = {
    ...next,
    ...placed,
    width: Number(next.width.toFixed(4)),
    height: Number(next.height.toFixed(4)),
    ...(nextKind === "window"
      ? { sillHeight: Number(placed.sillHeight.toFixed(4)) }
      : { sillHeight: undefined }),
    roomIds: wall.roomIds.length ? wall.roomIds.slice(0, 2) : opening.roomIds,
    reviewed: false,
    confidence: undefined,
    reviewState: "suggested",
    sourceNodeName: undefined,
    sourceOccurrence: undefined,
  };
  return {
    ...scene,
    openings: (scene.openings ?? []).map((entry) =>
      entry.id === openingId ? updated : entry,
    ),
  };
}

export function moveManualOpening(
  scene: Scene,
  openingId: string,
  point: RoomPoint,
  maxDistance = 0.8,
) {
  const opening = (scene.openings ?? []).find((entry) => entry.id === openingId);
  if (!opening) throw Error("Opening not found.");
  let best: { wall: Wall; distance: number } | undefined;
  for (const wall of scene.walls ?? []) {
    if (wall.floorId !== opening.floorId || wallLength(wall) < opening.width + 0.1)
      continue;
    if (!wall.roomIds.length) continue;
    if (
      opening.roomIds.length &&
      !opening.roomIds.some((roomId) => wall.roomIds.includes(roomId))
    )
      continue;
    const hit = distanceToSegment(point, wall.start, wall.end);
    if (hit.distance > maxDistance) continue;
    if (!best || hit.distance < best.distance)
      best = { wall, distance: hit.distance };
  }
  if (!best)
    throw Error("Move the opening onto a compatible wall on the same floor.");
  const placed = openingPlacementOnWall(scene, best.wall, {
    ...opening,
    x: point[0],
    z: point[1],
  });
  const updated: Opening = {
    ...opening,
    ...placed,
    roomIds: best.wall.roomIds.slice(0, 2),
    reviewed: false,
    reviewState: "suggested",
    confidence: undefined,
    sourceNodeName: undefined,
    sourceOccurrence: undefined,
  };
  return {
    ...scene,
    openings: (scene.openings ?? []).map((entry) =>
      entry.id === openingId ? updated : entry,
    ),
  };
}

export function setWallReviewed(scene: Scene, wallId: string, reviewed: boolean) {
  if (!(scene.walls ?? []).some((wall) => wall.id === wallId))
    throw Error("Wall not found.");
  return {
    ...scene,
    walls: (scene.walls ?? []).map((wall) =>
      wall.id === wallId
        ? {
            ...wall,
            reviewed,
            reviewState: reviewed
              ? ("human_reviewed" as const)
              : ("suggested" as const),
          }
        : wall,
    ),
  };
}

export function setOpeningReviewed(
  scene: Scene,
  openingId: string,
  reviewed: boolean,
) {
  if (!(scene.openings ?? []).some((opening) => opening.id === openingId))
    throw Error("Opening not found.");
  return {
    ...scene,
    openings: (scene.openings ?? []).map((opening) =>
      opening.id === openingId
        ? {
            ...opening,
            reviewed,
            reviewState: reviewed
              ? ("human_reviewed" as const)
              : ("suggested" as const),
          }
        : opening,
    ),
  };
}

export function removeManualOpening(scene: Scene, openingId: string) {
  if (!(scene.openings ?? []).some((opening) => opening.id === openingId))
    throw Error("Opening not found.");
  return {
    ...scene,
    openings: (scene.openings ?? []).filter((opening) => opening.id !== openingId),
  };
}

export function removeManualWall(scene: Scene, wallId: string) {
  const wall = (scene.walls ?? []).find((entry) => entry.id === wallId);
  if (!wall) throw Error("Wall not found.");
  if ((scene.openings ?? []).some((opening) => openingHostedByWall(opening, wall)))
    throw Error("Remove or move openings on this wall before deleting the wall.");
  const affected = new Set(wall.roomIds);
  return {
    ...scene,
    walls: (scene.walls ?? []).filter((entry) => entry.id !== wallId),
    rooms: scene.rooms.map((room) =>
      affected.has(room.id) ? { ...room, verified: false } : room,
    ),
  };
}
