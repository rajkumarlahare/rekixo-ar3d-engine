import {
  catalog,
  roomContainsPoint,
  type Furniture,
  type Kind,
  type Room,
} from "./domain";

export interface FurniturePlacement {
  x: number;
  z: number;
  rotation: number;
}

function corners(
  room: Room,
  kind: Kind,
  localX: number,
  localZ: number,
  rotation: number,
) {
  const item = catalog[kind];
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-item.width / 2, -item.depth / 2],
    [item.width / 2, -item.depth / 2],
    [item.width / 2, item.depth / 2],
    [-item.width / 2, item.depth / 2],
  ].map(([x, z]) => [
    room.x + localX + x * cos - z * sin,
    room.z + localZ + x * sin + z * cos,
  ] as const);
}

export function furnitureFitsAt(
  room: Room,
  kind: Kind,
  localX: number,
  localZ: number,
  rotation = 0,
) {
  return corners(room, kind, localX, localZ, rotation).every(([x, z]) =>
    roomContainsPoint(room, x, z, 0.04),
  );
}

function candidates(
  requestedX: number,
  requestedZ: number,
  room: Room,
) {
  const values: Array<[number, number]> = [[requestedX, requestedZ]];
  for (let radius = 0.1; radius <= 1.2 + 1e-6; radius += 0.1) {
    const steps = Math.max(8, Math.round((Math.PI * 2 * radius) / 0.12));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      values.push([
        requestedX + Math.cos(angle) * radius,
        requestedZ + Math.sin(angle) * radius,
      ]);
    }
  }
  values.push([0, 0]);
  return values.filter(([x, z]) =>
    roomContainsPoint(room, room.x + x, room.z + z, 0),
  );
}

export function findFurniturePlacement(
  room: Room,
  kind: Kind,
  worldX: number,
  worldZ: number,
): FurniturePlacement | undefined {
  const requestedX = worldX - room.x;
  const requestedZ = worldZ - room.z;

  for (const rotation of [0, 90, -90, 180]) {
    for (const [x, z] of candidates(requestedX, requestedZ, room))
      if (furnitureFitsAt(room, kind, x, z, rotation))
        return {
          x: Number(x.toFixed(3)),
          z: Number(z.toFixed(3)),
          rotation,
        };
  }
  return undefined;
}

export function furnitureFromPlacement(
  room: Room,
  kind: Kind,
  placement: FurniturePlacement,
  makeId: () => string,
): Furniture {
  return {
    id: makeId(),
    kind,
    roomId: room.id,
    x: placement.x,
    z: placement.z,
    rotation: placement.rotation,
    color: catalog[kind].color,
  };
}
