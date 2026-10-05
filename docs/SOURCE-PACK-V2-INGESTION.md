# Source Pack V2 Ingestion

Status: Phase 5 integrity-verification transport. Source registration and resumable multipart upload are implemented, and an uploaded original can now be promoted to `verified` only after a server-side streaming SHA-256 check. Automatic classification, operator approval, pack sealing and processing remain later phases.

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
  -> Resumable multipart upload
  -> Finalize R2 object and exact byte count
  -> Stream R2 object through server-side SHA-256 verification
  -> Mark original verified only on an exact digest/identity match
  -> Automatic classification suggestions
  -> Operator reviews roles
  -> Select exactly one geometry authority
  -> Seal Source Pack V2
  -> Durable processing may start
```

A sealed pack is immutable. If the client later supplies corrected files, create a new source-pack version rather than rewriting source history.

## Storage boundary

Original source objects live under a server-derived project-owned namespace, separate from legacy Studio draft assets and separate from derived/published artifacts. The Source Pack V2 API never trusts a client-supplied R2 key.

Registration derives a content-addressed key from validated project/file identity. Upload uses bounded 16 MiB multipart parts with durable D1 session/part tracking, resume, completion recovery and abort behavior. Upload completion stops at `uploaded`; it cannot silently promote an original to `verified`.

The integrity route is:

```text
POST /3Dprojects/api/cloud/projects/:slug/source-files/:sourceFileId/verify
```

It is authenticated, same-origin, deletion-job aware and protected by the generic project `source-write` operational lock. It reads the completed R2 object as a stream and uses Cloudflare `crypto.DigestStream("SHA-256")`; the full original is not buffered into Worker memory.

## Integrity requirements

A file can become `verified` only when all of the following match the durable registration:

- the source is already in `uploaded` state;
- R2 object byte size matches `byte_size`;
- R2 custom metadata matches project ID, source-file ID and registered SHA-256;
- current R2 ETag matches the ETag recorded at multipart finalization;
- the server-computed streaming SHA-256 exactly matches the registered SHA-256.

A deterministic identity/checksum mismatch moves the source to `failed` and records an audit event. Transient R2/runtime read failures leave it `uploaded` so verification can be retried safely. A successful verification records `source.verified` in the admin audit log. Replaying verification for an already verified source is idempotent.

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

Phase 5 does not:

- change `studio_assets_3d` or the legacy 64 MB Studio upload endpoint;
- classify a source as geometry authority automatically;
- seal or publish a Source Pack;
- mutate an active Building/Geo release;
- change the stable Platform/Super Admin;
- mutate or purge Jyoti production assets.
