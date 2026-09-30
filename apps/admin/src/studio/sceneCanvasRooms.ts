import * as T from "three";
import {
  roomBoundaryPoints,
  type Room,
  type RoomPoint,
  type Scene,
} from "./domain";
import { findSurfaceFinish } from "./surfaceMaterials";

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
  interiorPresentation = false,
  scene?: Scene,
  includeCeiling = false,
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
  const floorFinish = scene
    ? findSurfaceFinish(scene, room.id, "floor")
    : undefined;
  const floorColor = floorFinish
    ? new T.Color(floorFinish.color)
    : interiorPresentation
      ? new T.Color(room.color).lerp(new T.Color("#d8cbb8"), 0.24)
      : new T.Color(room.color);
  const floorMaterial = new T.MeshStandardMaterial({
    color: floorColor,
    roughness:
      floorFinish?.roughness ?? (interiorPresentation ? 0.92 : 0.75),
    metalness: floorFinish?.metalness ?? 0,
    side: T.DoubleSide,
    transparent: mapper,
    opacity: mapper ? (selected ? 0.52 : 0.24) : 1,
    depthWrite: !mapper,
  });
  const floor = new T.Mesh(new T.ShapeGeometry(shape), floorMaterial);
  floor.name = room.name;
  floor.userData.surfaceRoomId = room.id;
  floor.userData.surfaceKind = "floor";
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
    const wallFinish = scene
      ? findSurfaceFinish(scene, room.id, "wall", index)
      : undefined;
    const wall = new T.Mesh(
      new T.BoxGeometry(length, height, 0.12),
      new T.MeshStandardMaterial({
        color:
          wallFinish?.color ??
          (interiorPresentation
            ? index % 2
              ? "#eee8df"
              : "#f4f0e9"
            : index % 2
              ? "#e7e0d5"
              : "#eee9df"),
        roughness:
          wallFinish?.roughness ?? (interiorPresentation ? 0.92 : 0.82),
        metalness: wallFinish?.metalness ?? 0,
      }),
    );
    wall.name = "wall";
    wall.userData.surfaceRoomId = room.id;
    wall.userData.surfaceKind = "wall";
    wall.userData.surfaceEdgeIndex = index;
    wall.position.set(
      (left[0] + right[0]) / 2,
      height / 2,
      (left[1] + right[1]) / 2,
    );
    wall.rotation.y = Math.atan2(-dz, dx);
    wall.castShadow = true;
    wall.receiveShadow = true;
    root.add(wall);

    if (interiorPresentation) {
      const skirting = new T.Mesh(
        new T.BoxGeometry(length, 0.07, 0.135),
        new T.MeshStandardMaterial({
          color: "#c9b9a4",
          roughness: 0.9,
        }),
      );
      skirting.name = "skirting";
      skirting.position.set(
        (left[0] + right[0]) / 2,
        0.055,
        (left[1] + right[1]) / 2,
      );
      skirting.rotation.y = wall.rotation.y;
      skirting.receiveShadow = true;
      root.add(skirting);
    }
  }

  if (includeCeiling) {
    const ceilingFinish = scene
      ? findSurfaceFinish(scene, room.id, "ceiling")
      : undefined;
    const ceiling = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshStandardMaterial({
        color: ceilingFinish?.color ?? "#f4f1e9",
        roughness: ceilingFinish?.roughness ?? 0.9,
        metalness: ceilingFinish?.metalness ?? 0,
        side: T.DoubleSide,
      }),
    );
    ceiling.name = "ceiling";
    ceiling.userData.surfaceRoomId = room.id;
    ceiling.userData.surfaceKind = "ceiling";
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    ceiling.receiveShadow = true;
    root.add(ceiling);
  }
  return floor;
}
