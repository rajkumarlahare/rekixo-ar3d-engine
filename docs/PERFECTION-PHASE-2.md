# Rekixo AR3D Perfection Phase 2 — Deep Source Intelligence

Status: implementation slice active on `phase2-deep-source-intelligence`.

This roadmap name is intentionally **Perfection Phase 2**. It is separate from the older internal `phase2CadFusion` module and historical engine phase numbering.

## Goal

Turn an attached project source pack into explicit, reviewable evidence before Rekixo changes geometry. The operator should not have to decide manually which PDF page, CAD drawing, render, SketchUp archive, or metadata file is useful. Rekixo should classify the evidence automatically, but it must not invent missing measurements or silently choose between equally authoritative sources.

## Source authority policy

Authority is domain-specific rather than global:

- normalized DWG/DXF is strongest for metric geometry, dimensions, walls and openings;
- the selected FBX/GLB is strong 3D geometry evidence and remains useful when CAD geometry is unavailable;
- structured CSV/TSV is strong room/dimension evidence;
- PDF floor plans corroborate floor identity, rooms and dimensions but are not promoted above decoded CAD metric geometry;
- SketchUp/SKB is strongest for recovered material evidence and useful semantic metadata;
- DRS/JSON is metadata/dependency evidence only;
- JPG/PNG/WebP/TIFF visual references can drive facade/interior/site appearance, never metric dimensions.

Ties at the strongest authority score stay in `review`. Rekixo does not pick a source by upload order, page number or filename sequence.

## Implemented in this slice

### 2.1 Multi-PDF page intelligence

Every attached PDF is inspected page-by-page. Pages are classified as:

- floor plan
- site plan
- elevation
- section
- schedule
- brochure
- unknown

Classification uses existing PDF text-layer, room-label, dimension, spatial-label and embedded-image evidence. The report retains every page instead of collapsing a multi-PDF pack to one arbitrary PDF.

### 2.2 Explicit floor-role inference

CAD and PDF evidence can resolve explicit basement, ground, ordinal/numeric floor labels and bounded floor ranges such as `1st to 3rd floor`. A range remains multi-floor evidence. If no explicit floor identity exists, the source stays ambiguous.

No floor is inferred from attachment order, page order, file order, or a guessed sequence.

### 2.3 CAD intelligence

Every normalized DWG/DXF audit reports:

- geometry readiness;
- semantic readiness;
- explicit floor identity;
- wall segment count;
- door/window segment count;
- text-label count;
- confidence based on decoded evidence.

If two normalized CAD sources explicitly claim the same floor, that becomes a review conflict rather than a silent geometry winner.

### 2.4 Visual reference roles

Raster references are classified conservatively into facade, exterior, interior, site, generated/plan reference, or unknown. All visual-reference rows carry `metricAuthority: false`.

This is a guardrail: a beautiful render can affect style later, but it cannot override dimensions from CAD/model evidence.

### 2.5 DRS metadata intelligence

DRS inspection reports readable metadata, dependency counts, dependent products, room-center hints, material-resource hints and model-resource hints. Room centers remain non-authoritative hints; dependency paths do not become geometry.

### 2.6 Evidence authority matrix

The report produces a decision for each evidence domain:

- metric geometry
- dimensions
- floor identity
- room semantics
- openings
- materials
- visual style
- metadata

Each decision includes ranked source candidates, the selected source when a unique strongest source exists, or `review` when the strongest authority is tied.

### 2.7 Conflict matrix

Perfection Phase 2 now exposes explicit conflicts for cases including:

- multiple normalized CAD sources claiming the same floor;
- similarly strong PDF plan pages claiming the same floor;
- tied strongest authority for an evidence domain.

Review conflicts feed the shared AutoBuild issue stream, so certification can see unresolved source ambiguity.

### 2.8 AutoBuild integration

`AutoBuildPipelineResult` now includes `sourceIntelligence`. The normal summary reports classified PDF pages, resolved floor roles, authority reviews and source conflicts. This pass is non-destructive: it classifies and arbitrates evidence but does not rewrite otherwise-valid walls/rooms merely because a new evidence candidate exists.

## Fail-closed rules

1. Never infer a floor from page/file order.
2. Never use a raster render as metric truth.
3. Never convert DRS room centers into authoritative geometry.
4. Never silently break a top-authority tie.
5. Never replace existing CAD/model reconstruction only because weak PDF/image evidence disagrees.
6. Preserve existing AutoBuild, geometry-integrity, deterministic replay and publish-gate behavior from Perfection Phase 1.

## Remaining Phase 2 depth

This slice establishes the reusable evidence/arbitration layer. Follow-up depth can safely build on it for richer CAD block semantics, PDF architectural symbols, source-registration corroboration across several drawings, and native SketchUp component geometry. Those additions must continue using the same fail-closed authority rules rather than creating project-specific heuristics.

## Acceptance

Perfection Phase 2 is acceptable when:

- several PDFs can be attached without a blanket “pick one PDF” assumption;
- floor roles are resolved only from explicit evidence;
- CAD/PDF/visual/metadata roles are visible in one machine-readable report;
- visual references are guaranteed non-metric;
- authority ties and duplicate floor claims are reviewable;
- AutoBuild returns the report and includes its unresolved review conflicts in certification issues;
- normal `npm test` remains green.
