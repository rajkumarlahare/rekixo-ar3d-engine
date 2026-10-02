import type { PlanPoint, PlanSegment } from "./snap";

export interface PlanFace {
  key: string;
  points: PlanPoint[];
  area: number;
}

function pointDistance(left: PlanPoint, right: PlanPoint) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function signedArea(points: readonly PlanPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index][0] * next[1] - next[0] * points[index][1];
  }
  return area / 2;
}

function pointOnSegment(
  point: PlanPoint,
  segment: PlanSegment,
  tolerance: number,
) {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const length = Math.hypot(dx, dz);
  if (length <= tolerance) return false;
  const cross =
    (point[0] - segment.start[0]) * dz -
    (point[1] - segment.start[1]) * dx;
  if (Math.abs(cross) > tolerance * Math.max(1, length)) return false;
  const dot =
    (point[0] - segment.start[0]) * dx +
    (point[1] - segment.start[1]) * dz;
  return dot >= -tolerance && dot <= length * length + tolerance;
}

function segmentIntersection(
  left: PlanSegment,
  right: PlanSegment,
  tolerance: number,
): PlanPoint | undefined {
  const x1 = left.start[0];
  const y1 = left.start[1];
  const x2 = left.end[0];
  const y2 = left.end[1];
  const x3 = right.start[0];
  const y3 = right.start[1];
  const x4 = right.end[0];
  const y4 = right.end[1];
  const denominator =
    (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) <= tolerance * tolerance) return undefined;
  const t =
    ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) /
    denominator;
  const u =
    -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) /
    denominator;
  if (
    t < -tolerance ||
    t > 1 + tolerance ||
    u < -tolerance ||
    u > 1 + tolerance
  )
    return undefined;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function parameterOnSegment(point: PlanPoint, segment: PlanSegment) {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (!lengthSquared) return 0;
  return (
    ((point[0] - segment.start[0]) * dx +
      (point[1] - segment.start[1]) * dz) /
    lengthSquared
  );
}

function simplifyPolygon(points: PlanPoint[], tolerance: number) {
  let result = [...points];
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    const next: PlanPoint[] = [];
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const following = result[(index + 1) % result.length];
      const ax = current[0] - previous[0];
      const az = current[1] - previous[1];
      const bx = following[0] - current[0];
      const bz = following[1] - current[1];
      const cross = Math.abs(ax * bz - az * bx);
      const scale = Math.max(1, Math.hypot(ax, az), Math.hypot(bx, bz));
      if (cross <= tolerance * scale) {
        changed = true;
        continue;
      }
      next.push(current);
    }
    if (next.length >= 3) result = next;
    else break;
  }
  return result;
}

function faceKey(points: readonly PlanPoint[], tolerance: number) {
  const rounded = points.map(
    ([x, z]) =>
      [
        Math.round(x / tolerance),
        Math.round(z / tolerance),
      ] as const,
  );
  let best = "";
  for (let offset = 0; offset < rounded.length; offset += 1) {
    const candidate = Array.from({ length: rounded.length }, (_, index) => {
      const point = rounded[(offset + index) % rounded.length];
      return `${point[0]},${point[1]}`;
    }).join(";");
    if (!best || candidate < best) best = candidate;
  }
  return best;
}

export function detectPlanFaces(
  inputSegments: readonly PlanSegment[],
  options: {
    nodeMergeTolerance?: number;
    minimumArea?: number;
    maxSegments?: number;
  } = {},
): PlanFace[] {
  const tolerance = Math.max(0.0001, options.nodeMergeTolerance ?? 0.01);
  const minimumArea = Math.max(0.001, options.minimumArea ?? 0.25);
  const maxSegments = Math.max(8, Math.floor(options.maxSegments ?? 512));
  const segments = inputSegments.filter(
    (segment) => pointDistance(segment.start, segment.end) > tolerance,
  );
  if (segments.length < 3 || segments.length > maxSegments) return [];

  const cuts = segments.map((segment) => [
    segment.start as PlanPoint,
    segment.end as PlanPoint,
  ]);

  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const hit = segmentIntersection(segments[left], segments[right], tolerance);
      if (hit) {
        cuts[left].push(hit);
        cuts[right].push(hit);
      }
      for (const point of [segments[right].start, segments[right].end])
        if (pointOnSegment(point, segments[left], tolerance))
          cuts[left].push(point);
      for (const point of [segments[left].start, segments[left].end])
        if (pointOnSegment(point, segments[right], tolerance))
          cuts[right].push(point);
    }
  }

  const nodePoints = new Map<string, PlanPoint>();
  const nodeKey = (point: PlanPoint) => {
    const key = `${Math.round(point[0] / tolerance)},${Math.round(
      point[1] / tolerance,
    )}`;
    if (!nodePoints.has(key))
      nodePoints.set(key, [point[0], point[1]]);
    return key;
  };
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (left: string, right: string) => {
    if (left === right) return;
    if (!adjacency.has(left)) adjacency.set(left, new Set());
    if (!adjacency.has(right)) adjacency.set(right, new Set());
    adjacency.get(left)!.add(right);
    adjacency.get(right)!.add(left);
  };

  segments.forEach((segment, index) => {
    const ordered = cuts[index]
      .map((point) => ({
        point,
        parameter: parameterOnSegment(point, segment),
      }))
      .sort((left, right) => left.parameter - right.parameter)
      .filter(
        (entry, itemIndex, rows) =>
          itemIndex === 0 ||
          pointDistance(entry.point, rows[itemIndex - 1].point) > tolerance,
      );
    for (let item = 0; item + 1 < ordered.length; item += 1) {
      const left = nodeKey(ordered[item].point);
      const right = nodeKey(ordered[item + 1].point);
      addEdge(left, right);
    }
  });

  const sortedNeighbors = new Map<string, string[]>();
  for (const [key, neighbors] of adjacency) {
    const origin = nodePoints.get(key)!;
    sortedNeighbors.set(
      key,
      [...neighbors].sort((left, right) => {
        const a = nodePoints.get(left)!;
        const b = nodePoints.get(right)!;
        return (
          Math.atan2(a[1] - origin[1], a[0] - origin[0]) -
          Math.atan2(b[1] - origin[1], b[0] - origin[0])
        );
      }),
    );
  }

  const visited = new Set<string>();
  const faces: PlanFace[] = [];
  const emitted = new Set<string>();
  const directedKey = (left: string, right: string) => `${left}>${right}`;

  for (const [start, neighbors] of sortedNeighbors) {
    for (const first of neighbors) {
      const initialKey = directedKey(start, first);
      if (visited.has(initialKey)) continue;
      const polygonKeys: string[] = [];
      let left = start;
      let right = first;
      let closed = false;
      const guard = Math.max(32, adjacency.size * 8);

      for (let step = 0; step < guard; step += 1) {
        const key = directedKey(left, right);
        if (visited.has(key) && step > 0) break;
        visited.add(key);
        polygonKeys.push(left);
        const nextNeighbors = sortedNeighbors.get(right) ?? [];
        const reverseIndex = nextNeighbors.indexOf(left);
        if (reverseIndex < 0 || nextNeighbors.length < 2) break;
        const next =
          nextNeighbors[
            (reverseIndex - 1 + nextNeighbors.length) % nextNeighbors.length
          ];
        left = right;
        right = next;
        if (left === start && right === first) {
          closed = true;
          break;
        }
      }

      if (!closed || polygonKeys.length < 3) continue;
      let points = polygonKeys.map((key) => nodePoints.get(key)!);
      points = simplifyPolygon(points, tolerance);
      if (points.length < 3 || points.length > 128) continue;
      const area = signedArea(points);
      // With the clockwise-at-vertex half-edge rule, bounded faces are
      // counter-clockwise (positive area) and the unbounded outside face is
      // clockwise. Keeping only positive faces avoids inventing an outer room.
      if (area < minimumArea) continue;
      const key = faceKey(points, tolerance);
      if (emitted.has(key)) continue;
      emitted.add(key);
      faces.push({
        key,
        points: points.map(([x, z]) => [
          Number(x.toFixed(4)),
          Number(z.toFixed(4)),
        ]),
        area: Number(area.toFixed(4)),
      });
    }
  }

  return faces.sort((left, right) => right.area - left.area);
}
