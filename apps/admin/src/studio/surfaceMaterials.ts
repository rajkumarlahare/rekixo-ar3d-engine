import {
  surfaceFinishKey,
  type Room,
  type Scene,
  type SurfaceFinish,
  type SurfaceKind,
  type SurfaceMaterialPresetId,
} from "./domain";

export interface SurfaceMaterialPreset {
  id: Exclude<SurfaceMaterialPresetId, "custom">;
  label: string;
  detail: string;
  color: string;
  roughness: number;
  metalness: number;
}

export const SURFACE_MATERIAL_PRESETS: readonly SurfaceMaterialPreset[] = [
  {
    id: "paint",
    label: "Paint",
    detail: "Soft architectural wall paint",
    color: "#f2eee7",
    roughness: 0.88,
    metalness: 0,
  },
  {
    id: "wood",
    label: "Wood",
    detail: "Warm satin timber base",
    color: "#a97952",
    roughness: 0.58,
    metalness: 0,
  },
  {
    id: "marble",
    label: "Marble",
    detail: "Polished stone base; texture maps can be added later",
    color: "#ddd9d1",
    roughness: 0.26,
    metalness: 0,
  },
  {
    id: "tile",
    label: "Tile",
    detail: "Low-roughness ceramic base",
    color: "#d8d8d4",
    roughness: 0.34,
    metalness: 0.02,
  },
  {
    id: "concrete",
    label: "Concrete",
    detail: "Matte mineral finish",
    color: "#aaa6a0",
    roughness: 0.78,
    metalness: 0,
  },
] as const;

export function defaultSurfaceFinish(
  room: Room,
  kind: SurfaceKind,
  edgeIndex?: number,
): SurfaceFinish {
  if (kind === "floor")
    return {
      roomId: room.id,
      kind,
      presetId: "custom",
      color: room.color,
      roughness: 0.75,
      metalness: 0,
    };
  if (kind === "ceiling")
    return {
      roomId: room.id,
      kind,
      presetId: "paint",
      color: "#f4f1e9",
      roughness: 0.9,
      metalness: 0,
    };
  return {
    roomId: room.id,
    kind,
    edgeIndex,
    presetId: "paint",
    color: (edgeIndex ?? 0) % 2 ? "#e7e0d5" : "#eee9df",
    roughness: 0.82,
    metalness: 0,
  };
}

export function findSurfaceFinish(
  scene: Scene,
  roomId: string,
  kind: SurfaceKind,
  edgeIndex?: number,
) {
  const key = surfaceFinishKey(roomId, kind, edgeIndex);
  return (scene.surfaceFinishes ?? []).find(
    (finish) =>
      surfaceFinishKey(finish.roomId, finish.kind, finish.edgeIndex) === key,
  );
}

export function resolvedSurfaceFinish(
  scene: Scene,
  room: Room,
  kind: SurfaceKind,
  edgeIndex?: number,
): SurfaceFinish {
  return (
    findSurfaceFinish(scene, room.id, kind, edgeIndex) ??
    defaultSurfaceFinish(room, kind, edgeIndex)
  );
}

export function surfaceDisplayName(kind: SurfaceKind, edgeIndex?: number) {
  if (kind === "floor") return "Floor";
  if (kind === "ceiling") return "Ceiling";
  return `Wall ${(edgeIndex ?? 0) + 1}`;
}
