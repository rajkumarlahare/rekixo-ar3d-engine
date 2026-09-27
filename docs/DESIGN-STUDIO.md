# Engine Design Studio

Design Studio is the first working authoring surface in `rekixo-ar3d-engine`.
Open `/3Dprojects/studio` on the admin app. It works with independent projects;
Jyoti Paradise is one project, not the data model for the engine.

The workspace is labelled **Rekixo 3D Design Admin**. Project slugs follow the
existing Engine route shape `/3Dprojects/[slug]`. They are unique within the
local project library, with conflicts checked in the same transaction as saving.
This does not reserve a production slug or create a public link. Imported backups
and reused designs receive fresh slugs. Existing local projects receive stable
name/ID-based slugs and retain their models, rooms and review history.

Use **Use design for new project** after saving to copy a design and its assets
into an independent project. Reviews are cleared and dimensions need review for
the new site. **Duplicate furnished floor** copies the selected room's whole floor,
including its room layouts and furniture, onto a new elevation. Copied rooms get
new identities, lose old mesh bindings and are unverified until checked. Copying
a floor does not generate a new storey inside the imported building model.

## Start and use

Use Node 22.13 or newer, run `npm install` at the repository root, then
`npm run dev:admin`. Open the URL printed by Vite with `/3Dprojects/studio`.

1. Create and name a project. Import a self-contained GLB or FBX model.
2. Add reference drawings/images. These are archived as files, not automatically
   converted into certified geometry. Download them from the source library.
3. Add floors and rectangular rooms. Enter dimensions and positions in metres,
   unit names and measurement evidence. New rooms are explicitly unverified.
4. In Building mode, click a source mesh and bind it to a selected room if useful.
   Binding records identity only; it does not align the rectangular room proxy.
5. Add furniture from the initial five-item catalog. Select it in the scene to
   edit its position, rotation and finish. Undo/redo is available for scene edits.
6. Use Interior to inspect the layout, or Walk room to look around and move with
   WASD/arrows or touch controls. Walls and oriented furniture block movement.
7. Save draft. Create a review version to freeze the scene, inspect it read-only,
   or restore that version into the draft.
8. Export backup, then click Download backup. Import that `.rekixo.json` package
   on another browser/device to create a separate project with its assets and
   review history. Imported files are checked against their SHA-256 hashes.

## Storage and isolation

Drafts, source files and review versions live in IndexedDB on the current browser
origin. Clearing browser site data removes them. A different port, browser or
device has separate storage. Keep exported backups outside browser storage.
Export captures the current draft, including unsaved scene edits.

Project IDs and asset IDs are regenerated on backup import, so importing cannot
overwrite the source project. Saving uses a single IndexedDB transaction for
project and uploaded files. Each individual file is limited to 100 MB and an
import package to 256 MB. Large models and base64 packages need substantial RAM;
use optimized self-contained GLBs for practical browser work.

Review versions are **local snapshots, not live publications or customer links**.
No production write endpoint, platform database, Super Admin screen or platform
authentication flow is changed. The old project registry remains available.

## Model and measurement boundaries

FBX import preserves its supplied geometry, but external model resources are
blocked. Pack textures into a GLB for reliable portable materials. Model scale
must be checked against a known drawing dimension. Arbitrary source models do
not receive Jyoti-specific facade modifications; that profile is gated by the
recovered source provenance.

The initial furniture catalog uses simple sized primitives. Rooms are manual
rectangular proxies, with cutaway inspection and room-bounded walking. They do
not certify wall thicknesses, as-built accuracy, stairs or door-connected routes.
DWG, SKB and D5 inputs are retained as references; CAD/BIM conversion and semantic
room extraction are not implemented in this Studio milestone.

## Next engine milestones

Authenticated Engine sessions and per-project authorization must precede cloud
draft storage, R2 uploads and public version publication. Later work can add
irregular room polygons, door connections, stairs/navigation meshes, richer
furniture assets, catalog management and customer material alternatives. See
[the product roadmap](ENGINE-PRODUCT-ROADMAP.md).

## Validation

Domain tests cover project identity, frozen review snapshots, measurement
evidence, invalid references/dimensions, rotated furniture containment and walk
collisions. Both apps retain TypeScript/build checks and the existing suite.
Browser checks exercise original Jyoti GLB loading, draft persistence, layout
editing, review versions and the room camera.

Storage tests also verify a complete model/review backup round trip, independent
imported project ownership, and rejection of corrupt or incomplete archives.
The in-app browser did not report a completed file download during verification;
the explicit Download backup link should also be checked in a standard browser.
