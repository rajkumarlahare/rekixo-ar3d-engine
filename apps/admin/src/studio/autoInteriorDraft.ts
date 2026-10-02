import {
  catalog,
  roomArea,
  type Furniture,
  type Kind,
  type Room,
  type Scene,
} from "./domain";
import {
  findFurniturePlacement,
  furnitureFitsAt,
} from "./furniturePlacement";

export interface AutoInteriorDraftResult {
  scene: Scene;
  created: Furniture[];
  removedInvalidAutomatic: number;
  furnishedRooms: number;
  skippedRooms: string[];
}

type AutoInteriorRole =
  | "living"
  | "bedroom"
  | "dining"
  | "balcony"
  | "terrace"
  | "unsupported";

const SOURCE_AUTO_ORIGIN = "source-auto" as const;

function normalizedName(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function autoInteriorRole(room: Pick<Room, "name">): AutoInteriorRole {
  const name = normalizedName(room.name);
  if (/\b(?:living|drawing)\b/.test(name)) return "living";
  if (/\b(?:master\s+)?bed\s*room\b/.test(name)) return "bedroom";
  if (/\bdining\b/.test(name)) return "dining";
  if (/\bbalcony\b/.test(name)) return "balcony";
  if (/\bterrace\b/.test(name)) return "terrace";
  return "unsupported";
}

function autoDraftRoom(room: Room) {
  if (room.verified) return false;
  const source = normalizedName(room.source);
  return (
    source.includes("auto draft") ||
    source.includes("auto semantics matched")
  );
}

function commonRoom(room: Room) {
  const name = normalizedName(room.name);
  const unit = normalizedName(room.unit);
  return (
    unit === "common" ||
    /\b(?:lobby|corridor|stair|lift|duct|shaft|passage|parking)\b/.test(name)
  );
}

function desiredKinds(room: Room): Kind[] {
  switch (autoInteriorRole(room)) {
    case "living":
      return roomArea(room) >= 12
        ? ["sofa", "table", "plant"]
        : ["sofa", "table"];
    case "bedroom":
      return roomArea(room) >= 12 ? ["bed", "wardrobe"] : ["bed"];
    case "dining":
      return ["table"];
    case "balcony":
    case "terrace":
      return ["plant"];
    default:
      return [];
  }
}

function anchors(room: Room, kind: Kind): Array<[number, number]> {
  const x = room.width;
  const z = room.depth;
  switch (kind) {
    case "sofa":
      return [
        [-x * 0.22, -z * 0.22],
        [x * 0.22, -z * 0.22],
        [-x * 0.22, z * 0.22],
        [x * 0.22, z * 0.22],
        [0, 0],
      ];
    case "bed":
      return [
        [0, -z * 0.12],
        [-x * 0.16, -z * 0.12],
        [x * 0.16, -z * 0.12],
        [0, z * 0.12],
      ];
    case "wardrobe":
      return [
        [x * 0.3, z * 0.25],
        [-x * 0.3, z * 0.25],
        [x * 0.3, -z * 0.25],
        [-x * 0.3, -z * 0.25],
      ];
    case "table":
      return [
        [0, 0],
        [x * 0.22, 0],
        [-x * 0.22, 0],
        [0, z * 0.22],
        [0, -z * 0.22],
      ];
    case "plant":
      return [
        [x * 0.32, z * 0.32],
        [-x * 0.32, z * 0.32],
        [x * 0.32, -z * 0.32],
        [-x * 0.32, -z * 0.32],
        [0, 0],
      ];
  }
}

function extents(kind: Kind, rotation: number) {
  const definition = catalog[kind];
  const radians = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    x: (definition.width * cos + definition.depth * sin) / 2,
    z: (definition.width * sin + definition.depth * cos) / 2,
  };
}

function overlapsFurniture(
  candidate: Pick<Furniture, "kind" | "x" | "z" | "rotation">,
  existing: readonly Furniture[],
) {
  const left = extents(candidate.kind, candidate.rotation);
  for (const item of existing) {
    const right = extents(item.kind, item.rotation);
    if (
      Math.abs(candidate.x - item.x) < left.x + right.x + 0.08 &&
      Math.abs(candidate.z - item.z) < left.z + right.z + 0.08
    )
      return true;
  }
  return false;
}

function blocksOpening(
  scene: Scene,
  room: Room,
  kind: Kind,
  x: number,
  z: number,
  rotation: number,
) {
  const item = extents(kind, rotation);
  const radius = Math.hypot(item.x, item.z);
  const worldX = room.x + x;
  const worldZ = room.z + z;
  return (scene.openings ?? []).some((opening) => {
    if (!opening.roomIds.includes(room.id)) return false;
    const clearance =
      opening.kind === "door"
        ? Math.max(0.7, opening.width / 2 + 0.45)
        : Math.max(0.3, opening.width / 2 + 0.15);
    return (
      Math.hypot(worldX - opening.x, worldZ - opening.z) <
      radius + clearance
    );
  });
}

function automaticStillFits(scene: Scene, item: Furniture) {
  if (item.origin !== SOURCE_AUTO_ORIGIN) return true;
  const room = scene.rooms.find((candidate) => candidate.id === item.roomId);
  if (!room) return false;
  return (
    furnitureFitsAt(room, item.kind, item.x, item.z, item.rotation) &&
    !blocksOpening(scene, room, item.kind, item.x, item.z, item.rotation)
  );
}

export function buildSourceAutoInterior(
  scene: Scene,
  makeId: () => string = () => crypto.randomUUID(),
): AutoInteriorDraftResult {
  let removedInvalidAutomatic = 0;
  const furniture = scene.furniture.filter((item) => {
    const keep = automaticStillFits(scene, item);
    if (!keep && item.origin === SOURCE_AUTO_ORIGIN)
      removedInvalidAutomatic += 1;
    return keep;
  });
  const created: Furniture[] = [];
  const skippedRooms: string[] = [];
  let furnishedRooms = 0;

  for (const room of scene.rooms) {
    const desired = desiredKinds(room);
    if (!desired.length || !autoDraftRoom(room) || commonRoom(room)) continue;

    const current = () =>
      [...furniture, ...created].filter((item) => item.roomId === room.id);
    if (current().some((item) => item.origin !== SOURCE_AUTO_ORIGIN)) {
      skippedRooms.push(room.id);
      continue;
    }

    const existingKinds = new Set(current().map((item) => item.kind));
    let roomCreated = 0;
    let placementFailed = false;

    for (const kind of desired) {
      if (existingKinds.has(kind)) continue;
      let placed: Furniture | undefined;

      for (const [localX, localZ] of anchors(room, kind)) {
        const placement = findFurniturePlacement(
          room,
          kind,
          room.x + localX,
          room.z + localZ,
        );
        if (!placement) continue;
        const candidate: Furniture = {
          id: makeId(),
          kind,
          roomId: room.id,
          x: placement.x,
          z: placement.z,
          rotation: placement.rotation,
          color: catalog[kind].color,
          origin: SOURCE_AUTO_ORIGIN,
        };
        if (overlapsFurniture(candidate, current())) continue;
        if (
          blocksOpening(
            scene,
            room,
            candidate.kind,
            candidate.x,
            candidate.z,
            candidate.rotation,
          )
        )
          continue;
        placed = candidate;
        break;
      }

      if (!placed) {
        placementFailed = true;
        continue;
      }
      created.push(placed);
      existingKinds.add(kind);
      roomCreated += 1;
    }

    if (roomCreated > 0) furnishedRooms += 1;
    if (placementFailed) skippedRooms.push(room.id);
  }

  return {
    scene: { ...scene, furniture: [...furniture, ...created] },
    created,
    removedInvalidAutomatic,
    furnishedRooms,
    skippedRooms: [...new Set(skippedRooms)],
  };
}
