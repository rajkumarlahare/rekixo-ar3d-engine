from pathlib import Path

path = Path(".github/apply_phase4_next.py")
text = path.read_text(encoding="utf-8")
old = """replace_once(
    path,
    '        edgeSnapTargets(config, session.entity),',
    '        edgeSnapTargets(config, session.entity, excludedIds),',
)
"""
new = """replace_once(
    path,
    '    if (halfExtents) {\\n      const targets = edgeSnapTargets(config, session.entity);\\n      const edge = resolveEdgeSnap',
    '    if (halfExtents) {\\n      const targets = edgeSnapTargets(config, session.entity, excludedIds);\\n      const edge = resolveEdgeSnap',
)
"""
if text.count(old) != 1:
    raise SystemExit(f"expected one editor-script target, found {text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Phase 4 editor script corrected")
