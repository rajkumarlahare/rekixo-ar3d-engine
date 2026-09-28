# Immutable Releases V1

Status: Phase 5 implementation

## Purpose

The Rekixo AR3D Engine now separates mutable authoring state from immutable
public releases.

A cloud Studio draft can keep changing without changing the customer-facing
project. Public state changes only when an authenticated Engine Admin explicitly
publishes a release or activates an older release.

The stable Rekixo AR3D Platform / Super Admin remains outside this release
system and is not modified by it.

## Release boundary

A release freezes:

- project identity and public metadata;
- enabled public scenes and their settings;
- default camera;
- active model;
- project media referenced by public scenes/project metadata;
- optional Studio draft snapshot;
- all Studio assets referenced by that snapshot;
- Source Pack source/claim IDs carried by Studio room evidence.

The release manifest is hashed with SHA-256 before it becomes active.

## Storage

Mutable assets continue to live in their existing draft/runtime locations.

Published release assets are copied to immutable, release-specific R2 keys:

```
projects/{slug}/releases/{release-id}/models/{logical-id}
projects/{slug}/releases/{release-id}/media/{file-name}
projects/{slug}/releases/{release-id}/studio/{asset-id}
```

The release ID is part of the key. Two concurrent publish attempts therefore
cannot share a release object key even if they compute the same next numeric
version.

## Database

Migration `0021_immutable_release_v1.sql` adds:

- `projects_3d.active_release_id`;
- `releases_3d`;
- `release_assets_3d`;
- `release_activations_3d`.

Ownership triggers prevent a project from activating another project's release
and prevent cross-project release assets/activation records.

## Publish

Publishing is a distinct operation from **Save to cloud**.

The publisher:

1. reads the current Engine project/runtime plus the current cloud draft;
2. checks the expected cloud draft revision;
3. copies referenced model/media/Studio assets into release-specific R2 keys;
4. builds and hashes the release manifest;
5. inserts release metadata/assets and flips `active_release_id` in one D1
   batch;
6. records activation and Engine Admin audit rows.

If asset copy or the D1 batch fails, newly created release objects are cleaned
up and the previous active release remains selected.

## Public runtime

If a published project has an active immutable release, the Public Worker reads
that release manifest and never reconstructs the customer experience from the
current mutable scene/model rows.

A corrupted active release fails closed with a diagnostic response. It does not
silently fall back to mutable current tables.

Projects that have not yet received their first immutable release remain on the
legacy production read path for compatibility. This provides a controlled
migration rather than changing all existing customers at once.

Legacy model/media URLs also pin to the active release once one exists. The
mutable legacy objects are no longer advertised as immutable-cache content.

## Rollback

Rollback is implemented as activation of an existing immutable release.

Before the pointer changes, the Engine verifies:

- release ownership;
- release manifest SHA-256;
- manifest project/release identity;
- release asset metadata count and logical IDs;
- R2 object presence and byte size;
- SHA metadata consistency where present.

Only after those checks pass is `active_release_id` changed. The cloud draft
is not modified by rollback.

## Published Showcase

The Design Admin Published Showcase now prefers the active immutable release's
Studio snapshot. Every downloaded Studio asset is size- and SHA-256-verified.

Repository-static `/published/*` snapshots remain only as a compatibility
fallback for projects that have not yet migrated to an immutable release.

## Activation / deployment

Normal pushes remain Admin-only and do not apply migrations or deploy the
Public Worker.

The immutable schema can be installed through the reviewed Engine
`admin-infra` deployment scope without touching the Public Worker.

Public cutover for a project occurs only after:

1. dedicated Engine Admin auth is active;
2. migrations 0020 and 0021 are installed;
3. a reviewed immutable release is explicitly published;
4. the Public Worker version containing Release V1 is intentionally deployed.

This sequence keeps current production projects stable during migration.
