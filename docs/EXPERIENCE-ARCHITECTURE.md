# Rekixo AR3D Engine Experience Architecture

Status: **LOCKED FOR IMPLEMENTATION**
Date: 2026-10-02

This document defines the customer-deliverable model for the Rekixo AR3D Engine.
It applies only to `rajkumarlahare/rekixo-ar3d-engine`.

## Non-negotiable boundary

The stable `rekixo-ar3d-platform` is out of scope. This work must not modify or
depend on Platform code, database schema, R2 storage, Workers, routes, deployment,
or admin behavior.

Engine-owned production resources remain:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`

## Canonical URLs

Building is the default standalone customer product:

`https://ar3dstudio.in/3Dprojects/[project-slug]`

Geo is an optional add-on for the same project:

`https://ar3dstudio.in/3Dprojects/[project-slug]/geo`

The exact route segment is `3Dprojects` with an uppercase `D`. Project slugs
remain lowercase kebab-case and are the canonical Engine identity even when a
custom domain is added later.

## Product model

A **Project** is the customer/job container.

An **Experience** is a customer-facing deliverable produced from that Project.

### Building Experience

The Building Experience is always the primary/default deliverable. Its authoring
flow is:

`Project -> Design Studio -> Cloud Draft -> Review -> Immutable Building Release -> Building Live`

A Building project is complete without Geo.

The existing immutable release system remains the Building release system:

- `releases_3d`
- `release_assets_3d`
- `release_activations_3d`
- `projects_3d.active_release_id`

These production tables are not renamed or rewritten.

### Geo Experience

Geo is created only when the customer orders the add-on.

The Geo Experience references one specific immutable Building release. It must not
clone the Building project or authoring draft.

`Building Release -> Geo Draft -> Geo Preview -> Immutable Geo Release -> Geo Live`

A later Building release must never silently replace the Building release used by
a live Geo Experience. An upgrade requires explicit preview, verification and Geo
publication.

Performance-specific Geo model derivatives are caches/derived assets, not a new
Building source of truth.

## Target admin model

Project workspace:

- Overview
- Design
- Building Site
- Building Releases
- Experiences
- Assets
- Settings

Experiences:

- **3D Building Website** — default, independently live
- **3D Geo Experience** — optional add-on

The current sequential `Create -> Edit -> Map -> Live` wording is transitional
and will be replaced in the Dashboard phase. Geo must not appear as a required
step for publishing the Building Website.

## Migration phases

### Phase 1 — architecture guardrails ✅

- Canonical Building and Geo route helpers are locked.
- Shared Experience identity contracts are present.
- Building-versus-Geo lifecycle and Platform no-touch boundaries are locked.
- Regression tests protect route stability, Building release compatibility and
  Engine-only production resources.
- No database migration or production behavior change was made in Phase 1.

### Phase 2 — additive Experience data model ✅

Migration `0024_experience_identity_v1.sql` adds Engine-owned
`experiences_3d` identity without rewriting any existing Building release
tables.

- Every existing project is backfilled with one `building` Experience.
- A DB trigger gives every future Engine project one Building Experience.
- Existing Geo placement work is backfilled as an optional `geo` Experience.
- Geo Experience source identity is pinned to an immutable Building release.
- Cross-project source release attachment is blocked by DB triggers.
- Authenticated Admin API supports listing Experiences and explicit Geo
  Experience creation.
- Existing Geo placement save self-registers/updates Geo Experience identity for
  compatibility with the current mapper.
- Project hard-delete removes Experience identity before restricted Building
  release rows.
- No Platform database, R2, route or deployment dependency is introduced.

### Phase 3 — project-centric Admin workspace ✅

The Admin dashboard now presents the Building-first workflow:

`Create -> Design -> Publish -> Building Live`

- The standalone **3D Building Website** is the primary customer deliverable.
- The top-level mandatory Geo step is removed from the project workflow.
- Each selected project has an **Experiences** section.
- The Building Experience card exposes the canonical Building URL and current
  immutable Building release state.
- **3D Geo Experience** is a separate optional add-on card.
- Geo creation is blocked until an active immutable Building release exists.
- Creating/managing Geo opens the existing Engine Geo Mapper with the selected
  project context.
- A Geo Experience displays its pinned Building source release and can surface a
  newer Building release without switching the Geo source automatically.
- Building and Geo canonical URLs remain independent and unchanged.
- Existing Studio and Geo Mapper routes remain compatible.

### Phase 4 — Geo draft separation ✅

Migration `0025_geo_experience_draft_v1.sql` adds
`geo_experience_drafts_3d` as the editable authoring state owned by one optional
Geo Experience.

- Every Geo Experience owns one project-scoped Geo draft.
- The draft pins a specific immutable Building release and its version.
- Location, ground offset, heading, pitch, roll and scale are editable draft
  values with optimistic `revision` conflict protection.
- Existing compatible `geo_placements_3d` values are backfilled only when the
  legacy placement release matches the Geo Experience source release.
- A newer active Building release is surfaced as an available source update but
  never switches the Geo draft automatically.
- Geo Mapper now edits only `geo_experience_drafts_3d`; it no longer publishes
  or removes the live Geo state directly.
- Existing `geo_placements_3d` remains a backward-compatible public/live
  snapshot during this transition and is not mutated by Geo draft saves.
- Immutable Geo publication/history remains Phase 5; the public Geo runtime stays
  on the legacy snapshot until Phase 6.

### Phase 5 — immutable Geo releases

Add Geo release publication, active release pointer, release history and rollback.
A Building release upgrade is explicit and preview-gated.

### Phase 6 — public runtime separation

Keep the Building URL stable. Make `/[slug]/geo` read only an active immutable
Geo release instead of mutable admin placement state. Separate Building and Geo
public modules/bundles behind stable interfaces.

### Phase 7 — code modularization

Split large Studio, Viewer and Geo orchestration files into stable controllers and
feature modules without changing public identity or stored project data.

### Phase 8 — custom domains and operational polish

Allow Building and Geo Experiences to own independent optional custom domains,
health/readiness status and deployment diagnostics while preserving canonical
Engine URLs.

## Safety requirements for every phase

- No change to `rekixo-ar3d-platform`.
- No direct Platform D1/R2 bindings.
- No destructive migration or rewrite of applied migration history.
- No customer project duplicated to create Geo.
- No automatic Geo source upgrade when Building publishes a new release.
- Existing Building URL and active immutable Building release must remain valid.
- New privileged writes remain behind Engine Admin authentication, same-origin
  checks and project-scoped ownership validation.
