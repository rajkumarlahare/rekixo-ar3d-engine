import type { Floor, Room, RoomPoint, Wall } from "./domain";

interface Vertex {
  id: string;
  point: RoomPoint;
}
interface Edge {
  a: string;
  b: string;
}
interface RawSegment {
  start: RoomPoint;
  end: RoomPoint;
  height: number;
}

const ROOM_COLORS = [
  "#d8e8e2",
  "#e8dfd2",
  "#dce3ee",
  "#eadfdf",
  "#e5e3d5",
  "#dbe8ea",
];

function cross(ax: number, az: number, bx: number, bz: number) {
  return ax * bz - az * bx;
}

function area(points: readonly RoomPoint[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

function polygonBounds(points: readonly RoomPoint[]) {
  const xs = points.map((point) => point[0]);
  const zs = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

function pointAt(segment: RawSegment, t: number): RoomPoint {
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * t,
    segment.start[1] + (segment.end[1] - segment.start[1]) * t,
  ];
}

function intersectionT(left: RawSegment, right: RawSegment) {
  const px = left.start[0];
  const pz = left.start[1];
  const rx = left.end[0] - px;
  const rz = left.end[1] - pz;
  const qx = right.start[0];
  const qz = right.start[1];
  const sx = right.end[0] - qx;
  const sz = right.end[1] - qz;
  const denominator = cross(rx, rz, sx, sz);
  if (Math.abs(denominator) < 1e-8) return undefined;
  const qpx = qx - px;
  const qpz = qz - pz;
  const t = cross(qpx, qpz, sx, sz) / denominator;
  const u = cross(qpx, qpz, rx, rz) / denominator;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6)
    return undefined;
  return {
    left: Math.min(1, Math.max(0, t)),
    right: Math.min(1, Math.max(0, u)),
  };
}

function median(values: readonly number[]) {
  if (!values.length) return 2.8;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizePolygon(points: RoomPoint[]) {
  const cleaned: RoomPoint[] = [];
  for (const point of points) {
    const previous = cleaned.at(-1);
    if (
      previous &&
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.02
    )
      continue;
    cleaned.push(point);
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned.at(-1)!;
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.02)
      cleaned.pop();
  }
  return cleaned;
}

function facesFromSegments(
  segments: readonly RawSegment[],
  snap = 0.08,
): RoomPoint[][] {
  if (segments.length < 3 || segments.length > 700) return [];

  const split = segments.map(() => [0, 1]);
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const hit = intersectionT(segments[left], segments[right]);
      if (!hit) continue;
      split[left].push(hit.left);
      split[right].push(hit.right);
    }
  }

  const vertices = new Map<string, Vertex>();
  const canonical = (point: RoomPoint) => {
    const key = `${Math.round(point[0] / snap)}:${Math.round(point[1] / snap)}`;
    const existing = vertices.get(key);
    if (existing) return existing;
    const vertex = {
      id: key,
      point: [
        Number(point[0].toFixed(4)),
        Number(point[1].toFixed(4)),
      ] as RoomPoint,
    };
    vertices.set(key, vertex);
    return vertex;
  };

  const edgeKeys = new Set<string>();
  const edges: Edge[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const values = [...new Set(split[index].map((value) => Number(value.toFixed(7))))]
      .sort((a, b) => a - b);
    for (let part = 0; part + 1 < values.length; part += 1) {
      const a = canonical(pointAt(segments[index], values[part]));
      const b = canonical(pointAt(segments[index], values[part + 1]));
      if (
        a.id === b.id ||
        Math.hypot(
          a.point[0] - b.point[0],
          a.point[1] - b.point[1],
        ) < 0.12
      )
        continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ a: a.id, b: b.id });
    }
  }

  const outgoing = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const rows = outgoing.get(from) ?? [];
    if (!rows.includes(to)) rows.push(to);
    outgoing.set(from, rows);
  };
  for (const edge of edges) {
    add(edge.a, edge.b);
    add(edge.b, edge.a);
  }
  for (const [from, rows] of outgoing) {
    const origin = vertices.get(from)!.point;
    rows.sort((left, right) => {
      const a = vertices.get(left)!.point;
      const b = vertices.get(right)!.point;
      return (
        Math.atan2(a[1] - origin[1], a[0] - origin[0]) -
        Math.atan2(b[1] - origin[1], b[0] - origin[0])
      );
    });
  }

  const visited = new Set<string>();
  const faces: RoomPoint[][] = [];
  const directedKey = (a: string, b: string) => `${a}>${b}`;

  for (const edge of edges) {
    for (const [startA, startB] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ] as const) {
      if (visited.has(directedKey(startA, startB))) continue;
      const ids: string[] = [];
      let from = startA;
      let to = startB;
      let closed = false;
      for (let guard = 0; guard < edges.length * 3 + 10; guard += 1) {
        const key = directedKey(from, to);
        if (visited.has(key) && !(from === startA && to === startB)) break;
        visited.add(key);
        ids.push(from);

        const choices = outgoing.get(to);
        if (!choices?.length) break;
        const reverseIndex = choices.indexOf(from);
        if (reverseIndex < 0) break;
        const next = choices[(reverseIndex - 1 + choices.length) % choices.length];
        from = to;
        to = next;
        if (from === startA && to === startB) {
          closed = true;
          break;
        }
      }
      if (!closed || ids.length < 3) continue;
      const polygon = normalizePolygon(
        ids.map((id) => [...vertices.get(id)!.point] as RoomPoint),
      );
      if (polygon.length < 3) continue;
      const signed = area(polygon);
      const absolute = Math.abs(signed);
      if (signed <= 0 || absolute < 2 || absolute > 600) continue;
      faces.push(polygon);
    }
  }

  const unique = new Map<string, RoomPoint[]>();
  for (const face of faces) {
    const bounds = polygonBounds(face);
    const key = [
      Math.round(bounds.x * 10),
      Math.round(bounds.z * 10),
      Math.round(Math.abs(area(face)) * 10),
    ].join(":");
    if (!unique.has(key)) unique.set(key, face);
  }
  return [...unique.values()];
}

export interface AutoRoomDraftResult {
  rooms: Room[];
  skippedFloors: string[];
}

export function deriveAutoRoomDrafts(
  walls: readonly Wall[],
  floors: readonly Floor[],
  sourceAssetId?: string,
): AutoRoomDraftResult {
  const rooms: Room[] = [];
  const skippedFloors: string[] = [];

  for (const floor of floors) {
    const floorWalls = walls.filter(
      (wall) =>
        wall.floorId === floor.id &&
        (wall.reviewed || (wall.confidence ?? 0) >= 0.82),
    );
    const segments: RawSegment[] = floorWalls.map((wall) => ({
      start: wall.start,
      end: wall.end,
      height: wall.height,
    }));
    const faces = facesFromSegments(segments);
    if (!faces.length) {
      if (floorWalls.length >= 3) skippedFloors.push(floor.id);
      continue;
    }
    const roomHeight = Math.min(
      4.5,
      Math.max(2.4, median(floorWalls.map((wall) => wall.height))),
    );
    faces.forEach((polygon, index) => {
      const bounds = polygonBounds(polygon);
      if (bounds.width < 0.5 || bounds.depth < 0.5) return;
      rooms.push({
        id: `auto-room-${floor.id}-${index + 1}`,
        name: `Room ${index + 1}`,
        floorId: floor.id,
        unit: "Auto draft",
        x: Number(bounds.x.toFixed(4)),
        z: Number(bounds.z.toFixed(4)),
        width: Number(bounds.width.toFixed(4)),
        depth: Number(bounds.depth.toFixed(4)),
        polygon: polygon.map(
          ([x, z]) => [Number(x.toFixed(4)), Number(z.toFixed(4))] as RoomPoint,
        ),
        height: Number(roomHeight.toFixed(3)),
        color: ROOM_COLORS[index % ROOM_COLORS.length],
        source:
          "Auto draft from a closed high-confidence parametric wall loop. Requires visual review before publication.",
        verified: false,
        ...(sourceAssetId ? { sourceAssetId } : {}),
      });
    });
  }

  return { rooms, skippedFloors };
}
