from pathlib import Path

path = Path("apps/admin/src/studio/SceneCanvas.tsx")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '''import {
  buildTranslationCommit,
  nudgePlanDelta,
} from "./sceneTransformApply";
''',
    '''import {
  activeRoomAuthoringConfig,
  clearPolygonDraftVisual,
  insertPolygonMidpoint,
  polygonDraftResult,
  redrawPolygonDraftVisual,
  renderMultiSelectionOutlines,
  renderPolygonEditVisual,
  resolveCanvasNudge,
  toggleCanvasSelection,
  updateRoomDraftVisual,
} from "./sceneCanvasEditorUx";
''',
    "editor UX imports",
)

start = text.index("    const polygonDraftPoints: T.Vector3[] = [];")
end = text.index("    let yaw = 0,", start)
replacement = '''    const polygonDraftPoints: T.Vector3[] = [];
    const clearPolygonDraft = () =>
      clearPolygonDraftVisual(polygonDraft, polygonDraftPoints);
    const renderPolygonEdit = (room?: Room, points?: RoomPoint[]) => {
      const floorY =
        latest.current.scene.floors.find(
          (floor) => floor.id === room?.floorId,
        )?.elevation ?? 0;
      renderPolygonEditVisual(polygonEdit, room, floorY, points);
    };
    const redrawPolygonDraft = (hover?: T.Vector3) =>
      redrawPolygonDraftVisual(polygonDraft, polygonDraftPoints, hover);
    const finishPolygonDraft = () => {
      const points = polygonDraftResult(polygonDraftPoints);
      if (!points) {
        setStatus("Add at least 3 corners before finishing the room.");
        return;
      }
      latest.current.onRoomPolygonDraw?.(points);
      clearPolygonDraft();
      setStatus("");
    };
'''
text = text[:start] + replacement + text[end:]

old_nudge = '''      if (latest.current.view !== "walk") {
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
new_nudge = '''      if (latest.current.view !== "walk") {
        const nudge = resolveCanvasNudge(
          {
            scene: latest.current.scene,
            selected: latest.current.selected,
            selectedIds: latest.current.selectedIds,
            transformEnabled: latest.current.transformEnabled,
            transformMode: latest.current.transformMode,
            editorBusy: Boolean(
              latest.current.furniturePlacement?.enabled ||
                latest.current.roomDraw?.enabled ||
                latest.current.roomStamp?.enabled ||
                latest.current.roomPolygonDraw?.enabled ||
                latest.current.roomPolygonEdit?.enabled ||
                architectureAuthoringActive(latest.current),
            ),
          },
          e,
        );
        if (nudge) {
          e.preventDefault();
          latest.current.onTransformCommit?.(nudge.change);
          setStatus(nudge.status);
        }
        return;
      }
'''
replace_once(old_nudge, new_nudge, "keyboard nudge")

start = text.index("    const roomPlanePoint = (")
end = text.index("    const pointerDown = (e: PointerEvent) => {", start)
room_plane = '''    const roomPlanePoint = (
      event: PointerEvent,
      excludeRoomId?: string,
    ) => {
      const config = activeRoomAuthoringConfig(
        latest.current.scene,
        latest.current,
      );
      if (!config?.floorId) return undefined;
      return pointOnFloor(
        event.clientX,
        event.clientY,
        config.floorId,
        config.snap,
        excludeRoomId,
      );
    };

'''
text = text[:start] + room_plane + text[end:]
text = text.replace(
    "if (end) updateRoomDraft(roomDrawStart, end);",
    "if (end) updateRoomDraftVisual(roomDraft, roomDrawStart, end);",
    1,
)

old_insert = '''        if (
          targetRoom?.polygon?.length &&
          Number.isInteger(insertIndex) &&
          insertIndex >= 1 &&
          insertIndex <= targetRoom.polygon.length
        ) {
          const left = targetRoom.polygon[insertIndex - 1];
          const right = targetRoom.polygon[insertIndex % targetRoom.polygon.length];
          const next = targetRoom.polygon.map(([x, z]) => [x, z] as RoomPoint);
          next.splice(insertIndex, 0, [
            Number(((left[0] + right[0]) / 2).toFixed(3)),
            Number(((left[1] + right[1]) / 2).toFixed(3)),
          ]);
          latest.current.onRoomPolygonChange?.(targetRoom.id, next);
          setStatus(`Corner inserted · ${next.length} polygon corners.`);
          return;
        }
'''
new_insert = '''        if (targetRoom?.polygon?.length && Number.isInteger(insertIndex)) {
          const next = insertPolygonMidpoint(targetRoom.polygon, insertIndex);
          if (next) {
            latest.current.onRoomPolygonChange?.(targetRoom.id, next);
            setStatus(`Corner inserted · ${next.length} polygon corners.`);
            return;
          }
        }
'''
replace_once(old_insert, new_insert, "polygon midpoint insertion")

old_select = '''      const selectCanvasId = (id: string) => {
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
new_select = '''      const selectCanvasId = (id: string) => {
        if (!e.shiftKey || !latest.current.onSelectionChange) {
          latest.current.onSelect(id);
          return;
        }
        const selection = toggleCanvasSelection(
          latest.current.selectedIds,
          latest.current.selected,
          id,
        );
        latest.current.onSelectionChange(selection.ids, selection.primary);
        setStatus(selection.status);
      };
'''
replace_once(old_select, new_select, "shift selection")

old_outlines = '''    for (const child of [...r.multiSelection.children]) {
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
    }
'''
replace_once(
    old_outlines,
    '''    renderMultiSelectionOutlines(
      r.multiSelection,
      r.selectables,
      props.selectedIds,
      props.selected,
    );
''',
    "multi-selection outlines",
)

path.write_text(text, encoding="utf-8")
print("SceneCanvas maintainability refactor applied")
