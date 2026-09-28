# Rekixo AR3D Engine Hardening Roadmap

Status: ACTIVE
Date: 2026-09-28
Owner scope: Rekixo AR3D Engine only

## Non-negotiable boundary

The stable sibling `rajkumarlahare/rekixo-ar3d-platform` is a READ-ONLY reference for this work.

Do not modify its Super Admin, D1 `tiyansh-production`, R2 `tiyansh-gallery-production`, routes, authentication, project provisioning, publish flow, plot mapper, customer admin, or public project runtime while hardening the 3D Engine.

The Engine must continue to own its separate resources:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`
- Admin route: `/3Dprojects`
- Public route: `/3Dprojects/*`

The Platform may be studied for proven patterns only. Do not copy Platform credentials, cookies, sessions, database tables, or storage bindings into the Engine.

## Stable Platform patterns worth reusing conceptually

The current Platform Super Admin demonstrates production patterns that the separate 3D Admin should adopt without touching the Platform implementation:

- explicit selected-project workspace instead of tenant defaults;
- searchable/paginated project lists rather than loading everything;
- atomic project provisioning boundaries;
- project-scoped settings and ownership;
- authenticated mutation APIs plus same-origin protection;
- audit logging for privileged changes;
- authenticated preview before publish;
- publish-readiness checks and explicit warnings;
- immutable/versioned public snapshots rather than exposing a mutable draft;
- fail-closed Platform ↔ Engine linking through the versioned HTTP contract.

## Delivery phases

### Phase 1 — Tenant isolation and profile boundary
Status: COMPLETE — validated on main (GitHub Actions run 36395515444)

Goal: no project-specific material, texture, room, facade, or presentation data may affect an unrelated project.

1. Move Reference Source V9/Jyoti material restoration out of generic `realism.ts`.
2. Gate that material restoration by the verified source-model SHA.
3. Keep generic PBR enhancement project-neutral.
4. Preserve the existing Jyoti/reference visual output.
5. Add regression tests preventing customer-specific material names/textures from returning to generic runtime code.
6. Lazy-load project-specific experience/texture bundles so unrelated tenants do not download them.
7. Propagate the verified local asset SHA when the exact source FBX is opened directly in Studio.

Acceptance: a generic model with names such as `Metal_Panel`, `Slate`, or `Color_A06` cannot inherit another customer's source textures/tints merely because names match. Heavy Reference Source V9 texture/interior modules are loaded only after a positive profile match, and direct FBX Studio parsing carries the verified local asset SHA into profile matching.

### Phase 2 — Generic floors and geometry core
Status: COMPLETE — validated on main (PR #39, GitHub Actions run 36399474310)

- replace G+5 percentage heuristics with explicit floor entities/elevations;
- remove `levels.length === 7` assumptions;
- make clipping, exploded view, camera targeting and walkthrough consume the same floor contract;
- support sparse/non-sequential floor IDs, basements, villas and tall buildings;
- separate render meshes from navigation/collision geometry.

### Phase 3 — Source evidence and Scene Manifest V2 hardening
Status: PENDING

- enforce cross-floor Unit/Room/Opening integrity;
- validate polygon area, repeated points and self-intersection;
- enforce model asset role;
- link scene evidence to fingerprinted Source Pack asset IDs;
- preserve source precedence such as DWG over brochure dimensions;
- surface unresolved source conflicts instead of silently presenting reconstructed values as verified;
- move hardcoded project interior geometry toward authored manifest data.

### Phase 4 — 3D Admin project creation and cloud draft storage
Status: PENDING

Use the stable Platform Admin only as a design/operational reference.

- dedicated Engine authentication/authorization boundary;
- searchable selected-project workspace;
- project create/edit/archive workflow;
- atomic project provisioning;
- project-scoped asset ownership;
- R2-backed source/model/reference assets instead of browser-only primary storage;
- local IndexedDB as cache/offline draft support, not the sole production source of truth;
- asset lifecycle/reference counting so replaced assets do not leak forever.

### Phase 5 — Immutable release/publish/rollback
Status: PENDING

- make a release manifest the public source of truth;
- freeze exact scene/model/camera/source-pack references per release;
- use versioned R2 keys;
- add `active_release_id` or equivalent atomic public pointer;
- publish/rollback without exposing partially updated mutable tables;
- consolidate the current D1 runtime and repository-static Published Showcase paths.

### Phase 6 — Worker, DB and security hardening
Status: PENDING

- authenticate sensitive Engine Admin reads/writes;
- enforce project R2 prefixes against project slug/ID;
- add runtime response validation and visible corruption diagnostics;
- remove the 20-model availability blind spot with pagination/active-first checks;
- add required DB uniqueness/integrity constraints;
- add HTTP Range/206 support for video media;
- harden source-pack path containment and symlink policy.

### Phase 7 — Production 3D Admin UX
Status: PENDING

- bring the separate 3D Admin to the same operational quality level as the stable Platform Super Admin;
- project search/picker, compact responsive layouts, clear health/status cards;
- source intake, model processing, scene/floor/unit editor, evidence review;
- preview, readiness checks, publish and rollback controls;
- mobile/tablet/short-landscape handling;
- no dependency on Platform UI/runtime code.

### Phase 8 — CI, deployment, performance and operations
Status: PENDING

- fresh migration-chain integration test;
- browser/WebGL E2E and visual regression;
- bundle budgets and project-profile chunk checks;
- lockfile + reproducible install;
- Windows-safe CLI entry detection;
- align deployment docs with actual workflow behavior;
- clean stale Cloudflare resource metadata;
- large-project performance work such as BVH/navmesh/collider layers.

## Tracked defect backlog

The following findings remain tracked until their owning phase closes:

- [resolved Phase 1] customer-specific textures/tints in generic `realism.ts`;
- [resolved Phase 1] heavy project-specific texture/interior bundles statically shipped to unrelated tenants;
- mutable live-table publication instead of immutable release selection;
- brochure/DWG source conflicts not fully surfaced in customer UI;
- reconstructed doors/rooms/furniture encoded in project source code;
- [resolved Phase 2] G+5/fixed seven-level assumptions;
- [resolved Phase 2] sparse floor index mapping;
- [resolved Phase 1] direct Studio FBX source-SHA propagation gap;
- profile camera/default-room values still code-driven;
- Scene Manifest relational and polygon validation gaps;
- Source Pack ↔ Scene Manifest evidence-link gap;
- V1 Studio authoring model still narrower than V2 contract;
- replaced/orphaned Studio asset lifecycle;
- possible dangling IndexedDB project asset references;
- base64 JSON backup memory scaling;
- duplicate D1/static published project identities;
- unit-number parsing assumptions;
- fixed premium navigation modes;
- brochure-specific fallback copy in generic components;
- Admin read-surface authentication gap;
- R2 prefix isolation not enforced at worker/data boundary;
- admin availability checks limited to first 20 models;
- malformed JSON silently falling back;
- missing MP4 range responses;
- source-pack filename traversal hardening;
- Windows ASCII-FBX CLI entry check;
- ASCII-FBX transform limitations;
- Public WebGL construction less defensive than Admin;
- texture cache/disposal ownership;
- walkthrough raycast scalability;
- placeholder preview must remain clearly non-authoritative;
- model/scene schema ambiguity constraints;
- source-string-heavy regression coverage;
- migration chain not executed on a fresh DB in normal CI;
- deployment documentation drift;
- stale `cloudflare/resources.json`;
- non-lockfile `npm install` reproducibility;
- deployment cancellation/atomicity risk;
- project provisioning same-slug metadata conflict handling;
- historical/current documentation contradictions;
- Source Pack precedence capability validation;
- duplicated runtime-profile data that should be generated from canonical source evidence.

## Change-control rule

Every phase must satisfy all of the following before moving on:

1. Engine-only changes unless the owner explicitly authorizes Platform changes.
2. Existing Platform Super Admin behavior remains untouched.
3. Existing Jyoti production compatibility remains intact unless a deliberate reviewed migration changes it.
4. Generic runtime tests prove there is no first-customer/default-tenant leakage.
5. Build/typecheck/regression checks pass before an Engine public deployment.
