import type {
  Opening,
  OpeningKind,
  RoomPoint,
  Scene,
  Wall,
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

export function wallLength(wall: Pick<Wall, "start" | "end">) {
  return Math.hypot(
    wall.end[0] - wall.start[0],
    wall.end[1] - wall.start[1],
  );
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

  const wall: Wall = {
    id: makeId(),
    floorId: draft.floorId,
    roomIds: [],
    start: [
      Number(draft.start[0].toFixed(4)),
      Number(draft.start[1].toFixed(4)),
    ],
    end: [
      Number(draft.end[0].toFixed(4)),
      Number(draft.end[1].toFixed(4)),
    ],
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
  };
  if (!finitePoint(next.start) || !finitePoint(next.end) || wallLength(next) < 0.2)
    throw Error("Wall endpoints must stay at least 0.2 m apart.");
  if (!(next.thickness >= 0.05 && next.thickness <= 1))
    throw Error("Wall thickness must be between 0.05 m and 1 m.");
  if (!(next.height >= 1.8 && next.height <= 20))
    throw Error("Wall height must be between 1.8 m and 20 m.");

  return {
    ...scene,
    walls: (scene.walls ?? []).map((entry) =>
      entry.id === wallId ? next : entry,
    ),
    openings: (scene.openings ?? []).map((opening) =>
      opening.floorId === wall.floorId &&
      opening.roomIds.some((roomId) => wall.roomIds.includes(roomId))
        ? { ...opening, reviewed: false, reviewState: "suggested" as const }
        : opening,
    ),
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
  const floor = scene.floors.find((entry) => entry.id === wall.floorId);
  if (!floor) throw Error("Opening wall floor is missing.");
  const hit = distanceToSegment([draft.x, draft.z], wall.start, wall.end);
  if (hit.distance > Math.max(0.45, wall.thickness * 3))
    throw Error("Place the opening directly on its host wall.");
  const length = wallLength(wall);
  if (!(draft.width >= 0.25 && draft.width <= Math.min(8, length)))
    throw Error("Opening width does not fit on this wall.");
  const edgeClearance = Math.min(hit.t * length, (1 - hit.t) * length);
  if (edgeClearance < draft.width / 2 + 0.05)
    throw Error("Move the opening away from the wall end or reduce its width.");
  if (!(draft.height >= 0.3 && draft.height <= wall.height))
    throw Error("Opening height must fit inside the wall.");
  const sillHeight = draft.kind === "window" ? draft.sillHeight ?? 0.9 : 0;
  if (sillHeight < 0 || sillHeight + draft.height > wall.height + 1e-6)
    throw Error("Window sill and height must fit inside the wall.");

  const rotationY = Number(
    (
      (Math.atan2(
        -(wall.end[1] - wall.start[1]),
        wall.end[0] - wall.start[0],
      ) *
        180) /
      Math.PI
    ).toFixed(3),
  );
  const opening: Opening = {
    id: makeId(),
    floorId: wall.floorId,
    kind: draft.kind,
    roomIds: wall.roomIds.length ? wall.roomIds.slice(0, 2) : [],
    x: Number(hit.point[0].toFixed(4)),
    y: Number(
      (
        floor.elevation +
        sillHeight +
        draft.height / 2
      ).toFixed(4),
    ),
    z: Number(hit.point[1].toFixed(4)),
    width: Number(draft.width.toFixed(4)),
    height: Number(draft.height.toFixed(4)),
    ...(draft.kind === "window"
      ? { sillHeight: Number(sillHeight.toFixed(4)) }
      : {}),
    rotationY,
    reviewed: false,
    confidence: undefined,
    reviewState: "suggested",
  };
  if (!opening.roomIds.length)
    throw Error(
      "This wall is not associated with a room yet. Review/reconstruct room boundaries before placing a door or window.",
    );
  return {
    scene: { ...scene, openings: [...(scene.openings ?? []), opening] },
    opening,
  };
}

export function patchManualOpening(
  scene: Scene,
  openingId: string,
  patch: Partial<Pick<Opening, "width" | "height" | "sillHeight">>,
) {
  const opening = (scene.openings ?? []).find((entry) => entry.id === openingId);
  if (!opening) throw Error("Opening not found.");
  const next: Opening = {
    ...opening,
    ...patch,
    reviewed: false,
    confidence: undefined,
    reviewState: "suggested",
  };
  if (!(next.width >= 0.25 && next.width <= 8))
    throw Error("Opening width must be between 0.25 m and 8 m.");
  if (!(next.height >= 0.3 && next.height <= 20))
    throw Error("Opening height must be between 0.3 m and 20 m.");
  if (next.sillHeight !== undefined && next.sillHeight < 0)
    throw Error("Window sill height cannot be negative.");
  return {
    ...scene,
    openings: (scene.openings ?? []).map((entry) =>
      entry.id === openingId ? next : entry,
    ),
  };
}
