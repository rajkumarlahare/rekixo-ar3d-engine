# Rekixo AR3D — Automatic Presentation Engine Cleanup Audit

Date: 2026-10-05

Baseline production/default branch inspected: `main` at `23f71ed86fb90a4bd18a8f16a74054c2ae8ffb2b`.

Working branch: `cleanup/automatic-presentation-engine-20261005`.

## Product boundary

Rekixo AR3D is not a CAD/Blender/SketchUp replacement and must not rebuild an already-designed building. The source model is architectural truth. The engine converts a prepared project source pack into web-ready immutable assets, applies presentation intelligence, allows small operator overrides, previews the result, and publishes a premium client-facing site.

The cleanup must therefore optimize for:

`source pack -> analyze -> derive web model -> recover/tune materials -> presentation environment -> camera/lighting -> preview -> immutable publish`

rather than:

`draw/edit walls -> author rooms/openings/furniture -> reconstruct building -> publish`.

## Production protection — LOCKED

`jyoti-paradise` is the golden production reference. During this cleanup:

- do not delete its project record;
- do not delete or purge its `projects/jyoti-paradise/` R2 namespace;
- do not mutate its active release as a cleanup side effect;
- do not rewrite or remove its historical migrations;
- do not treat presentation assets referenced by its active release as orphaned;
- do not use it as the destructive migration test project.

Phase 0 adds fail-closed guards in the bulk project deletion worker, the manual R2 purge script, and the database delete path. These guards are intentionally narrow and do not change the public viewer or active release.

The exact live active-release ID, all live D1 rows referenced by that release, and all referenced R2 keys remain a required production snapshot before any destructive cleanup is allowed.

## KEEP

### Source and derived-model pipeline

Keep and evolve source ingestion/evidence modules such as `sourceRegistration`, `sourcePackSetup`, `sourcePackReadiness`, `sourceAudit`, `sourceConflicts`, `deepSourceIntelligence`, `projectAnalyzer`, `fbxWebModel`, `sketchUpArchive`, `sketchUpRecovery`, `sketchUpMaterialResolver`, `drsInspector`, `dwgEvidence`, `dwgNormalized`, `dwgProcessor`, `pdfPlanInspector`, `pdfReferenceRaster`, reference-image analysis, model integrity checks, storage/cloud helpers, and source provenance contracts.

DWG/PDF/DRS/reference-image information is evidence and presentation metadata. It must not silently override source-model geometry.

### Runtime and publishing

Keep the stable public routing/viewer foundation, immutable release tables/contracts, release publishing/runtime workers, storage boundary, HTTP range support, public asset loading, project identity, cloud draft/source storage, published-viewer support, error/security boundaries, model/profile isolation, and performance checks.

### Presentation runtime

Keep/refine `Viewer3D`, camera utilities, sky, realism/material utilities, `presentationEnvironment`, `siteEnvironment`, source-presentation mapping, runtime context, resource cleanup, and mobile/performance behavior.

### Tests worth retaining

Keep immutable-release, source-pack provenance/readiness, source publish/model, production-building readiness, public model-first, project-profile isolation, security/deployment, golden-source-pack, public building, storage-boundary, model-cache/versioning, and relevant performance tests.

## REFACTOR

### Admin Studio

`Studio.tsx`, `SceneCanvas.tsx`, `SmartProjectBuilder.tsx`, dashboard navigation, source/reference workspaces, review queues, appearance controls, material controls, and publish screens currently mix useful source/presentation capabilities with architectural authoring. Replace the large editor workflow with a small operator flow:

1. New Project
2. Project info
3. Upload source pack
4. Automatic analysis/processing
5. Presentation preview
6. Optional overrides
7. Publish

Optional overrides should be data/configuration, not geometry authoring: hero camera, front/entrance direction, sunlight, environment preset/density, road placement, day/evening default, location, gallery, and CTA.

### Source fusion

`sourceFusion`, `crossSourceFusion`, CAD-derived analysis, repeated-floor analysis, and similar intelligence can remain only where they improve confidence/evidence. Remove the responsibility to manufacture replacement architecture. Low-confidence conclusions must stay operator-reviewable.

### Public client presentation

Refactor `main.tsx`, `clientPresentation.ts`, `customer-info.ts`, `presentation-tour.ts`, and one-off showcase CSS/DOM behavior into normal React rendering driven by a presentation/release manifest. No project-slug hacks or MutationObserver-style product architecture should remain long term.

Render public controls conditionally. Floor Explorer, Walk, Section, Explode, semantic interior UI, and walkthrough controls must appear only when the published release contains verified data that makes them useful.

### Environment

Convert current primitive/site landscape behavior into a reusable presentation-environment system with project configuration and reusable optimized assets. Generated surroundings are presentation dressing, not claimed real-world GIS truth.

## DELETE CANDIDATES — AFTER DEPENDENCY REMOVAL AND GREEN TESTS

The following are wrong-direction candidates, but many are currently imported by Studio and therefore are **not safe to delete yet**:

- `ArchitectureEditingPanels.tsx`
- `CanvasAuthoringHints.tsx`
- `FloorRoomReview.tsx`
- `FurnitureShelf.tsx`
- `RoomNavigationPanel.tsx`
- `VisualRoomMapper.tsx`
- `applyBuildingReconstruction.ts`
- `architectureAuthoring.ts`
- architecture reconstruction/topology authoring paths
- `autoBuildPipeline.ts` and legacy building reconstruction pipeline
- `autoInteriorDraft.ts`
- `autoRoomDraft.ts`
- `buildingReconstructionPlan.ts`
- `cadFloorPlanning.ts`
- `cadOnlyAutoBuildPipeline.ts`
- `cadOnlySceneDraft.ts`
- opening-creation/fusion workflows whose purpose is geometry reconstruction
- room-sheet/furniture-placement authoring paths
- SceneCanvas direct manipulation / room-object / plan-resize / architecture editing modules
- structural primitive generation when used to replace finished source geometry
- the `packages/engine-core/src/editor` authoring/editor kernel after its remaining callers are removed
- corresponding editor/reconstruction E2E/unit tests and obsolete editor-phase docs after replacement tests/docs exist

Deletion order is dependency-first: detach runtime/UI callers, replace required behavior, run tests/build/smoke tests, then remove code. No filename-only deletion.

## LOCKED / HISTORICAL DATA

Do not delete applied migration files merely because the product direction changed. In particular, `0002` through `0019` are Jyoti-specific production history and must remain immutable. Obsolete schema can be retired only through a new forward migration after live-reference verification.

The checked-in `apps/public/public/presentations/<hash>/` assets are LOCKED/UNKNOWN until they are mapped against active published releases and proven unreferenced.

## UNKNOWN / NEEDS LIVE VERIFICATION

Before destructive Phase 1/2 work, verify from production rather than repository assumptions:

- exact active Jyoti project ID and active release ID;
- complete release-asset rows and exact R2 object keys reachable from that release;
- whether checked-in presentation hashes are live dependencies or build-time references;
- which geo-experience tables/routes are still part of the intended Rekixo product versus a separate retained capability;
- whether any external/legacy client URL depends on old customer-info/showcase DOM structure;
- all direct administrative deletion paths outside the audited bulk worker and purge script;
- production D1 columns/tables still read by public/admin workers before schema retirement.

## Current sample source-pack findings

The supplied sample pack validates the future ingestion model: there is a primary FBX candidate, a SketchUp backup/source file, DWG evidence, a DRS dependency/material source, an exterior render reference, and a brochure/floor-plan PDF. The FBX references external textures rather than embedding all texture payloads, which makes a confidence-based texture recovery/resolution stage a real requirement rather than a speculative feature.

Recommended source roles:

- FBX: primary finished geometry candidate;
- SKB: backup/original-source and material/texture recovery candidate;
- DWG: optional evidence/cross-check only;
- DRS: dependency/material/metadata hints;
- exterior image: visual presentation/facade reference;
- PDF: approved marketing/project/floor-plan content subject to human verification.

## Safe execution sequence

### Phase 0 — Production Protection

1. Lock destructive paths for Jyoti.
2. Capture live project/release/asset dependency snapshot.
3. Keep all cleanup on the dedicated branch.
4. Add regression tests.

### Phase 1 — Dependency inventory

Build an import/reference/schema/route inventory and classify each candidate as KEEP, REFACTOR, DELETE, LOCKED, or UNKNOWN.

### Phase 2 — UI/runtime detachment

Replace editor-first Studio surfaces with source-pack/presentation workflow while leaving old implementation isolated but still available to the branch until replacement tests pass.

### Phase 3 — safe deletion batches

Remove now-unreferenced authoring modules, editor package code, obsolete tests/styles/docs, and only then consider forward schema cleanup.

### Later phases

Source-pack processing, web-model optimization, texture recovery, reusable premium environment, sky/lighting/material intelligence, automatic camera presets, premium public template, minimal Super Admin workflow, performance/mobile QA, and controlled production deployment.

## Merge gate

No cleanup batch is mergeable unless typecheck/tests/build pass and the public viewer smoke test plus Jyoti production regression check are green. A change that cannot prove Jyoti is unaffected remains unmerged.
