# Rekixo AR3D — Automation Foundation Phase 1

Status: implementation branch

This is Phase 1 of the current five-phase product plan. It is intentionally a
foundation/hardening phase, not a rewrite of the working Design Studio or the
older six-file implementation milestones.

## Product rule

The normal Rekixo workflow is source-first:

`project files -> automatic reconstruction -> focused review -> visual correction`

Manual coordinate entry is a fallback. The engine should reconstruct everything
that the supplied evidence can support, but it must not fabricate architectural
truth to make an automation percentage look higher.

## What Phase 1 changes

### 1. One shared AutoBuild source plan

`autoBuildSourcePlan.ts` classifies the uploaded pack once into:

- FBX/GLB model;
- DWG/DXF CAD;
- SKP/SKB SketchUp support;
- PDF drawing/brochure;
- exterior visual reference;
- DRS/JSON render metadata;
- optional CSV/TSV structured evidence;
- texture/other support files.

The same plan decides whether AutoBuild uses the mature model-backed path or the
CAD-only reconstruction path. Source planning does not invent authority; Source
Fusion and review rules remain responsible for deciding what evidence can become
editable architecture.

### 2. CSV/TSV becomes first-class optional evidence

Room sheets are no longer only a manual mapping aid. After either AutoBuild route
finishes, structured room measurements are reconciled with the reconstructed
scene.

The automatic rule is deliberately conservative:

- match by floor (when explicit), unit/flat and room identity;
- accept width/depth orientation swaps where the same two measured sides agree;
- snap only nearby **unverified rectangular** generated rooms to the exact
  structured dimensions;
- preserve room centre/placement;
- never change `verified` to true automatically;
- never rewrite a human-reviewed room;
- never stretch polygon rooms;
- never create room placement from a CSV row that has no spatial evidence;
- large dimension conflicts, ambiguous matches and unmatched rows stay visible
  for review.

This lets a customer/architect schedule improve exactness without allowing a
spreadsheet to silently damage geometry reconstructed from CAD/model evidence.

### 3. Provenance stays intact

Applied room-sheet evidence records a stable `[room-sheet:...]` marker and keeps
prior reconstruction provenance in the source note. Existing source asset/source
pack identity is preserved instead of being overwritten merely because a CSV
row matched.

### 4. Existing safety boundaries stay unchanged

Phase 1 does not weaken:

- `suggested -> auto_ready -> human_reviewed` separation;
- ambiguity/conflict fail-closed behaviour;
- immutable release and rollback boundaries;
- Engine D1/R2 isolation from `rekixo-ar3d-platform`;
- project-scoped source ownership and hashes;
- the rule that rendered images are visual evidence, not metric truth;
- the rule that raw customer CAD/model assets stay out of Git.

## Canonical AEC direction

Scene Manifest V2 remains the reusable interchange/release contract in this
phase. We do **not** replace the proven Studio persistence model in one risky
migration. New automation should, however, keep moving toward the same canonical
hierarchy and stable identities:

`Project -> Site -> Building -> Floor -> Unit -> Room`

Future semantic elements (wall, slab, column, beam, stair, lift, roof, boundary,
road, landscape and interior assets) should attach to that hierarchy with source
provenance, confidence and review state instead of introducing customer-specific
coordinates.

## Phase 1 acceptance gates

Phase 1 is ready to merge when:

1. existing FBX/GLB AutoBuild behaviour remains compatible;
2. existing CAD-only and multi-floor CAD behaviour remains compatible;
3. source planning is shared by both routes;
4. CSV/TSV close-match reconciliation is covered by regression tests;
5. reviewed/polygon/conflicting/ambiguous rooms are never silently reshaped;
6. `npm test`, Admin Wrangler dry-run, Chromium E2E and `git diff --check` pass in
   the normal PR validation workflow.

## Deferred to Phase 2

Phase 2 is where reconstruction breadth/accuracy increases materially: shared
multi-CAD floor-role fusion for model-backed projects, complete stairs/lifts,
slabs/columns/beams/roof/unit binding, stronger site/boundary reconstruction and
maximum six-file source utilization. Phase 1 creates the common source/evidence
foundation so those features do not become separate project-specific pipelines.
