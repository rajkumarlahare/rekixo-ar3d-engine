# Phase 12 — SceneCanvas authoring retirement

## Goal

Retire the detached legacy `SceneCanvas` authoring runtime after Phase 10 moved published presentation onto the read-only `PresentationCanvas` boundary.

## Removed in this batch

- `SceneCanvas.tsx`
- `SceneCanvasOverlays.tsx`
- `sceneCanvasArchitectureController.ts`
- `sceneCanvasDirectManipulation.ts`
- `sceneCanvasEditorUx.ts`
- `sceneCanvasPlanResizeHandles.ts`
- `canvasFurniturePlacement.ts`

These modules implemented direct manual canvas authoring gestures, transform controls, selection overlays, resize handles, wall/opening placement and furniture placement for the retired Studio shell.

## Explicitly retained

- `PresentationCanvas` and `PublishedViewer`
- Source Pack / Automatic Engine review
- AutoBuild and source-fusion pipelines
- CAD/DWG/PDF/model evidence processing
- room-sheet and source provenance logic
- `sceneTransformApply` and transform data contracts
- reusable scene rendering helpers (`sceneCanvasModel`, `sceneCanvasRooms`, `sceneCanvasRoomObjects`, `sceneCanvasSite`, `sceneCanvasAppearance`)
- low-level `@rekixo/3d-engine-core` editor kernels
- storage/cloud/immutable release contracts
- Geo Mapper and Geo release lifecycle

## Test migration

Historical tests that existed only to prove the retired SceneCanvas wiring are removed or retargeted to retained standalone kernels. Published walkthrough coverage is anchored to `PresentationCanvas`.

## Safety

This is source-only Admin cleanup. It does not change D1 migrations, R2 cleanup, published release data, Geo data or the public viewer runtime. Production merge remains gated by full validation and post-deploy immutable-release/protected-read checks.
