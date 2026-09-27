# AR3D Engine: reusable building and interior platform

Investigation date: 27 September 2026. This is a proposed implementation plan,
not a claim that the editor or automated modelling workflow already exists.

## Recommendation

Keep the existing Super Admin and plot platform intact. Develop the separate
Engine repository into an authoring studio plus a customer viewer, with an
asset-processing service behind them. Use Jyoti Paradise as the first end-to-end
project and a second, different building as the proof of reuse.

The customer experience is: site -> building -> floor -> flat -> room -> walk,
inspect dimensions, orbit/pan/pinch/zoom, and compare approved interior options.
The operator experience is: create draft -> collect sources -> establish scale
and rooms -> furnish -> review -> publish -> revise or roll back.

## What the code actually has

Inspected Engine main base c04e168, recovered elevation branch 1786579, and
Platform main 1c0be92. Platform inspection was read-only.

| Capability | Verified state | Next work |
| --- | --- | --- |
| Existing Super Admin/customer/plot platform | Project-scoped platform and onboarding contracts exist | Reuse existing project link |
| Platform to Engine connection | project_3d_links, verified identity endpoint, and admin redirect exist | No platform redesign needed |
| Engine project registry | D1 projects, model versions, scenes and cameras exist | Add authoring workflow and permissions |
| Engine admin | Lists projects, model availability and configured modules | Upload/editor/publish controls are not implemented |
| Engine write authorization | Admin handoff only redirects project context; admin APIs are GET-only | Authenticate Engine operators separately before enabling writes |
| Viewer | Three.js model loading, camera controls, floor/section views, day/night, room entry | Extract reusable viewer from project presentation |
| Interior | Jyoti room coordinates, furniture and labels are coded into projectExperience.ts | Store project-specific rooms and furniture as data |
| Room geometry | Some sizes from brochure, some reconstructed; whole floor is scaled to scene bounds | Calibrate and align real geometry; preserve evidence and unresolved values |
| Walkthrough | Input controls and bounding-box constraints exist | Door connectivity, collision and walkable navigation surfaces |
| Publishing | Snapshot table exists; public API reads active model/scenes | Implement an immutable release manifest and atomic version activation |

Evidence in Engine: apps/admin/src/main.tsx (read-only workspace);
workers/admin.mjs (GET-only handlers); packages/contracts/src/index.ts;
apps/public/src/viewer/projectExperience.ts (addLowRoom calls and floorScale);
apps/public/src/viewer/walkthrough.ts (bounds clamp);
workers/public.mjs; database/migrations/0001_core.sql.

Evidence in Platform: app/api/admin/3d-link/route.ts;
app/api/admin/3d-handoff/route.ts; docs/STAGE-5-PLATFORM-ENGINE-INTEGRATION.md;
REKIXO-NEW-PROJECT-WORKFLOW.md.

## Architecture and ownership

1. Existing Platform: customer accounts, commercial project records, plots,
   existing publishing, and a link to the relevant 3D project.
2. Engine Studio (apps/admin): authoring, source upload, room tagging, furniture,
   material options, camera tours, validation and release controls.
3. Engine Viewer (apps/public): customer-friendly presentation of a published
   release. Editor libraries must not enter the customer bundle.
4. Asset processor: controlled conversion/optimization jobs outside the request
   handler. Begin with reproducible local Blender/Node jobs; introduce a queued
   container runner when remote uploads and job volume justify it.

Retain the Engine's separate D1/R2 resources and existing /3Dprojects routes.
Use existing linking APIs; do not query Platform tables from Engine or copy
Platform cookies into Engine. With Super Admin unchanged, Engine operators can
use a separate authenticated Studio session. True single sign-on is a later,
explicit integration decision, not something the existing redirect provides.

## Two source workflows

### A. Customer supplies an editable 3D model

Archive original files, textures and dependencies. Validate geometry, materials,
orientation, source units, plot boundary and floor elevations. Clean and tag the
model in Blender or a suitable architectural tool, export web GLB, and attach
the room/door/unit metadata. Import into Studio for furnishing and presentation.

### B. Customer supplies only plans, measurements and reference images

Register the drawing and its unit/scale, then trace/author building, walls,
openings and rooms. Review conflicts and missing values with the source owner.
AI can suggest labels and draft traces; reviewed geometry becomes authoritative.
Do not promise that an arbitrary PDF or image can automatically produce an exact
finished 3D building. A facade image cannot establish hidden room geometry.

Start with professional external tools for complex structural authoring. Build
simple measured walls, openings, floor duplication and plan tracing into Studio
later. This delivers useful interior editing sooner than attempting to recreate
a complete CAD/BIM modeller in the first release.

FBX is a geometry input; PDF/DWG provide drawing evidence; SKB requires recovery
in a compatible SketchUp workflow before relying on it. The inspected DRS is a
resource manifest, so linked assets are a separate dependency. The image guides
appearance. Conflicting dimensions must remain visible until resolved.

## Project data contract

Use stable project-scoped IDs rather than mesh ordering or file names:

Project -> Site -> Building -> Floor -> Unit -> Room.

Each room has a polygon/boundary, floor and ceiling elevations, connected doors,
wall/window references, mesh bindings, camera entry points, and measurement
records. Measurement records include unit, source file hash, page/entity,
measurement basis (clear room size versus structural dimension), review status,
and any conflict. Unknown is distinct from zero.

Furniture instances store catalog asset ID/version, room ID, transform and
material option. Material variants and lighting presets are data. Templates
instantiate new IDs and permit floor-specific exceptions, rather than assuming
all floors have an identical plan.

Import transforms should explicitly record source units, conversion to metres,
origin/orientation and site offset. Verify known lengths before calibration is
accepted. Do not stretch the interior to fit an arbitrary bounding box while
continuing to display unscaled drawing dimensions.

Maintain IDs through glTF extras plus an external, schema-versioned scene
manifest. Reimport reconciles stable IDs and flags missing bindings; it must not
silently attach saved interiors to a different room.

## First useful Studio release

Provide a project tree and selectable 3D objects alongside properties:

- upload/reference library and processing status;
- assign building/floor/unit/room identities to imported geometry;
- scale and dimension review with source evidence;
- catalog furniture placement, move/rotate, supported sizing and snapping;
- wall/floor material changes and lighting presets;
- undo/redo, autosaved drafts and explicit saved revisions;
- save interior alternatives without modifying the approved shell;
- room entry points, camera views and guided tours;
- desktop/mobile preview and a publish checklist.

Initial catalog covers common bed, sofa, table, wardrobe, kitchen, sanitary,
lighting and plants. Keep real dimensions and license records per asset. A
customer normally views or selects allowed options; a designer edits drafts;
an operator/reviewer approves structural data and publishes. Enforce these
permissions on APIs, not only by hiding controls.

## Walkthrough and customer experience

Load a lightweight exterior first. Load detailed floors/units on demand. Display
room names and reviewed measurements tied to the same geometry the user sees.
Maintain one coordinate system between exterior, interior and floor navigation.

Walking needs a navigation surface, door-to-room connectivity and collision with
walls/obstacles. Merely constraining the camera to a bounding box does not prevent
walking through walls. Support tap-to-enter rooms, touch look, desktop mouse/
keyboard controls, reset and an accessible non-walking floor/room list.

Mobile performance should be measured on named target devices with representative
projects. Proposed acceptance target: usable movement around 30 FPS on the agreed
mid-range phone, progressive exterior loading, no context loss, and no need to
download every furnished flat before showing the building. Tune mesh/texture
budgets from measurements instead of treating a file-size ceiling as proof.

Use real-time PBR materials, environment lighting and baked lighting where
appropriate. High-quality static D5 renders remain useful references/marketing
assets; they are not automatically equivalent to an editable real-time scene.
AR/VR headset support can follow the stable browser experience and should retain
a regular browser fallback for unsupported devices.

## Source storage, processing and publishing

Separate original sources, working authoring files, generated deliverables and
release manifests. Each import records hash, size, format, source dependency list,
converter version and conversion options. Keep durable private source storage
and an independently recoverable backup; a local cache or Git code history does
not back up the 3D model. Test restoration of a full project, not only code.

Browser uploads can use short-lived, project-scoped R2 signed URLs after server
authorization, followed by server-side completion validation. Do not trust the
client's declared type, hash, size or project ownership. Restrict CORS and source
downloads appropriately. Conversion jobs should be isolated, resource-limited,
retryable and idempotent, with clear error reports and no live asset replacement
on failure.

States: draft -> processing -> needs-review -> ready -> published, with a failed
job state and recoverable retries. A release manifest pins model, textures,
room metadata, furniture and settings versions. Check that all objects exist,
then atomically switch the published release pointer. Editing a draft must not
change what current customers see. Rollback selects an earlier complete release.

## Delivery sequence and acceptance gates

| Stage | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1. Reproducible Jyoti source | Originals, archive manifest, preserved GLB and recovered exterior | Rebuild from archived source on a fresh checkout; record remaining visual/dimension differences |
| 2. One complete flat | Reviewed rooms, openings, aligned shell/interior and furnished rooms | Customer enters every room, sees matching reviewed dimensions, cannot pass through walls |
| 3. Reusable scene contract | Rooms, bindings, furniture, lights and tours as project data | Jyoti-specific coordinates leave generic runtime; reimport preserves reviewed IDs |
| 4. Studio and publication | Authenticated upload, edit/save, preview, versioned publication and restore | A designer creates a draft and publishes without a code deploy; project isolation verified |
| 5. Second project | Different building and room arrangement | New project needs assets/data, no new repository, no project-specific migration and no viewer code edit |
| 6. Advanced authoring | Plan tracing, parametric shells, reusable design packs, optional AR/VR | Add each feature against a real project need and device acceptance tests |

Implement schema and shared-room work alongside the golden flat where useful;
do not finish all of Jyoti as another hardcoded exception before generalizing.
Do not estimate a guaranteed delivery date until the first-flat geometry and
source completeness audit establish actual authoring effort.

## Current local recovery result

The original FBX became available again during this investigation. Its SHA-256
matches the September 23 source exactly:
1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0.
It regenerated local-assets/jyoti-source-preserved.glb: 25,582,856 bytes,
913 meshes, 370 multi-material meshes, 38 materials and 242,241 triangles.
The original production build of the recovered design code is now used by the
localhost preview, without the older-base override. Browser inspection showed
the exterior and returned no captured console errors. This does not certify
all dimensions or claim a photorealistic match.

All six supplied files now have an additional working copy and hash manifest in
source-assets/jyoti-paradise. This same-machine archive is not an off-device
backup. No source archive has been uploaded, and the Super Admin code and live
platform have not been changed.

## Technical references checked

- [Platform integration contract](https://github.com/rajkumarlahare/rekixo-ar3d-platform/blob/main/docs/STAGE-5-PLATFORM-ENGINE-INTEGRATION.md)
- [Engine architecture](https://github.com/rajkumarlahare/rekixo-ar3d-engine/blob/main/ARCHITECTURE.md)
- [Blender glTF export and custom properties](https://docs.blender.org/manual/en/4.4/addons/import_export/scene_gltf2.html): custom properties can be exported as extras; review supported materials rather than assuming every shader transfers.
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html): supports KTX2 loader and Meshopt decoder configuration.
- [R2 signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): operation/object-specific temporary upload access.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): informs the recommendation to keep heavy model conversion in a separate processing job.
- [WebXR compatibility](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API): device/browser support is limited, so immersive mode is an optional capability.
