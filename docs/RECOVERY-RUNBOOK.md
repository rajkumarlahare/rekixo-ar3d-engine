# Rekixo AR3D Engine Recovery Runbook

This runbook applies only to the isolated Rekixo AR3D Engine. Do not restore, mutate, rename, or repoint the sibling AR3D Platform resources while following it.

## Production boundary

Engine resources:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`
- Admin route: `https://admin.rekixo.com/3Dprojects`
- Public route: `https://ar3dstudio.in/3Dprojects/*`

Platform resources such as `tiyansh-production`, `tiyansh-gallery-production`, `/admin`, and `/projects/*` are outside this runbook.

## First response to an incident

Before changing production state:

1. stop publish, rollback, delete and project-recreation actions;
2. record the UTC incident time, affected project slug, current Git commit and GitHub Actions run;
3. capture the Engine Admin audit entries relevant to the incident;
4. if permanent project deletion was involved, read the current deletion-job state and resume that job rather than recreating the same slug;
5. confirm whether the failure is D1 metadata, R2 bytes, Worker deployment, or a combination.

Do not use a D1 restore as a substitute for missing R2 objects. Database metadata can be restored while the referenced immutable bytes are still absent.

## D1 recovery

Use the repository-pinned Wrangler after `npm ci`.

Inspect the available Time Travel restore point before any restore:

```powershell
npx.cmd --no-install wrangler d1 time-travel info rekixo-3d-production --remote --config wrangler.infra.jsonc
```

Linux/macOS equivalent:

```bash
npx --no-install wrangler d1 time-travel info rekixo-3d-production --remote --config wrangler.infra.jsonc
```

A restore is an explicit incident action. Choose a reviewed timestamp/bookmark that predates the bad database mutation, document it, then use the corresponding Wrangler Time Travel restore command. Never run a restore speculatively.

After D1 recovery, verify at minimum:

- `projects_3d` project identity/status;
- active Building release pointer;
- immutable Building release/asset rows;
- Building/Geo Experience identity;
- active Geo release pointer when Geo exists;
- Studio draft revision if authoring state matters;
- `engine_deletion_jobs_3d` if deletion was involved.

Then verify every active release's referenced R2 object before reopening publish/admin work.

## R2 recovery

R2 and D1 do not share a transaction or a common Time Travel restore.

For a pending all-project deletion job:

- do not recreate a deleted/archived slug;
- retry the existing deletion operation from Admin;
- the job persists R2 progress and proceeds to D1 record deletion only after storage cleanup succeeds.

For an accidental or unrelated missing R2 object:

1. identify the exact immutable key and expected SHA-256/byte size from the release metadata;
2. recover the original approved/source bytes from the controlled source archive or rebuild the deterministic derivative;
3. upload only to the expected Engine-owned key;
4. download/read back the object and verify its SHA-256 and size;
5. only then restore/re-activate a release that references it.

Do not manufacture replacement bytes under an existing immutable key if their hash differs. Publish a new release instead.

## Worker deployment recovery

If a Worker deployment is the only broken layer:

1. identify the last known-good main commit and successful production run;
2. prefer a reviewed revert/fix PR through the normal validation gate;
3. do not manually repoint Engine routes to Platform Workers;
4. after deployment, verify Admin login/read boundaries, Admin bundle, Public project API, Building viewer and Geo viewer when applicable.

Production deployment concurrency is serialized. Do not cancel an in-progress production verification unless the deployment itself is the incident.

## Release/publish incident checks

Building and Geo active pointers are independent.

For a Building issue:

- inspect the active Building release and its immutable manifest checksum;
- confirm model/media/studio release objects exist;
- use normal release activation/rollback rather than editing immutable rows.

For a Geo issue:

- inspect the active Geo release;
- confirm its pinned Building release still exists and validates;
- confirm Geo placement manifest checksum;
- activate a prior immutable Geo release if rollback is required;
- do not change the active Building pointer merely to repair Geo.

## Post-recovery verification

Before declaring recovery complete:

- `npm ci` succeeds from the committed lockfile;
- `npm test` succeeds, including fresh local migrations;
- production Admin authentication/readiness checks pass;
- sensitive Admin reads remain fail-closed;
- Building/Public route loads without server corruption diagnostics;
- Geo route is checked for projects with an active Geo release;
- no unfinished deletion job remains unless intentionally paused;
- audit notes record what changed and why.

## Branch-protection operational requirement

Production deploys originate from `main`. The desired repository rule is:

- changes to `main` through pull requests only;
- require the `Validate Rekixo AR3D Engine / validate` check before merge;
- block force pushes and branch deletion;
- keep administrator bypass disabled for normal development.

This is a GitHub repository administration setting, not application code. It must be verified separately after repository settings are changed.
