# Jyoti Paradise source profile

This directory contains metadata and provenance only. Large customer/source
binaries remain outside Git.

`source-pack.json` fingerprints the six supplied project sources and records
which questions each source is allowed to answer. The engine must not silently
promote a visual or marketing reference into dimensional truth.

## Source priority

| Capability | Priority |
| --- | --- |
| Exterior/source geometry | FBX -> decoded DWG -> SketchUp backup |
| Dimensions | decoded DWG -> brochure reference |
| Doors/windows/openings | decoded DWG -> FBX -> SketchUp backup |
| Materials | FBX -> D5 manifest -> exterior render |
| Visual look-development | exterior render -> D5 manifest -> brochure |
| Marketing/unit areas/nearby context | brochure |
| Render dependency inventory | D5 manifest |

The brochure is explicitly reference-only because it states that it is
conceptual and not a legal document. The exterior render is reference-only for
look-development. The D5 `.drs` file is metadata-only: paths listed inside it
are not treated as supplied assets until those files are separately available
and fingerprinted.

## Verification

From the repository root, with all six original files in one directory:

```powershell
node scripts/verify-source-pack.mjs project-profiles/jyoti-paradise/source-pack.json "D:\path\to\jyoti-source-pack"
```

Verification requires exact filenames, byte sizes and SHA-256 hashes. A renamed
or intentionally replaced source should be registered as a new source revision,
not silently substituted under an existing fingerprint.

## Current runtime binding

The Jyoti exterior profile reads its FBX fingerprint and source-derived
architectural floor levels from this profile. A model that does not carry the
verified FBX SHA-256 provenance cannot receive the Jyoti-specific look
development.

The Scene Manifest V2 and Source Pack V1 solve different problems:

- Source Pack V1 records *where claims came from* and source authority.
- Scene Manifest V2 records *what the authored/published 3D scene contains*.

A future cloud release should reference both versions so a published scene can
be traced back to the source revision used to author it.


## Interior evidence manifest

`interior-scene-v2.json` is the current machine-readable typical-floor
reconstruction. It replaces room rectangle literals that were previously
embedded directly in `projectExperience.ts`.

Every current room/space is deliberately `unverified`: the brochure supplies
the plan reference, while interactive placement remains reconstructed until
higher-authority DWG dimensions/openings and semantic model boundaries are
reviewed. The manifest therefore contains no authoritative openings and no room
mesh bindings. Presentation furniture remains runtime decoration and is not
source evidence.
