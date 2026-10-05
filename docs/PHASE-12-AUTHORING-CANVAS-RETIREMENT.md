# Phase 12 — Detached authoring canvas retirement

Phase 10 moved published presentation onto `PresentationCanvas`. Phase 11 retired detached Studio operations wrappers. This phase removes the remaining app-level manual authoring surface that no production route consumes.

## Retired in this batch

- `apps/admin/src/studio/SceneCanvas.tsx`
- `apps/admin/src/studio/SceneCanvasOverlays.tsx`
- `apps/admin/src/studio/CanvasAuthoringHints.tsx`
- `apps/admin/src/studio/MaterialQuickEditor.tsx`
- `apps/admin/src/studio/ModelNodeInspector.tsx`
- `apps/admin/src/studio/ReferenceWorkspace.tsx`

These files implemented manual canvas authoring, transform controls, drawing/stamping/furniture interaction hints, legacy canvas overlays, model-node tagging UI, material-editing UI, and visual reference-alignment UI. The production router exposes Automatic Engine Source Pack Review, Geo Mapper, and Published Viewer. Published Viewer renders through the read-only `PresentationCanvas` boundary.

The three detached editor panels were discovered by TypeScript after `SceneCanvas` retirement because they imported types from that shell. They are not production routes; their reusable foundations remain separately available.

## Explicitly retained

This is not a blanket deletion of scene or reconstruction logic. Shared foundations remain, including `PresentationCanvas`, `PublishedViewer`, domain/storage/material/model helpers, `materialPresets`, PDF reference rasterization, source intelligence, CAD/DWG/PDF processing, AutoBuild/readiness/release contracts, and Geo lifecycle.

Lower-level authoring/reconstruction helpers are evaluated separately. They are only eligible for retirement after their remaining consumers and tests are classified; reusable geometry or Automatic Engine algorithms are not removed merely because the legacy canvas is gone.

## Safety

This is source-only cleanup. It does not request D1 migration, R2 purge, published release mutation, Geo data mutation, or public-runtime deployment. Production deployment must still verify the Admin entry, immutable release integrity, protected reads, and empty-safe shell before the phase is considered complete.
