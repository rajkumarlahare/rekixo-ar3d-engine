from pathlib import Path

path = Path(".github/apply_phase4_next.py")
text = path.read_text(encoding="utf-8")

def swap(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    text = text.replace(old, new, 1)

old_pointer = """replace_once(
    path,
    '      const furnitureRotationHandle =\\n        entity.kind === \"furniture\" && isFurnitureRotationHandle(hit?.object ?? null);\\n      const previewTarget =',
    '      const furnitureRotationHandle =\\n        entity.kind === \"furniture\" && isFurnitureRotationHandle(hit?.object ?? null);\\n      const groupMove =\\n        !endpointHit &&\\n        !resizeAllowed &&\\n        !openingResizeCorner &&\\n        !furnitureRotationHandle\\n          ? groupMoveMembers(config, options, entity)\\n          : undefined;\\n      const selectedGroup =\\n        (config.selectedIds?.length ?? 0) > 1 &&\\n        Boolean(config.selectedIds?.includes(id));\\n      if (selectedGroup && !groupMove && !endpointHit && !resizeAllowed && !openingResizeCorner && !furnitureRotationHandle) {\\n        options.setStatus(\\n          \"Group move supports same-floor rooms, same-room furniture, or compatible site objects. Adjust the selection first.\",\\n        );\\n        return true;\\n      }\\n      const previewTarget =',
)
"""
new_pointer = """replace_once(
    path,
    '      const rotationHandle =\\n        entity.kind === \"furniture\" &&\\n        isFurnitureRotationHandle(hit?.object ?? null);\\n      const previewTarget =',
    '      const rotationHandle =\\n        entity.kind === \"furniture\" &&\\n        isFurnitureRotationHandle(hit?.object ?? null);\\n      const groupMove =\\n        !endpointHit &&\\n        !resizeAllowed &&\\n        !openingCorner &&\\n        !rotationHandle\\n          ? groupMoveMembers(config, options, entity)\\n          : undefined;\\n      const selectedGroup =\\n        (config.selectedIds?.length ?? 0) > 1 &&\\n        Boolean(config.selectedIds?.includes(id));\\n      if (selectedGroup && !groupMove && !endpointHit && !resizeAllowed && !openingCorner && !rotationHandle) {\\n        options.setStatus(\\n          \"Group move supports same-floor rooms, same-room furniture, or compatible site objects. Adjust the selection first.\",\\n        );\\n        return true;\\n      }\\n      const previewTarget =',
)
"""
swap(old_pointer, new_pointer, "rotation handle insertion")

old_assignment = """replace_once(
    path,
    '        furnitureRotationHandle,\\n      };',
    '        furnitureRotationHandle,\\n        groupMove,\\n      };',
)
"""
new_assignment = """replace_once(
    path,
    '        furnitureRotationHandle: rotationHandle,\\n      };',
    '        furnitureRotationHandle: rotationHandle,\\n        groupMove,\\n      };',
)
"""
swap(old_assignment, new_assignment, "rotation handle assignment")

old_status = """replace_once(
    path,
    '          : session.wallEndpoint\\n            ? session.snapApplied\\n              ? \"Wall endpoint resized · smart snap applied · one undo step.\"\\n              : \"Wall endpoint resized · one undo step.\"\\n            : session.snapApplied',
    '          : session.wallEndpoint\\n            ? session.snapApplied\\n              ? \"Wall endpoint resized · smart snap applied · one undo step.\"\\n              : \"Wall endpoint resized · one undo step.\"\\n            : session.groupMove?.length\\n              ? `${session.groupMove.length} objects moved together · one undo step.`\\n            : session.snapApplied',
)
"""
new_status = """replace_once(
    path,
    '              : session.wallEndpoint\\n                ? session.snapApplied\\n                  ? \"Wall endpoint resized · smart snap applied · one undo step.\"\\n                  : \"Wall endpoint resized · one undo step.\"\\n                : session.snapApplied',
    '              : session.wallEndpoint\\n                ? session.snapApplied\\n                  ? \"Wall endpoint resized · smart snap applied · one undo step.\"\\n                  : \"Wall endpoint resized · one undo step.\"\\n                : session.groupMove?.length\\n                  ? `${session.groupMove.length} objects moved together · one undo step.`\\n                  : session.snapApplied',
)
"""
swap(old_status, new_status, "status insertion")

path.write_text(text, encoding="utf-8")
print("Phase 4 editor script v2 corrected")
