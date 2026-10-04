export type EditorPlanPoint = readonly [number, number];

export interface DirectPlanDragOptions {
  gridSize?: number;
}

function assertPlanPoint(label: string, point: EditorPlanPoint) {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]))
    throw new Error(`${label} must contain finite plan coordinates.`);
}

function snapCoordinate(value: number, gridSize: number) {
  const snapped = Math.round(value / gridSize) * gridSize;
  const normalized = Number(snapped.toFixed(6));
  return Object.is(normalized, -0) ? 0 : normalized;
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
