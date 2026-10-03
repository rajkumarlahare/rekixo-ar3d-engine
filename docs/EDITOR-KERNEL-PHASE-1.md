# Editor Kernel Phase 1

Status: implementation branch
Date: 2026-10-02

This phase establishes reusable authoring boundaries inside the existing Rekixo
AR3D Engine without changing the public Building release contract, D1 schema,
R2 layout, customer URLs, or the sibling AR3D Platform.

## Goal

Move the Design Studio toward a BIM-lite direct-manipulation editor that can
support walls, rooms, hosted doors/windows, interiors and site/garden authoring
without continuing to grow `Studio.tsx` and `SceneCanvas.tsx` as monolithic
feature containers.

The current production room mapper, model viewer, local autosave, immutable
release flow and published Scene Manifest remain compatible.

## Shared editor kernel

The first reusable primitives live under:

`packages/engine-core/src/editor`

They are deliberately renderer-neutral and storage-neutral.

### Authoring document

`AuthoringDocumentV1` introduces the future semantic authoring boundary:

- Site
- Building
- Level
- Wall
- wall-hosted Opening
- Space
- placed Asset Instance
- source provenance / review state

This is additive. It does not replace the current Studio `Scene` persistence
format in Phase 1 and it is not a new public release manifest.

A door or window is modelled as a hosted opening through `wallId` plus an
offset and dimensions. This prevents future opening placement from becoming a
free-floating XYZ-only object.

### Snap engine

`resolvePlanSnap` centralizes plan snapping for:

- metric grid
- vertices/endpoints
- segment midpoints
- wall/segment edges
- bounded segment intersections

Large imported CAD graphs must later use a spatial index before reaching this
interaction layer. Intersection work is therefore bounded in the Phase 1
implementation.

The current room/polygon mapper now routes its snapping through this shared
kernel while preserving the existing 0.1 m grid, 0.24 m vertex and 0.18 m wall
edge tolerances.

### Pointer interaction

`isPointerTap` and the pointer threshold helpers provide one shared input rule
for mouse, pen and touch. Mouse remains precise while touch receives a larger
tap tolerance so small finger movement does not cancel intended placement.

The existing SceneCanvas pointer events remain in place, but tap recognition is
now delegated to the kernel. A later phase can move capture, drag and gesture
state behind the same boundary.

### Tool state

The renderer-neutral tool state already names the intended direct authoring
modes:

- select / orbit / pan
- wall
- rectangular room
- polygon room
- door
- window
- furniture
- site object
- measure

Phase 1 does not expose unfinished wall/door/site tools in the production UI.
The state contract exists first so later tools do not invent unrelated input
state machines.

### History

`SnapshotHistory<T>` owns bounded undo/redo mechanics. Studio now uses this
shared helper with the same 40-snapshot behavior that existed previously.

Phase 1 intentionally preserves whole-project snapshots. Patch/command history
is a later scalability step after more authoring operations use the kernel.

## Compatibility rules

Phase 1 must not:

- change `projects_3d.active_release_id` or immutable Building releases;
- change the Scene Manifest V2 public contract;
- change Building or Geo customer URLs;
- change Engine D1/R2 production resource identity;
- modify `rekixo-ar3d-platform`;
- silently reinterpret existing room/source evidence;
- publish new wall/door authoring entities before their persistence/compiler
  contract is explicitly introduced.

## Next implementation slice

Phase 2 should build the real 2D architectural plan editor on these boundaries:

1. wall polyline/direct wall tool;
2. endpoint/midpoint/intersection/perpendicular/angle snapping;
3. wall selection and dimension editing;
4. hosted door/window placement;
5. closed-wall topology -> derived room/space detection;
6. floor slab/ceiling generation;
7. adapters between the current Studio Scene and the new authoring document;
8. worker/spatial-index support before large CAD graphs are interactive.

The existing quick room mapper remains available as the simple path while the
wall-first Architect mode is introduced incrementally.
