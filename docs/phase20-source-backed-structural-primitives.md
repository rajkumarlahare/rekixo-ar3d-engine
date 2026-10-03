# Phase 20 — Source-backed structural primitives

Phase 20 turns a subset of Phase 19 structural evidence into conservative, editable 3D envelopes without inventing missing building dimensions.

## Evidence contract

A structural primitive is prepared automatically only when two independent sources agree:

- normalized DWG supplies a metre-space structural footprint and semantic kind;
- the aligned 3D authoring model supplies an explicitly named/material-tagged structural mesh with a compatible floor, footprint and vertical envelope.

The CAD footprint is authoritative for X/Z position and footprint dimensions. The matched model mesh is authoritative for base elevation and height. A CAD plan alone never receives a guessed height, slab thickness, beam depth or other vertical dimension.

Supported automatic envelope kinds are `column`, `beam`, `slab`, `roof`, `duct`, `balcony`, `stair` and `lift`. `boundary` remains evidence-only because an axis-aligned bounding box would incorrectly fill the enclosed site; polygon/ring geometry is required before it can become a faithful boundary primitive.

Only closed `LWPOLYLINE`, `POLYLINE` and `CIRCLE` structural footprints are eligible for automatic preparation. Linear or point-only evidence remains review-only unless a later source contract provides enough geometry to remove the ambiguity.

## Fail-closed matching

Automatic preparation requires high-confidence CAD semantics, a reliable CAD↔3D registration, an explicit structural semantic in the 3D node name/material, the same resolved floor and structural kind, compatible footprint dimensions, and one clearly better 3D match. Ambiguous or conflicting candidates stay as evidence.

Generated primitives use `origin: "model-cad-auto"`, retain CAD and model provenance, and enter Studio as `reviewState: "auto_ready"` with `reviewed: false`. AutoBuild never overwrites a human-reviewed structural primitive.

## Publishing

Structural primitives share the existing scene element transport envelope but use distinct structural kinds and provenance fields. Studio renders them with dedicated structural visuals. Customer runtime receives them only after human review, through the same reviewed-only publish filter used by source-backed site elements.

The public representation is deliberately an envelope (`box` or source-backed circular `cylinder`), not fabrication/BIM truth. It is suitable for visual reconstruction, review and spatial presentation; it must not be interpreted as an engineering design, structural calculation or reinforcement specification.
