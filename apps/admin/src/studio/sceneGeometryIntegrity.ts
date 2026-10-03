import {
  roomArea,
  roomBoundaryPoints,
  validateProject,
  type Opening,
  type Project,
  type Room,
  type RoomPoint,
  type Wall,
} from "./domain";

export type SceneGeometryIssueSeverity = "review" | "blocker";
export type SceneGeometryEntityType = "project" | "floor" | "room" | "wall" | "opening";

export interface SceneGeometryIntegrityIssue {
  id: string;
  code: string;
  severity: SceneGeometryIssueSeverity;
  entityType: SceneGeometryEntityType;
  entityId?: string;
  floorId?: string;
  title: string;
  detail: string;
  action: string;
}

export interface SceneGeometryIntegrityReport {
  schema: 1;
  kind: "rekixo-scene-geometry-integrity";
  overallStatus: "passed" | "needs-review" | "blocked";
  counts: {
    blocker: number;
    review: number;
  };
  issues: SceneGeometryIntegrityIssue[];
  checked: {
    floors: number;
    rooms: number;
    walls: number;
    openings: number;
  };
}

const METRIC_TOLERANCE = 0.01;

function distance(left: RoomPoint, right: RoomPoint) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function pointToSegmentDistance(point: RoomPoint, start: RoomPoint, end: RoomPoint) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return distance(point, start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) /
        lengthSquared,
    ),
  );
  return distance(point, [start[0] + dx * t, start[1] + dz * t]);
}

function pointToRoomBoundaryDistance(point: RoomPoint, room: Room) {
  const boundary = roomBoundaryPoints(room);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < boundary.length; index += 1)
    best = Math.min(
      best,
      pointToSegmentDistance(
        point,
        boundary[index],
        boundary[(index + 1) % boundary.length],
      ),
    );
  return best;
}

function roomBounds(room: Room) {
  const boundary = roomBoundaryPoints(room);
  const xs = boundary.map((row) => row[0]);
  const zs = boundary.map((row) => row[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

function overlapRatio(left: Room, right: Room) {
  const a = roomBounds(left);
  const b = roomBounds(right);
  const width = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const depth = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  const overlap = width * depth;
  return overlap / Math.max(0.000001, Math.min(roomArea(left), roomArea(right)));
}

function sameRoomEnvelope(left: Room, right: Room) {
  return (
    left.floorId === right.floorId &&
    Math.abs(left.x - right.x) <= METRIC_TOLERANCE &&
    Math.abs(left.z - right.z) <= METRIC_TOLERANCE &&
    Math.abs(left.width - right.width) <= METRIC_TOLERANCE &&
    Math.abs(left.depth - right.depth) <= METRIC_TOLERANCE &&
    Math.abs(roomArea(left) - roomArea(right)) <= 0.02
  );
}

function orderedWallEndpoints(wall: Wall) {
  const left = `${wall.start[0].toFixed(3)}:${wall.start[1].toFixed(3)}`;
  const right = `${wall.end[0].toFixed(3)}:${wall.end[1].toFixed(3)}`;
  return left <= right ? `${left}|${right}` : `${right}|${left}`;
}

function wallHostDistance(opening: Opening, wall: Wall) {
  return pointToSegmentDistance([opening.x, opening.z], wall.start, wall.end);
}

function issue(
  value: Omit<SceneGeometryIntegrityIssue, "id">,
): SceneGeometryIntegrityIssue {
  const suffix = value.entityId ?? value.floorId ?? value.code;
  return { ...value, id: `${value.code}:${suffix}` };
}

function repeatCycle(project: Project, startId: string) {
  const floorById = new Map(project.scene.floors.map((floor) => [floor.id, floor]));
  const seen = new Set<string>();
  let current = startId;
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = floorById.get(current)?.repeatOfFloorId ?? "";
  }
  return false;
}

/**
 * Cross-entity geometry validation beyond domain shape/range checks.
 * This deliberately does not claim structural/code compliance; it checks the
 * editable scene for contradictions that make review or publication unsafe.
 */
export function validateWholeSceneGeometry(
  project: Project,
): SceneGeometryIntegrityReport {
  const issues: SceneGeometryIntegrityIssue[] = [];

  try {
    validateProject(project);
  } catch (error) {
    issues.push(
      issue({
        code: "project-schema-invalid",
        severity: "blocker",
        entityType: "project",
        title: "Project geometry contract is invalid",
        detail:
          error instanceof Error ? error.message : "Project validation failed.",
        action: "Fix the invalid scene object before publishing.",
      }),
    );
  }

  const floors = [...project.scene.floors].sort((a, b) => a.elevation - b.elevation);
  for (let index = 1; index < floors.length; index += 1) {
    if (Math.abs(floors[index].elevation - floors[index - 1].elevation) > METRIC_TOLERANCE)
      continue;
    issues.push(
      issue({
        code: "floor-elevation-collision",
        severity: "blocker",
        entityType: "floor",
        entityId: floors[index].id,
        floorId: floors[index].id,
        title: "Two floor identities share the same elevation",
        detail: `${floors[index - 1].name} and ${floors[index].name} resolve to the same physical level.`,
        action: "Correct or merge the duplicate floor before publication.",
      }),
    );
  }
  for (const floor of floors) {
    if (!floor.repeatOfFloorId || !repeatCycle(project, floor.id)) continue;
    issues.push(
      issue({
        code: "floor-repeat-cycle",
        severity: "blocker",
        entityType: "floor",
        entityId: floor.id,
        floorId: floor.id,
        title: "Repeated-floor relationship contains a cycle",
        detail: `${floor.name} eventually points back to itself through repeatOfFloorId.`,
        action: "Choose one source floor and remove the cyclic repeat relationship.",
      }),
    );
  }

  const rooms = project.scene.rooms;
  for (let left = 0; left < rooms.length; left += 1) {
    for (let right = left + 1; right < rooms.length; right += 1) {
      if (rooms[left].floorId !== rooms[right].floorId) continue;
      if (sameRoomEnvelope(rooms[left], rooms[right])) {
        issues.push(
          issue({
            code: "duplicate-room-geometry",
            severity: "blocker",
            entityType: "room",
            entityId: rooms[right].id,
            floorId: rooms[right].floorId,
            title: "Duplicate room geometry",
            detail: `${rooms[left].name} and ${rooms[right].name} occupy the same room envelope.`,
            action: "Keep the intended room and remove or redraw the duplicate.",
          }),
        );
        continue;
      }
      const ratio = overlapRatio(rooms[left], rooms[right]);
      if (ratio < 0.92) continue;
      issues.push(
        issue({
          code: "room-overlap-review",
          severity: "review",
          entityType: "room",
          entityId: rooms[right].id,
          floorId: rooms[right].floorId,
          title: "Rooms substantially overlap",
          detail: `${rooms[left].name} and ${rooms[right].name} have approximately ${Math.round(ratio * 100)}% bounding overlap.`,
          action: "Open the floor in the visual editor and confirm the room boundaries.",
        }),
      );
    }
  }

  const walls = project.scene.walls ?? [];
  const wallKeys = new Map<string, Wall>();
  for (const wall of walls) {
    const key = `${wall.floorId}|${orderedWallEndpoints(wall)}|${wall.thickness.toFixed(3)}|${wall.height.toFixed(3)}`;
    const previous = wallKeys.get(key);
    if (previous) {
      issues.push(
        issue({
          code: "duplicate-wall-geometry",
          severity: "blocker",
          entityType: "wall",
          entityId: wall.id,
          floorId: wall.floorId,
          title: "Duplicate wall segment",
          detail: `Wall ${wall.id} duplicates ${previous.id} on the same floor.`,
          action: "Remove the duplicate wall or rerun source fusion after deduplication.",
        }),
      );
    } else wallKeys.set(key, wall);

    for (const roomId of wall.roomIds) {
      const room = rooms.find((row) => row.id === roomId);
      if (!room) continue;
      const tolerance = Math.max(0.35, wall.thickness * 1.5);
      const startDistance = pointToRoomBoundaryDistance(wall.start, room);
      const endDistance = pointToRoomBoundaryDistance(wall.end, room);
      if (Math.max(startDistance, endDistance) <= tolerance) continue;
      issues.push(
        issue({
          code: "wall-room-boundary-mismatch",
          severity: wall.reviewed ? "blocker" : "review",
          entityType: "wall",
          entityId: wall.id,
          floorId: wall.floorId,
          title: "Wall does not agree with its room boundary",
          detail: `Wall ${wall.id} references ${room.name}, but its endpoints are not supported by that room boundary.`,
          action: "Drag the wall/room boundary into alignment or clear the incorrect room binding.",
        }),
      );
    }
  }

  const openings = project.scene.openings ?? [];
  const openingKeys = new Map<string, Opening>();
  for (const opening of openings) {
    const sameFloorWalls = walls.filter((wall) => wall.floorId === opening.floorId);
    const candidates = sameFloorWalls
      .map((wall) => ({ wall, distance: wallHostDistance(opening, wall) }))
      .sort((left, right) => left.distance - right.distance);
    const host = candidates[0];
    const hostTolerance = host
      ? Math.max(0.35, host.wall.thickness * 2)
      : 0.35;

    if (!host || host.distance > hostTolerance) {
      issues.push(
        issue({
          code: "opening-without-host-wall",
          severity: opening.reviewed ? "blocker" : "review",
          entityType: "opening",
          entityId: opening.id,
          floorId: opening.floorId,
          title: "Door/window is not hosted by a wall",
          detail: `${opening.kind} ${opening.id} is not close enough to any same-floor wall.`,
          action: "Drag the opening onto the correct wall or remove the unsupported opening.",
        }),
      );
    } else {
      const hostLength = Math.hypot(
        host.wall.end[0] - host.wall.start[0],
        host.wall.end[1] - host.wall.start[1],
      );
      if (opening.width > hostLength + 0.05)
        issues.push(
          issue({
            code: "opening-wider-than-wall",
            severity: "blocker",
            entityType: "opening",
            entityId: opening.id,
            floorId: opening.floorId,
            title: "Opening is wider than its host wall",
            detail: `${opening.width.toFixed(2)} m opening cannot fit on a ${hostLength.toFixed(2)} m wall segment.`,
            action: "Resize the opening or correct the host wall geometry.",
          }),
        );

      if (
        host.wall.roomIds.length &&
        opening.roomIds.some((roomId) => !host.wall.roomIds.includes(roomId))
      )
        issues.push(
          issue({
            code: "opening-room-host-mismatch",
            severity: opening.reviewed ? "blocker" : "review",
            entityType: "opening",
            entityId: opening.id,
            floorId: opening.floorId,
            title: "Opening room binding disagrees with host wall",
            detail: `The nearest host wall and ${opening.kind} ${opening.id} reference different rooms.`,
            action: "Review the opening and wall room assignments before accepting it.",
          }),
        );
    }

    const key = [
      opening.floorId,
      opening.kind,
      opening.x.toFixed(3),
      opening.y.toFixed(3),
      opening.z.toFixed(3),
      opening.width.toFixed(3),
      opening.height.toFixed(3),
    ].join("|");
    const previous = openingKeys.get(key);
    if (previous)
      issues.push(
        issue({
          code: "duplicate-opening-geometry",
          severity: opening.reviewed && previous.reviewed ? "blocker" : "review",
          entityType: "opening",
          entityId: opening.id,
          floorId: opening.floorId,
          title: "Duplicate opening geometry",
          detail: `${opening.kind} ${opening.id} duplicates ${previous.id}.`,
          action: "Keep one supported opening and remove the duplicate.",
        }),
      );
    else openingKeys.set(key, opening);
  }

  const deduped = [...new Map(issues.map((row) => [row.id, row])).values()];
  const blocker = deduped.filter((row) => row.severity === "blocker").length;
  const review = deduped.filter((row) => row.severity === "review").length;

  return {
    schema: 1,
    kind: "rekixo-scene-geometry-integrity",
    overallStatus: blocker ? "blocked" : review ? "needs-review" : "passed",
    counts: { blocker, review },
    issues: deduped,
    checked: {
      floors: project.scene.floors.length,
      rooms: rooms.length,
      walls: walls.length,
      openings: openings.length,
    },
  };
}
