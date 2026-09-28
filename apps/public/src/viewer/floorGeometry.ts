export type FloorGeometrySource = "scene" | "profile" | "inferred";

export interface FloorGeometryInput {
  floor: number;
  elevationM: number;
  topElevationM?: number;
}

export interface FloorGeometryLevel {
  floor: number;
  elevationM: number;
  topElevationM: number;
  source: FloorGeometrySource;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeFloorIds(values: readonly number[]) {
  return Array.from(
    new Set(values.filter((value) => finite(value))),
  ).sort((a, b) => a - b);
}

function strictlyIncreasing(values: readonly number[]) {
  for (let index = 1; index < values.length; index += 1)
    if (!(values[index] > values[index - 1])) return false;
  return true;
}

export function floorGeometryFromBoundaries(
  floors: readonly number[],
  boundaries: readonly number[],
  source: FloorGeometrySource = "profile",
): FloorGeometryLevel[] {
  const ids = normalizeFloorIds(floors);
  if (
    ids.length === 0 ||
    boundaries.length !== ids.length + 1 ||
    !boundaries.every(finite) ||
    !strictlyIncreasing(boundaries)
  )
    return [];

  return ids.map((floor, index) => ({
    floor,
    elevationM: boundaries[index],
    topElevationM: boundaries[index + 1],
    source,
  }));
}

function normalizeExplicitGeometry(
  floors: readonly number[],
  values: readonly FloorGeometryInput[] | undefined,
  maxY: number,
): FloorGeometryLevel[] {
  if (!values?.length) return [];

  const ids = normalizeFloorIds(floors.length ? floors : values.map((item) => item.floor));
  const byFloor = new Map<number, FloorGeometryInput>();
  for (const item of values) {
    if (
      !finite(item.floor) ||
      !finite(item.elevationM) ||
      (item.topElevationM !== undefined && !finite(item.topElevationM)) ||
      byFloor.has(item.floor)
    )
      return [];
    byFloor.set(item.floor, item);
  }
  if (ids.length !== byFloor.size || ids.some((floor) => !byFloor.has(floor)))
    return [];

  const ordered = ids
    .map((floor) => byFloor.get(floor)!)
    .sort((left, right) => left.elevationM - right.elevationM);

  if (!strictlyIncreasing(ordered.map((item) => item.elevationM)))
    return [];

  const result: FloorGeometryLevel[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index];
    const nextElevation = ordered[index + 1]?.elevationM;
    const topElevationM =
      item.topElevationM ??
      nextElevation ??
      maxY;

    if (!(topElevationM > item.elevationM)) return [];
    if (
      nextElevation !== undefined &&
      topElevationM > nextElevation + 1e-6
    )
      return [];

    result.push({
      floor: item.floor,
      elevationM: item.elevationM,
      topElevationM,
      source: "scene",
    });
  }
  return result;
}

export function resolveFloorGeometry(options: {
  floorIds: readonly number[];
  minY: number;
  maxY: number;
  scene?: readonly FloorGeometryInput[];
  profile?: readonly FloorGeometryLevel[];
}): FloorGeometryLevel[] {
  const minY = finite(options.minY) ? options.minY : 0;
  const maxY =
    finite(options.maxY) && options.maxY > minY
      ? options.maxY
      : minY + 1;

  const scene = normalizeExplicitGeometry(
    options.floorIds,
    options.scene,
    maxY,
  );
  if (scene.length) return scene;

  const floorIds = normalizeFloorIds(
    options.floorIds.length
      ? options.floorIds
      : options.profile?.map((item) => item.floor) ?? [],
  );

  if (options.profile?.length) {
    const byFloor = new Map(options.profile.map((item) => [item.floor, item]));
    if (
      floorIds.length === options.profile.length &&
      floorIds.every((floor) => {
        const item = byFloor.get(floor);
        return (
          item &&
          finite(item.elevationM) &&
          finite(item.topElevationM) &&
          item.topElevationM > item.elevationM
        );
      })
    )
      return floorIds.map((floor) => ({
        ...byFloor.get(floor)!,
        source: "profile",
      }));
  }

  const ids = floorIds.length ? floorIds : [0];
  const step = (maxY - minY) / ids.length;
  return ids.map((floor, index) => ({
    floor,
    elevationM: minY + step * index,
    topElevationM: index === ids.length - 1 ? maxY : minY + step * (index + 1),
    source: "inferred",
  }));
}

export function floorGeometryFor(
  geometry: readonly FloorGeometryLevel[],
  floor: number,
) {
  return geometry.find((item) => item.floor === floor);
}

export function floorForElevation(
  geometry: readonly FloorGeometryLevel[],
  elevation: number,
) {
  if (!geometry.length || !finite(elevation)) return undefined;

  for (let index = 0; index < geometry.length; index += 1) {
    const item = geometry[index];
    const last = index === geometry.length - 1;
    if (
      elevation >= item.elevationM &&
      (elevation < item.topElevationM ||
        (last && elevation <= item.topElevationM))
    )
      return item;
  }
  return undefined;
}

export function floorFocusElevation(level: FloorGeometryLevel) {
  return level.elevationM + (level.topElevationM - level.elevationM) * 0.52;
}

export function floorEyeElevation(
  level: FloorGeometryLevel,
  preferredEyeHeight = 1.65,
) {
  const height = level.topElevationM - level.elevationM;
  const localEye = Math.min(
    preferredEyeHeight,
    Math.max(height * 0.52, Math.min(1.15, height * 0.45)),
  );
  return Math.min(
    level.topElevationM - Math.min(0.12, height * 0.08),
    level.elevationM + localEye,
  );
}
