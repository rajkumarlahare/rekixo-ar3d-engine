# Phase 12 — SceneCanvas authoring retirement

## Goal

Retire the detached legacy `SceneCanvas` authoring runtime after Phase 10 moved published presentation onto the read-only `PresentationCanvas` boundary.

## Removed in this batch

- `SceneCanvas.tsx`
- `SceneCanvasOverlays.tsx`
- `sceneCanvasArchitectureController.ts`
- `sceneCanvasDirectManipulation.ts`
- `sceneCanvasEditorUx.ts`
- `canvasFurniturePlacement.ts`
- `MaterialQuickEditor.tsx`
- `ModelNodeInspector.tsx`
- `ReferenceWorkspace.tsx`

These modules implemented direct manual canvas authoring gestures, transform controls, selection overlays, wall/opening/furniture placement and detached Studio inspector/alignment panels.

## Explicitly retained

- `PresentationCanvas` and `PublishedViewer`
- Source Pack / Automatic Engine review
- AutoBuild and source-fusion pipelines
- CAD/DWG/PDF/model evidence processing, including `pdfReferenceRaster`
- room-sheet and source provenance logic
- `sceneTransformApply` and transform data contracts
- reusable scene rendering helpers (`sceneCanvasModel`, `sceneCanvasRooms`, `sceneCanvasRoomObjects`, `sceneCanvasSite`, `sceneCanvasAppearance`)
- `sceneCanvasPlanResizeHandles` because retained room/site rendering modules still import it
- low-level `@rekixo/3d-engine-core` editor kernels
- storage/cloud/immutable release contracts
- Geo Mapper and Geo release lifecycle

## Dependency adjustment

The first deletion attempt showed that `sceneCanvasPlanResizeHandles` remains a real source dependency of retained room/site rendering helpers, so it was restored instead of being retired prematurely. Detached inspector/alignment panels that only depended on `SceneCanvas` types were retired with the shell.

## Test migration

Historical tests that existed only to prove the retired SceneCanvas wiring are removed or retargeted to retained standalone kernels. Published walkthrough and appearance coverage is anchored to `PresentationCanvas`; PDF rasterization remains covered independently of the retired alignment panel.

## Safety

This is source-only Admin cleanup. It does not change D1 migrations, R2 cleanup, published release data, Geo data or the public viewer runtime. Production merge remains gated by full validation and post-deploy immutable-release/protected-read checks.
