# Rekixo AR3D Perfection Phase 1 — Golden Six-File AutoBuild Certification

Status: FOUNDATION IMPLEMENTED ON FEATURE BRANCH

This phase is intentionally separate from the older numbered implementation phases in the repository. Its purpose is to certify the current generic engine against a real six-role customer source pack before larger visual/editor features are added.

## Product rule

The target workflow remains:

`source files -> automatic processing -> explicit review queue -> mouse/touch correction -> immutable publish`

The engine must never convert missing or ambiguous evidence into a green "verified" result merely because the overall AutoBuild function completed.

## P1.1 — Golden source manifest contract

Implemented in `apps/admin/src/studio/goldenSourceManifest.ts`.

A golden pack records exactly these six generic roles:

1. authoring model — FBX or GLB
2. CAD — DWG or DXF
3. SketchUp — SKP or SKB
4. drawing — PDF
5. visual reference — raster image
6. render metadata — DRS or JSON

Each expected source records SHA-256 and exact byte size. Verification checks:

- current project ownership;
- SHA-256 identity;
- exact asset/blob byte size;
- valid source format for the declared role;
- missing/ambiguous candidates;
- untracked additional assets.

The manifest is generic. No customer name, customer hash or customer geometry is compiled into the engine.

### Real-source activation

The actual six production binaries should remain private. Once the real pack is available to the certification runner, generate/store its manifest in private test infrastructure rather than committing source binaries or customer-specific fingerprints into the public engine repository.

## P1.2 — AutoBuild certification report

Implemented in `apps/admin/src/studio/autoBuildReport.ts` and attached to every shared `runAutoBuildPipeline` result.

Every check is classified as one of:

- `passed` — an existing prerequisite/result is proven;
- `auto-derived` — this AutoBuild path produced or fused the result automatically;
- `needs-review` — non-blocking evidence remains unresolved;
- `blocked` — a critical certification requirement is missing or unusable.

Current certification checks include:

- source record integrity;
- six-role pack presence;
- authoring model and web-safe GLB path;
- real normalized DWG geometry readiness;
- SketchUp material recovery evidence;
- external texture resolution;
- PDF plan extraction;
- PDF↔CAD registration;
- floors, walls, rooms and openings;
- room/unit semantics;
- source-backed structural primitives;
- visual-reference evidence;
- automatic interior/site evidence when produced;
- structured room-sheet evidence when attached;
- explicit aggregate review burden.

The report exposes `checkCoveragePercent`, but this is deliberately only the percentage of certification checks currently completed. It must not be presented as "percent of the building automatically correct" or as architectural accuracy.

## Important fail-closed rule for DWG

If a `.dwg` file is attached but no source-bound normalized DWG audit has `geometryReady`, the certification report marks the DWG architecture check as `blocked`.

Therefore a model-backed build can still produce a useful draft, but it cannot pretend that the six-file DWG path was actually proven.

## What is not certified yet

This foundation does **not** claim that the owner's real six files have already passed. The public repository does not contain those private binaries.

Remaining Phase 1 slices are:

- P1.3: real binary DWG production certification;
- P1.4: protected real six-file browser E2E;
- P1.5: deterministic replay / normalized scene fingerprint;
- P1.6: whole-scene geometry integrity validator;
- P1.7: actionable review queue + publish gate integration.

## Acceptance for this foundation slice

- generic manifest contract exists without customer hardcoding;
- AutoBuild always returns a certification report;
- DWG cannot show complete certification unless normalized geometry is actually ready;
- summary text exposes blocked/review counts;
- normal typecheck/build/test gates remain the merge gate.
