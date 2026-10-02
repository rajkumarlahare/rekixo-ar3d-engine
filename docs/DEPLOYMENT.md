# Rekixo AR3D Engine Deployment

Deployment is GitHub-Actions-first. Existing D1, R2, Worker and route names are stable production identifiers and must not be renamed during Engine hardening.

## Production resources

Only isolated Engine resources are deployment targets:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- R2 binding: `MODEL_ASSETS`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`

The sibling AR3D Platform resources `tiyansh-production`, `tiyansh-gallery-production`, `/admin`, and `/projects/*` are not Engine deployment targets.

## Production routes

Admin:

- `https://admin.rekixo.com/3Dprojects`
- `https://admin.rekixo.com/3Dprojects/*`

Public:

- `https://ar3dstudio.in/3Dprojects`
- `https://ar3dstudio.in/3Dprojects/*`

These are path-specific Worker routes. There is no host-wide takeover.

## Automatic deployment on push to main

The production workflow is serialized with `cancel-in-progress: false`.

Every push to `main`:

1. checks out the repository;
2. uses Node.js 22;
3. installs dependencies;
4. runs `npm test` (typecheck, Admin/Public builds and Node regression tests);
5. installs Playwright Chromium and runs the browser E2E smoke;
6. verifies the Cloudflare deployment token and required Engine Admin secret names;
7. applies D1 migrations only when migration files changed;
8. prepares published designs and verifies model checksums;
9. rebuilds/uploads Geo derivatives only when the public-runtime change detector requires it;
10. deploys the isolated Admin Worker;
11. verifies invalid-login behavior and Engine Admin cloud readiness;
12. deploys the Public Worker only when public runtime/dependency inputs changed;
13. verifies the deployed Admin bundle, protected Admin reads and the empty-safe production shell.

Wrangler is pinned to `4.146.0` in production/provision workflows. Do not replace it with a floating major version without a reviewed upgrade.

## Manual deployment scopes

`workflow_dispatch` exposes three scopes:

- `admin-only` — safe default; validates and deploys the Admin Worker without infrastructure/public deployment.
- `admin-infra` — applies Engine D1 migrations, ensures the isolated R2 bucket exists, then deploys Admin.
- `engine-all` — applies infrastructure changes and deploys both Admin and Public, including Geo derivative preparation/upload.

## New project provisioning

Normal customer projects are data, not schema migrations.

Use the manual workflow `Provision Rekixo AR3D Project` with:

- `slug` — lowercase letters/numbers/hyphens;
- `name` — display name;
- `location` — optional.

The workflow renders validated SQL and writes a draft project row to isolated Engine D1. Re-running the same slug does not overwrite an existing project. Wrangler is pinned to the same reviewed production version.

The authenticated Engine dashboard can also create projects through the Engine-owned cloud contract. No project creation path may touch Platform D1/R2.

## Secrets and Admin security

The repository requires `CLOUDFLARE_API_TOKEN` with the existing Engine D1/R2/Workers permissions.

Engine Admin authentication uses dedicated Engine-only values:

- `ENGINE_ADMIN_EMAIL`
- `ENGINE_ADMIN_PASSWORD_SALT`
- `ENGINE_ADMIN_PASSWORD_HASH`
- `ENGINE_ADMIN_SESSION_SECRET`

Do not reuse Platform credentials, cookies or sessions.

Privileged Engine reads/writes require the dedicated Engine Admin session. Mutations additionally require same-origin validation and project-scoped ownership checks.

## Change-control rules

- Do not rename the production D1/R2/Worker resources merely to match repository naming.
- Do not rewrite already-applied migrations.
- Keep raw CAD/FBX/SKP/MAX source assets outside Git.
- Do not deploy a customer-specific default/fallback into generic Engine behavior.
- Building and optional Geo release pointers remain independent.
- Public/runtime changes must pass the repository regression and browser gates before production deployment.

See `docs/PHASE-8-CLOSEOUT.md` for the remaining hardening phases.
