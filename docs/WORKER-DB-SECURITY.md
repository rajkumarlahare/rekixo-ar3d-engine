# Worker, DB and Security Hardening

Phase 6 hardens the Rekixo AR3D Engine worker/runtime boundary without changing
the stable Rekixo AR3D Platform / Super Admin.

## Admin reads

Sensitive Admin registry and project-status APIs now use the same dedicated
Engine Admin session boundary as cloud draft mutations.

Unauthenticated requests fail closed:

- HTTP 401 when Engine Admin auth is configured but no valid session exists;
- HTTP 503 when dedicated Engine Admin secrets or the cloud auth schema are not
  provisioned.

The limited Platform ↔ Engine integration contract remains separately readable
because it intentionally exposes only project identity/status, enabled scene
count and active-model availability.

## Storage ownership

All R2 model, media, draft and release accesses are checked against the selected
project slug and expected storage area.

Expected prefixes are:

```
projects/{slug}/models/
projects/{slug}/media/
projects/{slug}/draft-assets/{asset-id}
projects/{slug}/releases/{release-id}/models/
projects/{slug}/releases/{release-id}/media/
projects/{slug}/releases/{release-id}/studio/
```

Normalized path tricks, cross-project keys and mismatched immutable release keys
fail closed.

Migration `0022_worker_db_security_v1.sql` adds equivalent database-side
ownership/integrity guards for future writes.

## Runtime corruption handling

Scene settings, camera vectors and immutable release payloads are no longer
silently replaced with generic fallback JSON when database data is malformed.

The workers return an explicit HTTP 500 corruption diagnostic. Public and Admin
frontends also validate worker response shape before rendering.

This makes corruption visible instead of turning invalid data into a plausible
but incorrect 3D result.

## Model availability

The Admin project-status endpoint now supports:

- `modelLimit` — 1 to 100, default 50;
- `modelOffset` — zero-based offset.

The active model is queried and storage-checked independently before paginated
model rows are checked. Availability checks run in bounded groups of 20, so an
active model can no longer disappear simply because it is outside the first 20
rows.

## Video Range requests

MP4 project media and immutable release media support a single HTTP byte range.

Valid `Range: bytes=...` requests return HTTP 206 with `Content-Range`,
`Content-Length` and `Accept-Ranges: bytes`. Invalid or unsatisfiable ranges
return HTTP 416 with `Content-Range: bytes */{size}`.

Images and model objects keep normal full-object responses.

## Source Pack filesystem policy

Source Pack filenames must be portable relative paths:

- absolute paths are rejected;
- Windows drive paths are rejected;
- backslash paths are rejected;
- `.` / `..` traversal segments are rejected;
- NUL-containing names are rejected.

The verifier resolves the source root, checks each path component with
`lstat`, rejects symlinks anywhere below the source root, resolves the final
real path and verifies it remains contained by the source directory before
size/SHA-256 verification.

## Database constraints

Migration 0022 adds:

- unique model version per project;
- globally unique model R2 key;
- unique camera name per project;
- model/media prefix ownership checks;
- scene → model/camera same-project ownership checks;
- JSON validity checks for scene/model/camera fields;
- exact Studio draft-asset R2 ownership;
- project-slug immutability once assets/releases exist.

These constraints are additive and run only when the reviewed Engine migration
scope is intentionally applied.
