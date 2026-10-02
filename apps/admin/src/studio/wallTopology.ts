import type { RoomPoint, Wall } from "./domain";

export interface WallTopologyOptions {
  /** Maximum endpoint gap that can be healed without inventing a long wall. */
  snapTolerance?: number;
  /** Segments shorter than this are removed from an automatic topology graph. */
  minSegmentLength?: number;
}

export interface WallTopologyResult {
  walls: Wall[];
  snappedEndpoints: number;
  intersectionSplits: number;
  duplicatesRemoved: number;
  tinySegmentsRemoved: number;
}

interface EndpointRef {
  wallIndex: number;
  end: 0 | 1;
  point: RoomPoint;
  direction: RoomPoint;
  weight: number;
}

interface WorkingWall {
  wall: Wall;
  start: RoomPoint;
  end: RoomPoint;
}

const DEFAULT_SNAP_TOLERANCE = 0.08;
const DEFAULT_MIN_SEGMENT_LENGTH = 0.12;

function cross(ax: number, az: number, bx: number, bz: number) {
  return ax * bz - az * bx;
}

function dot(ax: number, az: number, bx: number, bz: number) {
  return ax * bx + az * bz;
}

function length(a: RoomPoint, b: RoomPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function normalizedDirection(a: RoomPoint, b: RoomPoint): RoomPoint {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const magnitude = Math.hypot(dx, dz);
  if (magnitude < 1e-8) return [0, 0];
  return [dx / magnitude, dz / magnitude];
}

function pointLineDistance(
  point: RoomPoint,
  linePoint: RoomPoint,
  direction: RoomPoint,
) {
  if (Math.hypot(direction[0], direction[1]) < 1e-8)
    return Number.POSITIVE_INFINITY;
  const dx = point[0] - linePoint[0];
  const dz = point[1] - linePoint[1];
  return Math.abs(cross(dx, dz, direction[0], direction[1]));
}

function endpointsCompatible(
  left: EndpointRef,
  right: EndpointRef,
  tolerance: number,
) {
  if (left.wallIndex === right.wallIndex) return false;
  const gap = length(left.point, right.point);
  if (gap > tolerance) return false;
  if (gap <= Math.min(0.025, tolerance * 0.35)) return true;

  const alignment = Math.abs(
    dot(
      left.direction[0],
      left.direction[1],
      right.direction[0],
      right.direction[1],
    ),
  );
  if (alignment < 0.97) return true;

  // Collinear gaps may be healed, but nearby parallel wall faces must not
  // collapse into one centreline simply because their endpoints are close.
  const lineTolerance = Math.min(0.025, tolerance * 0.35);
  return (
    pointLineDistance(left.point, right.point, right.direction) <=
      lineTolerance &&
    pointLineDistance(right.point, left.point, left.direction) <=
      lineTolerance
  );
}

function weightedCentre(refs: readonly EndpointRef[]): RoomPoint {
  let total = 0;
  let x = 0;
  let z = 0;
  for (const ref of refs) {
    const weight = Math.max(0.25, Math.min(1, ref.weight));
    total += weight;
    x += ref.point[0] * weight;
    z += ref.point[1] * weight;
  }
  if (!total) return [...refs[0].point] as RoomPoint;
  return [
    Number((x / total).toFixed(4)),
    Number((z / total).toFixed(4)),
  ];
}

function authority(wall: Wall) {
  const origin =
    wall.origin === "manual"
      ? 40
      : wall.origin === "cad-auto"
        ? 30
        : wall.origin === "model-auto"
          ? 20
          : 10;
  const review = wall.reviewed ? 100 : 0;
  const state =
    wall.reviewState === "human_reviewed"
      ? 20
      : wall.reviewState === "auto_ready"
        ? 10
        : 0;
  return review + state + origin + (wall.confidence ?? 0);
}

function segmentKey(
  floorId: string,
  start: RoomPoint,
  end: RoomPoint,
) {
  const q = (value: number) => Math.round(value * 200) / 200;
  const a: RoomPoint = [q(start[0]), q(start[1])];
  const b: RoomPoint = [q(end[0]), q(end[1])];
  const [left, right] =
    a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
      ? [a, b]
      : [b, a];
  return `${floorId}:${left[0]},${left[1]}:${right[0]},${right[1]}`;
}

function pointAt(
  start: RoomPoint,
  end: RoomPoint,
  t: number,
): RoomPoint {
  return [
    Number((start[0] + (end[0] - start[0]) * t).toFixed(4)),
    Number((start[1] + (end[1] - start[1]) * t).toFixed(4)),
  ];
}

function intersectionParameters(
  leftStart: RoomPoint,
  leftEnd: RoomPoint,
  rightStart: RoomPoint,
  rightEnd: RoomPoint,
) {
  const px = leftStart[0];
  const pz = leftStart[1];
  const rx = leftEnd[0] - px;
  const rz = leftEnd[1] - pz;
  const qx = rightStart[0];
  const qz = rightStart[1];
  const sx = rightEnd[0] - qx;
  const sz = rightEnd[1] - qz;
  const denominator = cross(rx, rz, sx, sz);
  if (Math.abs(denominator) < 1e-8) return undefined;
  const qpx = qx - px;
  const qpz = qz - pz;
  const t = cross(qpx, qpz, sx, sz) / denominator;
  const u = cross(qpx, qpz, rx, rz) / denominator;
  if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7)
    return undefined;
  return {
    left: Math.min(1, Math.max(0, t)),
    right: Math.min(1, Math.max(0, u)),
  };
}

function snapFloorEndpoints(
  walls: WorkingWall[],
  tolerance: number,
) {
  const refs: EndpointRef[] = [];
  walls.forEach((entry, wallIndex) => {
    refs.push({
      wallIndex,
      end: 0,
      point: entry.start,
      direction: normalizedDirection(entry.start, entry.end),
      weight: entry.wall.confidence ?? 0.75,
    });
    refs.push({
      wallIndex,
      end: 1,
      point: entry.end,
      direction: normalizedDirection(entry.end, entry.start),
      weight: entry.wall.confidence ?? 0.75,
    });
  });

  const parent = refs.map((_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) current = parent[current];
    let node = value;
    while (parent[node] !== node) {
      const next = parent[node];
      parent[node] = current;
      node = next;
    }
    return current;
  };
  const unite = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  for (let left = 0; left < refs.length; left += 1)
    for (let right = left + 1; right < refs.length; right += 1)
      if (endpointsCompatible(refs[left], refs[right], tolerance))
        unite(left, right);

  const groups = new Map<number, EndpointRef[]>();
  refs.forEach((ref, index) => {
    const root = find(index);
    const rows = groups.get(root) ?? [];
    rows.push(ref);
    groups.set(root, rows);
  });

  let snapped = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const centre = weightedCentre(group);
    for (const ref of group) {
      const entry = walls[ref.wallIndex];
      const before = ref.end === 0 ? entry.start : entry.end;
      if (length(before, centre) > 1e-5) snapped += 1;
      if (ref.end === 0) entry.start = [...centre];
      else entry.end = [...centre];
    }
  }
  return snapped;
}

function splitAtIntersections(
  walls: readonly WorkingWall[],
  minSegmentLength: number,
) {
  const split = walls.map(() => [0, 1]);
  let intersectionSplits = 0;

  for (let left = 0; left < walls.length; left += 1) {
    for (let right = left + 1; right < walls.length; right += 1) {
      const hit = intersectionParameters(
        walls[left].start,
        walls[left].end,
        walls[right].start,
        walls[right].end,
      );
      if (!hit) continue;

      const leftLength = length(walls[left].start, walls[left].end);
      const rightLength = length(walls[right].start, walls[right].end);
      const leftInset =
        leftLength > 0 ? Math.min(0.2, minSegmentLength / leftLength / 2) : 1;
      const rightInset =
        rightLength > 0 ? Math.min(0.2, minSegmentLength / rightLength / 2) : 1;

      if (hit.left > leftInset && hit.left < 1 - leftInset) {
        split[left].push(hit.left);
        intersectionSplits += 1;
      }
      if (hit.right > rightInset && hit.right < 1 - rightInset) {
        split[right].push(hit.right);
        intersectionSplits += 1;
      }
    }
  }

  const parts: Wall[] = [];
  walls.forEach((entry, wallIndex) => {
    const values = [
      ...new Set(split[wallIndex].map((value) => Number(value.toFixed(7)))),
    ].sort((left, right) => left - right);
    const multiple = values.length > 2;

    for (let part = 0; part + 1 < values.length; part += 1) {
      const start = pointAt(entry.start, entry.end, values[part]);
      const end = pointAt(entry.start, entry.end, values[part + 1]);
      if (length(start, end) < minSegmentLength) continue;
      parts.push({
        ...entry.wall,
        id: multiple ? `${entry.wall.id}-topo-${part + 1}` : entry.wall.id,
        roomIds: [...entry.wall.roomIds],
        start,
        end,
      });
    }
  });

  return { parts, intersectionSplits };
}

function deduplicate(walls: readonly Wall[]) {
  const result = new Map<string, Wall>();
  let removed = 0;

  for (const wall of walls) {
    const key = segmentKey(wall.floorId, wall.start, wall.end);
    const existing = result.get(key);
    if (!existing) {
      result.set(key, { ...wall, roomIds: [...wall.roomIds] });
      continue;
    }
    removed += 1;
    const winner = authority(wall) > authority(existing) ? wall : existing;
    const roomIds = [...new Set([...existing.roomIds, ...wall.roomIds])].slice(
      0,
      2,
    );
    result.set(key, { ...winner, roomIds });
  }

  return { walls: [...result.values()], removed };
}

/**
 * Conservative topology cleanup for machine-derived wall graphs.
 *
 * It heals only small, geometrically plausible endpoint gaps, nodes true
 * intersections, removes tiny fragments and de-duplicates coincident segments.
 * It deliberately does not invent missing long walls or collapse nearby
 * parallel wall faces.
 */
export function regularizeWallTopology(
  walls: readonly Wall[],
  options: WallTopologyOptions = {},
): WallTopologyResult {
  const snapTolerance = Math.min(
    0.2,
    Math.max(0.01, options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE),
  );
  const minSegmentLength = Math.min(
    1,
    Math.max(0.03, options.minSegmentLength ?? DEFAULT_MIN_SEGMENT_LENGTH),
  );

  const usable = walls.filter(
    (wall) =>
      Number.isFinite(wall.start[0]) &&
      Number.isFinite(wall.start[1]) &&
      Number.isFinite(wall.end[0]) &&
      Number.isFinite(wall.end[1]) &&
      length(wall.start, wall.end) >= minSegmentLength,
  );
  let tinySegmentsRemoved = walls.length - usable.length;

  const byFloor = new Map<string, WorkingWall[]>();
  for (const wall of usable) {
    const rows = byFloor.get(wall.floorId) ?? [];
    rows.push({
      wall: { ...wall, roomIds: [...wall.roomIds] },
      start: [...wall.start],
      end: [...wall.end],
    });
    byFloor.set(wall.floorId, rows);
  }

  let snappedEndpoints = 0;
  let intersectionSplits = 0;
  const rebuilt: Wall[] = [];

  for (const floorWalls of byFloor.values()) {
    snappedEndpoints += snapFloorEndpoints(floorWalls, snapTolerance);
    const split = splitAtIntersections(floorWalls, minSegmentLength);
    intersectionSplits += split.intersectionSplits;
    rebuilt.push(...split.parts);
  }

  const afterSplit = rebuilt.filter((wall) => {
    const keep = length(wall.start, wall.end) >= minSegmentLength;
    if (!keep) tinySegmentsRemoved += 1;
    return keep;
  });
  const deduped = deduplicate(afterSplit);

  return {
    walls: deduped.walls,
    snappedEndpoints,
    intersectionSplits,
    duplicatesRemoved: deduped.removed,
    tinySegmentsRemoved,
  };
}
