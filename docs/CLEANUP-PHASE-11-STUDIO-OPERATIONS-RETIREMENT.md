# Cleanup Phase 11 — Detached Studio Operations Retirement

## Goal

Continue the Automatic Engine migration after the published viewer was split onto the read-only `PresentationCanvas` boundary.

## Retired in this batch

- `StudioOverview.tsx`
- `StudioPublish.tsx`
- `StudioSources.tsx`
- `useStudioCloudState.ts`

These modules belonged to the removed legacy Studio shell. They are not production route roots and are not part of the current Source Pack / Automatic Engine entry.

## Explicitly retained

- `SourcePackReview.tsx` and Automatic Engine source processing
- `PresentationCanvas.tsx` and `PublishedViewer.tsx`
- `StudioEvidence.tsx` and readiness/evidence primitives
- `cloud.ts`, storage and immutable release contracts
- Auto Build/source-fusion/CAD/DWG/PDF/model-processing foundations
- Geo Mapper and Geo lifecycle
- `SceneCanvas.tsx` and deeper authoring helpers for a later dependency-proven batch

`SceneCanvas.tsx` is intentionally not deleted in this batch because historical tests still exercise reusable behavior through that boundary. The next cleanup step must first retarget or separate those tests from legacy authoring wiring, then delete only code that has no production dependency.

## Safety

This is source-only cleanup. It performs no D1 mutation, no R2 purge, no published release mutation, and no public viewer/Geo data mutation.

## Merge gate

Merge only after the full validation workflow is green. After merge, the guarded production deployment must also complete successfully and confirm the deployed Automatic Engine entry, immutable release integrity, protected Admin reads and empty-safe production shell.
