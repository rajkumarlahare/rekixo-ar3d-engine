import * as T from "three";
import type { Room, RoomPoint, Scene } from "./domain";
import type { TransformCommit, TransformMode } from "./sceneCanvasTransform";
import { buildTranslationCommit, nudgePlanDelta } from "./sceneTransformApply";
import { disposeObjectResources } from "./threeResources";

export function clearVisualGroup(group: T.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectResources(child);
  }
}

export function clearPolygonDraftVisual(
  group: T.Group,
  draftPoints: T.Vector3[],
) {
  draftPoints.length = 0;
  clearVisualGroup(group);
}

export function renderPolygonEditVisual(
  group: T.Group,
  room: Room | undefined,
  floorY: number,
  points?: readonly RoomPoint[],
) {
  clearVisualGroup(group);
  if (!room?.polygon?.length) return;
  const source = points ?? room.polygon;
  const vectors = source.map(
    ([x, z]) => new T.Vector3(x, floorY + 0.11, z),
  );
  if (vectors.length >= 3) {
    const loop = new T.LineLoop(
      new T.BufferGeometry().setFromPoints(vectors),
      new T.LineBasicMaterial({
        color: 0xb9b2ff,
        transparent: true,
        opacity: 0.98,
      }),
    );
    group.add(loop);
  }
  vectors.forEach((point, index) => {
    const marker = new T.Mesh(
      new T.SphereGeometry(0.13, 14, 10),
      new T.MeshBasicMaterial({ color: 0x8d84ff }),
    );
    marker.position.copy(point);
    marker.userData.roomVertexIndex = index;
    marker.userData.roomId = room.id;
    group.add(marker);

    const touch = new T.Mesh(
      new T.SphereGeometry(0.32, 12, 8),
      new T.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      }),
    );
    touch.position.copy(point);
    touch.userData.roomVertexIndex = index;
    touch.userData.roomId = room.id;
    touch.name = `Polygon corner ${index + 1} touch target`;
    group.add(touch);

    const next = vectors[(index + 1) % vectors.length];
    const midpoint = point.clone().add(next).multiplyScalar(0.5);
    const insert = new T.Mesh(
      new T.SphereGeometry(0.075, 12, 8),
      new T.MeshBasicMaterial({ color: 0xffc56d, depthTest: false }),
    );
    insert.position.copy(midpoint);
    insert.userData.roomEdgeInsertIndex = index + 1;
    insert.userData.roomId = room.id;
    insert.renderOrder = 34;
    group.add(insert);

    const insertTouch = new T.Mesh(
      new T.SphereGeometry(0.27, 10, 8),
      new T.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      }),
    );
    insertTouch.position.copy(midpoint);
    insertTouch.userData.roomEdgeInsertIndex = index + 1;
    insertTouch.userData.roomId = room.id;
    insertTouch.name = `Insert polygon corner after ${index + 1}`;
    group.add(insertTouch);
  });
}

export function redrawPolygonDraftVisual(
  group: T.Group,
  draftPoints: readonly T.Vector3[],
  hover?: T.Vector3,
) {
  clearVisualGroup(group);
  const points = hover ? [...draftPoints, hover] : [...draftPoints];
  if (points.length >= 2) {
    const geometry = new T.BufferGeometry().setFromPoints(points);
    const line = new T.Line(
      geometry,
      new T.LineBasicMaterial({
        color: 0x8d84ff,
        transparent: true,
        opacity: 0.95,
      }),
    );
    group.add(line);
  }
  for (const point of draftPoints) {
    const marker = new T.Mesh(
      new T.SphereGeometry(0.09, 12, 8),
      new T.MeshBasicMaterial({ color: 0xb9b2ff }),
    );
    marker.position.copy(point);
    group.add(marker);
  }
}

export function polygonDraftResult(points: readonly T.Vector3[]) {
  if (points.length < 3) return undefined;
  return points.map(
    (point) =>
      [Number(point.x.toFixed(3)), Number(point.z.toFixed(3))] as RoomPoint,
  );
}

export function insertPolygonMidpoint(
  points: readonly RoomPoint[],
  insertIndex: number,
) {
  if (
    !Number.isInteger(insertIndex) ||
    insertIndex < 1 ||
    insertIndex > points.length
  )
    return undefined;
  const left = points[insertIndex - 1];
  const right = points[insertIndex % points.length];
  const next = points.map(([x, z]) => [x, z] as RoomPoint);
  next.splice(insertIndex, 0, [
    Number(((left[0] + right[0]) / 2).toFixed(3)),
    Number(((left[1] + right[1]) / 2).toFixed(3)),
  ]);
  return next;
}

export function updateRoomDraftVisual(
  draft: T.Mesh,
  start: T.Vector3,
  end: T.Vector3,
) {
  const width = Math.max(0.01, Math.abs(end.x - start.x));
  const depth = Math.max(0.01, Math.abs(end.z - start.z));
  draft.position.set(
    (start.x + end.x) / 2,
    start.y,
    (start.z + end.z) / 2,
  );
  draft.scale.set(width, 1, depth);
  draft.visible = true;
}

export function activeRoomAuthoringConfig(
  scene: Scene,
  config: {
    roomDraw?: { enabled: boolean; floorId: string; snap: boolean };
    roomStamp?: { enabled: boolean; floorId: string; snap: boolean };
    roomPolygonDraw?: { enabled: boolean; floorId: string; snap: boolean };
    roomPolygonEdit?: { enabled: boolean; roomId: string; snap: boolean };
  },
) {
  if (config.roomDraw?.enabled) return config.roomDraw;
  if (config.roomStamp?.enabled) return config.roomStamp;
  if (config.roomPolygonDraw?.enabled) return config.roomPolygonDraw;
  if (!config.roomPolygonEdit?.enabled) return undefined;
  return {
    enabled: true,
    floorId:
      scene.rooms.find((room) => room.id === config.roomPolygonEdit?.roomId)
        ?.floorId ?? "",
    snap: config.roomPolygonEdit.snap,
  };
}

export function resolveCanvasNudge(
  input: {
    scene: Scene;
    selected: string;
    selectedIds?: readonly string[];
    transformEnabled?: boolean;
    transformMode?: TransformMode;
    editorBusy: boolean;
  },
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey">,
): { change: TransformCommit; status: string } | undefined {
  const delta = nudgePlanDelta(event.key, {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  if (
    !delta ||
    input.editorBusy ||
    !input.transformEnabled ||
    (input.transformMode ?? "translate") !== "translate" ||
    !input.selected
  )
    return undefined;
  const ids = input.selectedIds?.length
    ? input.selectedIds
    : [input.selected];
  const change = buildTranslationCommit(
    input.scene,
    ids,
    delta[0],
    delta[1],
  );
  if (!change) return undefined;
  return {
    change,
    status: `${ids.length > 1 ? `${ids.length} objects` : "Object"} nudged ${Math.hypot(...delta).toFixed(2)} m · Alt 0.01 m · Arrow 0.10 m · Shift 0.50 m.`,
  };
}

export function toggleCanvasSelection(
  current: readonly string[] | undefined,
  primary: string,
  id: string,
) {
  const previous = current?.length ? [...current] : primary ? [primary] : [];
  const ids = previous.includes(id)
    ? previous.filter((entry) => entry !== id)
    : [...previous, id];
  return {
    ids,
    primary: ids.includes(id) ? id : (ids.at(-1) ?? ""),
    status:
      ids.length > 1
        ? `${ids.length} objects selected · drag one to move the group.`
        : "",
  };
}

export function renderMultiSelectionOutlines(
  group: T.Group,
  selectables: ReadonlyMap<string, T.Object3D>,
  selectedIds: readonly string[] | undefined,
  primary: string,
) {
  clearVisualGroup(group);
  for (const id of selectedIds ?? []) {
    if (id === primary) continue;
    const target = selectables.get(id);
    if (!target || !target.visible) continue;
    target.updateWorldMatrix(true, true);
    const helper = new T.BoxHelper(target, 0x2bc7ff);
    helper.renderOrder = 48;
    group.add(helper);
  }
}
