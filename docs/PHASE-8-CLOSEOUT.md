# Phase 8 Closeout Plan

This plan closes the production-hardening backlog before the next major Rekixo AR3D Engine editor/product push. It is Engine-only. The sibling `rekixo-ar3d-platform` remains untouched.

## Phase 1 — Production safety and correctness

Status: IN PROGRESS

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

Status: PENDING

Finish the high-risk operational items:

- replace destructive project cleanup with an idempotent, resumable delete lifecycle so R2 and D1 cannot be left half-cleaned;
- add a committed lockfile and switch CI/deploy to reproducible installs;
- run the full migration chain against a fresh D1-compatible database in CI;
- add real Engine staging/integration coverage for cloud draft -> Building publish -> public load -> rollback and Geo verify -> publish -> public load -> rollback;
- enforce/verify main-branch merge protection outside the repository code;
- introduce CSP in report-only mode first, verify Admin/PDF/Google Maps/3D flows, then enforce it;
- document recovery/runbook steps for D1 and R2 failures.

Exit gate:

- destructive cleanup is retry-safe;
- clean-database migrations pass from 0001 through latest;
- staging lifecycle tests exercise real persistence;
- reproducible dependency install is mandatory.

## Phase 3 — Performance and maintainability

Status: PENDING

Close the remaining P2/P3 engineering debt before focusing on the simplified editor:

- add bundle-size budgets and project-profile chunk checks;
- move large inline source texture payloads to immutable lazy-loaded assets;
- formalize texture/GPU resource ownership and disposal;
- split oversized `Studio.tsx`, `SceneCanvas.tsx`, and `admin-cloud.mjs` into focused modules without changing behavior;
- move shared model-profile runtime code out of `apps/public` into a shared Engine package;
- improve large-project collision/raycast scalability;
- remove remaining stale/historical documentation contradictions and close completed architecture tracking issues.

Exit gate:

- no regression in current production experience;
- public initial bundle has an enforced budget;
- editor/server hotspot modules have clear responsibility boundaries;
- Phase 8 hardening backlog is closed.

After these three phases, product work can focus on the next editor direction: simple Building creation with direct mouse/touch/drag-and-drop interaction and minimal advanced controls.
