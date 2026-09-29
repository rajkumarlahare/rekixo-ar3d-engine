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
9. Export Scene Manifest to produce the versioned `rekixo-scene-manifest` V2
   interchange contract. It contains hierarchy, geometry metadata, evidence,
   bindings and asset hashes, but not the asset bytes themselves.

## Storage and isolation

IndexedDB remains the browser cache/offline workspace. Authenticated Engine
projects can also save revision-checked cloud drafts and project-scoped assets to
the isolated Engine D1/R2 resources. A cloud revision conflict fails closed and
must be reloaded before another save; editing a draft never mutates the active
customer release.

Project IDs and asset IDs are regenerated on backup import, so importing cannot
overwrite the source project. Local saves use one IndexedDB transaction for the
project and uploaded files. Individual Studio assets are limited to **64 MB** so a
file accepted locally is also eligible for the current Engine Cloud upload path;
an import package is limited to 256 MB. Large production models should be
optimized/self-contained GLBs rather than relying on the browser cache as an
archive.

Review versions are authoring snapshots. **Publish release** creates a separate,
immutable release manifest with frozen model/Studio assets and an atomic active
release pointer; rollback activates an earlier complete release. The public
Studio snapshot is allowlisted and excludes operator brief/reference layers,
source-evidence IDs, model-node review metadata and unreviewed openings. Scene
Manifest V2 remains the metadata interchange contract. The sibling Platform
database, Super Admin and production resources remain isolated.

## Model and measurement boundaries

FBX import preserves its supplied geometry, but external model resources are
blocked. Pack textures into a GLB for reliable portable materials. Model scale
must be checked against a known drawing dimension. Arbitrary source models do
not receive Jyoti-specific facade modifications; that profile is gated by the
recovered source provenance.

The initial furniture catalog still uses simple sized primitives. Rooms can be
rectangular or mouse-drawn polygons; reviewed shared doors can connect room
walkthroughs. Smart floor/wall/door/window detection is **suggestion-first**:
uncertain geometry stays in review and copied designs lose project-specific
evidence, mesh bindings and reviewed-opening approval before reuse. These tools
do not certify wall thicknesses, as-built accuracy or hidden geometry.

ASCII DXF can provide named-layer hints; binary DWG, SKB/SKP and D5/DRS remain
source evidence unless converted/recovered by a compatible authoring pipeline.
The Studio must not invent CAD/BIM semantics merely because a source file exists.

## Next engine milestones

The current priority is hardening rather than adding another large feature:
split the Studio/Canvas/Viewer monoliths behind stable controllers, add browser
E2E coverage for create → analyze → map → save → publish → walk, move heavy source
analysis off the UI thread, render reviewed wall openings as real visual gaps,
and introduce content-addressed/compressed production assets. See
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
