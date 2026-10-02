# Automatic Building Draft — Phase 2

Status: complete on the generic Engine path; licensed native CAD/SketchUp decoding remains an optional provider integration.

## Product target

A normal operator should upload the available source pack, run analysis/build, and
review exceptions instead of recreating the building manually.

Phase 2 consumes the project-neutral Source Fusion layer from Phase 1.

## Implemented

### Parametric wall graph

The Studio scene now supports explicit wall segments with:

- floor identity;
- start/end plan coordinates;
- thickness and height;
- optional linked room IDs;
- reviewed state;
- origin values: model-auto, room-derived, cad-auto, manual;
- source node identity and confidence.

High-confidence wall candidates from the selected FBX/GLB source are converted
into reviewable wall segments during Smart Draft. Existing reviewed/manual walls
are preserved across re-analysis.

Only reviewed walls are allowed into the public-safe cloud snapshot.

### Repeated-floor detection

Each detected floor receives a geometry fingerprint from source mesh names,
counts and architectural candidate dimensions. Similar floors are grouped
without using project names or source hashes.

Repeated-floor metadata is suggestion-first:

- repeatOfFloorId;
- repeatConfidence;
- repeatReviewed.

No repeated floor becomes architectural truth merely because it looks similar.

### Conservative automatic rooms

When a project has no authored rooms, Smart Draft looks for closed planar faces
in the high-confidence wall graph.

A room draft is created only when the graph contains a closed loop that passes
area/geometry safety limits. Open or ambiguous wall networks are left for visual
review instead of inventing rooms.

All generated rooms are unverified and keep source-model provenance.

### Real opening gaps

Reviewed doors/windows now cut the procedural room wall mesh. Doors remove the
wall/skirting at floor level. Windows preserve lower wall/sill and upper wall
where appropriate.

This replaces the previous marker-only visual behavior for procedural interiors.

### SketchUp material recovery

ZIP-style SKB/SKP archives are inspected using their archive directory with
strict count/size limits.

The operator can recover material image files into normal project assets with
one action. The original SketchUp source is not mutated.

Native SketchUp geometry/component semantics still require a controlled native
processor; archive inspection is not presented as full SKP decoding.

### DWG evidence

Binary DWG files are inspected conservatively for:

- DWG version header;
- readable architectural/AEC tokens;
- useful drawing text hints.

This is evidence only. It is explicitly not treated as decoded DWG geometry.

### PDF floor-plan selection

For valid PDFs with a text layer, the first bounded set of pages is inspected
for:

- floor-plan labels;
- room labels;
- dimension strings;
- area-related text.

The strongest candidate page becomes the default PDF alignment page. Operators
can still override it.

### Plan auto-orientation

After a plan reference is calibrated, Auto Position compares source-model and
reference-plan aspect ratios and chooses 0° or 90° orientation before centering.
It deliberately does not auto-scale the building from image bounds because crop
margins are not reliable dimensional evidence.

## DWG provider boundary

Editable DWG/AEC extraction remains a controlled provider boundary.

A browser-distributed GPL DWG WASM dependency is intentionally not embedded in
the commercial Engine. A production provider must satisfy licensing, isolation,
resource limits, provenance and deterministic normalized-output requirements.

The rest of Phase 2 does not depend on a specific DWG vendor. FBX/GLB geometry,
PDF evidence, SketchUp archive evidence and manual/structured review remain
usable even when a DWG provider is unavailable.

## Completion state

The generic Engine now includes:

- normalized ASCII-DXF architecture extraction;
- model-derived and CAD-derived parametric wall graphs;
- wall-to-room linking;
- conservative closed-loop room drafting;
- source conflict review;
- one-click review of high-confidence walls/repeated floors/openings;
- SketchUp archive texture recovery;
- PDF floor-plan page scoring and alignment assistance;
- six-role source-pack readiness diagnostics;
- one-click generic automatic building;
- stable browser-smoke selectors so UI wording changes do not create false CI failures.

Two integrations remain provider-dependent rather than missing generic Engine logic:

- native binary DWG/AEC entity decoding;
- native SKP component/geometry decoding when archive texture recovery is insufficient.

These require a commercial-compatible provider. They are intentionally isolated from
the generic authoring model so the Engine continues to work from FBX/GLB, DXF,
PDF, visual and metadata evidence when those providers are unavailable.

Automatic room naming is applied only when spatially trustworthy normalized
labels exist. Text-only evidence without coordinates stays review-only rather
than being guessed.
## Safety invariants

- no project/customer hash unlocks hidden geometry;
- derived facts retain source provenance and confidence;
- ambiguous geometry stays review-only;
- existing reviewed/manual authoring survives re-analysis;
- public releases contain only reviewed architectural state;
- raw source files are never mutated.
