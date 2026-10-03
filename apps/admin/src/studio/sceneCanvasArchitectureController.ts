import * as T from "three";
import { isPointerTap, type PlanSegment } from "@rekixo/3d-engine-core";
import type { RoomPoint, Scene } from "./domain";
import type { TransformCommit, TransformMode } from "./sceneCanvasTransform";
import {
  openingTransformChange,
  renderArchitectureElements,
  wallTransformChange,
} from "./sceneCanvasArchitecture";

export interface WallDrawResult {
  floorId: string;
  start: RoomPoint;
  end: RoomPoint;
}

export interface OpeningPlacementResult {
  floorId: string;
  point: RoomPoint;
}

export interface ArchitectureCanvasProps {
  architectureEditing?: boolean;
  wallDraw?: {
    enabled: boolean;
    floorId: string;
    snap: boolean;
  };
  openingPlacement?: {
    enabled: boolean;
    floorId: string;
    snap: boolean;
  };
  onWallDraw?: (result: WallDrawResult) => void;
  onOpeningPlace?: (result: OpeningPlacementResult) => void;
}

type ArchitectureCanvasConfig = ArchitectureCanvasProps & {
  scene: Scene;
  selected: string;
  view: "building" | "rooms" | "walk";
  transformMode?: TransformMode;
  onTransformCommit?: (change: TransformCommit) => void;
};

interface ArchitectureControllerOptions {
  getConfig: () => ArchitectureCanvasConfig;
  renderer: T.WebGLRenderer;
  controls: { enabled: boolean };
  pointOnFloor: (
    clientX: number,
    clientY: number,
    floorId: string,
    snap: boolean,
  ) => T.Vector3 | undefined;
  setStatus: (message: string) => void;
}

interface PointerStart {
  id: number;
  x: number;
  y: number;
}

function createWallDraft() {
  const draft = new T.Mesh(
    new T.BoxGeometry(1, 0.07, 0.09),
    new T.MeshBasicMaterial({
      color: 0xffb45e,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  draft.visible = false;
  draft.renderOrder = 33;
  return draft;
}

export function architectureSelectionKind(scene: Scene, selected: string) {
  if (scene.walls?.some((wall) => wall.id === selected)) return "wall" as const;
  if (scene.openings?.some((opening) => opening.id === selected))
    return "opening" as const;
  return undefined;
}

export function architectureAuthoringActive(props: ArchitectureCanvasProps) {
  return Boolean(props.wallDraw?.enabled || props.openingPlacement?.enabled);
}

export function renderArchitectureCanvas(
  group: T.Group,
  config: Pick<ArchitectureCanvasConfig, "scene" | "selected" | "view" | "architectureEditing">,
  selectables: Map<string, T.Object3D>,
  floorId?: string,
) {
  renderArchitectureElements(group, config.scene, config.selected, selectables, {
    visible: config.view === "building" && Boolean(config.architectureEditing),
    floorId,
  });
}

export function createArchitectureCanvasController(
  options: ArchitectureControllerOptions,
) {
  const group = new T.Group();
  group.name = "Studio editable architecture";
  const wallDraft = createWallDraft();
  let wallDrawStart: T.Vector3 | undefined;
  let openingPointer: PointerStart | undefined;

  const planePoint = (event: PointerEvent) => {
    const config = options.getConfig();
    const authoring = config.wallDraw?.enabled
      ? config.wallDraw
      : config.openingPlacement?.enabled
        ? config.openingPlacement
        : undefined;
    if (!authoring?.enabled || !authoring.floorId) return undefined;
    return options.pointOnFloor(
      event.clientX,
      event.clientY,
      authoring.floorId,
      authoring.snap,
    );
  };

  const releasePointer = (pointerId: number) => {
    options.controls.enabled = options.getConfig().view !== "walk";
    try {
      options.renderer.domElement.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture can already be released when the browser cancels a gesture.
    }
  };

  return {
    group,
    wallDraft,

    addSnapSegments(floorId: string, segments: PlanSegment[]) {
      for (const wall of options.getConfig().scene.walls ?? []) {
        if (wall.floorId !== floorId) continue;
        segments.push({
          id: `wall:${wall.id}`,
          start: wall.start,
          end: wall.end,
        });
      }
    },

    pointerDown(event: PointerEvent) {
      const config = options.getConfig();
      if (event.button !== 0 || config.view !== "building") return false;
      if (config.wallDraw?.enabled) {
        const start = planePoint(event);
        if (!start) return false;
        wallDrawStart = start;
        wallDraft.visible = false;
        options.controls.enabled = false;
        options.renderer.domElement.setPointerCapture(event.pointerId);
        options.setStatus("Drag to draw the wall · release to place");
        return true;
      }
      if (config.openingPlacement?.enabled) {
        openingPointer = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        options.controls.enabled = false;
        options.renderer.domElement.setPointerCapture(event.pointerId);
        return true;
      }
      return false;
    },

    pointerMove(event: PointerEvent) {
      if (!wallDrawStart || !options.getConfig().wallDraw?.enabled) return false;
      const end = planePoint(event);
      if (end) {
        const dx = end.x - wallDrawStart.x;
        const dz = end.z - wallDrawStart.z;
        wallDraft.position.set(
          (end.x + wallDrawStart.x) / 2,
          wallDrawStart.y + 0.05,
          (end.z + wallDrawStart.z) / 2,
        );
        wallDraft.rotation.y = Math.atan2(-dz, dx);
        wallDraft.scale.set(Math.max(0.01, Math.hypot(dx, dz)), 1, 1);
        wallDraft.visible = true;
      }
      return true;
    },

    pointerUp(event: PointerEvent) {
      if (wallDrawStart) {
        const start = wallDrawStart;
        const config = options.getConfig();
        const end = planePoint(event);
        const floorId = config.wallDraw?.floorId;
        wallDrawStart = undefined;
        wallDraft.visible = false;
        releasePointer(event.pointerId);
        if (end && floorId) {
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          if (length >= 0.2) {
            config.onWallDraw?.({
              floorId,
              start: [Number(start.x.toFixed(4)), Number(start.z.toFixed(4))],
              end: [Number(end.x.toFixed(4)), Number(end.z.toFixed(4))],
            });
            options.setStatus("");
          } else {
            options.setStatus("Draw a wall at least 0.2 m long.");
          }
        }
        return true;
      }
      if (openingPointer) {
        const start = openingPointer;
        const config = options.getConfig();
        openingPointer = undefined;
        releasePointer(event.pointerId);
        if (
          start.id !== event.pointerId ||
          !isPointerTap({ clientX: start.x, clientY: start.y }, event)
        )
          return true;
        const target = planePoint(event);
        const floorId = config.openingPlacement?.floorId;
        if (target && floorId)
          config.onOpeningPlace?.({
            floorId,
            point: [Number(target.x.toFixed(4)), Number(target.z.toFixed(4))],
          });
        return true;
      }
      return false;
    },

    commitTransform(target: T.Object3D) {
      const config = options.getConfig();
      const wall = config.scene.walls?.find(
        (candidate) => candidate.id === config.selected,
      );
      if (wall) {
        config.onTransformCommit?.(
          wallTransformChange(wall, target, config.transformMode ?? "translate"),
        );
        return true;
      }
      const opening = config.scene.openings?.find(
        (candidate) => candidate.id === config.selected,
      );
      if (!opening) return false;
      const change = openingTransformChange(
        opening,
        target,
        config.transformMode ?? "translate",
      );
      if (change) config.onTransformCommit?.(change);
      return true;
    },
  };
}
