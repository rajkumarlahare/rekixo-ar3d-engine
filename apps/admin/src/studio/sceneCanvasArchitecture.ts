import * as T from "three";
import type { Opening, RoomPoint, Scene, Wall } from "./domain";
import { wallLength, wallMidpoint, wallRotationY } from "./architectureAuthoring";
import { disposeObjectResources } from "./threeResources";

export type ArchitectureTransformMode = "translate" | "rotate" | "scale";

export interface WallTransformChange {
  kind: "wall";
  id: string;
  start?: RoomPoint;
  end?: RoomPoint;
  thickness?: number;
  height?: number;
}

export interface OpeningTransformChange {
  kind: "opening";
  id: string;
  x?: number;
  z?: number;
  width?: number;
  height?: number;
}

function wallEndpointsAt(
  wall: Wall,
  target: T.Object3D,
  length: number,
): Pick<WallTransformChange, "start" | "end"> {
  const rotation = target.rotation.y;
  const halfX = (Math.cos(rotation) * length) / 2;
  const halfZ = (-Math.sin(rotation) * length) / 2;
  return {
    start: [target.position.x - halfX, target.position.z - halfZ],
    end: [target.position.x + halfX, target.position.z + halfZ],
  };
}

export function wallTransformChange(
  wall: Wall,
  target: T.Object3D,
  mode: ArchitectureTransformMode,
): WallTransformChange {
  if (mode === "translate") {
    const midpoint = wallMidpoint(wall);
    const dx = target.position.x - midpoint[0];
    const dz = target.position.z - midpoint[1];
    return {
      kind: "wall",
      id: wall.id,
      start: [wall.start[0] + dx, wall.start[1] + dz],
      end: [wall.end[0] + dx, wall.end[1] + dz],
    };
  }
  if (mode === "rotate") {
    return {
      kind: "wall",
      id: wall.id,
      ...wallEndpointsAt(wall, target, wallLength(wall)),
    };
  }
  const length = Math.max(0.2, wallLength(wall) * Math.abs(target.scale.x));
  return {
    kind: "wall",
    id: wall.id,
    ...wallEndpointsAt(wall, target, length),
    thickness: Math.max(0.05, wall.thickness * Math.abs(target.scale.z)),
    height: Math.max(1.8, wall.height * Math.abs(target.scale.y)),
  };
}

export function openingTransformChange(
  opening: Opening,
  target: T.Object3D,
  mode: ArchitectureTransformMode,
): OpeningTransformChange | undefined {
  if (mode === "translate")
    return {
      kind: "opening",
      id: opening.id,
      x: target.position.x,
      z: target.position.z,
    };
  if (mode === "scale")
    return {
      kind: "opening",
      id: opening.id,
      width: Math.max(0.25, opening.width * Math.abs(target.scale.x)),
      height: Math.max(0.3, opening.height * Math.abs(target.scale.y)),
    };
  return undefined;
}

function wallColor(wall: Wall, selected: boolean) {
  if (selected) return 0xffb45e;
  if (wall.reviewed) return 0x54a684;
  if (wall.reviewState === "auto_ready") return 0x6d9ee8;
  return 0xf0a35e;
}

function openingColor(opening: Opening, selected: boolean) {
  if (selected) return 0xffcc6f;
  return opening.kind === "window" ? 0x67b9df : 0xd6a35d;
}

function addWallEndpointHandle(
  root: T.Group,
  wall: Wall,
  endpoint: "start" | "end",
  localX: number,
) {
  const handle = new T.Group();
  handle.name = `Wall ${endpoint} endpoint handle`;
  handle.userData.selectId = wall.id;
  handle.userData.wallEndpoint = endpoint;
  handle.position.set(localX, -wall.height / 2 + 0.16, 0);

  const visible = new T.Mesh(
    new T.SphereGeometry(0.13, 18, 12),
    new T.MeshBasicMaterial({ color: 0xffd18a, depthTest: false }),
  );
  visible.userData.selectId = wall.id;
  visible.userData.wallEndpoint = endpoint;
  visible.renderOrder = 42;
  handle.add(visible);

  const hitTarget = new T.Mesh(
    new T.SphereGeometry(0.32, 12, 8),
    new T.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    }),
  );
  hitTarget.name = `Wall ${endpoint} touch target`;
  hitTarget.userData.selectId = wall.id;
  hitTarget.userData.wallEndpoint = endpoint;
  hitTarget.renderOrder = 43;
  handle.add(hitTarget);
  root.add(handle);
}

export function renderArchitectureElements(
  group: T.Group,
  scene: Scene,
  selected: string,
  selectables: Map<string, T.Object3D>,
  options: {
    visible: boolean;
    floorId?: string;
  },
) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectResources(child);
  }
  group.visible = options.visible;
  if (!options.visible) return;

  for (const wall of scene.walls ?? []) {
    if (options.floorId && wall.floorId !== options.floorId) continue;
    const floor = scene.floors.find((entry) => entry.id === wall.floorId);
    if (!floor) continue;
    const length = wallLength(wall);
    if (length < 0.03) continue;
    const midpoint = wallMidpoint(wall);
    const root = new T.Group();
    root.name = `Editable wall · ${wall.origin}`;
    root.userData.selectId = wall.id;
    root.userData.architectureKind = "wall";
    root.position.set(midpoint[0], floor.elevation + wall.height / 2, midpoint[1]);
    root.rotation.y = T.MathUtils.degToRad(wallRotationY(wall));
    const material = new T.MeshStandardMaterial({
      color: wallColor(wall, wall.id === selected),
      roughness: 0.72,
      transparent: true,
      opacity: wall.id === selected ? 0.5 : wall.reviewed ? 0.23 : 0.32,
      depthWrite: false,
    });
    const mesh = new T.Mesh(
      new T.BoxGeometry(length, wall.height, Math.max(0.05, wall.thickness)),
      material,
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    group.add(root);
    selectables.set(wall.id, root);
    if (wall.id === selected) {
      root.updateWorldMatrix(true, true);
      group.add(new T.BoxHelper(root, 0xffb45e));
      addWallEndpointHandle(root, wall, "start", -length / 2);
      addWallEndpointHandle(root, wall, "end", length / 2);
    }
  }

  for (const opening of scene.openings ?? []) {
    if (options.floorId && opening.floorId !== options.floorId) continue;
    const root = new T.Group();
    root.name = `Editable opening · ${opening.kind}`;
    root.userData.selectId = opening.id;
    root.userData.architectureKind = "opening";
    root.position.set(opening.x, opening.y, opening.z);
    root.rotation.y = T.MathUtils.degToRad(opening.rotationY);
    const marker = new T.Mesh(
      new T.BoxGeometry(
        Math.max(0.08, opening.width),
        Math.max(0.08, opening.height),
        0.1,
      ),
      new T.MeshStandardMaterial({
        color: openingColor(opening, opening.id === selected),
        transparent: true,
        opacity: opening.id === selected ? 0.72 : opening.reviewed ? 0.45 : 0.3,
        depthWrite: false,
        roughness: 0.5,
        metalness: opening.kind === "window" ? 0.08 : 0,
        wireframe: !opening.reviewed,
      }),
    );
    marker.renderOrder = 28;
    root.add(marker);
    group.add(root);
    selectables.set(opening.id, root);
    if (opening.id === selected) {
      root.updateWorldMatrix(true, true);
      group.add(new T.BoxHelper(root, 0xffcc6f));
    }
  }
}
