import type { Room, RoomPoint, Scene } from "./domain";

export type RoomSemanticEvidenceSource =
  | "cad-text"
  | "pdf-text"
  | "cad-object";

export interface RoomSemanticEvidence {
  id: string;
  floorId: string;
  point: RoomPoint;
  text: string;
  sourceAssetId?: string;
  source: RoomSemanticEvidenceSource;
  confidence: number;
  roomName?: string;
  unitName?: string;
}

export interface RoomSemanticBindingResult {
  scene: Scene;
  matchedEvidence: number;
  roomNamesApplied: number;
  unitAnchorsMatched: number;
  unitRoomsAssigned: number;
  unitGroupsDetected: number;
  unmatchedEvidence: number;
  reviewRemaining: number;
}

const COMMON_ROOM = /^(?:lobby|corridor|stair|lift|duct|shaft|passage|common\s+area)$/i;

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyRoomSemanticText(text: string): {
  roomName?: string;
  unitName?: string;
} {
  const cleaned = normalize(text);
  if (!cleaned) return {};
  const lower = cleaned.toLowerCase();

  let roomName: string | undefined;
  if (/\bmaster\s+bed\s*room\b/.test(lower)) roomName = "Master Bedroom";
  else if (/\bbed\s*room\b/.test(lower)) roomName = "Bedroom";
  else if (/\bliving(?:\s+room)?\b/.test(lower)) roomName = "Living Room";
  else if (/\bkitchen\b/.test(lower)) roomName = "Kitchen";
  else if (/\bdining(?:\s+room)?\b/.test(lower)) roomName = "Dining";
  else if (/\b(?:toilet|w\.?c\.?)\b/.test(lower)) roomName = "Toilet";
  else if (/\b(?:bath|bathroom)\b/.test(lower)) roomName = "Bathroom";
  else if (/\bbalcony\b/.test(lower)) roomName = "Balcony";
  else if (/\blobby\b/.test(lower)) roomName = "Lobby";
  else if (/\b(?:lift|elevator)\b/.test(lower)) roomName = "Lift";
  else if (/\bstair(?:case|s)?\b/.test(lower)) roomName = "Stair";
  else if (/\butility\b/.test(lower)) roomName = "Utility";
  else if (/\bstore(?:\s+room)?\b/.test(lower)) roomName = "Store";
  else if (/\bfoyer\b/.test(lower)) roomName = "Foyer";
  else if (/\bterrace\b/.test(lower)) roomName = "Terrace";
  else if (/\b(?:duct|shaft)\b/.test(lower)) roomName = "Duct";
  else if (/\b(?:corridor|passage)\b/.test(lower)) roomName = "Corridor";
  else if (/\bparking\b/.test(lower)) roomName = "Parking";

  let unitName: string | undefined;
  if (!/\b(?:to|through)\b/i.test(cleaned)) {
    const unit = cleaned.match(
      /\b(flat|unit|apartment|apt)\s*(?:no\.?\s*)?([a-z0-9][a-z0-9-]{0,15})\b/i,
    );
    if (unit?.[2]) {
      const prefix = /^flat$/i.test(unit[1])
        ? "Flat"
        : /^(?:apartment|apt)$/i.test(unit[1])
          ? "Apartment"
          : "Unit";
      unitName = `${prefix} ${unit[2].toUpperCase()}`;
    }
  }

  return {
    ...(roomName ? { roomName } : {}),
    ...(unitName ? { unitName } : {}),
  };
}

function polygonContains(points: readonly RoomPoint[], point: RoomPoint) {
  let inside = false;
  const [x, z] = point;
  for (
    let index = 0, previous = points.length - 1;
    index < points.length;
    previous = index++
  ) {
    const a = points[index];
    const b = points[previous];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > 0) {
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared,
        ),
      );
      const px = a[0] + t * dx;
      const pz = a[1] + t * dz;
      if (Math.hypot(x - px, z - pz) <= 0.025) return true;
    }
    const crosses =
      (a[1] > z) !== (b[1] > z) &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function roomContains(room: Room, point: RoomPoint) {
  if (room.polygon?.length) return polygonContains(room.polygon, point);
  return (
    Math.abs(point[0] - room.x) <= room.width / 2 + 0.025 &&
    Math.abs(point[1] - room.z) <= room.depth / 2 + 0.025
  );
}

function genericRoomName(name: string) {
  return /^(?:room\s+\d+|auto\s*room\s*\d*|layout\s+draft)$/i.test(
    name.trim(),
  );
}

function genericUnit(unit: string) {
  return /^(?:auto\s+draft|unassigned|unknown)?$/i.test(unit.trim());
}

function annotateSource(source: string) {
  const note = " Auto semantics matched from aligned uploaded source evidence.";
  if (source.includes(note.trim())) return source;
  return (source.trim() + note).trim().slice(0, 2000);
}

function bestValue(
  values: readonly { value: string; confidence: number }[],
): { value?: string; ambiguous: boolean } {
  if (!values.length) return { ambiguous: false };
  const byValue = new Map<string, number>();
  for (const row of values)
    byValue.set(
      row.value,
      Math.max(byValue.get(row.value) ?? 0, row.confidence),
    );
  const ranked = [...byValue.entries()]
    .map(([value, confidence]) => ({ value, confidence }))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.value.localeCompare(right.value),
    );
  if (
    ranked.length > 1 &&
    Math.abs(ranked[0].confidence - ranked[1].confidence) < 0.08
  )
    return { ambiguous: true };
  return { value: ranked[0].value, ambiguous: false };
}

function roomAdjacency(scene: Scene) {
  const graph = new Map<string, Set<string>>();
  for (const room of scene.rooms) graph.set(room.id, new Set());
  for (const wall of scene.walls ?? []) {
    if (wall.roomIds.length !== 2) continue;
    const [left, right] = wall.roomIds;
    graph.get(left)?.add(right);
    graph.get(right)?.add(left);
  }
  return graph;
}

function unitAssignments(
  scene: Scene,
  direct: Map<string, string>,
): {
  assignments: Map<string, string>;
  conflicts: number;
} {
  const assignments = new Map(direct);
  const distinctUnits = new Set(direct.values());
  if (distinctUnits.size < 2)
    return { assignments, conflicts: 0 };

  const graph = roomAdjacency(scene);
  const roomById = new Map(scene.rooms.map((room) => [room.id, room]));
  const distances = new Map<
    string,
    Array<{ unit: string; distance: number }>
  >();

  for (const [seedRoomId, unit] of direct) {
    const queue: Array<{ roomId: string; distance: number }> = [
      { roomId: seedRoomId, distance: 0 },
    ];
    const seen = new Set([seedRoomId]);
    while (queue.length) {
      const current = queue.shift()!;
      const room = roomById.get(current.roomId);
      if (!room) continue;
      if (
        current.distance > 0 &&
        COMMON_ROOM.test(room.name.trim())
      )
        continue;
      const rows = distances.get(current.roomId) ?? [];
      rows.push({ unit, distance: current.distance });
      distances.set(current.roomId, rows);
      if (current.distance >= 8) continue;
      for (const next of graph.get(current.roomId) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push({ roomId: next, distance: current.distance + 1 });
      }
    }
  }

  let conflicts = 0;
  for (const room of scene.rooms) {
    if (assignments.has(room.id) || !genericUnit(room.unit)) continue;
    if (COMMON_ROOM.test(room.name.trim())) continue;
    const rows = distances.get(room.id) ?? [];
    if (!rows.length) continue;
    const bestDistance = Math.min(...rows.map((row) => row.distance));
    const nearestUnits = [
      ...new Set(
        rows
          .filter((row) => row.distance === bestDistance)
          .map((row) => row.unit),
      ),
    ];
    if (nearestUnits.length !== 1) {
      conflicts += 1;
      continue;
    }
    assignments.set(room.id, nearestUnits[0]);
  }

  return { assignments, conflicts };
}

export function applyRoomSemanticEvidence(
  scene: Scene,
  evidence: readonly RoomSemanticEvidence[],
): RoomSemanticBindingResult {
  const usable = evidence.filter(
    (entry) =>
      entry.confidence >= 0.72 &&
      Number.isFinite(entry.point[0]) &&
      Number.isFinite(entry.point[1]) &&
      scene.floors.some((floor) => floor.id === entry.floorId),
  );

  const byRoom = new Map<string, RoomSemanticEvidence[]>();
  let unmatchedEvidence = 0;
  let reviewRemaining = 0;
  let matchedEvidence = 0;

  for (const entry of usable) {
    const matches = scene.rooms.filter(
      (room) =>
        room.floorId === entry.floorId &&
        roomContains(room, entry.point),
    );
    if (matches.length !== 1) {
      if (matches.length > 1) reviewRemaining += 1;
      else unmatchedEvidence += 1;
      continue;
    }
    matchedEvidence += 1;
    const rows = byRoom.get(matches[0].id) ?? [];
    rows.push(entry);
    byRoom.set(matches[0].id, rows);
  }

  let roomNamesApplied = 0;
  let unitAnchorsMatched = 0;
  const directUnits = new Map<string, string>();
  const rooms = scene.rooms.map((room) => {
    const rows = byRoom.get(room.id) ?? [];
    const roomChoice = bestValue(
      rows
        .filter((row) => row.roomName)
        .map((row) => ({
          value: row.roomName!,
          confidence: row.confidence,
        })),
    );
    const unitChoice = bestValue(
      rows
        .filter((row) => row.unitName && row.confidence >= 0.78)
        .map((row) => ({
          value: row.unitName!,
          confidence: row.confidence,
        })),
    );

    if (roomChoice.ambiguous) reviewRemaining += 1;
    if (unitChoice.ambiguous) reviewRemaining += 1;

    const next = { ...room };
    if (
      !roomChoice.ambiguous &&
      roomChoice.value &&
      !room.verified &&
      genericRoomName(room.name)
    ) {
      next.name = roomChoice.value;
      next.source = annotateSource(next.source);
      roomNamesApplied += 1;
    }
    if (
      !unitChoice.ambiguous &&
      unitChoice.value &&
      !room.verified &&
      genericUnit(room.unit)
    ) {
      directUnits.set(room.id, unitChoice.value);
      unitAnchorsMatched += 1;
    }
    return next;
  });

  const interim: Scene = { ...scene, rooms };
  const propagated = unitAssignments(interim, directUnits);
  reviewRemaining += propagated.conflicts;

  let unitRoomsAssigned = 0;
  const finalRooms = rooms.map((room) => {
    const unit = propagated.assignments.get(room.id);
    if (!unit || room.verified || !genericUnit(room.unit)) return room;
    unitRoomsAssigned += 1;
    return {
      ...room,
      unit,
      source: annotateSource(room.source),
    };
  });

  return {
    scene: { ...scene, rooms: finalRooms },
    matchedEvidence,
    roomNamesApplied,
    unitAnchorsMatched,
    unitRoomsAssigned,
    unitGroupsDetected: new Set(propagated.assignments.values()).size,
    unmatchedEvidence,
    reviewRemaining,
  };
}
