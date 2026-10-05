# Rekixo AR3D — Final Automatic Presentation + 3D Geo Architecture

Status: product direction locked on 2026-10-05.

This document is the target architecture for new Rekixo AR3D work. It does not authorize destructive migration of production data. `jyoti-paradise` remains a locked production benchmark until an explicit retirement decision is made after V2 is proven.

## 1. Product boundary

Rekixo AR3D is an automatic premium presentation engine, not a CAD/Blender/SketchUp replacement.

The source building model is geometry authority. Supporting DWG/PDF/DRS/images may provide evidence, material recovery hints, content, or presentation references, but they must not silently reconstruct or override an already-designed building.

Target flow:

`source pack -> analyze -> derive canonical web model -> recover/tune materials -> presentation environment -> camera/lighting -> preview -> small operator overrides -> immutable Building release -> optional 3D Geo mapping -> immutable Geo release`

## 2. One Project, two Engine-owned Experiences

Every Engine Project has a Building Experience. A Geo Experience is optional and references an immutable Building release.

```text
PROJECT
  |
  +-- BUILDING EXPERIENCE (mandatory)
  |     +-- /3Dprojects/{slug}
  |
  +-- GEO 3D EXPERIENCE (optional)
        +-- /3Dprojects/{slug}/geo
```

The Geo Experience never copies ownership of the Building source pack. It pins an exact immutable Building release and may use a geo-optimized derivative of that same release.

## 3. Source authority rule

Every source pack must classify inputs into explicit roles:

- `geometry-authority`: finished 3D source used to derive the canonical Building model;
- `evidence`: CAD/floor-plan/reference data used to verify or enrich confidence;
- `material-recovery`: source/dependency data used to resolve textures/materials;
- `presentation-reference`: renders/images used for visual comparison and presentation tuning;
- `content-reference`: brochure/project/location/marketing content requiring operator approval.

Only a selected `geometry-authority` may establish Building geometry. Cross-source fusion can raise warnings or confidence, but cannot manufacture replacement architecture unless a future explicit product mode is separately approved.

## 4. Building lifecycle

```text
Source Pack
  -> Processing
  -> Canonical Model (metres)
  -> Component Mapping
  -> Realism / Materials
  -> Interactions
  -> Environment
  -> Cameras / Tour
  -> Preview
  -> Verify Draft Revision
  -> Immutable Building Release
  -> Activate / Rollback
```

A Building release is immutable. Publishing a later Building release does not automatically retarget an active Geo release.

## 5. 3D Geo lifecycle

```text
Select immutable Building release
  -> Find actual WGS84 location
  -> Optional masterplan/site overlay
  -> Geo control-point calibration
  -> Select model anchor
  -> Place rigid Building
  -> Heading / height / fine ENU alignment
  -> Geo cameras
  -> Preview
  -> Verify Geo draft revision
  -> Immutable Geo release
  -> Activate / Rollback
```

If Building v2 is published while Geo v1 references Building v1, Geo v1 remains valid and active until the operator explicitly upgrades the Geo source, previews alignment, verifies the new draft, and publishes Geo v2.

## 6. Geographic truth

Canonical geographic placement is provider-independent:

- coordinate reference system: `WGS84`;
- local fine-alignment frame: `ENU` (East/North/Up);
- model units: metres;
- orientation: heading/pitch/roll in degrees;
- scale: uniform correction only, expected to be `1.0` for a correctly normalized model.

Google/Cesium/provider pixel coordinates are never durable database truth.

## 7. Building placement is rigid

The Building is a rigid 3D object. Geo placement may translate, rotate, uniformly scale, and vertically align it. The Geo system must not apply a homography or other non-rigid warp to the Building geometry.

Masterplan imagery is different: it is a 2D ground overlay and may use control-point homography calibration.

## 8. Model anchor

Every Geo placement references an explicit local Building anchor in metres. Supported semantic anchor kinds include:

- entrance;
- main gate;
- site center;
- south-west corner;
- custom point.

The selected anchor is bound to an actual WGS84 location. Fine adjustment is then stored as metric East/North/Up offsets.

## 9. Masterplan / site calibration

The Geo Mapper may show:

- real-world base context;
- site/parcel boundary;
- masterplan overlay;
- Building model;
- roads;
- labels;
- control points.

Masterplan calibration uses normalized source-image coordinates paired with WGS84 control points. A calibration report must record at least:

- algorithm/version;
- point count;
- RMS error in metres;
- max error in metres;
- worst control point when known;
- verification status.

Publishing must fail closed when required calibration is missing or outside configured tolerance.

## 10. Height modes

Geo placement supports three explicit modes:

- `ground-clamped`: Building base follows sampled ground;
- `ground-relative`: sampled ground plus manual vertical offset;
- `absolute`: explicit geographic altitude.

Manual vertical correction remains available because road/slab levels may differ from provider terrain.

## 11. Public Geo runtime

The final public Geo page is one integrated geospatial 3D scene, not a satellite map card beside a separate model viewer.

Provider/runtime adapters may include photorealistic 3D context, terrain, satellite imagery, or a flat fallback. The Geo Experience remains valid even when photorealistic surrounding coverage is unavailable.

Runtime quality levels:

1. photorealistic surroundings + Rekixo Building;
2. terrain/satellite + Rekixo Building;
3. flat/satellite fallback + Rekixo Building.

The Building itself remains Rekixo-owned release content.

## 12. Geo-optimized derivative

A Building release may expose a `geo-optimized` GLB derivative for distant/geospatial viewing. It may reduce geometry, textures, hidden interior content, or other unnecessary detail, but must preserve:

- Building dimensions;
- anchor identity;
- placement scale;
- relevant exterior semantics;
- source-release provenance.

The Geo release references this derivative; it does not become a separate Building authority.

## 13. Admin information architecture

Target Engine Admin navigation:

```text
PROJECT
  Overview
  Source Pack
  Processing
  Model Mapper
  Realism
  Interactions
  Environment
  Camera & Tour

BUILDING
  Building Preview
  Building Publish

GEO
  3D Geo Mapper
  Geo Preview
  Geo Publish

  Project Info
  Release History
```

The operator UI should expose presentation controls, not architecture authoring tools such as Draw Wall, Create Room, Add Opening, or furniture-layout reconstruction.

## 14. Geo publish gate

Geo publish remains disabled until the required state is valid, including:

- immutable Building source release selected;
- usable source/geo-optimized model available;
- valid WGS84 position;
- explicit model anchor;
- metre-normalized model;
- heading reviewed;
- ground/height mode resolved;
- scale reviewed;
- required masterplan calibration verified;
- current Geo draft revision verified;
- desktop/mobile preview requirements passed.

## 15. Data boundaries

The long-term system keeps three explicit boundaries.

### SOURCE

Original uploads, source classification, provenance, processing evidence, canonical/derived models. Original source files remain immutable/reference-safe.

### PRESENTATION

Building materials/appearance, environment, interactions, cameras, gallery/content, plus Geo draft alignment, control points, masterplan/site overlays, and Geo cameras.

### PUBLICATION

Immutable Building release manifests/assets and immutable Geo release manifests/activation history.

## 16. Migration rule

Existing applied migrations are historical production facts and are not rewritten or deleted. Schema retirement happens only through forward migrations after all live readers/writers and production dependencies are proven absent.

Legacy `geo_placements_3d` remains compatibility state until the verified immutable Geo release runtime fully replaces every required reader. It is not the long-term V2 source of truth.

## 17. Stable Platform boundary

The existing Rekixo Platform/Super Admin plot/masterplan Geo Mapper is a proven workflow reference and remains operationally separate from the AR3D Engine migration. New Engine work must not mutate stable Platform data or behavior as a side effect.

## 18. Jyoti production lock

Until explicit retirement approval:

- do not delete `jyoti-paradise`;
- do not purge its R2 namespace;
- do not mutate its active Building or Geo release as a cleanup side effect;
- do not remove historical Jyoti migrations;
- do not treat its referenced assets as orphaned;
- do not use Jyoti as a destructive migration test fixture.

## 19. Implementation phases

1. Safety and dependency audit.
2. Final V2 contracts, including `GeoPresentationManifestV1`.
3. Additive V2 data foundation.
4. Source-pack upload and durable processing.
5. Canonical web-model + derivatives.
6. Component mapping.
7. Realism/material engine.
8. Interaction/animation engine.
9. Environment/motion.
10. Camera/tour.
11. Building public runtime.
12. Building verify/publish/rollback.
13. 3D Geo Mapper.
14. Geo verify/publish/public runtime.
15. Production hardening.
16. Dependency-proven legacy removal.
17. Jyoti retirement/clean V2 cutover only after explicit approval.

## 20. Current Phase 1 rule

Phase 1 is contract work only. It must not switch the live public Geo runtime, alter active releases, delete legacy schema, or migrate Jyoti data. Runtime/schema adoption follows later phases behind tests and explicit dependency checks.
