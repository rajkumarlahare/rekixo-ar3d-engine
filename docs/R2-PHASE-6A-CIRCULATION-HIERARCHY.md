# R2 — Phase 6A Source-Backed Circulation Hierarchy

## Purpose

R2 starts closing the remaining Phase 6 reconstruction gap by binding already-proven stair and lift structural evidence across adjacent floors.

This is deliberately a hierarchy/reconstruction step, not a geometry generator. Rekixo must not invent a stair flight, lift shaft, floor connection, or vertical extent from a name alone.

## Inputs

The hierarchy consumes `Scene.siteElements` only after the existing CAD + 3D structural fusion has created `model-cad-auto` stair/lift primitives with provenance.

A circulation member is eligible only when it has:

- kind `stair` or `lift`;
- `origin === "model-cad-auto"`;
- resolved `floorId`;
- source provenance through `sourceRef`;
- finite positive footprint dimensions.

Manual elements and CAD-only evidence are not promoted into automatic cross-floor hierarchy.

## Binding policy

Elements are processed in floor-elevation order. A candidate may bind only to a core whose latest member is on the immediately preceding floor and has the same circulation kind.

The binding score uses source-backed X/Z centre proximity and footprint-size agreement. A binding is accepted only when it is below the guarded score threshold and is uniquely better than the second candidate. Otherwise the evidence starts or remains a review-only core.

Missing-floor, singleton, and ambiguous evidence is reported explicitly.

## Review semantics

`auto-ready` means only that source-backed members form a uniquely supported adjacent-floor hierarchy. It never means `human_reviewed`.

The implementation:

- does not mutate the scene;
- does not set `reviewed: true`;
- does not synthesize geometry;
- does not publish anything by itself;
- preserves the existing Super Admin/platform boundary.

## R2 continuation

After this hierarchy foundation is green, Phase 6B should bind unit hierarchy to reviewed rooms/floors and then connect circulation cores to that unit/floor graph. Only after those source-backed relationships are proven should Phase 6 be marked complete and the real six-file source-pack gate be rerun.
