# Phase 10 — Read-only Presentation Canvas Split

## Goal

Remove the production published-design viewer from the legacy authoring `SceneCanvas` dependency graph before deleting deeper editor helpers.

## New boundary

`PublishedViewer.tsx` now renders `PresentationCanvas.tsx`.

The presentation canvas keeps only customer-facing runtime behavior needed by the published snapshot:

- GLB/FBX loading
- shared model-profile appearance
- model material overrides
- project site visuals
- room/interior presentation
- furniture visuals
- reviewed opening markers
- orbit controls
- read-only room selection
- walkthrough movement and reviewed-door transitions

## Explicitly excluded from the published runtime

The new canvas must not depend on:

- `TransformControls`
- architecture authoring controller
- room/polygon editor UX
- direct manipulation controller
- canvas furniture placement/drop authoring
- plan resize handles
- Studio authoring overlays/hints
- retired Studio panels

The maintainability gate and `presentation-canvas-boundary.test.mjs` enforce this boundary.

## What remains intentionally untouched

`SceneCanvas.tsx` remains in the repository for dependency analysis and later deletion work. This phase does not blindly delete its deeper helpers because historical tests and reusable authoring primitives still reference them.

The correct next cleanup step is to map which editor modules now have no production caller after the published viewer split, then delete only zero-dependency modules in a separate phase.

## Safety boundary

This phase changes no D1 schema or data, no R2 project assets, no Jyoti Paradise release or asset, no public immutable release contract, and no Geo release lifecycle.

Production acceptance requires the normal validation workflow, merged PR, guarded Admin deployment, published release integrity verification, protected Admin reads, and empty-safe production shell verification.
