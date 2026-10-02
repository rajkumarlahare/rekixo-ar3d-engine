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

### Phase 1 — architecture guardrails

- Lock canonical Building and Geo route helpers.
- Add shared Experience identity contracts.
- Lock the Building-versus-Geo lifecycle in architecture documentation.
- Add regression tests for route stability, Building release compatibility and
  Platform resource isolation.
- No database migration and no production behavior change.

### Phase 2 — additive Experience data model

Add Engine-only additive migrations for Experience identity and future Geo release
history. Do not rewrite applied migrations. Backfill/compatibility must treat all
existing Engine projects as having a Building Experience.

### Phase 3 — project-centric Admin workspace

Replace the mandatory `Create -> Edit -> Map -> Live` presentation with
Building-first project workflow and an optional `+ Add 3D Geo Experience` card.
Keep current Studio and Building publish paths compatible.

### Phase 4 — Geo draft separation

Refactor current `geo_placements_3d` behavior into a proper editable Geo draft
owned by a Geo Experience. Source selection pins an immutable Building release.

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
