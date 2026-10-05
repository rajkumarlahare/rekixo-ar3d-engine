# Phase 7 — Source Pack Review and Immutable Sealing

Phase 7 converts Phase 6 automatic classification suggestions into an operator-approved Source Pack V2 decision without allowing the automatic classifier to rewrite building architecture.

## Product boundary

The Source Pack Review is a decision surface, not a CAD/model editor.

- Original uploaded bytes remain unchanged.
- Automatic classification remains advisory.
- Exactly one verified original must be chosen as `geometry-authority` before a draft can be saved.
- DWG/PDF/reference files may remain evidence/content/presentation inputs and are not silently promoted into geometry.
- Supporting roles can be adjusted by the operator.
- Sealing creates a deterministic manifest and SHA-256 digest.
- A sealed pack is immutable. Changes require a new Source Pack version.
- Sealing does not publish a Building release, mutate an active release pointer, or write/delete R2 presentation assets.

## Workflow

1. Verify uploaded originals.
2. Refresh automatic classification.
3. Start Source Pack Review.
4. Review every currently verified original.
5. Select exactly one geometry authority.
6. Save operator review.
7. Seal Source Pack.
8. Downstream model-processing phases may consume only a sealed pack.

The review draft intentionally strips the classifier's `geometry-authority` role when it is first created. The recommendation is shown in the UI, but the operator must explicitly choose the authority.

A new review draft also requires every verified original to have a suggestion produced by the **current** `SOURCE_CLASSIFIER_VERSION`. If the classifier policy is upgraded later, previously persisted suggestions cannot silently seed a new review version; the operator must refresh automatic analysis first. Existing operator-reviewed or sealed packs remain unchanged.

## API

`GET /3Dprojects/api/cloud/projects/:slug/source-pack-review`

Returns automatic suggestions plus the latest Source Pack state/readiness. Each suggestion includes its classifier version so the decision provenance remains inspectable.

`POST /3Dprojects/api/cloud/projects/:slug/source-pack-review`

Supported actions:

- `start-draft`
- `save-review`
- `seal` (requires exact `SEAL SOURCE PACK` confirmation)

Every POST is authenticated, same-origin, blocked for archived projects, blocked by the generic `source-write` operation lock, and blocked while permanent deletion is active.

## Manifest

The sealed manifest contains:

- review schema version
- project id/slug
- Source Pack id/version
- chosen geometry authority file id
- every reviewed original with filename, media type, byte size, SHA-256, roles, capabilities, classification origin/confidence and optional operator note

Files, roles and capabilities are canonically sorted before hashing so the same approved decision yields the same manifest bytes.

## Safety / production compatibility

Phase 7 does not:

- modify original source bytes
- modify public Building or Geo release rows
- mutate active immutable releases
- write or delete presentation/model R2 objects
- remove legacy Studio functionality
- bypass project operation locks

Existing production projects therefore remain isolated from the new Source Pack decision path until an operator intentionally starts a Source Pack review for that project.
