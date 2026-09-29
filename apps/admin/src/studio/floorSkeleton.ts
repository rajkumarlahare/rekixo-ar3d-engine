import type { Floor, Scene } from "./domain";

export type FloorSkeletonKind = "ground" | "residential" | "roof" | "level";

export interface FloorSkeletonLevel {
  key: string;
  name: string;
  sourceElevation: number;
  kind?: FloorSkeletonKind;
  sourcePackSourceId?: string;
  sourceClaimIds?: readonly string[];
  note?: string;
}

export interface FloorSkeletonStatus {
  total: number;
  matched: number;
  missing: number;
  floorIdByKey: Record<string, string>;
  preferredFloorId?: string;
}

export interface FloorSkeletonApplyResult extends FloorSkeletonStatus {
  floors: Floor[];
  added: number;
  updated: number;
}

function cleanToken(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "level"
  );
}

function generatedFloorId(profileId: string, key: string) {
  return `profile-floor-${cleanToken(profileId)}-${cleanToken(key)}`.slice(
    0,
    100,
  );
}

function worldElevation(scene: Scene, level: FloorSkeletonLevel) {
  const scale =
    Number.isFinite(scene.scale) && scene.scale > 0 ? scene.scale : 1;
  const modelY =
    scene.modelTransform && Number.isFinite(scene.modelTransform.y)
      ? scene.modelTransform.y
      : 0;
  return Number((level.sourceElevation * scale + modelY).toFixed(4));
}

function tolerance(scene: Scene) {
  const scale =
    Number.isFinite(scene.scale) && scene.scale > 0 ? scene.scale : 1;
  return Math.max(0.045, Math.min(0.16, scale * 0.08));
}

function findFloor(
  floors: readonly Floor[],
  scene: Scene,
  profileId: string,
  level: FloorSkeletonLevel,
) {
  const generatedId = generatedFloorId(profileId, level.key);
  const exact = floors.find((floor) => floor.id === generatedId);
  if (exact) return exact;

  const target = worldElevation(scene, level);
  const near = [...floors]
    .filter((floor) => Math.abs(floor.elevation - target) <= tolerance(scene))
    .sort(
      (left, right) =>
        Math.abs(left.elevation - target) - Math.abs(right.elevation - target),
    )[0];
  if (near) return near;

  if (level.kind === "ground") {
    const ground = floors.find(
      (floor) =>
        floor.name.trim().toLowerCase() === "ground" &&
        Math.abs(floor.elevation - target) <= Math.max(0.5, tolerance(scene)),
    );
    if (ground) return ground;
  }
  return undefined;
}

function statusFromFloors(
  floors: readonly Floor[],
  scene: Scene,
  profileId: string,
  levels: readonly FloorSkeletonLevel[],
): FloorSkeletonStatus {
  const floorIdByKey: Record<string, string> = {};
  let matched = 0;
  for (const level of levels) {
    const floor = findFloor(floors, scene, profileId, level);
    if (!floor) continue;
    matched += 1;
    floorIdByKey[level.key] = floor.id;
  }
  const preferred =
    levels.find(
      (level) => level.kind === "residential" && floorIdByKey[level.key],
    ) ?? levels.find((level) => floorIdByKey[level.key]);
  return {
    total: levels.length,
    matched,
    missing: Math.max(0, levels.length - matched),
    floorIdByKey,
    ...(preferred ? { preferredFloorId: floorIdByKey[preferred.key] } : {}),
  };
}

export function floorSkeletonStatus(
  scene: Scene,
  profileId: string,
  levels: readonly FloorSkeletonLevel[] | undefined,
): FloorSkeletonStatus {
  if (!levels?.length)
    return {
      total: 0,
      matched: 0,
      missing: 0,
      floorIdByKey: {},
    };
  return statusFromFloors(scene.floors, scene, profileId, levels);
}

export function applyFloorSkeleton(
  scene: Scene,
  profileId: string,
  levels: readonly FloorSkeletonLevel[] | undefined,
): FloorSkeletonApplyResult {
  if (!levels?.length)
    return {
      floors: [...scene.floors],
      total: 0,
      matched: 0,
      missing: 0,
      added: 0,
      updated: 0,
      floorIdByKey: {},
    };

  const floors = scene.floors.map((floor) => ({ ...floor }));
  let added = 0;
  let updated = 0;

  for (const level of [...levels].sort(
    (left, right) => left.sourceElevation - right.sourceElevation,
  )) {
    const target = worldElevation(scene, level);
    const generatedId = generatedFloorId(profileId, level.key);
    const generated = floors.find((floor) => floor.id === generatedId);
    if (generated) {
      if (
        Math.abs(generated.elevation - target) > 0.0005 ||
        generated.name !== level.name
      ) {
        generated.elevation = target;
        generated.name = level.name;
        updated += 1;
      }
      continue;
    }

    const existing = findFloor(floors, scene, profileId, level);
    if (existing) continue;

    floors.push({
      id: generatedId,
      name: level.name,
      elevation: target,
    });
    added += 1;
  }

  floors.sort((left, right) => left.elevation - right.elevation);
  const status = statusFromFloors(floors, scene, profileId, levels);
  return {
    ...status,
    floors,
    added,
    updated,
  };
}
