# Jyoti Paradise reference design

**Recovery update, 27 September:** The original FBX is available again and its
hash matches. The GLB was regenerated at 25,582,856 bytes, and the localhost
preview uses it with the recovered original design code. The missing-asset
section below records the earlier recovery state, not the current local state.
See [Engine roadmap](ENGINE-PRODUCT-ROADMAP.md) for the current audit.

## Engine and first project

Rekixo AR3D Engine provides reusable loading, rendering, navigation, floor controls,
and project discovery for multiple products and projects. Jyoti Paradise is its
first reference project. Its elevation profile is deliberately gated to the SHA-256
of its source model; other projects retain the generic engine behavior.

## Recovered implementation

The local preview implementation was recovered from this task's saved edit
history on 27 September 2026. It includes alternating balcony frames, clear
railings, corner fins, timber soffits, window surrounds, central glazing,
LED strips and downlights, shutters, brick boundary finishes, planting, and sky.
Original source geometry is retained; added decorative geometry and landscape
are reference-image reconstructions, not surveyed dimensions.

Source floor elevations drive selection and exploded-floor grouping rather than
dividing the whole site bounding box into equal sections. Source-tagged site
models suppress the generic generated compound to avoid duplicate boundaries.

## Required asset: not recovered

The previously converted `local-assets/jyoti-source-preserved.glb` (about 25.6 MB)
and the original FBX are absent from the current filesystem. The port 5175 preview
server is also no longer running. The GitHub code alone does **not** replace the
older published model or reproduce the finished preview with that older asset.

Recover the original FBX with SHA-256
`1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0`
and run:

```powershell
node scripts/asset-pipeline/convert-source-fbx.mjs '<path-to-original.fbx>' local-assets/jyoti-source-preserved.glb --authored-site
```

The converter preserves source material groups and writes the provenance metadata
required by the profile. Do not attach that provenance to the old published GLB:
its per-face material assignments were lost. After recovering and validating the
asset, publish it through the existing project asset pipeline and update the
project model reference. Binary source assets remain outside Git per repository
policy. No production asset, project record, or deployment is changed by this PR.

## Validation on 27 September 2026

- Public and admin TypeScript checks passed.
- Public and admin production builds passed.
- All 86 Node tests passed, including source material preservation and elevation
  profile checks. The public build retains a bundle-size warning.
- The recovered public bundle filename matches the last successful local build,
  `index-CklB9KcB.js`. A fresh visual check requires the missing source model.

The earlier [source audit](JYOTI-SOURCE-RECOVERY.md) records the original inspection
and conversion results; its validation predates this recovery.
