import * as T from "three";
import {
  roomBoundaryPoints,
  type Room,
  type RoomPoint,
} from "./domain";

export function block(
  root: T.Object3D,
  name: string,
  size: number[],
  pos: number[],
  color: string,
) {
  const mesh = new T.Mesh(
    new T.BoxGeometry(...(size as [number, number, number])),
    new T.MeshStandardMaterial({ color, roughness: 0.75 }),
  );
  mesh.name = name;
  mesh.position.set(...(pos as [number, number, number]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

export function roomSurface(
  root: T.Object3D,
  room: Room,
  height: number,
  mapper: boolean,
  selected: boolean,
) {
  const world = roomBoundaryPoints(room);
  const local = world.map(
    ([x, z]) => [x - room.x, z - room.z] as RoomPoint,
  );
  const shape = new T.Shape();
  local.forEach(([x, z], index) => {
    if (!index) shape.moveTo(x, z);
    if (index) shape.lineTo(x, z);
  });
  shape.closePath();
  const floorMaterial = new T.MeshStandardMaterial({
    color: room.color,
    roughness: 0.75,
    side: T.DoubleSide,
    transparent: mapper,
    opacity: mapper ? (selected ? 0.52 : 0.24) : 1,
    depthWrite: !mapper,
  });
  const floor = new T.Mesh(new T.ShapeGeometry(shape), floorMaterial);
  floor.name = room.name;
  floor.rotation.x = Math.PI / 2;
  floor.position.y = mapper ? 0.04 : -0.04;
  floor.receiveShadow = true;
  floor.renderOrder = mapper ? 20 : 0;
  root.add(floor);

  if (mapper) return floor;
  for (let index = 0; index < local.length; index += 1) {
    const left = local[index];
    const right = local[(index + 1) % local.length];
    const dx = right[0] - left[0];
    const dz = right[1] - left[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.03) continue;
    const wall = new T.Mesh(
      new T.BoxGeometry(length, height, 0.12),
      new T.MeshStandardMaterial({
        color: index % 2 ? "#e7e0d5" : "#eee9df",
        roughness: 0.82,
      }),
    );
    wall.name = "wall";
    wall.position.set(
      (left[0] + right[0]) / 2,
      height / 2,
      (left[1] + right[1]) / 2,
    );
    wall.rotation.y = Math.atan2(-dz, dx);
    wall.castShadow = true;
    wall.receiveShadow = true;
    root.add(wall);
  }
  return floor;
}
