# Rekixo AR3D Demo Launch Plan

Status: ACTIVE — LAUNCH PRIORITY
Date: 2026-10-04
Target: ship the existing building model as a polished public 3D website as quickly and safely as possible.

## Locked product direction

The immediate deliverable is **not** a universal SketchUp replacement and **not** a complete automatic building generator.

The immediate deliverable is a customer-facing Building Website where a visitor can:

- open the real project model in the browser;
- rotate, zoom and pan;
- view the building from useful presentation cameras;
- inspect floors and an exploded floor stack;
- see verified flat/project information;
- use walkthrough features where verified data exists;
- use the experience on desktop and mobile;
- open a stable public production URL.

## Source-of-truth hierarchy for the demo

1. **FBX / published GLB** — primary visual building geometry. The engine must preserve this model instead of trying to rebuild it from drawings.
2. **SKP / SKB** — material and texture recovery/support for the source model.
3. **DWG / PDF / brochure data** — verified floor, flat, room, dimension and project-information evidence. These sources support the experience; they do not replace a good existing source model.
4. **Studio semantic geometry** — correction/review data. During launch Phase 1 it must not replace the public source model.
5. **Generated geometry** — only a later fallback or explicitly reviewed enhancement, never silent visual truth for the demo.

## Hard boundary

The stable `rekixo-ar3d-platform` remains production and is not modified by this launch work.

The AR3D Engine remains isolated on its existing Engine D1/R2/Workers/routes. Plot-platform behavior, data and deployment are not launch dependencies.

## Implementation phases

### Phase 0 — Scope freeze ✅

- Stop new AutoBuild-perfection, CAD-reconstruction, universal-editor, furniture-library and Geo feature work for the demo.
- Preserve all existing engine work; do not delete it.
- Work on a launch-focused branch.

### Phase 1 — Model First 🚧

Goal: make the real existing building model the unquestioned public visual authority.

- Preserve imported FBX/GLB source geometry in the public viewer.
- Keep reviewed/reconstructed Studio geometry from replacing the source model during this phase.
- Use existing SKP/SKB recovery and FBX-to-GLB preparation for materials/textures.
- Verify model orientation, scale, framing and presentation camera.
- Do not use DWG/PDF to reconstruct a building that already exists in the source model.
- Do not show invented customer geometry if the approved model is unavailable.

Completion gate:

- The correct building loads from the published model asset.
- Exterior shape is faithful to the source.
- Materials/textures are acceptable for the demo.
- Orientation/scale/camera are correct.
- No reconstructed Studio shell replaces the source building.

### Phase 2 — Public Viewer Rescue

- Make 3D the dominant full-screen customer experience.
- Keep controls simple: Building, Floors, Flats, Walk, Info.
- Retain rotate, zoom, pan, reset, fullscreen and touch interaction.
- Remove authoring/debug concepts from the customer UI.

### Phase 3 — Presentation / Animation

- Add polished intro camera movement.
- Add guided tour presets: overview, front, corner, balcony/detail, floors.
- Stop automatic camera motion immediately when the visitor interacts.

### Phase 4 — Floor Experience

- Configure verified floor elevations.
- Support All, Ground, F1... floor selection.
- Support exploded floors and focused single-floor inspection.

### Phase 5 — Flat / Project Information

- Show verified flat number/type/area/floor-plan information from project sources.
- Show project overview, amenities and location.
- Never invent unit boundaries or measurements that are not verified.

### Phase 6 — Walk / Tour

- Enable first-person/floor walkthrough where reviewed data is reliable.
- Keep source-model inspection available even when full room semantics are incomplete.
- Desktop keyboard and mobile touch controls must both work.

### Phase 7 — Polish & Performance

- Loading/progress UI.
- Mobile responsive controls.
- Device-aware quality, shadows and pixel ratio.
- Graceful model/network/WebGL failures.
- Production performance QA.

### Phase 8 — Preview → Production

- Review the exact customer experience.
- Publish an immutable Building release.
- Deploy through existing Engine deployment workflow.
- Verify the public production URL on desktop and Android.

## Demo-ready acceptance scenario

A demo is ready when this complete flow works without manual intervention or false data:

1. Open project URL.
2. Correct existing building model loads.
3. Visitor rotates/zooms/pans the model.
4. Presentation camera/tour works.
5. Floors can be exploded and selected.
6. Verified flat/project information is available.
7. Walkthrough works where supported.
8. Fullscreen and mobile interactions work.
9. Reload/direct shared URL is stable.
10. Published release remains immutable and rollback-safe.

## Deferred until after the demo

- universal six-file AutoBuild perfection;
- CAD-only full building generation;
- complete wall/component modelling editor;
- bathroom/kitchen automatic furnishing;
- large furniture/landscape asset library;
- SketchUp-like authoring features;
- advanced Geo improvements not required by the Building Website;
- any feature that does not directly improve the customer-facing demo or launch reliability.

## Decision test for every new change

Before implementing a demo change, ask:

> Does this directly make the public Building Website more correct, more impressive, more usable or more launch-safe?

If not, defer it until after the demo ships.
