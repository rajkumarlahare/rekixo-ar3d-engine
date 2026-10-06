import type { Room, RoomPoint, Scene } from "./domain";
import type {
  CirculationCore,
  CirculationHierarchyReport,
  CirculationKind,
} from "./circulationHierarchy";

export type UnitHierarchyStatus = "auto-ready" | "review";

export interface UnitHierarchyUnit {
  id: string;
  label: string;
  floorId: string;
  floorName: string;
  status: UnitHierarchyStatus;
  roomIds: string[];
  sourceBackedRoomIds: string[];
  circulationCoreIds: string[];
  reviewedAccessOpeningIds: string[];
  reason: string;
}

export interface UnitHierarchyReport {
  units: UnitHierarchyUnit[];
  counts: {
    sourceBackedUnits: number;
    reviewUnits: number;
    sourceBackedRooms: number;
    unprovenUnitRooms: number;
    circulationLinks: number;
    unresolvedCirculationMembers: number;
  };
  issues: string[];
}

interface DoorEdge {
  nextRoomId: string;
  openingId: string;
}

const AUTO_SEMANTIC_NOTE =
  "Auto semantics matched from aligned uploaded source evidence.";
const GENERIC_UNIT = /^(?:auto\s+draft|unassigned|unknown|common|common\s+area)?$/i;
const COMMON_ROOM =
  /^(?:lobby|corridor|stair|staircase|lift|elevator|duct|shaft|passage|common\s+area|foyer)$/i;
const MAX_COMMON_PATH_DEPTH = 8;

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\s+/g, " ").trim();
}

function normalizedKey(value: string) {
  return normalize(value).toLowerCase();
}

function safeIdPart(value: string) {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function meaningfulUnit(room: Room) {
  const unit = normalize(room.unit ?? "");
  return unit && !GENERIC_UNIT.test(unit) ? unit : undefined;
}

function hasSourceIdentity(room: Room) {
  return Boolean(
    room.sourceAssetId ||
      room.sourcePackSourceId ||
      room.sourceClaimIds?.length,
  );
}

/**
 * Unit membership is trusted only when the room carries explicit aligned
 * semantic evidence, or when an operator-reviewed room is still traceable to
 * immutable source provenance. A typed unit label by itself is not evidence.
 */
function hasUnitEvidence(room: Room) {
  return (
    room.source.includes(AUTO_SEMANTIC_NOTE) ||
    (room.verified && hasSourceIdentity(room))
  );
}

function pointOnSegment(
  point: RoomPoint,
  left: RoomPoint,
  right: RoomPoint,
  epsilon = 1e-7,
) {
  const cross =
    (point[0] - left[0]) * (right[1] - left[1]) -
    (point[1] - left[1]) * (right[0] - left[0]);
  if (Math.abs(cross) > epsilon) return false;
  return (
    point[0] >= Math.min(left[0], right[0]) - epsilon &&
    point[0] <= Math.max(left[0], right[0]) + epsilon &&
    point[1] >= Math.min(left[1], right[1]) - epsilon &&
    point[1] <= Math.max(left[1], right[1]) + epsilon
  );
}

function roomContains(room: Room, point: RoomPoint) {
  if (!room.polygon?.length) {
    return (
      Math.abs(point[0] - room.x) <= room.width / 2 + 0.025 &&
      Math.abs(point[1] - room.z) <= room.depth / 2 + 0.025
    );
  }

  let inside = false;
  for (
    let index = 0, previous = room.polygon.length - 1;
    index < room.polygon.length;
    previous = index++
  ) {
    const left = room.polygon[index];
    const right = room.polygon[previous];
    if (pointOnSegment(point, left, right)) return true;
    const crosses =
      (left[1] > point[1]) !== (right[1] > point[1]) &&
      point[0] <
        ((right[0] - left[0]) * (point[1] - left[1])) /
          (right[1] - left[1]) +
          left[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function roomMatchesCirculationKind(room: Room, kind: CirculationKind) {
  const name = normalize(room.name).toLowerCase();
  return kind === "stair"
    ? /\bstair(?:case|s)?\b/.test(name)
    : /\b(?:lift|elevator)\b/.test(name);
}

function isCommonRoom(room: Room) {
  return COMMON_ROOM.test(normalize(room.name));
}

function reviewedDoorGraph(scene: Scene) {
  const graph = new Map<string, DoorEdge[]>();
  for (const room of scene.rooms) graph.set(room.id, []);
  for (const opening of scene.openings ?? []) {
    if (
      opening.kind !== "door" ||
      opening.reviewed !== true ||
      opening.roomIds.length !== 2
    )
      continue;
    const [left, right] = opening.roomIds;
    if (!graph.has(left) || !graph.has(right)) continue;
    graph.get(left)!.push({ nextRoomId: right, openingId: opening.id });
    graph.get(right)!.push({ nextRoomId: left, openingId: opening.id });
  }
  return graph;
}

function deterministicUnitId(floorId: string, label: string) {
  const floor = safeIdPart(floorId) || "floor";
  const unit = safeIdPart(label) || "unit";
  return `unit-${floor}-${unit}`;
}

function sourceBackedUnits(scene: Scene) {
  const floorName = new Map(scene.floors.map((floor) => [floor.id, floor.name]));
  const groups = new Map<string, Room[]>();
  let unprovenUnitRooms = 0;

  for (const room of scene.rooms) {
    const label = meaningfulUnit(room);
    if (!label) continue;
    if (!hasUnitEvidence(room)) {
      unprovenUnitRooms += 1;
      continue;
    }
    if (!floorName.has(room.floorId)) continue;
    const key = `${room.floorId}\u0000${normalizedKey(label)}`;
    const rows = groups.get(key) ?? [];
    rows.push(room);
    groups.set(key, rows);
  }

  const units: UnitHierarchyUnit[] = [];
  for (const rooms of groups.values()) {
    rooms.sort((left, right) => left.id.localeCompare(right.id));
    const first = rooms[0];
    const label = meaningfulUnit(first)!;
    const normalizedLabels = new Set(
      rooms.map((room) => normalizedKey(meaningfulUnit(room) ?? "")),
    );
    const status: UnitHierarchyStatus =
      normalizedLabels.size === 1 ? "auto-ready" : "review";
    units.push({
      id: deterministicUnitId(first.floorId, label),
      label,
      floorId: first.floorId,
      floorName: floorName.get(first.floorId) ?? first.floorId,
      status,
      roomIds: rooms.map((room) => room.id),
      sourceBackedRoomIds: rooms.map((room) => room.id),
      circulationCoreIds: [],
      reviewedAccessOpeningIds: [],
      reason:
        status === "auto-ready"
          ? "Unit membership is derived only from aligned source semantics or operator-reviewed source-backed rooms."
          : "Conflicting source-backed unit labels require review before hierarchy promotion.",
    });
  }

  units.sort(
    (left, right) =>
      left.floorName.localeCompare(right.floorName, undefined, { numeric: true }) ||
      left.label.localeCompare(right.label, undefined, { numeric: true }) ||
      left.id.localeCompare(right.id),
  );
  return { units, unprovenUnitRooms };
}

function bindCoreMemberToUnits(
  scene: Scene,
  core: CirculationCore,
  member: CirculationCore["members"][number],
  unitByRoomId: ReadonlyMap<string, UnitHierarchyUnit>,
  graph: ReadonlyMap<string, readonly DoorEdge[]>,
) {
  const circulationRooms = scene.rooms.filter(
    (room) =>
      room.floorId === member.floorId &&
      roomMatchesCirculationKind(room, core.kind) &&
      roomContains(room, [member.x, member.z]),
  );
  if (circulationRooms.length !== 1) return { resolved: false, links: 0 };

  const startRoom = circulationRooms[0];
  const queue: Array<{
    roomId: string;
    depth: number;
    pathOpeningIds: string[];
  }> = [{ roomId: startRoom.id, depth: 0, pathOpeningIds: [] }];
  const bestDepth = new Map<string, number>([[startRoom.id, 0]]);
  const links = new Map<string, { unit: UnitHierarchyUnit; openingIds: string[] }>();

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= MAX_COMMON_PATH_DEPTH) continue;
    for (const edge of graph.get(current.roomId) ?? []) {
      const nextRoom = scene.rooms.find((room) => room.id === edge.nextRoomId);
      if (!nextRoom || nextRoom.floorId !== member.floorId) continue;
      const nextPath = [...current.pathOpeningIds, edge.openingId];
      const unit = unitByRoomId.get(nextRoom.id);
      if (unit) {
        const existing = links.get(unit.id);
        if (!existing || nextPath.length < existing.openingIds.length)
          links.set(unit.id, { unit, openingIds: nextPath });
        continue;
      }
      if (!isCommonRoom(nextRoom)) continue;
      const nextDepth = current.depth + 1;
      const previous = bestDepth.get(nextRoom.id);
      if (previous !== undefined && previous <= nextDepth) continue;
      bestDepth.set(nextRoom.id, nextDepth);
      queue.push({
        roomId: nextRoom.id,
        depth: nextDepth,
        pathOpeningIds: nextPath,
      });
    }
  }

  for (const { unit, openingIds } of links.values()) {
    if (!unit.circulationCoreIds.includes(core.id))
      unit.circulationCoreIds.push(core.id);
    for (const openingId of openingIds)
      if (!unit.reviewedAccessOpeningIds.includes(openingId))
        unit.reviewedAccessOpeningIds.push(openingId);
  }
  return { resolved: true, links: links.size };
}

/**
 * Builds project-neutral unit hierarchy from explicit source semantics and then
 * binds a unit to a stair/lift core only through real reviewed door transitions.
 * It is metadata-only: the scene, room geometry, review flags and openings are
 * never mutated or inferred.
 */
export function buildUnitHierarchy(
  scene: Scene,
  circulation: CirculationHierarchyReport,
): UnitHierarchyReport {
  const { units, unprovenUnitRooms } = sourceBackedUnits(scene);
  const unitByRoomId = new Map<string, UnitHierarchyUnit>();
  for (const unit of units)
    for (const roomId of unit.roomIds) unitByRoomId.set(roomId, unit);

  const graph = reviewedDoorGraph(scene);
  let circulationLinks = 0;
  let unresolvedCirculationMembers = 0;

  for (const core of circulation.cores) {
    if (core.status !== "auto-ready") continue;
    for (const member of core.members) {
      const bound = bindCoreMemberToUnits(
        scene,
        core,
        member,
        unitByRoomId,
        graph,
      );
      if (!bound.resolved) unresolvedCirculationMembers += 1;
      circulationLinks += bound.links;
    }
  }

  for (const unit of units) {
    unit.circulationCoreIds.sort();
    unit.reviewedAccessOpeningIds.sort();
  }

  const issues: string[] = [];
  if (unprovenUnitRooms)
    issues.push(
      `${unprovenUnitRooms} room${unprovenUnitRooms === 1 ? "" : "s"} had a unit label without aligned semantic or reviewed source provenance and stayed outside automatic unit hierarchy.`,
    );
  if (unresolvedCirculationMembers)
    issues.push(
      `${unresolvedCirculationMembers} auto-ready stair/lift floor member${unresolvedCirculationMembers === 1 ? "" : "s"} could not be uniquely located inside a matching circulation room; unit access was not inferred.`,
    );

  return {
    units,
    counts: {
      sourceBackedUnits: units.length,
      reviewUnits: units.filter((unit) => unit.status === "review").length,
      sourceBackedRooms: units.reduce(
        (total, unit) => total + unit.sourceBackedRoomIds.length,
        0,
      ),
      unprovenUnitRooms,
      circulationLinks,
      unresolvedCirculationMembers,
    },
    issues,
  };
}
