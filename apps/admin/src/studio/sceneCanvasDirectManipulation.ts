import * as T from "three";
import {
  beginPointerGesture,
  finishPointerGesture,
  resolveDirectPlanDrag,
  updatePointerGesture,
  type PointerGestureSession,
} from "@rekixo/3d-engine-core";
import type {
  Furniture,
  Opening,
  Room,
  Scene,
  SiteElement,
  Wall,
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

interface DragSession {
  gesture: PointerGestureSession;
  id: string;
  entity: DirectEntity;
  target: T.Object3D;
  startLocal: T.Vector3;
  originWorld: readonly [number, number];
  grabWorld: readonly [number, number];
  planeY: number;
  previousCursor: string;
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

function setWorldPlanPosition(
  options: DirectManipulationOptions,
  session: DragSession,
  pointer: T.Vector3,
) {
  const config = options.getConfig();
  const gridOnly = session.entity.kind === "furniture" || session.entity.kind === "site";
  let [x, z] = resolveDirectPlanDrag(
    session.originWorld,
    session.grabWorld,
    [pointer.x, pointer.z],
    { gridSize: config.snap && gridOnly ? 0.1 : 0 },
  );

  if (
    config.snap &&
    !gridOnly &&
    "floorId" in session.entity
  ) {
    const snapped = options.snapPlanPoint(
      new T.Vector3(x, session.planeY, z),
      session.entity.floorId,
      true,
      session.entity.kind === "room" ? session.entity.value.id : undefined,
    );
    x = snapped.x;
    z = snapped.z;
  }

  const world = new T.Vector3(x, session.planeY, z);
  const local = session.target.parent
    ? session.target.parent.worldToLocal(world.clone())
    : world;
  session.target.position.x = local.x;
  session.target.position.z = local.z;
  session.target.updateWorldMatrix(true, true);
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
  if (session.entity.kind === "wall")
    return wallTransformChange(session.entity.value, session.target, "translate");
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

      target.updateWorldMatrix(true, true);
      const world = target.getWorldPosition(new T.Vector3());
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
        startLocal: target.position.clone(),
        originWorld: [world.x, world.z],
        grabWorld: [grab.x, grab.z],
        planeY: world.y,
        previousCursor: options.renderer.domElement.style.cursor,
      };
      options.controls.enabled = false;
      options.transform.enabled = false;
      options.renderer.domElement.setPointerCapture(event.pointerId);
      options.renderer.domElement.style.cursor = "grab";
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
        setWorldPlanPosition(options, active, pointer);
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
        session.target.position.copy(session.startLocal);
        session.target.updateWorldMatrix(true, true);
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
      if (pointer) setWorldPlanPosition(options, session, pointer);
      const change = transformCommit(session);
      release(session);
      const config = options.getConfig();
      config.onSelect(session.id);
      if (change) config.onTransformCommit?.(change);
      options.setStatus(
        config.snap
          ? "Moved directly · smart snap applied · one undo step."
          : "Moved directly · one undo step.",
      );
      return true;
    },
  };
}
