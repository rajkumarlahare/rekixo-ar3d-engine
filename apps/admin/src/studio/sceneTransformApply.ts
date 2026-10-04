import {
  moveManualOpening,
  patchManualOpening,
  patchManualWall,
} from "./architectureAuthoring";
import {
  roomGeometryFromPolygon,
  type RoomPoint,
  type Scene,
} from "./domain";
import type {
  AtomicTransformCommit,
  TransformCommit,
} from "./sceneCanvasTransform";

function applyAtomicTransform(
  scene: Scene,
  change: AtomicTransformCommit,
): Scene {
  if (change.kind === "model") {
    const current = scene.modelTransform ?? { x: 0, y: 0, z: 0, rotationY: 0 };
    return {
      ...scene,
      modelTransform: {
        ...current,
        ...(change.x !== undefined ? { x: change.x } : {}),
        ...(change.y !== undefined ? { y: change.y } : {}),
        ...(change.z !== undefined ? { z: change.z } : {}),
        ...(change.rotationY !== undefined
          ? { rotationY: change.rotationY }
          : {}),
      },
    };
  }
  if (change.kind === "siteElement")
    return {
      ...scene,
      siteElements: (scene.siteElements ?? []).map((candidate) =>
        candidate.id === change.id
          ? {
              ...candidate,
              ...(change.x !== undefined ? { x: change.x } : {}),
              ...(change.z !== undefined ? { z: change.z } : {}),
              ...(change.rotation !== undefined
                ? { rotation: change.rotation }
                : {}),
              ...(change.width !== undefined ? { width: change.width } : {}),
              ...(change.depth !== undefined ? { depth: change.depth } : {}),
              ...(change.height !== undefined ? { height: change.height } : {}),
              reviewed: false,
              reviewState: "suggested" as const,
              origin: "manual" as const,
              confidence: undefined,
            }
          : candidate,
      ),
    };
  if (change.kind === "wall")
    return patchManualWall(scene, change.id, {
      ...(change.start !== undefined ? { start: change.start } : {}),
      ...(change.end !== undefined ? { end: change.end } : {}),
      ...(change.thickness !== undefined ? { thickness: change.thickness } : {}),
      ...(change.height !== undefined ? { height: change.height } : {}),
    });
  if (change.kind === "opening") {
    let next = scene;
    if (change.x !== undefined || change.z !== undefined) {
      const current = next.openings?.find((entry) => entry.id === change.id);
      if (!current) return scene;
      next = moveManualOpening(next, change.id, [
        change.x ?? current.x,
        change.z ?? current.z,
      ]);
    }
    if (change.width !== undefined || change.height !== undefined)
      next = patchManualOpening(next, change.id, {
        ...(change.width !== undefined ? { width: change.width } : {}),
        ...(change.height !== undefined ? { height: change.height } : {}),
      });
    return next;
  }
  if (change.kind === "room")
    return {
      ...scene,
      rooms: scene.rooms.map((candidate) => {
        if (candidate.id !== change.id) return candidate;
        let polygon = candidate.polygon?.map(
          (point) => [point[0], point[1]] as RoomPoint,
        );
        if (polygon?.length) {
          if (change.x !== undefined || change.z !== undefined) {
            const dx = (change.x ?? candidate.x) - candidate.x;
            const dz = (change.z ?? candidate.z) - candidate.z;
            polygon = polygon.map(([x, z]) => [x + dx, z + dz] as RoomPoint);
          }
          if (change.width !== undefined || change.depth !== undefined) {
            const scaleX = change.width !== undefined ? change.width / candidate.width : 1;
            const scaleZ = change.depth !== undefined ? change.depth / candidate.depth : 1;
            polygon = polygon.map(
              ([x, z]) =>
                [
                  candidate.x + (x - candidate.x) * scaleX,
                  candidate.z + (z - candidate.z) * scaleZ,
                ] as RoomPoint,
            );
          }
          const geometry = roomGeometryFromPolygon(polygon);
          return {
            ...candidate,
            ...geometry,
            verified: false,
            ...(change.height !== undefined ? { height: change.height } : {}),
          };
        }
        return {
          ...candidate,
          verified: false,
          ...(change.x !== undefined ? { x: change.x } : {}),
          ...(change.z !== undefined ? { z: change.z } : {}),
          ...(change.width !== undefined ? { width: change.width } : {}),
          ...(change.depth !== undefined ? { depth: change.depth } : {}),
          ...(change.height !== undefined ? { height: change.height } : {}),
        };
      }),
    };
  return {
    ...scene,
    furniture: scene.furniture.map((candidate) =>
      candidate.id === change.id
        ? {
            ...candidate,
            ...(change.x !== undefined ? { x: change.x } : {}),
            ...(change.z !== undefined ? { z: change.z } : {}),
            ...(change.rotation !== undefined ? { rotation: change.rotation } : {}),
          }
        : candidate,
    ),
  };
}

export function applyTransformCommit(scene: Scene, change: TransformCommit) {
  return change.kind === "batch"
    ? change.changes.reduce(applyAtomicTransform, scene)
    : applyAtomicTransform(scene, change);
}

export function nudgePlanDelta(
  key: string,
  modifiers: { shiftKey?: boolean; altKey?: boolean } = {},
): readonly [number, number] | undefined {
  const step = modifiers.altKey ? 0.01 : modifiers.shiftKey ? 0.5 : 0.1;
  switch (key.toLowerCase()) {
    case "arrowleft":
      return [-step, 0];
    case "arrowright":
      return [step, 0];
    case "arrowup":
      return [0, -step];
    case "arrowdown":
      return [0, step];
    default:
      return undefined;
  }
}

type TranslationEntity =
  | { kind: "room"; id: string; floorId: string; x: number; z: number }
  | { kind: "furniture"; id: string; roomId: string; x: number; z: number }
  | { kind: "siteElement"; id: string; floorId?: string; x: number; z: number };

function translationEntity(scene: Scene, id: string): TranslationEntity | undefined {
  const room = scene.rooms.find((entry) => entry.id === id);
  if (room)
    return {
      kind: "room",
      id: room.id,
      floorId: room.floorId,
      x: room.x,
      z: room.z,
    };
  const furniture = scene.furniture.find((entry) => entry.id === id);
  if (furniture)
    return {
      kind: "furniture",
      id: furniture.id,
      roomId: furniture.roomId,
      x: furniture.x,
      z: furniture.z,
    };
  const site = scene.siteElements?.find((entry) => entry.id === id);
  if (site)
    return {
      kind: "siteElement",
      id: site.id,
      floorId: site.floorId,
      x: site.x,
      z: site.z,
    };
  return undefined;
}

export function buildTranslationCommit(
  scene: Scene,
  ids: readonly string[],
  dx: number,
  dz: number,
): TransformCommit | undefined {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || (!dx && !dz)) return undefined;
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const entities = uniqueIds.map((id) => translationEntity(scene, id));
  if (!entities.length || entities.some((entry) => !entry)) return undefined;
  const rows = entities as TranslationEntity[];
  const first = rows[0];
  if (rows.some((entry) => entry.kind !== first.kind)) return undefined;
  if (
    first.kind === "room" &&
    rows.some((entry) => entry.kind !== "room" || entry.floorId !== first.floorId)
  )
    return undefined;
  if (
    first.kind === "furniture" &&
    rows.some((entry) => entry.kind !== "furniture" || entry.roomId !== first.roomId)
  )
    return undefined;
  if (
    first.kind === "siteElement" &&
    rows.some(
      (entry) =>
        entry.kind !== "siteElement" || (entry.floorId ?? "") !== (first.floorId ?? ""),
    )
  )
    return undefined;

  const changes: AtomicTransformCommit[] = rows.map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    x: Number((entry.x + dx).toFixed(6)),
    z: Number((entry.z + dz).toFixed(6)),
  }));
  return changes.length === 1 ? changes[0] : { kind: "batch", changes };
}
