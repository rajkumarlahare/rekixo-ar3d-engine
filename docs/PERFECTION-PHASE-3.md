# Rekixo AR3D Perfection Phase 3 — Complete Building Reconstruction

## Goal

Turn Phase 2 source intelligence into a deterministic, floor-by-floor building reconstruction plan while keeping Rekixo fail-closed whenever source authority, floor identity, registration, or human ownership is uncertain.

This phase is not a structural-engineering calculator. Columns, beams, slabs, stairs, lifts and other structural-looking primitives remain source-backed visual/coordination envelopes unless a later engineering workflow provides calculation-grade data.

## Phase 3.1 — Source-backed reconstruction plan

`buildingReconstructionPlan.ts` converts normalized source evidence into an execution plan with one row per explicitly identified CAD floor.

A floor becomes `auto-ready` only when all of these are true:

- normalized DWG/DXF geometry is ready;
- exactly one CAD source explicitly resolves to the source floor;
- at least three reliable wall segments exist;
- a unique target scene/model floor can be resolved;
- model-backed projects pass CAD↔3D registration without ambiguity at >= 0.68 confidence;
- no human-reviewed/manual content on that floor would be overwritten.

If reviewed/manual rooms, walls, openings, site/structural envelopes or user furniture are present, the floor becomes `preserve-existing`. Competing CAD sources, multi-floor CAD drawings, missing floor identity, unsafe registration and unresolved target floors become `review`.

## Floor identity rules

Explicit source labels remain authoritative. Rekixo may map a non-negative explicit source level to the corresponding model storey order only when a model-backed floor stack already exists. Basement levels do not use ordinal fallback; they require explicit scene-floor identity.

No page order, upload order or filename sequence is used as a hidden floor guess.

## Evidence roles

DWG/DXF normalized geometry may become metric reconstruction authority. PDF floor-plan pages can corroborate the selected floor with dimensions, room labels and spatial evidence, but cannot become metric geometry authority by themselves. Visual references remain non-metric.

## Human-preservation contract

Phase 3 planning must never silently overwrite human-reviewed geometry. The planner checks reviewed/verified rooms, reviewed/manual walls, reviewed openings, reviewed/manual site elements and user/imported furniture before marking a floor auto-ready.

## Pipeline integration

`runAutoBuildPipeline()` now returns `reconstructionPlan` alongside:

- `sourceIntelligence`
- Phase 2 CAD fusion summary
- structured room evidence
- certification report
- geometry integrity report
- deterministic scene fingerprint
- actionable review queue

Unresolved reconstruction-plan items are included in the same issue/certification path, so the UI cannot present a weak reconstruction plan as complete source-backed automation.

## Current boundary

This slice is the planning and safety foundation for Complete Building Reconstruction. It deliberately does **not** bulk-replace scene walls yet. The next Phase 3 execution slice will apply only `auto-ready` floor plans, then regenerate safe automatic room/opening topology while preserving all protected human work.

That separation is intentional: first prove which floor/source pairing is safe and deterministic, then mutate geometry.
