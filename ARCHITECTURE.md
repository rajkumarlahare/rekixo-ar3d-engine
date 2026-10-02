# Rekixo AR3D Engine Architecture Contract

Status: **LOCKED**
Date: 2026-10-02

This file is the source of truth for the Rekixo AR3D Engine architecture. Future patches must preserve these boundaries unless the owner explicitly changes them.

## 1. Rekixo AR3D product-family boundary

The following existing production surfaces must remain unchanged by 3D development:

- Sibling platform repository: `rajkumarlahare/rekixo-ar3d-platform` (historical name: `rajkumarlahare/tiyansh-prime-square`)
- Super Admin: `https://admin.rekixo.com/admin`
- Existing public projects: `https://ar3dstudio.in/projects/*`
- Existing D1 database: `tiyansh-production`
- Existing R2 bucket: `tiyansh-gallery-production`
- Existing Cloudflare Workers and current deployment workflow
- Existing plot mapper, project mapper, road access, side mapping, pricing, plot status, project gallery, client admin, and public project runtime

The Platform and Engine are parts of the same Rekixo AR3D product family, but their production runtime resources stay isolated. No 3D dependency, schema migration, asset, route, or deployment step may be added to the Platform merely to support this engine.

## 2. New 3D system identity

Repository:

`rajkumarlahare/rekixo-ar3d-engine`

Historical repository name: `rajkumarlahare/rekixo-3d-engine`. The rename is source identity only; Cloudflare resource names remain unchanged.

Admin surface:

`https://admin.rekixo.com/3Dprojects`

Public surface:

`https://ar3dstudio.in/3Dprojects/[slug]`

Existing production compatibility fixture:

`https://ar3dstudio.in/3Dprojects/jyoti-paradise`

The Engine has no runtime default project. Public project identity comes only from `/3Dprojects/[slug]`; Admin project identity comes from the D1 project registry and explicit selection.

The exact path segment is `3Dprojects` with an uppercase `D`.

## 3. Separate production resources

The 3D engine uses its own Cloudflare resources:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`

The admin and public Workers may share the new 3D D1/R2 resources, but they must never bind to the existing Tiyansh production D1/R2 resources.

## 4. Bundle isolation

The admin and public experiences are separate applications.

`apps/admin`
- project management
- model upload/replace controls
- scene builder
- camera preset editor
- floor/unit editor
- hotspot editor
- media manager
- preview/publish controls

`apps/public`
- customer-facing project viewer
- 3D navigation
- scene transitions
- floor/unit browsing
- balcony/section/amenity experiences
- mobile fallbacks

Heavy editor-only code must not ship in the public bundle.

## 5. Route isolation

All new browser assets and APIs must remain under the `3Dprojects` prefix so the route can be delegated without taking over the whole host.

Admin examples:

- `/3Dprojects`
- `/3Dprojects/projects/jyoti-paradise`
- `/3Dprojects/api/projects`
- `/3Dprojects/assets/*`

Public examples:

- `/3Dprojects/jyoti-paradise`
- `/3Dprojects/api/public/jyoti-paradise`
- `/3Dprojects/assets/*`

No host-wide wildcard takeover is allowed.

### 5.1 Canonical customer URL contract

The Building Experience is the canonical/default customer deliverable:

`https://ar3dstudio.in/3Dprojects/[slug]`

An optional Geo Experience for the same project uses the nested route:

`https://ar3dstudio.in/3Dprojects/[slug]/geo`

The exact `3Dprojects` path segment remains case-sensitive with an uppercase `D`.
Existing Building URLs must not be renamed when optional experiences are added.
Custom domains may alias an experience later, but they do not replace the Engine
project slug as canonical identity.

### 5.2 Project versus Experience boundary

A **Project** is the Engine-owned customer/job container. A customer-facing
**Experience** is a sellable/public deliverable produced from that project.

Phase 1 locks two experience identities:

- `building` — default standalone 3D Building Website;
- `geo` — optional add-on that places a selected immutable Building release in
  geographic context.

The Building Experience does **not** require Geo. A project may finish and remain
fully valid with only the Building Experience live.

The Geo Experience must reference a specific immutable Building release. It must
not create a second customer project, duplicate the Building authoring draft, or
silently follow a newer Building release. A future Geo release lifecycle may
advance only after explicit preview/verification.

The existing `releases_3d`, `release_assets_3d`,
`release_activations_3d`, and `projects_3d.active_release_id` remain the
Building release system. Phase 1 does not rename or rewrite them.

### 5.3 Platform no-touch rule

`rekixo-ar3d-platform` is stable and outside this Engine refactor. No phase of
the Experience architecture may require a Platform code change, schema change,
R2 change, Worker change, route change, or deployment change. Existing Engine
compatibility/integration reads may remain for backward compatibility, but new
Building/Geo product behavior must be implemented entirely inside Engine-owned
code and Engine-owned production resources.

## 6. Data model direction

The 3D database is project-scoped. Planned entities:

- `projects_3d`
- `models_3d`
- `scenes_3d`
- `camera_presets_3d`
- `floors_3d`
- `units_3d`
- `hotspots_3d`
- `media_3d`
- `publish_versions_3d`

Each row that belongs to a project must be keyed by the 3D project ID. No customer project may be encoded as a generic runtime default.

New customer projects are provisioned as draft D1 records through the controlled operator workflow. Customer onboarding is data provisioning, not a new repository and not a new schema migration.

## 7. Asset policy

Raw architectural/source assets must not be committed to GitHub:

- FBX
- MAX
- DWG
- SKP / SKB
- DRS
- GLB / glTF production models
- large texture packs
- rendered videos/panoramas

Source files stay in controlled working/archive storage. Web-ready production assets are uploaded to the dedicated `rekixo-3d-assets` R2 bucket.

Preferred web pipeline:

`FBX/SKP -> Blender cleanup -> GLB -> Meshopt/Draco where appropriate -> KTX2/compressed textures -> R2`

Large projects should be split by scene/module rather than loaded as one giant model.

## 8. Generalized Engine boundary

Stage 4 establishes these reusable seams:

- `packages/contracts` for transport/domain types;
- `packages/engine-core` for project slug, path and asset-key rules;
- D1-backed Admin project registry and explicit project selection;
- path-derived public project selection;
- project-neutral viewer/camera fallbacks;
- controlled draft-project provisioning outside migration history.

Jyoti Paradise remains an existing production compatibility fixture and retains its current data, URL and assets. It is not a default in generic runtime code.

## 9. Deployment rule

The Engine repository has its own CI/CD workflow. Deploying the AR3D Engine must not trigger or modify deployment of the sibling `rekixo-ar3d-platform` application.

Production routing is configured only after the new Workers, D1, and R2 resources exist and have been verified independently.

## 10. Stage 5 integration boundary

Platform ↔ Engine integration must use an explicit linking/service contract. The Platform must not read Engine model/scene tables directly, and the Engine must not read Platform project/plot tables directly.

Privileged Engine writes require authenticated handoff before upload/edit/publish APIs are enabled.

## 11. Change-control rule

Any patch that would couple the Engine to the AR3D Platform D1/R2 resources, `/admin` surface, or `/projects/*` route must stop and require an explicit architecture decision first.


## 12. Platform integration contract v1

The sibling Platform may validate Engine project identity through the read-only endpoint:

`/3Dprojects/api/integration/projects/[slug]`

This endpoint is deliberately narrow and versioned. It is not a shared database gateway and must not become a privileged mutation surface.

The Platform owns link metadata. The Engine owns 3D project/model/scene/camera/asset data. Neither repository directly queries the other's D1 database.

Stage 5 admin handoff transfers selected-project context only. No Platform password, cookie or session secret is accepted by the Engine. Privileged Engine write APIs remain disabled until a dedicated authenticated authorization layer is introduced.
