import type { Room, RoomPoint, Scene } from "./domain";
import {
  floorSkeletonStatus,
  type FloorSkeletonLevel,
} from "./floorSkeleton";

export interface BatchRepeatTarget {
  floorKey: string;
  targetUnit: string;
}

export interface BatchRepeatSeries {
  sourceUnit: string;
  expectedRoomCount?: number;
  targets: readonly BatchRepeatTarget[];
}

export interface BatchRepeatPlan {
  id: string;
  label: string;
  sourceFloorKey: string;
  note?: string;
  series: readonly BatchRepeatSeries[];
}

export type BatchRepeatRowStatus = "ready" | "existing" | "blocked";

export interface BatchRepeatPreviewRow {
  key: string;
  sourceFloorId?: string;
  sourceFloorName?: string;
  sourceUnit: string;
  sourceRoomCount: number;
  expectedRoomCount?: number;
  targetFloorId?: string;
  targetFloorName?: string;
  targetUnit: string;
  status: BatchRepeatRowStatus;
  reason: string;
}

export interface BatchRepeatPreview {
  planId?: string;
  label?: string;
  note?: string;
  rows: BatchRepeatPreviewRow[];
  readyTargets: number;
  existingTargets: number;
  blockedTargets: number;
  roomsToCreate: number;
}

export interface BatchRepeatApplyResult extends BatchRepeatPreview {
  rooms: Room[];
  createdRooms: Room[];
  generatedTargets: number;
}

function emptyPreview(): BatchRepeatPreview {
  return {
    rows: [],
    readyTargets: 0,
    existingTargets: 0,
    blockedTargets: 0,
    roomsToCreate: 0,
  };
}

function sameUnit(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export const BATCH_REPEAT_SOURCE_PREFIX = "Batch repeated draft from ";

export function isBatchRepeatedRoom(room: Pick<Room, "source">) {
  return room.source.startsWith(BATCH_REPEAT_SOURCE_PREFIX);
}

export function buildBatchRepeatPreview(
  scene: Scene,
  profileId: string | undefined,
  floorSkeleton: readonly FloorSkeletonLevel[] | undefined,
  plan: BatchRepeatPlan | undefined,
): BatchRepeatPreview {
  if (!profileId || !floorSkeleton?.length || !plan) return emptyPreview();

  const floorStatus = floorSkeletonStatus(scene, profileId, floorSkeleton);
  const sourceFloorId = floorStatus.floorIdByKey[plan.sourceFloorKey];
  const sourceFloorName = sourceFloorId
    ? scene.floors.find((floor) => floor.id === sourceFloorId)?.name
    : undefined;
  const rows: BatchRepeatPreviewRow[] = [];

  for (const series of plan.series) {
    const sourceRooms = sourceFloorId
      ? scene.rooms.filter(
          (room) =>
            room.floorId === sourceFloorId &&
            sameUnit(room.unit, series.sourceUnit),
        )
      : [];

    for (const target of series.targets) {
      const targetFloorId = floorStatus.floorIdByKey[target.floorKey];
      const targetFloorName = targetFloorId
        ? scene.floors.find((floor) => floor.id === targetFloorId)?.name
        : undefined;
      const existing = targetFloorId
        ? scene.rooms.some(
            (room) =>
              room.floorId === targetFloorId &&
              sameUnit(room.unit, target.targetUnit),
          )
        : false;

      let status: BatchRepeatRowStatus = "ready";
      let reason = `${sourceRooms.length} mapped room${sourceRooms.length === 1 ? "" : "s"} ready to copy`;

      if (!sourceFloorId) {
        status = "blocked";
        reason = "Source floor from the project profile is not available.";
      } else if (!targetFloorId) {
        status = "blocked";
        reason = "Target floor from the project profile is not available.";
      } else if (existing) {
        status = "existing";
        reason = "Target unit already has mapped rooms; it will be preserved.";
      } else if (!sourceRooms.length) {
        status = "blocked";
        reason = "Map/review the source unit before generating upper floors.";
      } else if (
        series.expectedRoomCount !== undefined &&
        sourceRooms.length !== series.expectedRoomCount
      ) {
        status = "blocked";
        reason = `Source unit has ${sourceRooms.length}/${series.expectedRoomCount} expected rooms; finish review first.`;
      } else if (sourceRooms.some((room) => !room.verified)) {
        status = "blocked";
        reason = "Accept each source room after visual review before repeating this unit.";
      }

      rows.push({
        key: `${series.sourceUnit}:${target.floorKey}:${target.targetUnit}`,
        ...(sourceFloorId ? { sourceFloorId } : {}),
        ...(sourceFloorName ? { sourceFloorName } : {}),
        sourceUnit: series.sourceUnit,
        sourceRoomCount: sourceRooms.length,
        ...(series.expectedRoomCount !== undefined
          ? { expectedRoomCount: series.expectedRoomCount }
          : {}),
        ...(targetFloorId ? { targetFloorId } : {}),
        ...(targetFloorName ? { targetFloorName } : {}),
        targetUnit: target.targetUnit,
        status,
        reason,
      });
    }
  }

  return {
    planId: plan.id,
    label: plan.label,
    note: plan.note,
    rows,
    readyTargets: rows.filter((row) => row.status === "ready").length,
    existingTargets: rows.filter((row) => row.status === "existing").length,
    blockedTargets: rows.filter((row) => row.status === "blocked").length,
    roomsToCreate: rows
      .filter((row) => row.status === "ready")
      .reduce((sum, row) => sum + row.sourceRoomCount, 0),
  };
}

function copiedRoom(
  room: Room,
  targetFloorId: string,
  targetUnit: string,
  sourceFloorName: string,
  sourceUnit: string,
  makeId: () => string,
): Room {
  return {
    ...room,
    id: makeId(),
    floorId: targetFloorId,
    unit: targetUnit,
    verified: false,
    source: `${BATCH_REPEAT_SOURCE_PREFIX}${sourceFloorName} · ${sourceUnit} → ${targetUnit}. Geometry is copied for authoring convenience and requires visual review.`,
    sourceAssetId: undefined,
    sourcePackSourceId: undefined,
    sourceClaimIds: undefined,
    mesh: undefined,
    polygon: room.polygon?.map(
      ([x, z]) => [x, z] as RoomPoint,
    ),
  };
}

export function applyBatchRepeatPlan(
  scene: Scene,
  profileId: string | undefined,
  floorSkeleton: readonly FloorSkeletonLevel[] | undefined,
  plan: BatchRepeatPlan | undefined,
  makeId: () => string = () => crypto.randomUUID(),
): BatchRepeatApplyResult {
  const preview = buildBatchRepeatPreview(
    scene,
    profileId,
    floorSkeleton,
    plan,
  );
  if (!plan || !preview.readyTargets)
    return {
      ...preview,
      rooms: [...scene.rooms],
      createdRooms: [],
      generatedTargets: 0,
    };

  const createdRooms: Room[] = [];
  for (const row of preview.rows) {
    if (
      row.status !== "ready" ||
      !row.sourceFloorId ||
      !row.targetFloorId
    )
      continue;
    const sourceRooms = scene.rooms.filter(
      (room) =>
        room.floorId === row.sourceFloorId &&
        sameUnit(room.unit, row.sourceUnit),
    );
    for (const room of sourceRooms)
      createdRooms.push(
        copiedRoom(
          room,
          row.targetFloorId,
          row.targetUnit,
          row.sourceFloorName ?? "source floor",
          row.sourceUnit,
          makeId,
        ),
      );
  }

  return {
    ...preview,
    rooms: [...scene.rooms, ...createdRooms],
    createdRooms,
    generatedTargets: preview.readyTargets,
  };
}


function unitNamesOnFloor(scene: Scene, floorId: string) {
  return [
    ...new Set(
      scene.rooms
        .filter((room) => room.floorId === floorId)
        .map((room) => room.unit.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export function buildDetectedRepeatPreview(scene: Scene): BatchRepeatPreview {
  const rows: BatchRepeatPreviewRow[] = [];

  for (const targetFloor of scene.floors) {
    if (
      !targetFloor.repeatOfFloorId ||
      targetFloor.repeatReviewed !== true
    )
      continue;
    const sourceFloor = scene.floors.find(
      (floor) => floor.id === targetFloor.repeatOfFloorId,
    );
    if (!sourceFloor) continue;

    const units = unitNamesOnFloor(scene, sourceFloor.id);
    if (!units.length) {
      rows.push({
        key: `detected:${sourceFloor.id}:${targetFloor.id}:unmapped`,
        sourceFloorId: sourceFloor.id,
        sourceFloorName: sourceFloor.name,
        sourceUnit: "",
        sourceRoomCount: 0,
        targetFloorId: targetFloor.id,
        targetFloorName: targetFloor.name,
        targetUnit: "",
        status: "blocked",
        reason: "Map and review at least one source-floor unit before repeating this floor.",
      });
      continue;
    }

    for (const sourceUnit of units) {
      const sourceRooms = scene.rooms.filter(
        (room) =>
          room.floorId === sourceFloor.id &&
          sameUnit(room.unit, sourceUnit),
      );
      const existing = scene.rooms.some(
        (room) =>
          room.floorId === targetFloor.id &&
          sameUnit(room.unit, sourceUnit),
      );
      let status: BatchRepeatRowStatus = "ready";
      let reason = `${sourceRooms.length} reviewed room${sourceRooms.length === 1 ? "" : "s"} ready to copy`;

      if (existing) {
        status = "existing";
        reason = "Target floor/unit already has mapped rooms; it will be preserved.";
      } else if (!sourceRooms.length) {
        status = "blocked";
        reason = "Source unit has no mapped rooms.";
      } else if (sourceRooms.some((room) => !room.verified)) {
        status = "blocked";
        reason =
          "Review and accept each source room before repeating this detected floor.";
      }

      rows.push({
        key: `detected:${sourceFloor.id}:${targetFloor.id}:${sourceUnit.toLowerCase()}`,
        sourceFloorId: sourceFloor.id,
        sourceFloorName: sourceFloor.name,
        sourceUnit,
        sourceRoomCount: sourceRooms.length,
        targetFloorId: targetFloor.id,
        targetFloorName: targetFloor.name,
        targetUnit: sourceUnit,
        status,
        reason,
      });
    }
  }

  return {
    planId: "detected-floor-repeats",
    label: "Detected repeated floors",
    note:
      "Targets come from accepted repeatOfFloorId relationships; copied rooms remain unverified until visual review.",
    rows,
    readyTargets: rows.filter((row) => row.status === "ready").length,
    existingTargets: rows.filter((row) => row.status === "existing").length,
    blockedTargets: rows.filter((row) => row.status === "blocked").length,
    roomsToCreate: rows
      .filter((row) => row.status === "ready")
      .reduce((sum, row) => sum + row.sourceRoomCount, 0),
  };
}

export function applyDetectedRepeatPlan(
  scene: Scene,
  makeId: () => string = () => crypto.randomUUID(),
): BatchRepeatApplyResult {
  const preview = buildDetectedRepeatPreview(scene);
  if (!preview.readyTargets)
    return {
      ...preview,
      rooms: [...scene.rooms],
      createdRooms: [],
      generatedTargets: 0,
    };

  const createdRooms: Room[] = [];
  for (const row of preview.rows) {
    if (
      row.status !== "ready" ||
      !row.sourceFloorId ||
      !row.targetFloorId ||
      !row.sourceUnit
    )
      continue;
    const sourceRooms = scene.rooms.filter(
      (room) =>
        room.floorId === row.sourceFloorId &&
        sameUnit(room.unit, row.sourceUnit),
    );
    for (const room of sourceRooms)
      createdRooms.push(
        copiedRoom(
          room,
          row.targetFloorId,
          row.targetUnit,
          row.sourceFloorName ?? "source floor",
          row.sourceUnit,
          makeId,
        ),
      );
  }

  return {
    ...preview,
    rooms: [...scene.rooms, ...createdRooms],
    createdRooms,
    generatedTargets: preview.readyTargets,
  };
}
