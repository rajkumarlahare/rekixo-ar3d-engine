# R7 — Premium Motion Safety Boundary

Status: implemented on the R2–R7 integration branch.

R7 adds presentation motion without changing Building authority, Building geometry, Geo placement truth, or review state.

## Guided camera motion

The public guided tour is driven by the immutable `BuildingPresentationManifestV1` camera/tour data when present. One deterministic motion director schedules camera transitions and holds, bounds malformed timing, caps total automatic tour duration, cancels immediately on user interaction, and stops when the page becomes hidden.

Reduced-motion preference is authoritative. Automatic intro motion is skipped, the semantic tour remains usable, and the existing Viewer camera path resolves requested exterior views without tweening for reduced-motion users.

## Ambient presentation motion

`premiumPresentationMotion.ts` provides a restricted ambient-motion controller for Rekixo-generated dressing only. It refuses roots that are not explicitly marked `presentationOnly`, targets only generated `Site tree` and `Site plant` groups, uses deterministic phase offsets instead of randomness, performs scalar-only per-frame updates, and restores the original rotations on dispose.

This helper must never be pointed at the canonical Building model, source-backed site geometry, room/floor geometry, Geo placement objects, or any object carrying architectural authority.

## Non-authoritative rule

Motion is a presentation concern. It must not:

- mutate canonical model bytes or metric bounds;
- change floor/unit/circulation hierarchy;
- alter material/source provenance;
- modify immutable Building or Geo release identity;
- change WGS84/ENU placement, model anchor, heading, height mode, or scale;
- manufacture architecture or mark evidence as reviewed.

## Acceptance

R7 is accepted only when typecheck/build/unit tests remain green together with the existing R2–R6 gates. The full branch must still pass the repository validation workflow before merge.
