# Phase 2 — Multi-CAD + 3D source fusion

Phase 2 extends the shared AutoBuild boundary introduced in Phase 1. The mature model-backed and CAD-only builders remain the geometry authorities; this layer adds cross-source evidence only after a base scene has been reconstructed.

## Automatic path

For a model-backed project, every DWG/DXF source must resolve to exactly one detected 3D floor and pass CAD↔3D registration. Rekixo then fuses that floor's room/unit labels, stair/lift semantic evidence and door/window plan evidence into the reconstructed scene. Prepared, unreviewed openings may be refined by stronger corroborated evidence. Human-reviewed openings are never moved or resized.

Ground/site evidence is allowed from one unambiguous resolved ground-floor CAD source. That source can contribute existing source-backed road, parking, path, garden, lawn, vegetation, gate and outdoor-light primitives through the established site/landscape pipeline. If competing ground plans contain site evidence, placement stays review-only.

## Structural evidence boundary

Normalized DWG already carries stair, lift, column, slab, roof, duct, balcony and gate semantic objects. Stair/lift evidence can safely bind room semantics because the existing room graph can represent those circulation spaces. Column/slab/roof/duct/balcony classes are counted and preserved as source evidence, but Phase 2 does not disguise them as walls, rooms or landscape objects. A dedicated structural scene primitive is required before those objects can become publishable geometry.

This fail-closed boundary is deliberate: automatic reconstruction may omit an unsupported structural primitive, but it must not manufacture dimensions or silently coerce one architectural class into another.

## Review invariants

- duplicate CAD floor roles are not mixed automatically;
- ambiguous or weak CAD↔3D registration remains review-only;
- human-reviewed geometry is preserved;
- CAD-only reconstruction is not re-registered against a nonexistent 3D coordinate system;
- CSV/TSV exact room measurements are still reconciled after Phase 2 source fusion;
- source provenance remains attached to semantic evidence and existing generated primitives.

Future structural work should add explicit scene primitives for columns, slabs, roofs, beams, ducts, balconies and boundaries, together with validation, editor transforms, release serialization and public rendering before those classes are auto-built.
