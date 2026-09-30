import {
  catalog,
  type Furniture,
  type Kind,
  type Room,
  type Scene,
} from "./domain";
import type { BatchRepeatPreviewRow } from "./unitRepeat";

export interface InteriorBuildResult {
  furniture: Furniture[];
  created: Furniture[];
  skippedRooms: string[];
}

export type DemoInteriorRoomRole =
  | "living"
  | "bedroom"
  | "dining"
  | "balcony"
  | "unsupported";

export interface DemoInteriorIssue {
  furnitureId: string;
  roomId: string;
  kind: Kind;
  roomRole: Exclude<DemoInteriorRoomRole, "unsupported">;
}

export interface DemoInteriorRepairResult {
  furniture: Furniture[];
  removed: DemoInteriorIssue[];
}

export interface DemoInteriorReconcileResult {
  furniture: Furniture[];
  removed: DemoInteriorIssue[];
  createdTypical: Furniture[];
  createdRepeated: Furniture[];
  skippedRooms: string[];
}

function normalizeRoomName(value: string) {
  return value
    .toLowerCase()
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function roomRole(room: Room): DemoInteriorRoomRole {
  const name = normalizeRoomName(room.name);
  if (
    name.includes("balcony") ||
    /(^|\s)w\.?\s*bal(?:\s|$)/.test(name)
  )
    return "balcony";
  if (name.includes("living")) return "living";
  if (name.includes("bed room") || name.includes("bedroom")) return "bedroom";
  if (name.includes("dining")) return "dining";
  return "unsupported";
}

function allowedKindsForRoom(room: Room): ReadonlySet<Kind> | undefined {
  switch (roomRole(room)) {
    case "living":
      return new Set<Kind>(["sofa", "table", "plant"]);
    case "bedroom":
      return new Set<Kind>(["bed", "wardrobe"]);
    case "dining":
      return new Set<Kind>(["table"]);
    case "balcony":
      return new Set<Kind>(["plant"]);
    default:
      return undefined;
  }
}

export function auditDemoInterior(scene: Scene): DemoInteriorIssue[] {
  const roomById = new Map(scene.rooms.map((room) => [room.id, room]));
  const issues: DemoInteriorIssue[] = [];

  for (const item of scene.furniture) {
    const room = roomById.get(item.roomId);
    if (!room || !room.verified || room.unit.trim().toLowerCase() === "common")
      continue;
    const allowed = allowedKindsForRoom(room);
    if (!allowed || allowed.has(item.kind)) continue;
    const role = roomRole(room);
    if (role === "unsupported") continue;
    issues.push({
      furnitureId: item.id,
      roomId: room.id,
      kind: item.kind,
      roomRole: role,
    });
  }

  return issues;
}

export function repairDemoInterior(scene: Scene): DemoInteriorRepairResult {
  const removed = auditDemoInterior(scene);
  if (!removed.length) return { furniture: scene.furniture, removed };
  const ids = new Set(removed.map((issue) => issue.furnitureId));
  return {
    furniture: scene.furniture.filter((item) => !ids.has(item.id)),
    removed,
  };
}

function desiredPlacements(room: Room): Array<{
  kind: Kind;
  x: number;
  z: number;
  rotation: number;
}> {
  switch (roomRole(room)) {
    case "living":
      return [
        { kind: "sofa", x: -1, z: -0.8, rotation: 0 },
        { kind: "table", x: 0.6, z: 0.5, rotation: 0 },
        { kind: "plant", x: 1.7, z: 1, rotation: 0 },
      ];
    case "bedroom":
      return [
        { kind: "bed", x: -0.3, z: 0, rotation: 0 },
        { kind: "wardrobe", x: 1, z: 0.55, rotation: 90 },
      ];
    case "dining":
      return [{ kind: "table", x: 0, z: 0, rotation: 0 }];
    case "balcony":
      return [{ kind: "plant", x: 0, z: 0, rotation: 0 }];
    default:
      return [];
  }
}

function fitPlacement(
  room: Room,
  placement: { kind: Kind; x: number; z: number; rotation: number },
) {
  if (room.polygon?.length) return undefined;
  const definition = catalog[placement.kind];
  const angle = (placement.rotation * Math.PI) / 180;
  const extentX =
    (Math.abs(Math.cos(angle)) * definition.width +
      Math.abs(Math.sin(angle)) * definition.depth) /
    2;
  const extentZ =
    (Math.abs(Math.sin(angle)) * definition.width +
      Math.abs(Math.cos(angle)) * definition.depth) /
    2;
  const margin = 0.04;
  const maxX = room.width / 2 - extentX - margin;
  const maxZ = room.depth / 2 - extentZ - margin;
  if (maxX < 0 || maxZ < 0) return undefined;
  return {
    ...placement,
    x: Math.max(-maxX, Math.min(maxX, placement.x)),
    z: Math.max(-maxZ, Math.min(maxZ, placement.z)),
  };
}

export function buildTypicalFloorDemoInterior(
  scene: Scene,
  floorId: string,
  makeId: () => string = () => crypto.randomUUID(),
): InteriorBuildResult {
  const created: Furniture[] = [];
  const skippedRooms: string[] = [];
  const existing = [...scene.furniture];

  for (const room of scene.rooms) {
    if (room.floorId !== floorId || !room.verified) continue;
    if (room.unit.trim().toLowerCase() === "common") continue;

    const placements = desiredPlacements(room);
    if (!placements.length) continue;

    const existingKinds = new Set(
      existing
        .filter((item) => item.roomId === room.id)
        .map((item) => item.kind),
    );

    let supported = true;
    for (const placement of placements) {
      if (existingKinds.has(placement.kind)) continue;
      const fitted = fitPlacement(room, placement);
      if (!fitted) {
        supported = false;
        continue;
      }
      const furniture: Furniture = {
        id: makeId(),
        kind: fitted.kind,
        roomId: room.id,
        x: fitted.x,
        z: fitted.z,
        rotation: fitted.rotation,
        color: catalog[fitted.kind].color,
        origin: "demo-auto",
      };
      created.push(furniture);
      existing.push(furniture);
      existingKinds.add(fitted.kind);
    }
    if (!supported) skippedRooms.push(room.id);
  }

  return {
    furniture: [...scene.furniture, ...created],
    created,
    skippedRooms,
  };
}

function roomSignature(room: Room) {
  return [
    normalizeRoomName(room.name),
    room.width.toFixed(2),
    room.depth.toFixed(2),
  ].join("|");
}

function pairRooms(sourceRooms: Room[], targetRooms: Room[]) {
  const targetBuckets = new Map<string, Room[]>();
  for (const target of targetRooms) {
    const key = roomSignature(target);
    targetBuckets.set(key, [...(targetBuckets.get(key) ?? []), target]);
  }

  const pairs: Array<[Room, Room]> = [];
  for (const source of sourceRooms) {
    const bucket = targetBuckets.get(roomSignature(source));
    const target = bucket?.shift();
    if (target) pairs.push([source, target]);
  }
  return pairs;
}

export function buildRepeatedDemoInterior(
  scene: Scene,
  rows: readonly BatchRepeatPreviewRow[],
  makeId: () => string = () => crypto.randomUUID(),
): InteriorBuildResult {
  const created: Furniture[] = [];
  const skippedRooms: string[] = [];
  const existing = [...scene.furniture];

  for (const row of rows) {
    if (!row.sourceFloorId || !row.targetFloorId) continue;

    const sourceRooms = scene.rooms.filter(
      (room) =>
        room.floorId === row.sourceFloorId &&
        room.unit.trim().toLowerCase() === row.sourceUnit.trim().toLowerCase(),
    );
    const targetRooms = scene.rooms.filter(
      (room) =>
        room.floorId === row.targetFloorId &&
        room.unit.trim().toLowerCase() === row.targetUnit.trim().toLowerCase(),
    );

    if (
      !sourceRooms.length ||
      sourceRooms.some((room) => !room.verified) ||
      targetRooms.length !== sourceRooms.length ||
      targetRooms.some((room) => !room.verified)
    ) {
      skippedRooms.push(...targetRooms.map((room) => room.id));
      continue;
    }

    for (const [sourceRoom, targetRoom] of pairRooms(sourceRooms, targetRooms)) {
      const allowedSourceKinds = allowedKindsForRoom(sourceRoom);
      const sourceItems = scene.furniture.filter(
        (item) =>
          item.roomId === sourceRoom.id &&
          (!allowedSourceKinds || allowedSourceKinds.has(item.kind)),
      );
      if (!sourceItems.length) continue;

      const targetKinds = new Set(
        existing
          .filter((item) => item.roomId === targetRoom.id)
          .map((item) => item.kind),
      );

      for (const sourceItem of sourceItems) {
        if (targetKinds.has(sourceItem.kind)) continue;
        const fitted = fitPlacement(targetRoom, {
          kind: sourceItem.kind,
          x: sourceItem.x,
          z: sourceItem.z,
          rotation: sourceItem.rotation,
        });
        if (!fitted) {
          skippedRooms.push(targetRoom.id);
          continue;
        }
        const furniture: Furniture = {
          ...sourceItem,
          id: makeId(),
          roomId: targetRoom.id,
          x: fitted.x,
          z: fitted.z,
          rotation: fitted.rotation,
          origin: "demo-repeat",
        };
        created.push(furniture);
        existing.push(furniture);
        targetKinds.add(furniture.kind);
      }
    }
  }

  return {
    furniture: [...scene.furniture, ...created],
    created,
    skippedRooms: [...new Set(skippedRooms)],
  };
}


export function reconcileDemoInterior(
  scene: Scene,
  typicalFloorId: string,
  rows: readonly BatchRepeatPreviewRow[],
  makeId: () => string = () => crypto.randomUUID(),
): DemoInteriorReconcileResult {
  const repaired = repairDemoInterior(scene);
  const repairedScene: Scene = {
    ...scene,
    furniture: repaired.furniture,
  };
  const typical = buildTypicalFloorDemoInterior(
    repairedScene,
    typicalFloorId,
    makeId,
  );
  const typicalScene: Scene = {
    ...repairedScene,
    furniture: typical.furniture,
  };
  const repeated = buildRepeatedDemoInterior(typicalScene, rows, makeId);

  return {
    furniture: repeated.furniture,
    removed: repaired.removed,
    createdTypical: typical.created,
    createdRepeated: repeated.created,
    skippedRooms: [
      ...new Set([...typical.skippedRooms, ...repeated.skippedRooms]),
    ],
  };
}
