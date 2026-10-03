export type PlanPoint = readonly [number, number];

export interface PlanSegment {
  id?: string;
  start: PlanPoint;
  end: PlanPoint;
}

export type PlanSnapKind =
  | "none"
  | "grid"
  | "vertex"
  | "midpoint"
  | "edge"
  | "intersection";

export interface PlanSnapOptions {
  enabled?: boolean;
  gridSize?: number;
  vertexTolerance?: number;
  midpointTolerance?: number;
  edgeTolerance?: number;
  intersectionTolerance?: number;
  vertices?: readonly PlanPoint[];
  segments?: readonly PlanSegment[];
}

export interface PlanSnapResult {
  point: PlanPoint;
  kind: PlanSnapKind;
  distance: number;
  sourceId?: string;
}

function distance(a: PlanPoint, b: PlanPoint) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function closestPointOnSegment(point: PlanPoint, segment: PlanSegment): PlanPoint {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) return segment.start;
  const t = clamp(
    ((point[0] - segment.start[0]) * dx +
      (point[1] - segment.start[1]) * dz) /
      lengthSquared,
    0,
    1,
  );
  return [segment.start[0] + t * dx, segment.start[1] + t * dz];
}

function segmentIntersection(
  left: PlanSegment,
  right: PlanSegment,
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
  if (Math.abs(denominator) < 1e-9) return undefined;

  const t =
    ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) /
    denominator;
  const u =
    -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) /
    denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;
}

function snapPriority(kind: PlanSnapKind) {
  switch (kind) {
    case "intersection":
      return 5;
    case "vertex":
      return 4;
    case "midpoint":
      return 3;
    case "edge":
      return 2;
    case "grid":
      return 1;
    default:
      return 0;
  }
}

export function resolvePlanSnap(
  point: PlanPoint,
  options: PlanSnapOptions = {},
): PlanSnapResult {
  if (options.enabled === false)
    return { point: [point[0], point[1]], kind: "none", distance: 0 };

  const gridSize = positive(options.gridSize, 0.1);
  const grid: PlanPoint = [
    Math.round(point[0] / gridSize) * gridSize,
    Math.round(point[1] / gridSize) * gridSize,
  ];
  let best: PlanSnapResult = {
    point: grid,
    kind: "grid",
    distance: distance(point, grid),
  };

  const consider = (
    candidate: PlanPoint,
    kind: Exclude<PlanSnapKind, "none" | "grid">,
    tolerance: number,
    sourceId?: string,
  ) => {
    const candidateDistance = distance(point, candidate);
    const candidatePriority = snapPriority(kind);
    const bestPriority = snapPriority(best.kind);
    const meaningfullyCloser = candidateDistance + 0.03 < best.distance;
    const closerAtSameOrHigherPriority =
      candidatePriority >= bestPriority &&
      candidateDistance + 1e-9 < best.distance;
    const preferredSemanticSnap =
      candidatePriority > bestPriority &&
      candidateDistance <= best.distance + 0.03;
    if (
      candidateDistance <= tolerance &&
      (meaningfullyCloser ||
        closerAtSameOrHigherPriority ||
        preferredSemanticSnap)
    )
      best = {
        point: [candidate[0], candidate[1]],
        kind,
        distance: candidateDistance,
        ...(sourceId ? { sourceId } : {}),
      };
  };

  const vertexTolerance = positive(options.vertexTolerance, 0.24);
  const midpointTolerance = positive(options.midpointTolerance, 0.2);
  const edgeTolerance = positive(options.edgeTolerance, 0.18);
  const intersectionTolerance = positive(
    options.intersectionTolerance,
    edgeTolerance,
  );
  const segments = options.segments ?? [];

  for (const vertex of options.vertices ?? [])
    consider(vertex, "vertex", vertexTolerance);

  for (const segment of segments) {
    consider(segment.start, "vertex", vertexTolerance, segment.id);
    consider(segment.end, "vertex", vertexTolerance, segment.id);
    consider(
      [
        (segment.start[0] + segment.end[0]) / 2,
        (segment.start[1] + segment.end[1]) / 2,
      ],
      "midpoint",
      midpointTolerance,
      segment.id,
    );
    consider(
      closestPointOnSegment(point, segment),
      "edge",
      edgeTolerance,
      segment.id,
    );
  }

  if (segments.length <= 128) {
    for (let left = 0; left < segments.length; left += 1) {
      for (let right = left + 1; right < segments.length; right += 1) {
        const hit = segmentIntersection(segments[left], segments[right]);
        if (hit)
          consider(
            hit,
            "intersection",
            intersectionTolerance,
            segments[left].id ?? segments[right].id,
          );
      }
    }
  }

  return best;
}
