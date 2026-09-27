# Jyoti source recovery - 23 September 2026

Historical audit. For the later elevation implementation, current validation,
and missing model asset, see [reference design status](JYOTI-REFERENCE-DESIGN.md).

This is a source-preserving correction, not acceptance of a photorealistic match.

## Verified defect

The published model v2 contains 913 meshes, each with only one material primitive,
and 19 materials. The supplied `jyoti aprtment model.fbx` contains 913 meshes;
370 use multiple materials. Flattening these arrays loses per-face material
assignments, including glazing and facade finishes.

The new converter retains all 38 referenced materials, all 242,241 triangles,
UV coordinates, hierarchy and transforms. Repeated groups sharing a material are
batched without changing triangle ownership. No coordinates are rescaled or
recentered. Source SHA-256:
`1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0`.

Bounds in original source coordinates:

| Axis | Minimum | Maximum |
| --- | ---: | ---: |
| X | 0 | 26.07216454 |
| Y | 0 | 20.85339928 |
| Z | -27.55778694 | 0 |

These are model extents, not surveyed plot dimensions. No independent physical
unit calibration is claimed.

## Viewer correction

An explicitly tagged authored-site model suppresses the generated parcel,
parking slab, road, flower strip, compound walls and gate. The source model's
own geometry stays visible. Legacy models keep their existing context. The
reference Project/Building camera approaches from negative X and positive Z,
showing the front elevation rather than the opposite corner.

## Reproduce locally

Install the repository dependencies, then run:

```powershell
node scripts/asset-pipeline/convert-source-fbx.mjs 'C:\Users\rkl\Downloads\jyoti aprtment model.fbx' local-assets/jyoti-source-preserved.glb --authored-site
```

Only use `--authored-site` after inspecting the source for its own site geometry.
The GLB and adjacent audit JSON remain ignored local assets. The browser preview
uses the local GLB and existing public project metadata. Nothing has been uploaded,
merged or deployed. The output is about 25.6 MB before transport compression.

## Reference limits still requiring authoring

- The two-page brochure contains the unit plans and areas, but its isolated and
  combined plans disagree on some dimensions (including the central duct).
- The DWG was decoded with LibreDWG 0.14 and rendered from its model space. It
  includes ground-floor and first-to-fourth architectural plan blocks alongside
  the structural first-floor sheet. Its ground outline is not the viewer's
  formerly generated rectangle. Decode warnings include unsupported custom
  objects/hatch data, so this conversion is not a certified dimensional check.
- The DRS is a resource manifest: it references 229 resource paths and 56 product
  entries. The complete D5 render package is not contained in that 18 KB file.
- The existing extracted bitmap library is restored by the viewer using material
  names. The converter does not invent missing D5 textures or vegetation assets.
- The supplied render still differs in finish placement, balcony framing,
  lighting and landscape detail. Per-material recoloring alone cannot reproduce
  it because some source materials span several architectural surfaces.
- The brochure interior reconstruction remains a reconstruction; this change
  does not certify unit-to-mesh boundaries or make every room/plot dimension exact.

## Validation

The exported GLB was independently inspected: 370 multi-primitive meshes,
38 materials and 242,241 triangles match the input audit. Browser inspection
confirmed the model loads with the authored boundary and without a second
generated compound. Type checks, both application builds and all 84 tests passed. Regression
coverage checks material triangle ownership and omission of synthetic site
features for authored-site models.
