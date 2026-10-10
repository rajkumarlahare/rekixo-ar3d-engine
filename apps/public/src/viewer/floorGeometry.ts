export type FloorGeometrySource = "scene" | "profile" | "model";

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

export interface ModelMeshBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface ModelDerivedFloorGeometry {
  floors: FloorGeometryLevel[];
  roof?: FloorGeometryLevel;
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

function isValidBounds(box: ModelMeshBounds) {
  return [
    box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ,
  ].every(finite) &&
    box.maxX > box.minX &&
    box.maxY > box.minY &&
    box.maxZ > box.minZ;
}

function horizontalOverlapRatio(a: ModelMeshBounds, b: ModelMeshBounds) {
  const overlapX = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapZ = Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
  const smallerWidth = Math.min(a.maxX - a.minX, b.maxX - b.minX);
  const smallerDepth = Math.min(a.maxZ - a.minZ, b.maxZ - b.minZ);
  if (smallerWidth <= 0 || smallerDepth <= 0) return 0;
  return Math.min(overlapX / smallerWidth, overlapZ / smallerDepth);
}

function quantize(value: number, step = 0.05) {
  return Math.round(value / step);
}

/**
 * Derive floor bands from the loaded model's own meshes.
 *
 * A candidate must occupy a substantial part of the building footprint and
 * have a plausible storey-sized vertical span. At least three matching mesh
 * bands must form a contiguous vertical stack; a compatible lower band and
 * upper-storey band are then required before exposing controls. No floor
 * boundaries are manufactured by evenly dividing the overall model height.
 *
 * This intentionally fails closed for merged/unstructured GLBs: operators
 * must supply reviewed scene elevations rather than receive misleading cuts.
 */
export function deriveFloorGeometryFromModel(options: {
  modelBounds: ModelMeshBounds;
  meshBounds: readonly ModelMeshBounds[];
  floorIds?: readonly number[];
}): ModelDerivedFloorGeometry {
  const bounds = options.modelBounds;
  if (!isValidBounds(bounds)) return { floors: [] };

  const modelWidth = bounds.maxX - bounds.minX;
  const modelDepth = bounds.maxZ - bounds.minZ;
  const modelHeight = bounds.maxY - bounds.minY;
  if (modelWidth <= 0 || modelDepth <= 0 || modelHeight <= 0)
    return { floors: [] };

  // These ranges are candidate filters, not floor measurements. Exact cuts
  // always come from the selected mesh bounds below.
  const candidates = options.meshBounds.filter((box) => {
    if (!isValidBounds(box)) return false;
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    const depth = box.maxZ - box.minZ;
    return (
      height >= 2.3 &&
      height <= 3.5 &&
      width >= modelWidth * 0.4 &&
      depth >= modelDepth * 0.4
    );
  });

  const signatures = new Map<string, ModelMeshBounds[]>();
  for (const box of candidates) {
    const height = box.maxY - box.minY;
    const key = [
      box.minX, box.maxX, box.minZ, box.maxZ, height,
    ].map((value) => quantize(value)).join(":");
    const group = signatures.get(key) ?? [];
    group.push(box);
    signatures.set(key, group);
  }

  const runs: ModelMeshBounds[][] = [];
  for (const group of signatures.values()) {
    const ordered = [...group].sort((a, b) => a.minY - b.minY);
    let run: ModelMeshBounds[] = [];
    for (const box of ordered) {
      const previous = run[run.length - 1];
      if (
        previous &&
        Math.abs(box.minY - previous.maxY) > 0.05
      ) {
        if (run.length >= 3) runs.push(run);
        run = [];
      }
      run.push(box);
    }
    if (run.length >= 3) runs.push(run);
  }

  // Prefer the longest contiguous stack, then the broadest footprint.
  runs.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const area = (box: ModelMeshBounds) =>
      (box.maxX - box.minX) * (box.maxZ - box.minZ);
    return area(b[0]) - area(a[0]);
  });
  const stack = runs[0];
  if (!stack || stack.length < 3) return { floors: [] };

  const stackSet = new Set(stack);
  const averageStoreyHeight =
    stack.reduce((sum, box) => sum + box.maxY - box.minY, 0) / stack.length;
  if (!(averageStoreyHeight >= 2.3 && averageStoreyHeight <= 3.5))
    return { floors: [] };

  const stackStart = stack[0].minY;
  const stackEnd = stack[stack.length - 1].maxY;
  const stackFootprint = stack[0];

  const groundCandidates = candidates.filter((box) =>
    !stackSet.has(box) &&
    Math.abs(box.maxY - stackStart) <= 0.05 &&
    box.minY < stackStart &&
    horizontalOverlapRatio(box, stackFootprint) >= 0.65
  );
  groundCandidates.sort((a, b) => {
    const areaA = (a.maxX - a.minX) * (a.maxZ - a.minZ);
    const areaB = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    return areaB - areaA;
  });
  const ground = groundCandidates[0];
  if (!ground) return { floors: [] };

  const upperCandidates = candidates.filter((box) =>
    !stackSet.has(box) &&
    Math.abs(box.minY - stackEnd) <= averageStoreyHeight * 0.16 &&
    box.maxY - stackEnd >= averageStoreyHeight * 0.55 &&
    horizontalOverlapRatio(box, stackFootprint) >= 0.65
  );
  upperCandidates.sort((a, b) => {
    const differenceA = Math.abs((a.maxY - stackEnd) - averageStoreyHeight);
    const differenceB = Math.abs((b.maxY - stackEnd) - averageStoreyHeight);
    if (Math.abs(differenceA - differenceB) > 0.02)
      return differenceA - differenceB;
    const areaA = (a.maxX - a.minX) * (a.maxZ - a.minZ);
    const areaB = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    return areaB - areaA;
  });
  const upper = upperCandidates[0];
  if (!upper || !(upper.maxY > stackEnd)) return { floors: [] };

  const bandCount = stack.length + 2; // Ground + repeated floors + upper floor.
  const requestedIds = normalizeFloorIds(options.floorIds ?? []);
  if (requestedIds.length > 0 && requestedIds.length !== bandCount)
    return { floors: [] };
  const floors = requestedIds.length
    ? requestedIds
    : Array.from({ length: bandCount }, (_unused, index) => index);

  const bands: Array<{ floor: number; elevationM: number; topElevationM: number; source: "model" }> = [
    {
      floor: floors[0],
      elevationM: ground.minY,
      topElevationM: stackStart,
      source: "model",
    },
    ...stack.map((box, index) => ({
      floor: floors[index + 1],
      elevationM: box.minY,
      topElevationM: box.maxY,
      source: "model" as const,
    })),
    {
      floor: floors[floors.length - 1],
      elevationM: stackEnd,
      topElevationM: upper.maxY,
      source: "model",
    },
  ];

  if (
    bands.length !== floors.length ||
    bands.some((item) => !finite(item.elevationM) || !finite(item.topElevationM) || item.topElevationM <= item.elevationM) ||
    bands.some((item, index) => index > 0 && Math.abs(item.elevationM - bands[index - 1].topElevationM) > 0.05)
  )
    return { floors: [] };

  const roofHeight = bounds.maxY - upper.maxY;
  const roof =
    roofHeight >= 0.35 &&
    roofHeight <= averageStoreyHeight * 1.5
      ? {
          floor: floors.length,
          elevationM: upper.maxY,
          topElevationM: bounds.maxY,
          source: "model" as const,
        }
      : undefined;

  return { floors: bands, roof };
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
      return floorIds
        .map((floor) => ({
          ...byFloor.get(floor)!,
          source: "profile" as const,
        }))
        .sort((left, right) => left.elevationM - right.elevationM);
  }

  // Missing floor metadata must not be converted into invented equal-height
  // intervals. The viewer can derive levels from repeated mesh bands, or hide
  // floor isolation and wait for reviewed source elevations.
  return [];
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
