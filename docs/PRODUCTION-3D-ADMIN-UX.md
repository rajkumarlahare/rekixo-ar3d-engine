# Production 3D Admin UX

Phase 7 turns the separate Rekixo AR3D Engine Studio into an operations-first
workspace while preserving the existing 3D editor and the stable sibling
Rekixo AR3D Platform / Super Admin boundary.

## Workspace model

The Studio now exposes five project-scoped work areas:

1. **Overview** — selected-project health, draft/release state and production
   workflow.
2. **3D Editor** — the existing floor/room/furniture/model authoring workspace.
3. **Sources** — publish model, drawings, CAD files, brochures, reference
   images and other evidence assets.
4. **Evidence** — room-by-room measurement provenance and review status.
5. **Preview & Publish** — readiness checks, public/showcase links, explicit
   immutable publish and rollback.

The 3D WebGL editor is mounted only while the Editor workspace is active so
overview/source/release work does not keep an unnecessary render loop alive.

## Project selection

The header keeps project context visible across every workspace:

- local project search by name/slug;
- local project picker;
- authenticated cloud project picker;
- project creation available without entering the editor;
- project name and local/cloud state remain visible.

The existing cloud workspace inside the editor remains available for detailed
archive/restore and release operations.

## Publish readiness

Publish is not only a visual button state. The same readiness model is checked
again immediately before the immutable publish mutation.

Blocking conditions include:

- invalid local project structure;
- no model and no authored room content;
- missing model bytes;
- FBX selected as the final publish model instead of self-contained GLB;
- missing Engine Admin cloud session;
- no cloud draft;
- unsaved draft changes.

Warnings remain non-blocking and visible, including:

- no attached source/reference asset;
- unreviewed room measurements;
- empty project location;
- no immutable release yet.

The release action remains separate from local save and cloud draft save.

## Source intake and model processing

The Sources workspace clearly separates the selected publish model from
reference/source files.

The model card displays type, byte size and SHA-256. GLB is labeled web-ready.
FBX stays usable for Studio inspection but is blocked from final release until a
self-contained GLB is selected.

Attached source/reference files remain downloadable and project-scoped.

## Evidence review

Evidence review lists every authored room with:

- floor and unit;
- metric dimensions;
- calculated rectangular area;
- source note / attached asset / Source Pack source ID;
- Source Pack claim count where linked;
- reviewed vs unverified status.

Selecting a room opens that room directly in the 3D Editor properties workflow.

## Preview, publish and rollback

The Publish workspace surfaces:

- the complete readiness list;
- local save;
- cloud draft save;
- explicit immutable release publish;
- local review snapshot creation;
- customer public runtime link;
- published Studio showcase link when available;
- immutable release history;
- active LIVE release state;
- explicit activation of an older release with confirmation.

Rollback continues to use the Phase 5 integrity-checked activation path and
does not overwrite the mutable draft.

## Responsive behavior

The operations UI has dedicated desktop, tablet, mobile and short-landscape
rules. The operation tabs remain reachable on narrow screens, cards collapse to
single columns where required, and release actions stay usable without relying
on the desktop three-column editor layout.

## Boundary

No code, credentials, sessions, components, database tables or runtime imports
are taken from `rekixo-ar3d-platform`.

The stable Super Admin is only a product/interaction reference. All Phase 7
implementation remains inside `rekixo-ar3d-engine`.
