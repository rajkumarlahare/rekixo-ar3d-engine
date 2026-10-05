# Phase 9 — Legacy Studio shell retirement

Date: 2026-10-05

## Purpose

Phase 8 moved the production Admin entry to the Automatic Engine / Source Pack workflow. Phase 9 begins dependency-proven removal of the now-detached architecture-authoring UI instead of leaving dead editor code in the repository.

This is intentionally a narrow first deletion batch. It does **not** remove shared rendering, source-processing, immutable publishing, or Geo foundations.

## Removed in this batch

- `Studio.tsx`
- `ArchitectureEditingPanels.tsx`
- `FloorRoomReview.tsx`
- `FurnitureShelf.tsx`
- `RoomNavigationPanel.tsx`
- `VisualRoomMapper.tsx`
- `studio-editor-core.css`
- `studio-operations.css`
- `studio-superadmin-theme.css`

These files belonged to the detached legacy Studio shell and its room/wall/furniture authoring UI.

## Explicitly retained

The following classes of code remain because they still have a valid Automatic Engine, published-viewer, processing, or Geo role, or because a production dependency still exists:

- `SceneCanvas.tsx` and its current runtime dependencies;
- `PublishedViewer.tsx` and `studio.css`;
- FBX/web-model processing;
- SketchUp recovery/material utilities;
- DWG evidence/normalization/processor utilities;
- PDF/reference inspection utilities;
- storage/cloud and source-provenance utilities;
- immutable Building release runtime;
- Geo Mapper and Geo release lifecycle;
- material/appearance/environment/runtime foundations.

## Why deeper editor modules are not deleted yet

`PublishedViewer.tsx` still uses `SceneCanvas.tsx`, and `SceneCanvas.tsx` currently imports architecture/editor/direct-manipulation helpers. Those helpers are therefore not yet dependency-proven dead even though many belong to the old product direction.

The next cleanup boundary must first split or simplify the shared canvas into a read-only/presentation runtime. Only after the production caller graph no longer reaches architecture authoring, direct manipulation, furniture placement, plan resize, room construction, or opening construction can those modules be deleted safely.

## Safety boundary

This phase changes code only. It does not:

- mutate D1 production data;
- delete or purge R2 objects;
- change Jyoti Paradise active release/assets;
- change the stable Rekixo Super Admin / Plot Mapper / Geo Mapper platform;
- alter public release URLs;
- remove the Engine-owned 3D Geo Experience.

## Acceptance gate

The batch is mergeable only after the normal repository validation passes: typecheck, build, budgets, unit/integration tests, migrations, Worker/Wrangler validation, browser E2E, whitespace checks, and then the guarded production deployment with immutable-release and security verification.

A dedicated regression test keeps the retired files absent while asserting that retained source-processing, presentation, and Geo foundations remain present.
