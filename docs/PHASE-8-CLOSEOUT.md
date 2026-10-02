# Phase 8 Closeout Plan

This plan closes the production-hardening backlog before the next major Rekixo AR3D Engine editor/product push. It is Engine-only. The sibling `rekixo-ar3d-platform` remains untouched.

## Phase 1 — Production safety and correctness

Status: COMPLETE

Small, low-risk fixes that should not change Building/Geo rendering behavior:

- fix cloud project metadata so an intentionally cleared location stays cleared;
- stop returning internal login exception reasons to unauthenticated clients;
- pin the exact Wrangler version used by production and provisioning workflows;
- align tracked Cloudflare resource metadata with the live Engine bindings;
- align deployment documentation with the real selective deployment workflow;
- add regression tests for these guarantees.

Exit gate:

- `npm test` passes;
- PR validation passes;
- no Building/Geo runtime contract changes;
- no Platform resources are touched.

## Phase 2 — Data lifecycle and deployment confidence

Status: COMPLETE — production hardening steps deployed and verified

Finish the high-risk operational items:

- [done] replace destructive project cleanup with an idempotent, resumable delete lifecycle so R2 and D1 cannot be left half-cleaned;
- [done] add a committed lockfile and switch CI/deploy/provisioning to reproducible installs;
- [done] run the full migration chain against a fresh local D1-compatible database in every normal test gate;
- [done] add post-deploy read-only integrity checks for active immutable Building/Geo releases and their model bytes;
- [mitigated in code + tracked separately] production deploys now fail closed unless the pushed main commit is associated with a merged PR; native GitHub branch protection remains repository-admin issue #143;
- [done] introduce CSP in report-only mode first and verify it on deployed Admin/Public before any enforcement;
- [done] document recovery/runbook steps for D1, R2, Worker, Building release and Geo release incidents;
- [deferred until dedicated isolated staging resources exist] destructive publish/rollback staging rehearsal. Production is never used as a mutation test fixture.

Exit gate:

- destructive cleanup is retry-safe;
- clean-database migrations pass from 0001 through latest;
- active production release pointers and bytes pass read-only integrity checks; destructive publish/rollback rehearsal runs only on dedicated isolated staging resources;
- reproducible dependency install is mandatory.

## Phase 3 — Performance and maintainability

Status: COMPLETE — performance/resource guardrails and safe modular boundaries implemented

Close the remaining P2/P3 engineering debt before focusing on the simplified editor:

- [done] add bundle-size budgets and project-profile chunk checks;
- [done] move large inline source texture payloads to lazy content-hashed assets;
- [done] formalize profile texture/GPU resource ownership and disposal;
- [done] extract destructive project cleanup from `admin-cloud.mjs` and enforce size/boundary ceilings around the remaining large editor shells;
- [done] move shared model-profile runtime code out of `apps/public` into `@rekixo/3d-model-profiles`;
- [done] add a world-bounds broad phase before expensive walkthrough triangle raycasts;
- [done] enforce no Admin -> Public implementation imports and maintainability budgets in every test gate.

A full mechanical rewrite of `Studio.tsx` / `SceneCanvas.tsx` is intentionally not done here: those shells already delegate focused responsibilities and are the next product surface to be simplified. Churning thousands of lines immediately before that redesign would add regression risk without user value.

Exit gate:

- no regression in current production experience;
- public initial bundle has an enforced budget;
- editor/server hotspot modules have enforced responsibility/size boundaries;
- shared model-profile code is app-neutral;
- large walkthrough models avoid raycasting every collider;
- Phase 8 code hardening backlog is closed.

After these three phases, product work can focus on the next editor direction: simple Building creation with direct mouse/touch/drag-and-drop interaction and minimal advanced controls.
