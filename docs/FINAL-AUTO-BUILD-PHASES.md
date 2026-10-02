# Rekixo AR3D — Final Auto-Build Phases

This roadmap assumes each production project arrives with the same six source roles:

1. FBX authoring model
2. DWG architectural drawing
3. SKB/SKP SketchUp source or backup
4. PDF drawing/brochure
5. Exterior/reference image
6. DRS render metadata

The product rule is: **files first, automatic reconstruction first, manual editing only for review/correction.**

## Phase 1 — Six-file pipeline hardening

Status: **complete — validation and browser E2E passed before merge**

Goals:
- Keep the six-role intake generic; never hardcode customer names, hashes or geometry.
- Preserve source SHA-256/byte-size/project ownership checks.
- Expose an explicit intake/pipeline readiness state.
- Separate machine confidence from human review.
- Automatic build may mark walls, repeated floors and openings as `auto_ready`, but must not silently mark them human-reviewed.
- Only an explicit operator action may transition eligible architecture to `human_reviewed`.
- Public release remains fail-closed: only human-reviewed walls/openings and accepted repeated-floor relationships can be published.

## Phase 2 — FBX + SKB material recovery

Status: **complete — material XML/texture fusion implemented; validation and browser E2E passed**

- Recover SketchUp materials/textures before final FBX → GLB preparation.
- Match FBX material assignments to recovered SketchUp material definitions.
- Build a reusable material resolver and preserve material provenance.

## Phase 3 — Real DWG architecture processor

Status: **implementation complete; production decoder activates only when Cloudflare Containers access is available, otherwise the route fails closed and DWG remains evidence**

- Decode binary DWG/AEC architecture through a controlled processor.
- Normalize walls, thicknesses, doors, windows, stairs, lifts, slabs/columns, dimensions, text and floor identity.
- Keep provider output behind a stable Rekixo normalized contract.

## Phase 4 — PDF + SKB + DRS deep extraction

Status: **complete — structured DRS/SKB/PDF extraction implemented; validation and browser E2E passed before merge**

- Extract PDF embedded floor-plan imagery in addition to the text layer.
- Recover room/flat labels and dimensional evidence with coordinates.
- Extend SketchUp semantic extraction.
- Parse DRS dependency/resource/material metadata without inventing missing resources.

## Phase 5 — Cross-source alignment and fusion

Status: **complete — capability-specific source authority, CAD↔model rigid registration, guarded PDF↔CAD↔model registration, SketchUp↔FBX provenance linking, and review-only ambiguity handling are implemented**

- Normalize units, origin, scale and orientation across FBX/DWG/SKB/PDF.
- Fuse claims by capability and source authority instead of treating CAD as a fallback.
- Detect conflicts and require review instead of silently averaging or guessing.

## Phase 6 — Automatic building reconstruction

Status: **partial — floor/repeat/wall/room/opening flow and conservative wall-topology cleanup are live; stairs/lifts/unit hierarchy still need full reconstruction/binding**

- Build floors, repeated floors, wall topology, rooms, openings, stairs/lifts and unit hierarchy.
- Bind reconstructed architecture to source 3D geometry.
- Keep low-confidence geometry reviewable and provenance-linked.

## Phase 7 — Reference-image visual matching

- Use the reference render as a visual target for facade zones, material families, lighting and landscape appearance.
- Never use a rendered image as dimensional truth when stronger architectural evidence exists.

## Phase 8 — Easy mouse/touch correction editor

- Direct wall/endpoint/opening/room manipulation.
- Snapping, duplicate, rotate, reshape, undo/redo and mobile-friendly touch controls.
- Numeric properties remain an advanced fallback, not the primary workflow.

## Phase 9 — Production processing and live publish

- Move heavy conversion to controlled async processors.
- Preserve immutable original sources in private object storage.
- Produce optimized web assets (including compression/streaming/LOD where appropriate).
- Keep draft, preview and immutable published release boundaries separate.
- Publish atomically and support rollback.

## Gate before real customer project creation

Phases 1–6 must be proven using the real six-file source pack, then verified again with a second unrelated building so no project-specific assumptions enter the generic engine.

Phases 7–9 then complete visual matching, easy correction and production/live delivery.
