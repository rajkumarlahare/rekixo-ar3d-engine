# Perfection Roadmap — Next Execution Order

Current active milestone: **Phase 5 — Automatic Visual / Facade Matching**.

Phase 4 visual correction is now landed: pointer-safe direct manipulation, snapping, wall/opening/furniture handles, room/site resize, multi-select, group move, precision nudge and polygon editing are available in the shared Studio editor.

Phase 5 now also exposes **Reference look review** in the Building editor. Users can inspect the reference, confidence, current/suggested color and reasons, then explicitly apply one material color or the lighting suggestion. Each accepted change uses the existing undo/redo and autosave path. Material application requires an exact loaded material name in the active audited FBX; materials from other attached models do not authorize changes. Missing sources, changed evidence, stale actions and the material-override limit are checked before application. Existing finish parameters are preserved.

These are palette/name heuristics, not facade-region correspondence. Converted GLB and other models without an audit for the active asset have no automatic material application in this slice. Region correspondence, multiple-reference arbitration, visual-difference scoring and protected real-pack certification remain pending. The browser review test uses seeded analyzed evidence and verifies lighting apply/undo/redo/reload; it does not certify image recognition or the real six-file pack.

Phase 5 execution order:

1. Build a deterministic visual-match plan from analyzed raster reference evidence.
2. Treat image evidence as **non-metric appearance evidence only**; it may never create or move walls, rooms, openings, floors or structural geometry.
3. Suggest presentation lighting only when reference confidence is sufficient; low-confidence or unknown lighting stays review-only.
4. Match palette colors only to material names already proven by audited FBX source data. Unknown material names are not guessed.
5. Keep all source-material color changes review-required until a later facade-region correspondence layer can prove which visible reference region belongs to which model material.
6. Add facade-region segmentation/correspondence, multiple-reference arbitration and visual-difference scoring without weakening metric-source authority.
7. Surface the visual plan in Studio as actionable review/apply controls, then include accepted runtime appearance/material overrides in deterministic replay.
8. Promote Phase 5 to visual-match certified only after the protected real six-file pack demonstrates the same behavior end to end.

Source authority remains: **DWG metric > FBX/SKB > measured PDF > visual image**. Visual references must never become dimensional truth.
