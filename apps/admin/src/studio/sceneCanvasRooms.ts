import * as T from "three";
import {
  roomBoundaryPoints,
  type Opening,
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
  interiorPresentation = false,
  openings: readonly Opening[] = [],
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
  const floorColor = interiorPresentation
    ? new T.Color(room.color).lerp(new T.Color("#d8cbb8"), 0.24)
    : new T.Color(room.color);
  const floorMaterial = new T.MeshStandardMaterial({
    color: floorColor,
    roughness: interiorPresentation ? 0.92 : 0.75,
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
  const roomOpenings = openings.filter(
    (opening) => opening.reviewed && opening.roomIds.includes(room.id),
  );
  for (let index = 0; index < local.length; index += 1) {
    const left = local[index];
    const right = local[(index + 1) % local.length];
    const dx = right[0] - left[0];
    const dz = right[1] - left[1];
    const length = Math.hypot(dx, dz);
    if (length < 0.03) continue;
    const ux = dx / length;
    const uz = dz / length;
    const worldLeft: RoomPoint = [left[0] + room.x, left[1] + room.z];
    const cuts = roomOpenings
      .map((opening) => {
        const vx = opening.x - worldLeft[0];
        const vz = opening.z - worldLeft[1];
        const along = vx * ux + vz * uz;
        const perpendicular = Math.abs(vx * -uz + vz * ux);
        if (
          perpendicular > 0.22 ||
          along < -opening.width / 2 ||
          along > length + opening.width / 2
        )
          return undefined;
        const start = Math.max(0, along - opening.width / 2);
        const end = Math.min(length, along + opening.width / 2);
        const bottom =
          opening.kind === "window"
            ? Math.max(0, opening.sillHeight ?? 0.9)
            : Math.max(0, opening.sillHeight ?? 0);
        const top = Math.min(height, bottom + opening.height);
        if (end - start < 0.02 || top <= 0 || bottom >= height)
          return undefined;
        return {
          start,
          end,
          bottom: Math.min(height, bottom),
          top: Math.max(0, top),
          floorGap: bottom <= 0.08,
        };
      })
      .filter(
        (
          cut,
        ): cut is {
          start: number;
          end: number;
          bottom: number;
          top: number;
          floorGap: boolean;
        } => Boolean(cut),
      );

    const boundaries = Array.from(
      new Set([
        0,
        length,
        ...cuts.flatMap((cut) => [cut.start, cut.end]),
      ]),
    ).sort((a, b) => a - b);
    const wallRotation = Math.atan2(-dz, dx);
    const wallColor = interiorPresentation
      ? index % 2
        ? "#eee8df"
        : "#f4f0e9"
      : index % 2
        ? "#e7e0d5"
        : "#eee9df";
    const wallMaterial = new T.MeshStandardMaterial({
      color: wallColor,
      roughness: interiorPresentation ? 0.92 : 0.82,
    });

    const addPiece = (
      from: number,
      to: number,
      bottom: number,
      top: number,
    ) => {
      const pieceLength = to - from;
      const pieceHeight = top - bottom;
      if (pieceLength < 0.02 || pieceHeight < 0.02) return;
      const mid = (from + to) / 2;
      const wall = new T.Mesh(
        new T.BoxGeometry(pieceLength, pieceHeight, 0.12),
        wallMaterial,
      );
      wall.name = "wall";
      wall.position.set(
        left[0] + ux * mid,
        bottom + pieceHeight / 2,
        left[1] + uz * mid,
      );
      wall.rotation.y = wallRotation;
      wall.castShadow = true;
      wall.receiveShadow = true;
      root.add(wall);
    };

    for (let part = 0; part + 1 < boundaries.length; part += 1) {
      const from = boundaries[part];
      const to = boundaries[part + 1];
      if (to - from < 0.02) continue;
      const mid = (from + to) / 2;
      const active = cuts.filter(
        (cut) => mid >= cut.start - 1e-5 && mid <= cut.end + 1e-5,
      );
      if (!active.length) {
        addPiece(from, to, 0, height);
        continue;
      }
      const bottom = Math.min(...active.map((cut) => cut.bottom));
      const top = Math.max(...active.map((cut) => cut.top));
      if (bottom > 0.02) addPiece(from, to, 0, bottom);
      if (top < height - 0.02) addPiece(from, to, top, height);
    }

    if (interiorPresentation) {
      const floorCuts = cuts
        .filter((cut) => cut.floorGap)
        .map((cut) => [cut.start, cut.end] as const);
      const skirtBoundaries = Array.from(
        new Set([0, length, ...floorCuts.flatMap(([a, b]) => [a, b])]),
      ).sort((a, b) => a - b);
      for (let part = 0; part + 1 < skirtBoundaries.length; part += 1) {
        const from = skirtBoundaries[part];
        const to = skirtBoundaries[part + 1];
        if (to - from < 0.02) continue;
        const mid = (from + to) / 2;
        if (
          floorCuts.some(
            ([a, b]) => mid >= a - 1e-5 && mid <= b + 1e-5,
          )
        )
          continue;
        const skirting = new T.Mesh(
          new T.BoxGeometry(to - from, 0.07, 0.135),
          new T.MeshStandardMaterial({
            color: "#c9b9a4",
            roughness: 0.9,
          }),
        );
        skirting.name = "skirting";
        skirting.position.set(
          left[0] + ux * mid,
          0.055,
          left[1] + uz * mid,
        );
        skirting.rotation.y = wallRotation;
        skirting.receiveShadow = true;
        root.add(skirting);
      }
    }
  }
  return floor;
}
