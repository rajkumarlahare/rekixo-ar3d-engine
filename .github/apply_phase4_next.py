from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


# Transform contract: one callback can now carry one atomic transform or one batch.
path = "apps/admin/src/studio/sceneCanvasTransform.ts"
text = read(path)
if "export type AtomicTransformCommit" not in text:
    text = text.replace("export type TransformCommit =", "export type AtomicTransformCommit =", 1)
    text = text.rstrip() + "\n\nexport type TransformCommit =\n  | AtomicTransformCommit\n  | { kind: \"batch\"; changes: AtomicTransformCommit[] };\n"
    write(path, text)

# Pure scene transform application + keyboard/group translation policy.
write(
    "apps/admin/src/studio/sceneTransformApply.ts",
    '''import {
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
''',
)

# Studio owns selection persistence and applies a batch with one history edit.
path = "apps/admin/src/studio/Studio.tsx"
replace_once(
    path,
    'import {\n  projectAheadOfCloud,\n  withLocalSaveTimestamp,\n} from "./localDraftState";\n',
    'import {\n  projectAheadOfCloud,\n  withLocalSaveTimestamp,\n} from "./localDraftState";\nimport { applyTransformCommit } from "./sceneTransformApply";\n',
)
replace_once(
    path,
    '    [roomId, setRoomId] = useState(""),\n    [selected, setSelected] = useState(""),\n    [view, setView] = useState<View>("rooms"),',
    '    [roomId, setRoomId] = useState(""),\n    [selected, setSelected] = useState(""),\n    [selectedIds, setSelectedIds] = useState<string[]>([]),\n    [view, setView] = useState<View>("rooms"),',
)
replace_once(
    path,
    '    setProject(p);\n    setRoomId(p.scene.rooms[0]?.id ?? "");\n    setSelected(p.scene.rooms[0]?.id ?? "");\n    setReview("");',
    '    setProject(p);\n    setRoomId(p.scene.rooms[0]?.id ?? "");\n    const initialSelection = p.scene.rooms[0]?.id ?? "";\n    setSelected(initialSelection);\n    setSelectedIds(initialSelection ? [initialSelection] : []);\n    setReview("");',
)
replace_once(
    path,
    '  }, [modelMaterials, selectedMaterial]);\n  useEffect(() => {\n    const guard = (e: BeforeUnloadEvent) => {',
    '  }, [modelMaterials, selectedMaterial]);\n  useEffect(() => {\n    setSelectedIds((current) => {\n      if (!selected) return [];\n      return current.includes(selected) ? current : [selected];\n    });\n  }, [selected]);\n  useEffect(() => {\n    const guard = (e: BeforeUnloadEvent) => {',
)
text = read(path)
start = text.index('  function commitCanvasTransform(change: TransformCommit) {')
end = text.index('  function addRoom() {', start)
new_function = '''  function commitCanvasTransform(change: TransformCommit) {
    if (review || busy) return;
    try {
      const next: Project = {
        ...p,
        scene: applyTransformCommit(p.scene, change),
      };
      validateProject(next);
      edit(next);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That transform is outside the valid design bounds.",
      );
    }
  }
'''
write(path, text[:start] + new_function + text[end:])
replace_once(
    path,
    '  function select(key: string) {\n    setSelected(key);',
    '  function select(key: string, selection: readonly string[] = key ? [key] : []) {\n    setSelected(key);\n    setSelectedIds([...new Set(selection.filter(Boolean))]);',
)
replace_once(
    path,
    '            roomId={roomId}\n            selected={selected}\n            selectedMesh={mesh}',
    '            roomId={roomId}\n            selected={selected}\n            selectedIds={selectedIds}\n            onSelectionChange={(ids, primary) => select(primary, ids)}\n            selectedMesh={mesh}',
)

# Canvas selection, nudge and polygon UX.
path = "apps/admin/src/studio/SceneCanvas.tsx"
replace_once(
    path,
    '} from "./sceneCanvasArchitectureController";\nimport { createDirectManipulationController } from "./sceneCanvasDirectManipulation";',
    '} from "./sceneCanvasArchitectureController";\nimport {\n  buildTranslationCommit,\n  nudgePlanDelta,\n} from "./sceneTransformApply";\nimport { createDirectManipulationController } from "./sceneCanvasDirectManipulation";',
)
replace_once(
    path,
    '  selected: string;\n  onSelect: (id: string) => void;\n  onMesh: (name: string) => void;',
    '  selected: string;\n  selectedIds?: readonly string[];\n  onSelect: (id: string) => void;\n  onSelectionChange?: (ids: string[], primary: string) => void;\n  onMesh: (name: string) => void;',
)
replace_once(
    path,
    '    polygonDraft: T.Group;\n    polygonEdit: T.Group;\n    clearPolygonDraft: () => void;',
    '    polygonDraft: T.Group;\n    polygonEdit: T.Group;\n    multiSelection: T.Group;\n    clearPolygonDraft: () => void;',
)
replace_once(
    path,
    '    const polygonEdit = new T.Group();\n    polygonEdit.name = "Room polygon edit handles";\n    polygonEdit.renderOrder = 32;\n    scene.add(',
    '    const polygonEdit = new T.Group();\n    polygonEdit.name = "Room polygon edit handles";\n    polygonEdit.renderOrder = 32;\n    const multiSelection = new T.Group();\n    multiSelection.name = "Multi-selection outlines";\n    multiSelection.renderOrder = 48;\n    scene.add(',
)
replace_once(
    path,
    '      polygonDraft,\n      polygonEdit,\n    );',
    '      polygonDraft,\n      polygonEdit,\n      multiSelection,\n    );',
)
old_loop = '''      vectors.forEach((point, index) => {
        const marker = new T.Mesh(
          new T.SphereGeometry(0.12, 14, 10),
          new T.MeshBasicMaterial({ color: 0x8d84ff }),
        );
        marker.position.copy(point);
        marker.userData.roomVertexIndex = index;
        marker.userData.roomId = room.id;
        polygonEdit.add(marker);
      });'''
new_loop = '''      vectors.forEach((point, index) => {
        const marker = new T.Mesh(
          new T.SphereGeometry(0.13, 14, 10),
          new T.MeshBasicMaterial({ color: 0x8d84ff }),
        );
        marker.position.copy(point);
        marker.userData.roomVertexIndex = index;
        marker.userData.roomId = room.id;
        polygonEdit.add(marker);

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
        polygonEdit.add(touch);

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
        polygonEdit.add(insert);
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
        polygonEdit.add(insertTouch);
      });'''
replace_once(path, old_loop, new_loop)
replace_once(
    path,
    '      polygonDraft,\n      polygonEdit,\n      clearPolygonDraft,',
    '      polygonDraft,\n      polygonEdit,\n      multiSelection,\n      clearPolygonDraft,',
)
nudge_block = '''      if (latest.current.view !== "walk") {
        const delta = nudgePlanDelta(e.key, {
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        });
        const editorBusy = Boolean(
          latest.current.furniturePlacement?.enabled ||
            latest.current.roomDraw?.enabled ||
            latest.current.roomStamp?.enabled ||
            latest.current.roomPolygonDraw?.enabled ||
            latest.current.roomPolygonEdit?.enabled ||
            architectureAuthoringActive(latest.current),
        );
        if (
          delta &&
          !editorBusy &&
          latest.current.transformEnabled &&
          (latest.current.transformMode ?? "translate") === "translate" &&
          latest.current.selected
        ) {
          const ids = latest.current.selectedIds?.length
            ? latest.current.selectedIds
            : [latest.current.selected];
          const change = buildTranslationCommit(
            latest.current.scene,
            ids,
            delta[0],
            delta[1],
          );
          if (change) {
            e.preventDefault();
            latest.current.onTransformCommit?.(change);
            setStatus(
              `${ids.length > 1 ? `${ids.length} objects` : "Object"} nudged ${Math.hypot(...delta).toFixed(2)} m · Alt 0.01 m · Arrow 0.10 m · Shift 0.50 m.`,
            );
          }
        }
        return;
      }
'''
replace_once(
    path,
    '      if (latest.current.view !== "walk") return;\n      if (\n        [',
    nudge_block + '      if (\n        [',
)
replace_once(
    path,
    '          points: RoomPoint[];\n          floorId: string;',
    '          points: RoomPoint[];\n          originalPoints: RoomPoint[];\n          floorId: string;',
)
replace_once(
    path,
    '        const index = hit?.object.userData.roomVertexIndex;\n        const roomId = hit?.object.userData.roomId;',
    '        const index = hit?.object.userData.roomVertexIndex;\n        const insertIndex = hit?.object.userData.roomEdgeInsertIndex;\n        const roomId = hit?.object.userData.roomId;',
)
replace_once(
    path,
    '        const targetRoom =\n          typeof roomId === "string"\n            ? latest.current.scene.rooms.find((room) => room.id === roomId)\n            : undefined;\n        if (\n          targetRoom?.polygon?.length &&\n          Number.isInteger(index)',
    '        const targetRoom =\n          typeof roomId === "string"\n            ? latest.current.scene.rooms.find((room) => room.id === roomId)\n            : undefined;\n        if (\n          targetRoom?.polygon?.length &&\n          Number.isInteger(insertIndex) &&\n          insertIndex >= 1 &&\n          insertIndex <= targetRoom.polygon.length\n        ) {\n          const left = targetRoom.polygon[insertIndex - 1];\n          const right = targetRoom.polygon[insertIndex % targetRoom.polygon.length];\n          const next = targetRoom.polygon.map(([x, z]) => [x, z] as RoomPoint);\n          next.splice(insertIndex, 0, [\n            Number(((left[0] + right[0]) / 2).toFixed(3)),\n            Number(((left[1] + right[1]) / 2).toFixed(3)),\n          ]);\n          latest.current.onRoomPolygonChange?.(targetRoom.id, next);\n          setStatus(`Corner inserted · ${next.length} polygon corners.`);\n          return;\n        }\n        if (\n          targetRoom?.polygon?.length &&\n          Number.isInteger(index)',
)
replace_once(
    path,
    '            points: targetRoom.polygon.map(\n              ([x, z]) => [x, z] as RoomPoint,\n            ),\n            floorId: targetRoom.floorId,',
    '            points: targetRoom.polygon.map(\n              ([x, z]) => [x, z] as RoomPoint,\n            ),\n            originalPoints: targetRoom.polygon.map(\n              ([x, z]) => [x, z] as RoomPoint,\n            ),\n            floorId: targetRoom.floorId,',
)
replace_once(
    path,
    '          api.current?.renderPolygonEdit(room, vertexDrag.points);\n        }\n        return;',
    '          api.current?.renderPolygonEdit(room, vertexDrag.points);\n          setStatus(\n            `Corner ${vertexDrag.index + 1}/${vertexDrag.points.length} · X ${target.x.toFixed(2)} m · Z ${target.z.toFixed(2)} m${latest.current.roomPolygonEdit?.snap ? " · snap" : ""}`,\n          );\n        }\n        return;',
)
replace_once(
    path,
    '      if (vertexDrag) {\n        const current = vertexDrag;\n        const target = roomPlanePoint(e, current.roomId);',
    '      if (vertexDrag) {\n        const current = vertexDrag;\n        if (e.type === "pointercancel") {\n          const room = latest.current.scene.rooms.find((entry) => entry.id === current.roomId);\n          api.current?.renderPolygonEdit(room, current.originalPoints);\n          vertexDrag = undefined;\n          point = undefined;\n          controls.enabled = latest.current.view !== "walk";\n          setStatus("Polygon corner edit cancelled.");\n          return;\n        }\n        const target = roomPlanePoint(e, current.roomId);',
)
select_helper = '''      const selectCanvasId = (id: string) => {
        if (e.shiftKey && latest.current.onSelectionChange) {
          const previous = latest.current.selectedIds?.length
            ? [...latest.current.selectedIds]
            : latest.current.selected
              ? [latest.current.selected]
              : [];
          const next = previous.includes(id)
            ? previous.filter((entry) => entry !== id)
            : [...previous, id];
          const primary = next.includes(id) ? id : (next.at(-1) ?? "");
          latest.current.onSelectionChange(next, primary);
          setStatus(
            next.length > 1
              ? `${next.length} objects selected · drag one to move the group.`
              : "",
          );
          return;
        }
        latest.current.onSelect(id);
      };
'''
replace_once(path, '      const roomHit =\n', select_helper + '      const roomHit =\n')
replace_once(
    path,
    '          latest.current.onSelect(selectedRoomNode.userData.selectId);',
    '          selectCanvasId(String(selectedRoomNode.userData.selectId));',
)
replace_once(
    path,
    '            latest.current.onSelect(String(n.userData.selectId));',
    '            selectCanvasId(String(n.userData.selectId));',
)
replace_once(
    path,
    '          if (n) latest.current.onSelect(n.userData.selectId);',
    '          if (n) selectCanvasId(String(n.userData.selectId));',
)
marker_block = '''    renderReviewedOpeningMarkers(
      r.rooms,
      props.scene.openings ?? [],
      {
        view: props.view,
        roomId: props.roomId,
        isolateFloorId: props.isolateFloorId,
        soloRoomId: props.soloRoomId,
        roomMapEnabled: props.roomMapEnabled,
      },
    );'''
outline_block = marker_block + '''
    for (const child of [...r.multiSelection.children]) {
      r.multiSelection.remove(child);
      disposeObjectResources(child);
    }
    for (const id of props.selectedIds ?? []) {
      if (id === props.selected) continue;
      const target = r.selectables.get(id);
      if (!target || !target.visible) continue;
      target.updateWorldMatrix(true, true);
      const helper = new T.BoxHelper(target, 0x2bc7ff);
      helper.renderOrder = 48;
      r.multiSelection.add(helper);
    }'''
replace_once(path, marker_block, outline_block)
replace_once(
    path,
    '    props.scene,\n    props.selected,\n    props.view,',
    '    props.scene,\n    props.selected,\n    props.selectedIds,\n    props.view,',
)
replace_once(
    path,
    '    const target = runtime.selectables.get(props.selected);\n    const isSiteElement = Boolean(',
    '    const target = runtime.selectables.get(props.selected);\n    if ((props.selectedIds?.length ?? 0) > 1) return;\n    const isSiteElement = Boolean(',
)
replace_once(
    path,
    '    props.selected,\n    props.transformMode,',
    '    props.selected,\n    props.selectedIds,\n    props.transformMode,',
)

# Direct manipulation: compatible selected objects move as one preview/commit.
path = "apps/admin/src/studio/sceneCanvasDirectManipulation.ts"
replace_once(
    path,
    '  scene: Scene;\n  selected: string;\n  view:',
    '  scene: Scene;\n  selected: string;\n  selectedIds?: readonly string[];\n  view:',
)
replace_once(
    path,
    'import type { TransformCommit, TransformMode } from "./sceneCanvasTransform";',
    'import type {\n  AtomicTransformCommit,\n  TransformCommit,\n  TransformMode,\n} from "./sceneCanvasTransform";',
)
replace_once(
    path,
    'interface DragSession {',
    'interface GroupMoveMember {\n  id: string;\n  entity: Extract<DirectEntity, { kind: "room" | "furniture" | "site" }>;\n  target: T.Object3D;\n  startLocal: T.Vector3;\n  originWorld: readonly [number, number];\n}\n\ninterface DragSession {',
)
replace_once(
    path,
    '  rotationPreview?: number;\n  snapApplied?: boolean;\n}',
    '  rotationPreview?: number;\n  snapApplied?: boolean;\n  groupMove?: GroupMoveMember[];\n  moveDelta?: readonly [number, number];\n}',
)
replace_once(
    path,
    'function edgeSnapTargets(\n  config: DirectManipulationConfig,\n  entity: DirectEntity,\n): MutableEdgeSnapTargets {',
    'function edgeSnapTargets(\n  config: DirectManipulationConfig,\n  entity: DirectEntity,\n  excludedIds: ReadonlySet<string> = new Set(),\n): MutableEdgeSnapTargets {',
)
replace_once(
    path,
    '        item.id === entity.value.id ||\n        item.roomId !== entity.value.roomId',
    '        item.id === entity.value.id ||\n        excludedIds.has(item.id) ||\n        item.roomId !== entity.value.roomId',
)
replace_once(
    path,
    '    if (entity.kind === "room" && room.id === entity.value.id) continue;\n    addRoomTargets(targets, room);',
    '    if (entity.kind === "room" && room.id === entity.value.id) continue;\n    if (excludedIds.has(room.id)) continue;\n    addRoomTargets(targets, room);',
)
replace_once(
    path,
    '      if (item.id === entity.value.id) continue;\n      if (floorId && item.floorId && item.floorId !== floorId) continue;',
    '      if (item.id === entity.value.id) continue;\n      if (excludedIds.has(item.id)) continue;\n      if (floorId && item.floorId && item.floorId !== floorId) continue;',
)
group_helper = '''
function groupMoveMembers(
  config: DirectManipulationConfig,
  options: DirectManipulationOptions,
  primary: DirectEntity,
) {
  const ids = [...new Set(config.selectedIds ?? [])];
  if (ids.length < 2 || !ids.includes(primary.value.id)) return undefined;
  if (primary.kind !== "room" && primary.kind !== "furniture" && primary.kind !== "site")
    return undefined;
  const entities = ids.map((id) => directEntity(config, id));
  if (entities.some((entry) => !entry || entry.kind !== primary.kind)) return undefined;
  const rows = entities as GroupMoveMember["entity"][];
  if (
    primary.kind === "room" &&
    rows.some((entry) => entry.kind !== "room" || entry.floorId !== primary.floorId)
  )
    return undefined;
  if (
    primary.kind === "furniture" &&
    rows.some(
      (entry) =>
        entry.kind !== "furniture" || entry.value.roomId !== primary.value.roomId,
    )
  )
    return undefined;
  if (
    primary.kind === "site" &&
    rows.some(
      (entry) =>
        entry.kind !== "site" ||
        (entry.value.floorId ?? "") !== (primary.value.floorId ?? ""),
    )
  )
    return undefined;

  const members: GroupMoveMember[] = [];
  for (const entity of rows) {
    const target = options.selectables.get(entity.value.id);
    if (!target) return undefined;
    target.updateWorldMatrix(true, true);
    const world = target.getWorldPosition(new T.Vector3());
    members.push({
      id: entity.value.id,
      entity,
      target,
      startLocal: target.position.clone(),
      originWorld: [world.x, world.z],
    });
  }
  return members;
}
'''
replace_once(path, '\nfunction setWorldPlanPosition(\n', group_helper + '\nfunction setWorldPlanPosition(\n')
replace_once(
    path,
    '  if (config.snap) {\n    const halfExtents = entityHalfExtents(session.entity);\n    if (halfExtents) {',
    '  if (config.snap) {\n    const halfExtents = entityHalfExtents(session.entity);\n    const excludedIds = new Set(session.groupMove?.map((entry) => entry.id) ?? []);\n    if (halfExtents) {',
)
replace_once(
    path,
    '        edgeSnapTargets(config, session.entity),',
    '        edgeSnapTargets(config, session.entity, excludedIds),',
)
replace_once(
    path,
    '  session.target.position.z = local.z;\n  session.target.updateWorldMatrix(true, true);\n}',
    '  session.target.position.z = local.z;\n  session.target.updateWorldMatrix(true, true);\n  const delta: readonly [number, number] = [\n    x - session.originWorld[0],\n    z - session.originWorld[1],\n  ];\n  session.moveDelta = delta;\n  for (const member of session.groupMove ?? []) {\n    if (member.id === session.id) continue;\n    const memberWorld = new T.Vector3(\n      member.originWorld[0] + delta[0],\n      session.planeY,\n      member.originWorld[1] + delta[1],\n    );\n    const memberLocal = member.target.parent\n      ? member.target.parent.worldToLocal(memberWorld.clone())\n      : memberWorld;\n    member.target.position.x = memberLocal.x;\n    member.target.position.z = memberLocal.z;\n    member.target.updateWorldMatrix(true, true);\n  }\n}',
)
group_commit = '''function groupTransformCommit(session: DragSession): TransformCommit | undefined {
  if (!session.groupMove?.length || !session.moveDelta) return undefined;
  const [dx, dz] = session.moveDelta;
  if (Math.hypot(dx, dz) <= 1e-7) return undefined;
  const changes: AtomicTransformCommit[] = session.groupMove.map((member) => {
    const common = {
      id: member.id,
      x: Number((member.entity.value.x + dx).toFixed(6)),
      z: Number((member.entity.value.z + dz).toFixed(6)),
    };
    if (member.entity.kind === "site") return { kind: "siteElement", ...common };
    if (member.entity.kind === "room") return { kind: "room", ...common };
    return { kind: "furniture", ...common };
  });
  return { kind: "batch", changes };
}

'''
replace_once(
    path,
    'function transformCommit(session: DragSession): TransformCommit | undefined {\n',
    group_commit + 'function transformCommit(session: DragSession): TransformCommit | undefined {\n  const group = groupTransformCommit(session);\n  if (group) return group;\n',
)
replace_once(
    path,
    '        active ||\n        event.button !== 0 ||\n        config.view === "walk" ||',
    '        active ||\n        event.button !== 0 ||\n        event.shiftKey ||\n        config.view === "walk" ||',
)
replace_once(
    path,
    '      const furnitureRotationHandle =\n        entity.kind === "furniture" && isFurnitureRotationHandle(hit?.object ?? null);\n      const previewTarget =',
    '      const furnitureRotationHandle =\n        entity.kind === "furniture" && isFurnitureRotationHandle(hit?.object ?? null);\n      const groupMove =\n        !endpointHit &&\n        !resizeAllowed &&\n        !openingResizeCorner &&\n        !furnitureRotationHandle\n          ? groupMoveMembers(config, options, entity)\n          : undefined;\n      const selectedGroup =\n        (config.selectedIds?.length ?? 0) > 1 &&\n        Boolean(config.selectedIds?.includes(id));\n      if (selectedGroup && !groupMove && !endpointHit && !resizeAllowed && !openingResizeCorner && !furnitureRotationHandle) {\n        options.setStatus(\n          "Group move supports same-floor rooms, same-room furniture, or compatible site objects. Adjust the selection first.",\n        );\n        return true;\n      }\n      const previewTarget =',
)
replace_once(
    path,
    '        furnitureRotationHandle,\n      };',
    '        furnitureRotationHandle,\n        groupMove,\n      };',
)
replace_once(
    path,
    '      if (completion.kind === "cancel") {\n        session.previewTarget.position.copy(session.startLocal);',
    '      if (completion.kind === "cancel") {\n        for (const member of session.groupMove ?? [])\n          if (member.id !== session.id) member.target.position.copy(member.startLocal);\n        session.previewTarget.position.copy(session.startLocal);',
)
replace_once(
    path,
    '      if (completion.kind === "tap") {\n        release(session);\n        options.getConfig().onSelect(session.id);\n        return true;\n      }',
    '      if (completion.kind === "tap") {\n        release(session);\n        const selectedIds = options.getConfig().selectedIds ?? [];\n        if (!(selectedIds.length > 1 && selectedIds.includes(session.id)))\n          options.getConfig().onSelect(session.id);\n        return true;\n      }',
)
replace_once(
    path,
    '      const config = options.getConfig();\n      config.onSelect(session.id);\n      if (change) config.onTransformCommit?.(change);',
    '      const config = options.getConfig();\n      if (!(session.groupMove?.length && (config.selectedIds?.length ?? 0) > 1))\n        config.onSelect(session.id);\n      if (change) config.onTransformCommit?.(change);',
)
replace_once(
    path,
    '          : session.wallEndpoint\n            ? session.snapApplied\n              ? "Wall endpoint resized · smart snap applied · one undo step."\n              : "Wall endpoint resized · one undo step."\n            : session.snapApplied',
    '          : session.wallEndpoint\n            ? session.snapApplied\n              ? "Wall endpoint resized · smart snap applied · one undo step."\n              : "Wall endpoint resized · one undo step."\n            : session.groupMove?.length\n              ? `${session.groupMove.length} objects moved together · one undo step.`\n            : session.snapApplied',
)

# Regression contract for this completion slice.
write(
    "tests/perfection-phase4-multiselect-nudge-polygon.test.mjs",
    '''import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");
const transform = read("apps/admin/src/studio/sceneCanvasTransform.ts");
const apply = read("apps/admin/src/studio/sceneTransformApply.ts");
const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
const direct = read("apps/admin/src/studio/sceneCanvasDirectManipulation.ts");
const studio = read("apps/admin/src/studio/Studio.tsx");

test("Phase 4 batches group moves into one transform transaction", () => {
  assert.match(transform, /kind: "batch"; changes: AtomicTransformCommit\[\]/);
  assert.match(apply, /change\.kind === "batch"/);
  assert.match(direct, /groupMove\?\.length/);
  assert.match(direct, /kind: "batch"/);
  assert.match(studio, /applyTransformCommit\(p\.scene, change\)/);
});

test("Phase 4 keeps multi-select explicit and prevents Shift from starting a drag", () => {
  assert.match(canvas, /selectedIds\?: readonly string\[\]/);
  assert.match(canvas, /onSelectionChange\?:/);
  assert.match(canvas, /e\.shiftKey && latest\.current\.onSelectionChange/);
  assert.match(direct, /event\.shiftKey/);
  assert.match(studio, /selectedIds, setSelectedIds/);
});

test("Phase 4 keyboard nudging has fine, normal and coarse precision", () => {
  assert.match(apply, /modifiers\.altKey \? 0\.01 : modifiers\.shiftKey \? 0\.5 : 0\.1/);
  assert.match(apply, /case "arrowleft"/);
  assert.match(apply, /case "arrowup"/);
  assert.match(canvas, /buildTranslationCommit/);
  assert.match(canvas, /Alt 0\.01 m/);
});

test("Phase 4 polygon editing has touch targets, insertion and cancellation safety", () => {
  assert.match(canvas, /Polygon corner .* touch target/);
  assert.match(canvas, /roomEdgeInsertIndex/);
  assert.match(canvas, /next\.splice\(insertIndex, 0/);
  assert.match(canvas, /e\.type === "pointercancel"/);
  assert.match(canvas, /originalPoints/);
  assert.match(canvas, /Polygon corner edit cancelled/);
});

test("Phase 4 renders secondary selection outlines and disables single-object gizmo", () => {
  assert.match(canvas, /Multi-selection outlines/);
  assert.match(canvas, /new T\.BoxHelper\(target, 0x2bc7ff\)/);
  assert.match(canvas, /\(props\.selectedIds\?\.length \?\? 0\) > 1/);
});
''',
)

print("Phase 4 source edits applied successfully")
