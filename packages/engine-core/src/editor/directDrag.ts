export type EditorPlanPoint = readonly [number, number];
export type PlanResizeCorner = "nw" | "ne" | "se" | "sw";

export interface DirectPlanDragOptions {
  gridSize?: number;
}

export interface EdgeSnapTargets {
  x?: readonly number[];
  z?: readonly number[];
}

export interface EdgeSnapOptions {
  tolerance?: number;
}

export interface EdgeSnapResult {
  point: [number, number];
  snappedX: boolean;
  snappedZ: boolean;
}

export interface PlanCornerResizeOptions {
  minWidth?: number;
  minDepth?: number;
}

export interface PlanCornerResizeResult {
  centre: [number, number];
  width: number;
  depth: number;
  cornerPoint: [number, number];
}

function assertPlanPoint(label: string, point: EditorPlanPoint) {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]))
    throw new Error(`${label} must contain finite plan coordinates.`);
}

function normalized(value: number) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function snapCoordinate(value: number, gridSize: number) {
  return normalized(Math.round(value / gridSize) * gridSize);
}

function nearestEdgeDelta(
  centre: number,
  halfExtent: number,
  targets: readonly number[],
  tolerance: number,
) {
  let best:
    | { delta: number; distance: number; target: number; edge: number }
    | undefined;
  const edges = [centre - halfExtent, centre + halfExtent];
  for (const target of targets) {
    if (!Number.isFinite(target)) continue;
    for (const edge of edges) {
      const delta = target - edge;
      const distance = Math.abs(delta);
      if (distance > tolerance) continue;
      if (
        !best ||
        distance < best.distance - 1e-9 ||
        (Math.abs(distance - best.distance) <= 1e-9 &&
          (target < best.target - 1e-9 ||
            (Math.abs(target - best.target) <= 1e-9 && edge < best.edge)))
      )
        best = { delta, distance, target, edge };
    }
  }
  return best?.delta;
}

/**
 * Resolves a direct-manipulation object centre from a grabbed pointer point.
 *
 * The grab offset is preserved so an object does not jump under the cursor or
 * finger when dragging starts. Optional grid snapping is applied to the object
 * centre, not the raw pointer position.
 */
export function resolveDirectPlanDrag(
  origin: EditorPlanPoint,
  grab: EditorPlanPoint,
  pointer: EditorPlanPoint,
  options: DirectPlanDragOptions = {},
): [number, number] {
  assertPlanPoint("Direct drag origin", origin);
  assertPlanPoint("Direct drag grab point", grab);
  assertPlanPoint("Direct drag pointer point", pointer);

  const gridSize = options.gridSize ?? 0;
  if (!Number.isFinite(gridSize) || gridSize < 0)
    throw new Error("Direct drag grid size must be a finite non-negative number.");

  const x = origin[0] + pointer[0] - grab[0];
  const z = origin[1] + pointer[1] - grab[1];
  if (!gridSize) return [x, z];
  return [snapCoordinate(x, gridSize), snapCoordinate(z, gridSize)];
}

/**
 * Snaps an axis-aligned footprint by its outside edges instead of snapping the
 * object centre. This makes direct correction feel like CAD: a room/furniture
 * edge can line up with nearby room or wall evidence without changing size.
 */
export function resolveEdgeSnap(
  centre: EditorPlanPoint,
  halfExtents: EditorPlanPoint,
  targets: EdgeSnapTargets,
  options: EdgeSnapOptions = {},
): EdgeSnapResult {
  assertPlanPoint("Edge snap centre", centre);
  assertPlanPoint("Edge snap half extents", halfExtents);
  if (halfExtents[0] < 0 || halfExtents[1] < 0)
    throw new Error("Edge snap half extents must be non-negative.");

  const tolerance = options.tolerance ?? 0.18;
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error("Edge snap tolerance must be a finite non-negative number.");

  const dx = nearestEdgeDelta(
    centre[0],
    halfExtents[0],
    targets.x ?? [],
    tolerance,
  );
  const dz = nearestEdgeDelta(
    centre[1],
    halfExtents[1],
    targets.z ?? [],
    tolerance,
  );

  return {
    point: [
      normalized(centre[0] + (dx ?? 0)),
      normalized(centre[1] + (dz ?? 0)),
    ],
    snappedX: dx !== undefined,
    snappedZ: dz !== undefined,
  };
}

function cornerSigns(corner: PlanResizeCorner): readonly [number, number] {
  switch (corner) {
    case "nw":
      return [-1, -1];
    case "ne":
      return [1, -1];
    case "se":
      return [1, 1];
    case "sw":
      return [-1, 1];
  }
}

/**
 * Resizes a rectangular plan footprint from one corner while keeping the
 * opposite corner fixed. Coordinates are local to the object's unrotated plan
 * axes, so callers can safely use the same kernel for rotated site objects by
 * transforming the pointer into local space first.
 */
export function resolvePlanCornerResize(
  originalSize: EditorPlanPoint,
  corner: PlanResizeCorner,
  pointerLocal: EditorPlanPoint,
  options: PlanCornerResizeOptions = {},
): PlanCornerResizeResult {
  assertPlanPoint("Plan resize size", originalSize);
  assertPlanPoint("Plan resize pointer", pointerLocal);
  if (originalSize[0] <= 0 || originalSize[1] <= 0)
    throw new Error("Plan resize size must be positive.");

  const minWidth = options.minWidth ?? 0.2;
  const minDepth = options.minDepth ?? 0.2;
  if (
    !Number.isFinite(minWidth) ||
    !Number.isFinite(minDepth) ||
    minWidth <= 0 ||
    minDepth <= 0
  )
    throw new Error("Plan resize minimum dimensions must be finite and positive.");

  const [signX, signZ] = cornerSigns(corner);
  const fixedX = (-signX * originalSize[0]) / 2;
  const fixedZ = (-signZ * originalSize[1]) / 2;
  const x =
    signX > 0
      ? Math.max(pointerLocal[0], fixedX + minWidth)
      : Math.min(pointerLocal[0], fixedX - minWidth);
  const z =
    signZ > 0
      ? Math.max(pointerLocal[1], fixedZ + minDepth)
      : Math.min(pointerLocal[1], fixedZ - minDepth);

  return {
    centre: [normalized((fixedX + x) / 2), normalized((fixedZ + z) / 2)],
    width: normalized(Math.abs(x - fixedX)),
    depth: normalized(Math.abs(z - fixedZ)),
    cornerPoint: [normalized(x), normalized(z)],
  };
}
