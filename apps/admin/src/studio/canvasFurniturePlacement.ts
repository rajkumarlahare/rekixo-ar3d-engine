import type { Kind, Room } from "./domain";

export const REKIXO_FURNITURE_MIME = "application/x-rekixo-furniture";

export interface CanvasFurniturePlacement {
  enabled: boolean;
  kind: Kind;
  roomId: string;
}

export interface CanvasFurniturePoint {
  x: number;
  z: number;
}

export interface CanvasFurnitureResult {
  kind: Kind;
  roomId: string;
  worldX: number;
  worldZ: number;
}

export type FloorPointResolver = (
  clientX: number,
  clientY: number,
  floorId: string,
  snap: boolean,
) => CanvasFurniturePoint | undefined;

const KINDS = new Set<Kind>([
  "sofa",
  "bed",
  "table",
  "wardrobe",
  "plant",
]);

export function placeCanvasFurnitureAtPointer(
  placement: CanvasFurniturePlacement | undefined,
  rooms: readonly Room[],
  clientX: number,
  clientY: number,
  pointOnFloor: FloorPointResolver,
  onPlace: (result: CanvasFurnitureResult) => void,
) {
  if (!placement?.enabled || !placement.roomId) return false;
  const room = rooms.find((candidate) => candidate.id === placement.roomId);
  if (!room) return false;
  const point = pointOnFloor(clientX, clientY, room.floorId, true);
  if (!point) return false;
  onPlace({
    kind: placement.kind,
    roomId: room.id,
    worldX: point.x,
    worldZ: point.z,
  });
  return true;
}

function parsePayload(raw: string) {
  try {
    const value = JSON.parse(raw) as { kind?: string; roomId?: string };
    if (!value.kind || !KINDS.has(value.kind as Kind)) return undefined;
    return {
      kind: value.kind as Kind,
      roomId: value.roomId ?? "",
    };
  } catch {
    return undefined;
  }
}

export function installCanvasFurnitureDrop(
  element: HTMLElement,
  getRooms: () => readonly Room[],
  getFallbackRoomId: () => string,
  pointOnFloor: FloorPointResolver,
  onPlace: (result: CanvasFurnitureResult) => void,
) {
  const dragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes(REKIXO_FURNITURE_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent) => {
    const raw = event.dataTransfer?.getData(REKIXO_FURNITURE_MIME);
    if (!raw) return;
    const payload = parsePayload(raw);
    if (!payload) return;
    event.preventDefault();
    const roomId = payload.roomId || getFallbackRoomId();
    placeCanvasFurnitureAtPointer(
      { enabled: true, kind: payload.kind, roomId },
      getRooms(),
      event.clientX,
      event.clientY,
      pointOnFloor,
      onPlace,
    );
  };

  element.addEventListener("dragover", dragOver);
  element.addEventListener("drop", drop);
  return () => {
    element.removeEventListener("dragover", dragOver);
    element.removeEventListener("drop", drop);
  };
}
