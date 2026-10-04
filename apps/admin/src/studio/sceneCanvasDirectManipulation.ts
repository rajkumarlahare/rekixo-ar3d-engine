import * as T from "three";
import {
  beginPointerGesture,
  finishPointerGesture,
  resolveDirectPlanDrag,
  resolveEdgeSnap,
  updatePointerGesture,
  type EdgeSnapTargets,
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

interface DragSession {
  gesture: PointerGestureSession;
  id: string;
  entity: DirectEntity;
  target: T.Object3D;
  previewTarget: T.Object3D;
  startLocal: T.Vector3;
  originWorld: readonly [number, number];
  grabWorld: readonly [number, number];
  planeY: number;
  previousCursor: string;
  wallEndpoint?: WallEndpoint;
  endpointWorld?: [number, number];
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

function directEntity(config: DirectManipulationConfig, id: string): DirectEntity | undefined {
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
    const owner = config.scene.rooms.find((roomEntry) => roomEntry.id === furniture.roomId);
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

function entityPointerPoint(
  options: DirectManipulationOptions,
  session: Pick<DragSession, "entity" | "planeY">,
  event: PointerEvent,
) {
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

function addRoomTargets(targets: Required<EdgeSnapTargets>, room: Room) {
  for (const [x, z] of roomBoundaryPoints(room)) {
    targets.x.push(x);
    targets.z.push(z);
  }
}

function addBoxTargets(
  targets: Required<EdgeSnapTargets>,
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
): Required<EdgeSnapTargets> {
  const targets: Required<EdgeSnapTargets> = { x: [], z: [] };
  const floorId = "floorId" in entity ? entity.floorId : entity.value.floorId;

  if (entity.kind === "furniture") {
    const owner = config.scene.rooms.find((room) => room.id === entity.value.roomId);
    if (owner) addRoomTargets(targets, owner);
    for (const item of config.scene.furniture) {
      if (item.id === entity.value.id || item.roomId !== entity.value.roomId) continue;
      const room = config.scene.rooms.find((candidate) => candidate.id === item.roomId);
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
  const gridObject = session.entity.kind === "furniture" || session.entity.kind === "site";
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
  let snapped = Math.abs(x - raw[0]) > 1e-6 || Math.abs(z - raw[1]) > 1e-6;

  if (config.snap) {
    const halfExtents = entityHalfExtents(session.entity);
    if (halfExtents) {
      const edge = resolveEdgeSnap(
        [x, z],
        halfExtents,
        edgeSnapTargets(config, session.entity),
        { tolerance: 0.18 },
      );
      x = edge.point[0];
      z = edge.point[1];
      snapped ||= edge.snappedX || edge.snappedZ;
    } else if ("floorId" in session.entity) {
      const plan = options.snapPlanPoint(
        new T.Vector3(x, session.planeY, z),
        session.entity.floorId,
        true,
      );
      snapped ||= Math.abs(plan.x - x) > 1e-6 || Math.abs(plan.z - z) > 1e-6;
      x = plan.x;
      z = plan.z;
    }
  }

  session.snapApplied = snapped;
  const world = new T.Vector3(x, session.planeY, z);
  const local = session.target.parent
    ? session.target.parent.worldToLocal(world.clone())
    : world;
  session.target.position.x = local.x;
  session.target.position.z = local.z;
  session.target.updateWorldMatrix(true, true);
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
  if (config.snap) {
    const plan = options.snapPlanPoint(
      new T.Vector3(x, session.planeY, z),
      session.entity.floorId,
      true,
    );
    snapped = Math.abs(plan.x - x) > 1e-6 || Math.abs(plan.z - z) > 1e-6;
    x = plan.x;
    z = plan.z;
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
  return true;
}

function transformCommit(session: DragSession): TransformCommit | undefined {
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
        ? { kind: "wall", id: session.entity.value.id, start: session.endpointWorld }
        : { kind: "wall", id: session.entity.value.id, end: session.endpointWorld };
    }
    return wallTransformChange(session.entity.value, session.target, "translate");
  }
  return openingTransformChange(session.entity.value, session.target, "translate");
}

export function createDirectManipulationController(options: DirectManipulationOptions) {
  let active: DragSession | undefined;

  const release = (session: DragSession) => {
    const config = options.getConfig();
    options.controls.enabled = config.view !== "walk";
    options.transform.enabled = true;
    options.renderer.domElement.style.cursor = session.previousCursor;
    try {
      options.renderer.domElement.releasePointerCapture(session.gesture.pointerId);
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
        entity.kind === "wall" ? wallEndpointHandle(hit?.object ?? null) : undefined;
      const previewTarget = endpointHit?.node ?? target;
      previewTarget.updateWorldMatrix(true, true);
      const world = previewTarget.getWorldPosition(new T.Vector3());
      const endpointWorld =
        entity.kind === "wall" && endpointHit
          ? ([...entity.value[endpointHit.endpoint]] as [number, number])
          : undefined;
      const probe: Pick<DragSession, "entity" | "planeY"> = {
        entity,
        planeY: world.y,
      };
      const grab = entityPointerPoint(options, probe, event);
      if (!grab) return false;

      active = {
        gesture: beginPointerGesture(event),
        id,
        entity,
        target,
        previewTarget,
        startLocal: previewTarget.position.clone(),
        originWorld: endpointWorld ?? [world.x, world.z],
        grabWorld: [grab.x, grab.z],
        planeY: world.y,
        previousCursor: options.renderer.domElement.style.cursor,
        wallEndpoint: endpointHit?.endpoint,
        endpointWorld,
      };
      options.controls.enabled = false;
      options.transform.enabled = false;
      options.renderer.domElement.setPointerCapture(event.pointerId);
      options.renderer.domElement.style.cursor = endpointHit ? "crosshair" : "grab";
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
        if (active.wallEndpoint) setWallEndpointPosition(options, active, pointer);
        else setWorldPlanPosition(options, active, pointer);
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
        if (session.wallEndpoint) setWallEndpointPosition(options, session, pointer);
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
        session.wallEndpoint
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
