# Source Pack V2 Ingestion

Status: Phase 3 foundation. This document defines the new source-ingestion boundary; it does not switch the live Studio upload UI yet.

## Why V2 exists

The old Studio asset path is editor-oriented and accepts individual assets with a 64 MB request limit. It is retained for compatibility while the new Automatic Presentation Engine gets a dedicated source-pack pipeline.

Source Pack V2 treats client originals as immutable source evidence and makes one explicit geometry-authority decision. Other supplied files may recover materials/textures, verify dimensions/content, or guide presentation, but they do not silently rebuild the Building.

## Roles

A file may have one or more supporting roles, but exactly one file in a pack must have `geometry-authority`.

- `geometry-authority` — the finished source model that establishes Building geometry.
- `material-recovery` — backups/dependencies useful for recovering materials/textures.
- `evidence` — CAD/plans/metadata used for verification and confidence.
- `presentation-reference` — exterior renders/photos used for visual presentation matching.
- `content-reference` — brochure/project/location/marketing content requiring operator review.

Automatic classification is a suggestion with confidence. The operator can correct roles before approving the pack.

## Lifecycle

```text
New Project
  -> Register source files
  -> Resumable upload
  -> Verify byte count + SHA-256
  -> Automatic classification suggestions
  -> Operator reviews roles
  -> Select exactly one geometry authority
  -> Seal Source Pack V2
  -> Durable processing may start
```

A sealed pack is immutable. If the client later supplies corrected files, create a new source-pack version rather than rewriting source history.

## Storage boundary

Dedicated source objects will live under a project-owned source namespace, separate from legacy Studio draft assets and separate from derived/published artifacts.

The exact key builder and upload API are implemented in a later Phase 3 change together with R2 multipart/resume/abort behavior. Database tables added in this phase only prepare durable state for those operations.

No API should trust a client-supplied R2 key. The server derives the key from validated project/file identity and checks project isolation before read/write/delete.

## Integrity requirements

A file can become `verified` only after final object length/checksum validation. Once verified, its filename/media type/size/SHA/storage key cannot be changed in place.

A Source Pack can become `ready` only after:

- all required files are verified;
- exactly one geometry authority is selected;
- that authority is a verified file from the same project and pack;
- roles/capabilities are valid Source Pack V2 values;
- the operator approves the decision;
- the sealed manifest and SHA-256 are stored.

`ready` and `superseded` packs keep immutable file-role mappings and authority/content identity.

## Current sample mapping

For the supplied Jyoti-style source pack, the expected starting classification is:

- FBX -> `geometry-authority`;
- SKB -> `material-recovery` + `evidence`;
- DWG -> `evidence`;
- DRS -> `material-recovery` + `evidence`;
- exterior render -> `presentation-reference`;
- brochure/floor-plan PDF -> `content-reference` + `evidence`.

This is a classification policy, not permission to alter Jyoti production data.

## Compatibility

Phase 3 foundation does not:

- change `studio_assets_3d`;
- change the existing 64 MB legacy Studio upload endpoint;
- deploy or start multipart uploads;
- mutate active Building/Geo releases;
- change the stable Platform/Super Admin;
- mutate or purge Jyoti production assets.
