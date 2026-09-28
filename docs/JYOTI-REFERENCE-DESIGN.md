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

## Canonical source pack

The supplied source set is now fingerprinted in
`project-profiles/jyoti-paradise/source-pack.json`. It records the recovered FBX,
architectural DWG, SketchUp backup, D5 resource manifest, brochure PDF and exterior
render by byte size and SHA-256, together with source authority and claim
precedence.

The runtime exterior profile no longer owns a duplicated literal source hash or
floor-level list. Those values are read through `jyotiSourceProfile.ts` from the
canonical source pack. The FBX remains the exact source revision required for the
Jyoti look-development profile.

To verify a local source directory before conversion:

```powershell
node scripts/verify-source-pack.mjs project-profiles/jyoti-paradise/source-pack.json '<source-directory>'
node scripts/asset-pipeline/convert-source-fbx.mjs '<source-directory>\\jyoti aprtment model.fbx' local-assets/jyoti-source-preserved.glb --authored-site
```

Binary source assets remain outside Git. Verification proves exact file identity;
it does not convert a brochure/render into certified dimensional evidence and it
does not resolve conflicts between sources.

## Validation on 27 September 2026

- Public and admin TypeScript checks passed.
- Public and admin production builds passed.
- All 86 Node tests passed, including source material preservation and elevation
  profile checks. The public build retains a bundle-size warning.
- The recovered public bundle filename matches the last successful local build,
  `index-CklB9KcB.js`. A fresh visual check requires the missing source model.

The earlier [source audit](JYOTI-SOURCE-RECOVERY.md) records the original inspection
and conversion results; its validation predates this recovery.
