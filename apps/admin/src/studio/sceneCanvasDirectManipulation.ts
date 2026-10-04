import * as T from "three";
import {
  beginPointerGesture,
  finishPointerGesture,
  resolveDirectPlanDrag,
  resolveEdgeSnap,
  resolvePlanCornerResize,
  updatePointerGesture,
  type PlanResizeCorner,
  type PointerGestureSession,
} from "@rekixo/3d-engine-core";
import {
  catalog,
  roomBoundaryPoints,
  type Furniture,
  type Opening,
  type Room,
  type Scene,
  type SiteElement,
  type Wall,
} from "./domain";
import { hostWallForOpening, wallLength } from "./architectureAuthoring";
import { disposeObjectResources } from "./threeResources";
import type { TransformCommit, TransformMode } from "./sceneCanvasTransform";
import {
  openingTransformChange,
  wallTransformChange,
} from "./sceneCanvasArchitecture";

export interface DirectManipulationConfig {
  scene: Scene;
  selected: string;
  view: "building" | "rooms" | "walk";
  transformMode?: TransformMode;
  transformEnabled?: boolean;
  snap?: boolean;
  roomMapEnabled?: boolean;
  soloRoomId?: string;
  architectureEditing?: boolean;
  furniturePlacement?: { enabled: boolean };
  roomDraw?: { enabled: boolean };
  roomStamp?: { enabled: boolean };
  roomPolygonDraw?: { enabled: boolean };
  roomPolygonEdit?: { enabled: boolean };
  wallDraw?: { enabled: boolean };
  openingPlacement?: { enabled: boolean };
  onSelect: (id: string) => void;
  onTransformCommit?: (change: TransformCommit) => void;
}

type DirectEntity =
  | { kind: "room"; value: Room; floorId: string }
  | { kind: "furniture"; value: Furniture; floorId: string }
  | { kind: "site"; value: SiteElement }
  | { kind: "wall"; value: Wall; floorId: string }
  | { kind: "opening"; value: Opening; floorId: string };

type WallEndpoint = "start" | "end";
type OpeningResizeCorner = "top-left" | "top-right";
type MutableEdgeSnapTargets = { x: number[]; z: number[] };

interface ResizePreview {
  centreWorld: [number, number];
  width: number;
  depth: number;
}

interface OpeningResizePreview {
  centreWorld: [number, number];
  centreY: number;
  width: number;
  height: number;
}

interface DragSession {
  gesture: PointerGestureSession;
  id: string;
  entity: DirectEntity;
  target: T.Object3D;
  previewTarget: T.Object3D;
  startLocal: T.Vector3;
  startScale: T.Vector3;
  startRotationY: number;
  originWorld: readonly [number, number];
  grabWorld: readonly [number, number];
  planeY: number;
  previousCursor: string;
  guideLayer: T.Group;
  wallEndpoint?: WallEndpoint;
  endpointWorld?: [number, number];
  resizeCorner?: PlanResizeCorner;
  resizePreview?: ResizePreview;
  openingResizeCorner?: OpeningResizeCorner;
  openingResizePreview?: OpeningResizePreview;
  furnitureRotationHandle?: boolean;
  rotationPreview?: number;
  snapApplied?: boolean;
}

interface DirectManipulationOptions {
  getConfig: () => DirectManipulationConfig;
  renderer: T.WebGLRenderer;
  camera: T.Camera;
  controls: { enabled: boolean };
  transform: {
    dragging: boolean;
    axis: string | null;
    enabled: boolean;
  };
  selectables: Map<string, T.Object3D>;
  pointOnFloor: (
    clientX: number,
    clientY: number,
    floorId: string,
    snap: boolean,
    excludeRoomId?: string,
  ) => T.Vector3 | undefined;
  snapPlanPoint: (
    point: T.Vector3,
    floorId: string,
    enabled: boolean,
    excludeRoomId?: string,
  ) => T.Vector3;
  setStatus: (message: string) => void;
}

function authoringActive(config: DirectManipulationConfig) {
  return Boolean(
    config.furniturePlacement?.enabled ||
      config.roomDraw?.enabled ||
      config.roomStamp?.enabled ||
      config.roomPolygonDraw?.enabled ||
      config.roomPolygonEdit?.enabled ||
      config.wallDraw?.enabled ||
      config.openingPlacement?.enabled,
  );
}

function directEntity(
  config: DirectManipulationConfig,
  id: string,
): DirectEntity | undefined {
  const room = config.scene.rooms.find((entry) => entry.id === id);
  if (room) {
    if (
      (config.view === "rooms" && !config.soloRoomId) ||
      (config.view === "building" && config.roomMapEnabled)
    )
      return { kind: "room", value: room, floorId: room.floorId };
    return undefined;
  }

  const furniture = config.scene.furniture.find((entry) => entry.id === id);
  if (furniture && config.view === "rooms") {
    const owner = config.scene.rooms.find(
      (roomEntry) => roomEntry.id === furniture.roomId,
    );
    if (owner)
      return { kind: "furniture", value: furniture, floorId: owner.floorId };
  }

  const site = config.scene.siteElements?.find((entry) => entry.id === id);
  if (site && config.view === "building") return { kind: "site", value: site };

  const wall = config.scene.walls?.find((entry) => entry.id === id);
  if (wall && config.view === "building" && config.architectureEditing)
    return { kind: "wall", value: wall, floorId: wall.floorId };

  const opening = config.scene.openings?.find((entry) => entry.id === id);
  if (opening && config.view === "building" && config.architectureEditing)
    return { kind: "opening", value: opening, floorId: opening.floorId };

  return undefined;
}

function selectableId(node: T.Object3D | null) {
  let current = node;
  while (current) {
    if (current.userData.selectId) return String(current.userData.selectId);
    current = current.parent;
  }
  return undefined;
}

function wallEndpointHandle(node: T.Object3D | null) {
  let current = node;
  let hit: { node: T.Object3D; endpoint: WallEndpoint } | undefined;
  while (current) {
    const endpoint = current.userData.wallEndpoint;
    if (endpoint === "start" || endpoint === "end")
      hit = { node: current, endpoint };
    if (current.userData.architectureKind === "wall") break;
    current = current.parent;
  }
  return hit;
}

function planResizeHandle(node: T.Object3D | null) {
  let current = node;
  while (current) {
    const corner = current.userData.planResizeCorner;
    if (
      corner === "nw" ||
      corner === "ne" ||
      corner === "se" ||
      corner === "sw"
    )
      return corner as PlanResizeCorner;
    if (current.userData.selectId) break;
    current = current.parent;
  }
  return undefined;
}

function openingResizeHandle(node: T.Object3D | null) {
  let current = node;
  while (current) {
    const corner = current.userData.openingResizeCorner;
    if (corner === "top-left" || corner === "top-right")
      return corner as OpeningResizeCorner;
    if (current.userData.architectureKind === "opening") break;
    current = current.parent;
  }
  return undefined;
}

function isFurnitureRotationHandle(node: T.Object3D | null) {
  let current = node;
  while (current) {
    if (current.userData.furnitureRotationHandle) return true;
    if (current.userData.selectId) break;
    current = current.parent;
  }
  return false;
}

function pointerRay(
  renderer: T.WebGLRenderer,
  camera: T.Camera,
  clientX: number,
  clientY: number,
) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ray = new T.Raycaster();
  ray.setFromCamera(
    new T.Vector2(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      (-(clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    ),
    camera,
  );
  return ray;
}

function pointAtHeight(
  options: DirectManipulationOptions,
  clientX: number,
  clientY: number,
  y: number,
) {
  const ray = pointerRay(options.renderer, options.camera, clientX, clientY);
  const target = new T.Vector3();
  return ray.ray.intersectPlane(
    new T.Plane(new T.Vector3(0, 1, 0), -y),
    target,
  )
    ? target
    : undefined;
}

function openingPlanePoint(
  options: DirectManipulationOptions,
  opening: Opening,
  event: PointerEvent,
) {
  const rotation = T.MathUtils.degToRad(opening.rotationY);
  const normal = new T.Vector3(Math.sin(rotation), 0, Math.cos(rotation));
  const plane = new T.Plane().setFromNormalAndCoplanarPoint(
    normal,
    new T.Vector3(opening.x, opening.y, opening.z),
  );
  const target = new T.Vector3();
  return pointerRay(
    options.renderer,
    options.camera,
    event.clientX,
    event.clientY,
  ).ray.intersectPlane(plane, target)
    ? target
    : undefined;
}

function entityPointerPoint(
  options: DirectManipulationOptions,
  session: Pick<DragSession, "entity" | "planeY" | "openingResizeCorner">,
  event: PointerEvent,
) {
  if (session.openingResizeCorner && session.entity.kind === "opening")
    return openingPlanePoint(options, session.entity.value, event);
  return "floorId" in session.entity
    ? options.pointOnFloor(
        event.clientX,
        event.clientY,
        session.entity.floorId,
        false,
        session.entity.kind === "room" ? session.entity.value.id : undefined,
      )
    : pointAtHeight(options, event.clientX, event.clientY, session.planeY);
}

function topScene(node: T.Object3D) {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

function clearSnapGuides(layer: T.Group) {
  for (const child of [...layer.children]) {
    layer.remove(child);
    disposeObjectResources(child);
  }
}

function addGuideLine(
  layer: T.Group,
  points: readonly T.Vector3[],
  color = 0x2bc7ff,
) {
  const line = new T.Line(
    new T.BufferGeometry().setFromPoints(points),
    new T.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  line.renderOrder = 60;
  layer.add(line);
}

function renderPlanSnapGuides(
  session: DragSession,
  x?: number,
  z?: number,
) {
  clearSnapGuides(session.guideLayer);
  if (x === undefined && z === undefined) return;
  const y = session.planeY + 0.12;
  const span = 60;
  if (x !== undefined)
    addGuideLine(
      session.guideLayer,
      [new T.Vector3(x, y, -span), new T.Vector3(x, y, span)],
    );
  if (z !== undefined)
    addGuideLine(
      session.guideLayer,
      [new T.Vector3(-span, y, z), new T.Vector3(span, y, z)],
    );
  if (x !== undefined && z !== undefined) {
    const marker = new T.Mesh(
      new T.SphereGeometry(0.07, 12, 8),
      new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    marker.position.set(x, y, z);
    marker.renderOrder = 61;
    session.guideLayer.add(marker);
  }
}

function renderRotationSnapGuide(
  session: DragSession,
  centre: readonly [number, number],
  rotation: number,
) {
  clearSnapGuides(session.guideLayer);
  const angle = T.MathUtils.degToRad(rotation);
  const y = session.planeY + 0.12;
  const radius = 2.2;
  addGuideLine(
    session.guideLayer,
    [
      new T.Vector3(centre[0], y, centre[1]),
      new T.Vector3(
        centre[0] + Math.sin(angle) * radius,
        y,
        centre[1] + Math.cos(angle) * radius,
      ),
    ],
    0xffb45e,
  );
}

function matchingEdgeTarget(
  centre: number,
  halfExtent: number,
  targets: readonly number[],
) {
  const edges = [centre - halfExtent, centre + halfExtent];
  let best: { target: number; distance: number } | undefined;
  for (const target of targets) {
    if (!Number.isFinite(target)) continue;
    for (const edge of edges) {
      const distance = Math.abs(edge - target);
      if (
        distance <= 1e-5 &&
        (!best ||
          distance < best.distance - 1e-9 ||
          (Math.abs(distance - best.distance) <= 1e-9 && target < best.target))
      )
        best = { target, distance };
    }
  }
  return best?.target;
}

function rotatedHalfExtents(width: number, depth: number, rotation: number) {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return [
    (width * cos + depth * sin) / 2,
    (width * sin + depth * cos) / 2,
  ] as const;
}

function entityHalfExtents(entity: DirectEntity) {
  if (entity.kind === "room")
    return [entity.value.width / 2, entity.value.depth / 2] as const;
  if (entity.kind === "furniture") {
    const item = catalog[entity.value.kind];
    return rotatedHalfExtents(item.width, item.depth, entity.value.rotation);
  }
  if (entity.kind === "site")
    return rotatedHalfExtents(
      entity.value.width,
      entity.value.depth,
      entity.value.rotation,
    );
  return undefined;
}

function addRoomTargets(targets: MutableEdgeSnapTargets, room: Room) {
  for (const [x, z] of roomBoundaryPoints(room)) {
    targets.x.push(x);
    targets.z.push(z);
  }
}

function addBoxTargets(
  targets: MutableEdgeSnapTargets,
  x: number,
  z: number,
  halfExtents: readonly [number, number],
) {
  targets.x.push(x - halfExtents[0], x + halfExtents[0]);
  targets.z.push(z - halfExtents[1], z + halfExtents[1]);
}

function edgeSnapTargets(
  config: DirectManipulationConfig,
  entity: DirectEntity,
): MutableEdgeSnapTargets {
  const targets: MutableEdgeSnapTargets = { x: [], z: [] };
  const floorId = "floorId" in entity ? entity.floorId : entity.value.floorId;

  if (entity.kind === "furniture") {
    const owner = config.scene.rooms.find(
      (room) => room.id === entity.value.roomId,
    );
    if (owner) addRoomTargets(targets, owner);
    for (const item of config.scene.furniture) {
      if (
        item.id === entity.value.id ||
        item.roomId !== entity.value.roomId
      )
        continue;
      const room = config.scene.rooms.find(
        (candidate) => candidate.id === item.roomId,
      );
      if (!room) continue;
      const size = catalog[item.kind];
      addBoxTargets(
        targets,
        room.x + item.x,
        room.z + item.z,
        rotatedHalfExtents(size.width, size.depth, item.rotation),
      );
    }
    return targets;
  }

  for (const room of config.scene.rooms) {
    if (floorId && room.floorId !== floorId) continue;
    if (entity.kind === "room" && room.id === entity.value.id) continue;
    addRoomTargets(targets, room);
  }
  for (const wall of config.scene.walls ?? []) {
    if (floorId && wall.floorId !== floorId) continue;
    targets.x.push(wall.start[0], wall.end[0]);
    targets.z.push(wall.start[1], wall.end[1]);
  }

  if (entity.kind === "site")
    for (const item of config.scene.siteElements ?? []) {
      if (item.id === entity.value.id) continue;
      if (floorId && item.floorId && item.floorId !== floorId) continue;
      addBoxTargets(
        targets,
        item.x,
        item.z,
        rotatedHalfExtents(item.width, item.depth, item.rotation),
      );
    }

  return targets;
}

function setWorldPlanPosition(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  const config = options.getConfig();
  const gridObject =
    session.entity.kind === "furniture" || session.entity.kind === "site";
  const raw = resolveDirectPlanDrag(
    session.originWorld,
    session.grabWorld,
    [pointer.x, pointer.z],
  );
  let [x, z] = resolveDirectPlanDrag(
    session.originWorld,
    session.grabWorld,
    [pointer.x, pointer.z],
    { gridSize: config.snap && gridObject ? 0.1 : 0 },
  );
  let snapped =
    Math.abs(x - raw[0]) > 1e-6 || Math.abs(z - raw[1]) > 1e-6;
  let guideX: number | undefined;
  let guideZ: number | undefined;

  if (config.snap) {
    const halfExtents = entityHalfExtents(session.entity);
    if (halfExtents) {
      const targets = edgeSnapTargets(config, session.entity);
      const edge = resolveEdgeSnap([x, z], halfExtents, targets, {
        tolerance: 0.18,
      });
      x = edge.point[0];
      z = edge.point[1];
      snapped ||= edge.snappedX || edge.snappedZ;
      guideX = edge.snappedX
        ? matchingEdgeTarget(x, halfExtents[0], targets.x)
        : undefined;
      guideZ = edge.snappedZ
        ? matchingEdgeTarget(z, halfExtents[1], targets.z)
        : undefined;
    } else if ("floorId" in session.entity) {
      const plan = options.snapPlanPoint(
        new T.Vector3(x, session.planeY, z),
        session.entity.floorId,
        true,
      );
      const changedX = Math.abs(plan.x - x) > 1e-6;
      const changedZ = Math.abs(plan.z - z) > 1e-6;
      snapped ||= changedX || changedZ;
      x = plan.x;
      z = plan.z;
      guideX = changedX ? x : undefined;
      guideZ = changedZ ? z : undefined;
    }
  }

  session.snapApplied = snapped;
  renderPlanSnapGuides(session, guideX, guideZ);
  const world = new T.Vector3(x, session.planeY, z);
  const local = session.target.parent
    ? session.target.parent.worldToLocal(world.clone())
    : world;
  session.target.position.x = local.x;
  session.target.position.z = local.z;
  session.target.updateWorldMatrix(true, true);
}

function resizeEntitySize(entity: DirectEntity) {
  if (entity.kind === "room" || entity.kind === "site")
    return [entity.value.width, entity.value.depth] as const;
  return undefined;
}

function resizeRotationRadians(entity: DirectEntity) {
  return entity.kind === "site"
    ? T.MathUtils.degToRad(entity.value.rotation)
    : 0;
}

function setPlanCornerResize(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  if (!session.resizeCorner) return false;
  const size = resizeEntitySize(session.entity);
  if (!size) return false;
  const config = options.getConfig();
  let pointerX = pointer.x;
  let pointerZ = pointer.z;
  let snapped = false;
  let guideX: number | undefined;
  let guideZ: number | undefined;

  if (config.snap) {
    const targets = edgeSnapTargets(config, session.entity);
    const edge = resolveEdgeSnap(
      [pointerX, pointerZ],
      [0, 0],
      targets,
      { tolerance: 0.18 },
    );
    pointerX = edge.point[0];
    pointerZ = edge.point[1];
    snapped = edge.snappedX || edge.snappedZ;
    guideX = edge.snappedX
      ? matchingEdgeTarget(pointerX, 0, targets.x)
      : undefined;
    guideZ = edge.snappedZ
      ? matchingEdgeTarget(pointerZ, 0, targets.z)
      : undefined;
  }

  const rotation = resizeRotationRadians(session.entity);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = pointerX - session.originWorld[0];
  const dz = pointerZ - session.originWorld[1];
  const pointerLocal: [number, number] = [
    cos * dx - sin * dz,
    sin * dx + cos * dz,
  ];
  const minimum = session.entity.kind === "site" ? 0.05 : 0.2;
  const resize = resolvePlanCornerResize(
    size,
    session.resizeCorner,
    pointerLocal,
    {
      minWidth: minimum,
      minDepth: minimum,
    },
  );
  const offsetX = cos * resize.centre[0] + sin * resize.centre[1];
  const offsetZ = -sin * resize.centre[0] + cos * resize.centre[1];
  const centreWorld: [number, number] = [
    Number((session.originWorld[0] + offsetX).toFixed(6)),
    Number((session.originWorld[1] + offsetZ).toFixed(6)),
  ];
  const world = new T.Vector3(
    centreWorld[0],
    session.planeY,
    centreWorld[1],
  );
  const local = session.target.parent
    ? session.target.parent.worldToLocal(world.clone())
    : world;
  session.target.position.x = local.x;
  session.target.position.z = local.z;
  session.target.scale.x = session.startScale.x * (resize.width / size[0]);
  session.target.scale.z = session.startScale.z * (resize.depth / size[1]);
  session.target.updateWorldMatrix(true, true);
  session.resizePreview = {
    centreWorld,
    width: resize.width,
    depth: resize.depth,
  };
  session.snapApplied = snapped;
  renderPlanSnapGuides(session, guideX, guideZ);
  options.setStatus(
    `Resize · W ${resize.width.toFixed(2)} m × D ${resize.depth.toFixed(2)} m${snapped ? " · snap" : ""}`,
  );
  return true;
}

function setWallEndpointPosition(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  if (session.entity.kind !== "wall" || !session.wallEndpoint) return false;
  const config = options.getConfig();
  let [x, z] = resolveDirectPlanDrag(
    session.originWorld,
    session.grabWorld,
    [pointer.x, pointer.z],
  );
  let snapped = false;
  let guideX: number | undefined;
  let guideZ: number | undefined;
  if (config.snap) {
    const plan = options.snapPlanPoint(
      new T.Vector3(x, session.planeY, z),
      session.entity.floorId,
      true,
    );
    const changedX = Math.abs(plan.x - x) > 1e-6;
    const changedZ = Math.abs(plan.z - z) > 1e-6;
    snapped = changedX || changedZ;
    x = plan.x;
    z = plan.z;
    guideX = changedX ? x : undefined;
    guideZ = changedZ ? z : undefined;
  }

  const fixed =
    session.wallEndpoint === "start"
      ? session.entity.value.end
      : session.entity.value.start;
  if (Math.hypot(x - fixed[0], z - fixed[1]) < 0.2) {
    options.setStatus("Wall endpoints must stay at least 0.2 m apart.");
    return false;
  }

  const world = new T.Vector3(x, session.planeY, z);
  const local = session.previewTarget.parent
    ? session.previewTarget.parent.worldToLocal(world.clone())
    : world;
  session.previewTarget.position.x = local.x;
  session.previewTarget.position.z = local.z;
  session.previewTarget.updateWorldMatrix(true, true);
  session.endpointWorld = [Number(x.toFixed(4)), Number(z.toFixed(4))];
  session.snapApplied = snapped;
  renderPlanSnapGuides(session, guideX, guideZ);
  return true;
}

function openingResizePlanCorner(corner: OpeningResizeCorner): PlanResizeCorner {
  return corner === "top-left" ? "sw" : "se";
}

function setOpeningResize(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  if (
    session.entity.kind !== "opening" ||
    !session.openingResizeCorner
  )
    return false;
  const opening = session.entity.value;
  const config = options.getConfig();
  const rotation = T.MathUtils.degToRad(opening.rotationY);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = pointer.x - session.originWorld[0];
  const dz = pointer.z - session.originWorld[1];
  let localX = cos * dx - sin * dz;
  let localY = pointer.y - session.planeY;
  const corner = openingResizePlanCorner(session.openingResizeCorner);
  let resize = resolvePlanCornerResize(
    [opening.width, opening.height],
    corner,
    [localX, localY],
    { minWidth: 0.25, minDepth: 0.3 },
  );

  const host = hostWallForOpening(config.scene, opening);
  const sillHeight = opening.kind === "window" ? opening.sillHeight ?? 0.9 : 0;
  const maxWidth = host
    ? Math.max(0.25, Math.min(8, wallLength(host) - 0.1))
    : 8;
  const maxHeight = host
    ? Math.max(0.3, host.height - sillHeight)
    : 20;
  let width = Math.min(resize.width, maxWidth);
  let height = Math.min(resize.depth, maxHeight);
  let snapped = false;

  if (config.snap) {
    const snappedWidth = Math.min(
      maxWidth,
      Math.max(0.25, Math.round(width / 0.05) * 0.05),
    );
    const snappedHeight = Math.min(
      maxHeight,
      Math.max(0.3, Math.round(height / 0.05) * 0.05),
    );
    snapped =
      Math.abs(snappedWidth - width) > 1e-6 ||
      Math.abs(snappedHeight - height) > 1e-6;
    width = snappedWidth;
    height = snappedHeight;
  }

  const signX = session.openingResizeCorner === "top-right" ? 1 : -1;
  const fixedX = (-signX * opening.width) / 2;
  const fixedY = -opening.height / 2;
  localX = fixedX + signX * width;
  localY = fixedY + height;
  resize = resolvePlanCornerResize(
    [opening.width, opening.height],
    corner,
    [localX, localY],
    { minWidth: 0.25, minDepth: 0.3 },
  );

  const centreWorld: [number, number] = [
    Number(
      (
        session.originWorld[0] +
        cos * resize.centre[0]
      ).toFixed(6),
    ),
    Number(
      (
        session.originWorld[1] -
        sin * resize.centre[0]
      ).toFixed(6),
    ),
  ];
  const centreY = Number((session.planeY + resize.centre[1]).toFixed(6));
  const world = new T.Vector3(centreWorld[0], centreY, centreWorld[1]);
  const local = session.target.parent
    ? session.target.parent.worldToLocal(world.clone())
    : world;
  session.target.position.copy(local);
  session.target.scale.x =
    session.startScale.x * (resize.width / opening.width);
  session.target.scale.y =
    session.startScale.y * (resize.depth / opening.height);
  session.target.updateWorldMatrix(true, true);
  session.openingResizePreview = {
    centreWorld,
    centreY,
    width: resize.width,
    height: resize.depth,
  };
  session.snapApplied = snapped;
  clearSnapGuides(session.guideLayer);
  options.setStatus(
    `Opening resize · W ${resize.width.toFixed(2)} m × H ${resize.depth.toFixed(2)} m${snapped ? " · 0.05 m snap" : ""}`,
  );
  return true;
}

function normalizeDegrees(value: number) {
  const normalized = ((value % 360) + 360) % 360;
  return Number(normalized.toFixed(3));
}

function setFurnitureRotation(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  if (session.entity.kind !== "furniture" || !session.furnitureRotationHandle)
    return false;
  const dx = pointer.x - session.originWorld[0];
  const dz = pointer.z - session.originWorld[1];
  if (Math.hypot(dx, dz) < 0.12) return false;
  let rotation = normalizeDegrees(
    T.MathUtils.radToDeg(Math.atan2(dx, dz)),
  );
  let snapped = false;
  if (options.getConfig().snap) {
    const snappedRotation = normalizeDegrees(Math.round(rotation / 15) * 15);
    snapped = Math.abs(snappedRotation - rotation) > 1e-6;
    rotation = snappedRotation;
  }
  session.target.rotation.y = T.MathUtils.degToRad(rotation);
  session.target.updateWorldMatrix(true, true);
  session.rotationPreview = rotation;
  session.snapApplied = snapped;
  renderRotationSnapGuide(session, session.originWorld, rotation);
  options.setStatus(
    `Rotate furniture · ${rotation.toFixed(0)}°${options.getConfig().snap ? " · 15° snap" : ""}`,
  );
  return true;
}

function transformCommit(session: DragSession): TransformCommit | undefined {
  if (session.openingResizeCorner && session.openingResizePreview) {
    if (session.entity.kind !== "opening") return undefined;
    const preview = session.openingResizePreview;
    const opening = session.entity.value;
    if (
      Math.abs(preview.centreWorld[0] - opening.x) <= 1e-6 &&
      Math.abs(preview.centreWorld[1] - opening.z) <= 1e-6 &&
      Math.abs(preview.width - opening.width) <= 1e-6 &&
      Math.abs(preview.height - opening.height) <= 1e-6
    )
      return undefined;
    return {
      kind: "opening",
      id: opening.id,
      x: preview.centreWorld[0],
      z: preview.centreWorld[1],
      width: preview.width,
      height: preview.height,
    };
  }
  if (session.furnitureRotationHandle && session.rotationPreview !== undefined) {
    if (session.entity.kind !== "furniture") return undefined;
    if (
      Math.abs(
        normalizeDegrees(session.rotationPreview - session.entity.value.rotation),
      ) <= 1e-6
    )
      return undefined;
    return {
      kind: "furniture",
      id: session.entity.value.id,
      rotation: session.rotationPreview,
    };
  }
  if (session.resizeCorner && session.resizePreview) {
    const { centreWorld, width, depth } = session.resizePreview;
    if (session.entity.kind !== "room" && session.entity.kind !== "site")
      return undefined;
    const value = session.entity.value;
    if (
      Math.abs(centreWorld[0] - value.x) <= 1e-6 &&
      Math.abs(centreWorld[1] - value.z) <= 1e-6 &&
      Math.abs(width - value.width) <= 1e-6 &&
      Math.abs(depth - value.depth) <= 1e-6
    )
      return undefined;
    return session.entity.kind === "room"
      ? {
          kind: "room",
          id: value.id,
          x: centreWorld[0],
          z: centreWorld[1],
          width,
          depth,
        }
      : {
          kind: "siteElement",
          id: value.id,
          x: centreWorld[0],
          z: centreWorld[1],
          width,
          depth,
        };
  }
  if (session.entity.kind === "room")
    return {
      kind: "room",
      id: session.entity.value.id,
      x: session.target.position.x,
      z: session.target.position.z,
    };
  if (session.entity.kind === "furniture")
    return {
      kind: "furniture",
      id: session.entity.value.id,
      x: session.target.position.x,
      z: session.target.position.z,
    };
  if (session.entity.kind === "site")
    return {
      kind: "siteElement",
      id: session.entity.value.id,
      x: session.target.position.x,
      z: session.target.position.z,
    };
  if (session.entity.kind === "wall") {
    if (session.wallEndpoint && session.endpointWorld) {
      const original = session.entity.value[session.wallEndpoint];
      if (
        Math.hypot(
          session.endpointWorld[0] - original[0],
          session.endpointWorld[1] - original[1],
        ) <= 1e-6
      )
        return undefined;
      return session.wallEndpoint === "start"
        ? {
            kind: "wall",
            id: session.entity.value.id,
            start: session.endpointWorld,
          }
        : {
            kind: "wall",
            id: session.entity.value.id,
            end: session.endpointWorld,
          };
    }
    return wallTransformChange(session.entity.value, session.target, "translate");
  }
  return openingTransformChange(session.entity.value, session.target, "translate");
}

export function createDirectManipulationController(
  options: DirectManipulationOptions,
) {
  let active: DragSession | undefined;
  const guideLayer = new T.Group();
  guideLayer.name = "Direct manipulation snap guides";

  const release = (session: DragSession) => {
    const config = options.getConfig();
    options.controls.enabled = config.view !== "walk";
    options.transform.enabled = true;
    options.renderer.domElement.style.cursor = session.previousCursor;
    clearSnapGuides(session.guideLayer);
    try {
      options.renderer.domElement.releasePointerCapture(
        session.gesture.pointerId,
      );
    } catch {
      // Pointer capture can already be gone after browser cancellation.
    }
  };

  return {
    get active() {
      return Boolean(active);
    },

    pointerDown(event: PointerEvent) {
      const config = options.getConfig();
      if (
        active ||
        event.button !== 0 ||
        config.view === "walk" ||
        !config.transformEnabled ||
        (config.transformMode ?? "translate") !== "translate" ||
        authoringActive(config) ||
        options.transform.dragging ||
        options.transform.axis
      )
        return false;

      const candidates = [...options.selectables.values()].filter(
        (target) => target.visible,
      );
      const hit = pointerRay(
        options.renderer,
        options.camera,
        event.clientX,
        event.clientY,
      ).intersectObjects(candidates, true)[0];
      const id = selectableId(hit?.object ?? null);
      if (!id) return false;
      const target = options.selectables.get(id);
      const entity = directEntity(config, id);
      if (!target || !entity) return false;

      const endpointHit =
        entity.kind === "wall"
          ? wallEndpointHandle(hit?.object ?? null)
          : undefined;
      const resizeCorner = planResizeHandle(hit?.object ?? null);
      const resizeAllowed = Boolean(
        resizeCorner &&
          (entity.kind === "site" ||
            (entity.kind === "room" && !entity.value.polygon?.length)),
      );
      const openingCorner =
        entity.kind === "opening"
          ? openingResizeHandle(hit?.object ?? null)
          : undefined;
      const rotationHandle =
        entity.kind === "furniture" &&
        isFurnitureRotationHandle(hit?.object ?? null);
      const previewTarget = endpointHit?.node ?? target;
      previewTarget.updateWorldMatrix(true, true);
      target.updateWorldMatrix(true, true);
      const targetWorld = target.getWorldPosition(new T.Vector3());
      const previewWorld = previewTarget.getWorldPosition(new T.Vector3());
      const endpointWorld =
        entity.kind === "wall" && endpointHit
          ? ([...entity.value[endpointHit.endpoint]] as [number, number])
          : undefined;
      const probe: Pick<
        DragSession,
        "entity" | "planeY" | "openingResizeCorner"
      > = {
        entity,
        planeY: targetWorld.y,
        openingResizeCorner: openingCorner,
      };
      const grab = entityPointerPoint(options, probe, event);
      if (!grab) return false;

      const root = topScene(target);
      if (guideLayer.parent !== root) {
        guideLayer.removeFromParent();
        root.add(guideLayer);
      }
      clearSnapGuides(guideLayer);

      active = {
        gesture: beginPointerGesture(event),
        id,
        entity,
        target,
        previewTarget,
        startLocal: previewTarget.position.clone(),
        startScale: previewTarget.scale.clone(),
        startRotationY: previewTarget.rotation.y,
        originWorld:
          resizeAllowed || openingCorner || rotationHandle
            ? [targetWorld.x, targetWorld.z]
            : endpointWorld ?? [previewWorld.x, previewWorld.z],
        grabWorld: [grab.x, grab.z],
        planeY: targetWorld.y,
        previousCursor: options.renderer.domElement.style.cursor,
        guideLayer,
        wallEndpoint: endpointHit?.endpoint,
        endpointWorld,
        resizeCorner: resizeAllowed ? resizeCorner : undefined,
        openingResizeCorner: openingCorner,
        furnitureRotationHandle: rotationHandle,
      };
      options.controls.enabled = false;
      options.transform.enabled = false;
      options.renderer.domElement.setPointerCapture(event.pointerId);
      options.renderer.domElement.style.cursor = openingCorner
        ? "nwse-resize"
        : rotationHandle
          ? "crosshair"
          : resizeAllowed
            ? resizeCorner === "nw" || resizeCorner === "se"
              ? "nwse-resize"
              : "nesw-resize"
            : endpointHit
              ? "crosshair"
              : "grab";
      return true;
    },

    pointerMove(event: PointerEvent) {
      if (!active) return false;
      const update = updatePointerGesture(active.gesture, event);
      if (!update.accepted) return true;
      active.gesture = update.session;
      if (!update.session.activated) return true;
      const pointer = entityPointerPoint(options, active, event);
      if (pointer) {
        if (active.openingResizeCorner)
          setOpeningResize(options, active, pointer);
        else if (active.furnitureRotationHandle)
          setFurnitureRotation(options, active, pointer);
        else if (active.resizeCorner)
          setPlanCornerResize(options, active, pointer);
        else if (active.wallEndpoint)
          setWallEndpointPosition(options, active, pointer);
        else setWorldPlanPosition(options, active, pointer);
        if (
          !active.resizeCorner &&
          !active.openingResizeCorner &&
          !active.furnitureRotationHandle
        )
          options.renderer.domElement.style.cursor = "grabbing";
      }
      return true;
    },

    pointerUp(event: PointerEvent) {
      if (!active) return false;
      const completion = finishPointerGesture(active.gesture, event, {
        cancelled: event.type === "pointercancel",
      });
      if (!completion.accepted) return true;

      const session = active;
      active = undefined;
      if (completion.kind === "cancel") {
        session.previewTarget.position.copy(session.startLocal);
        session.previewTarget.scale.copy(session.startScale);
        session.previewTarget.rotation.y = session.startRotationY;
        session.previewTarget.updateWorldMatrix(true, true);
        release(session);
        options.setStatus("");
        return true;
      }

      if (completion.kind === "tap") {
        release(session);
        options.getConfig().onSelect(session.id);
        return true;
      }

      const pointer = entityPointerPoint(options, session, event);
      if (pointer) {
        if (session.openingResizeCorner)
          setOpeningResize(options, session, pointer);
        else if (session.furnitureRotationHandle)
          setFurnitureRotation(options, session, pointer);
        else if (session.resizeCorner)
          setPlanCornerResize(options, session, pointer);
        else if (session.wallEndpoint)
          setWallEndpointPosition(options, session, pointer);
        else setWorldPlanPosition(options, session, pointer);
      }
      const change = transformCommit(session);
      release(session);
      const config = options.getConfig();
      config.onSelect(session.id);
      if (change) config.onTransformCommit?.(change);
      if (!change) {
        options.setStatus("");
        return true;
      }
      options.setStatus(
        session.openingResizeCorner && session.openingResizePreview
          ? `Opening resized directly · W ${session.openingResizePreview.width.toFixed(2)} m × H ${session.openingResizePreview.height.toFixed(2)} m${session.snapApplied ? " · dimension snap" : ""} · one undo step.`
          : session.furnitureRotationHandle &&
              session.rotationPreview !== undefined
            ? `Furniture rotated directly · ${session.rotationPreview.toFixed(0)}°${config.snap ? " · 15° snap" : ""} · one undo step.`
            : session.resizeCorner && session.resizePreview
              ? `Resized directly · W ${session.resizePreview.width.toFixed(2)} m × D ${session.resizePreview.depth.toFixed(2)} m${session.snapApplied ? " · smart snap" : ""} · one undo step.`
              : session.wallEndpoint
                ? session.snapApplied
                  ? "Wall endpoint resized · smart snap applied · one undo step."
                  : "Wall endpoint resized · one undo step."
                : session.snapApplied
                  ? "Moved directly · smart edge snap applied · one undo step."
                  : "Moved directly · one undo step.",
      );
      return true;
    },
  };
}
