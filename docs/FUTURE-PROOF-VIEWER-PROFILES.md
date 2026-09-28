# Future-proof viewer profile boundary

Status: Phase A implemented on 2026-09-28.

The reusable viewer and Design Studio no longer import the Jyoti exterior or
reconstructed interior implementation directly. They call a model-profile
registry. A project profile may alter a model only after positively identifying
the source model; unmatched projects keep generic behavior.

This is an isolation step, not a visual redesign. Jyoti Paradise keeps its
source-hash-gated V9 exterior treatment and its current reconstructed interior.
The important change is ownership: those assumptions are no longer defaults of
the generic viewer.

## Rules

- Generic viewer code must not contain customer unit numbers, room IDs, measured
  camera envelopes, or direct imports of a customer profile.
- Floor buttons and unit cards come from project scene data.
- A project-specific experience is instantiated only after its model profile
  matches.
- Studio may use the same registry for source-faithful preview, but it must not
  import a customer decorator directly.
- A second project must render without inheriting Jyoti rooms, furniture,
  cameras, or floor assumptions.

## Next phase

Move authored room/unit/furniture data out of source code into a versioned scene
contract, then back Studio drafts with authenticated Engine storage and immutable
publish releases. IndexedDB remains a local cache/backup surface until that
authenticated write path exists.
