# Rekixo AR3D Engine Cloud Studio

Phase 4 adds an Engine-owned cloud draft path for the separate 3D Design Admin.

## Boundary

This system belongs only to `rajkumarlahare/rekixo-ar3d-engine`.

It does not reuse or modify Rekixo AR3D Platform Super Admin sessions, cookies,
credentials, D1 tables or R2 objects. The Platform remains a read-only design
reference.

Engine resources remain:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Worker: `rekixo-3d-admin`
- Admin path: `/3Dprojects`

## Authentication

Cloud writes are fail-closed. There is no default password.

The Admin Worker requires four dedicated configuration values:

- `ENGINE_ADMIN_EMAIL`
- `ENGINE_ADMIN_PASSWORD_SALT`
- `ENGINE_ADMIN_PASSWORD_HASH`
- `ENGINE_ADMIN_SESSION_SECRET`

Generate a salt/hash/session secret locally without printing the plaintext
password:

```powershell
$env:ENGINE_ADMIN_EMAIL="owner@example.com"
$env:ENGINE_ADMIN_PASSWORD="use-a-dedicated-strong-password"
node scripts/generate-engine-admin-secrets.mjs
```

Store the generated values in the `rekixo-3d-admin` Worker configuration.
Do not reuse Platform/Super Admin secrets.

Sessions are signed, HttpOnly, Secure, SameSite=Strict, scoped to
`/3Dprojects`, have an 8-hour lifetime and are revocable through the
`engine_admin_security.session_version` row. Login attempts are bounded per
IP+identifier window.

## Cloud schema

Migration `0020_engine_studio_cloud_v1.sql` creates:

- `studio_drafts_3d` — one revisioned cloud draft per Engine project;
- `studio_assets_3d` — project-owned R2 asset metadata and lifecycle state;
- `engine_admin_security` — session revocation version;
- `engine_admin_audit` — privileged mutation audit trail;
- `engine_admin_login_attempts` — bounded login throttling state.

The migration is additive. Existing public project/model/scene records are not
rewritten.

## Deployment

Normal pushes remain `admin-only`: they validate and deploy the Admin Worker
without applying D1 migrations or touching the Public Worker.

For Phase 4 infrastructure activation, run the deployment workflow manually
with `deployment_scope=admin-infra`. That scope applies Engine D1 migrations,
ensures the Engine R2 bucket exists and deploys the Admin Worker, while leaving
the Public Worker unchanged.

Use `engine-all` only when a separate reviewed change intentionally needs the
Public Worker too.

## Draft lifecycle

A local Studio project can be created and edited offline first. The first
**Save to cloud** reserves its immutable cloud project identity, uploads any
missing project-owned assets, and creates revision 1. Later saves use optimistic
revision checks; a stale browser cannot silently overwrite a newer cloud draft.

The cloud project slug is immutable after first sync because it scopes R2
ownership. Display name and location remain editable.

Opening a cloud project downloads its current draft and verifies every asset's
byte length and SHA-256 before caching it into IndexedDB. IndexedDB is therefore
an offline/local cache, not the production source of truth.

Replacing a model removes the old local asset only when no review snapshot
still references it. Cloud draft saves recalculate asset references; unreferenced
cloud objects become orphans and are deleted only after the current draft no
longer references them.

Archiving a cloud project preserves its draft and asset history. The browser can
keep an independent local copy for experimentation without mutating the archived
cloud project.

## API ownership rules

All cloud project/draft/asset APIs require the dedicated Engine Admin session.
All mutation requests additionally require same-origin browser requests.

R2 object keys are server-generated as:

```
projects/{project-slug}/draft-assets/{asset-id}
```

Client filenames never control the R2 path. Asset downloads and deletes verify
that stored keys still match the selected project's prefix.

The existing read-only Engine registry and Platform integration contract remain
separate from these private cloud APIs.
