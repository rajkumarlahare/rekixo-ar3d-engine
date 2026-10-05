# Phase 6 — Source Classification Suggestions

Phase 6 adds deterministic classification suggestions after Source Pack V2 originals have reached the `verified` state.

## Boundary

Classification is advisory. It does not write `source_pack_files_3d`, does not set `source_packs_3d.geometry_authority_file_id`, does not seal a Source Pack and does not mutate source bytes or any active Building/Geo release.

The operator remains the authority for the final Source Pack decision.

## API

```text
GET  /3Dprojects/api/cloud/projects/:slug/source-classification
POST /3Dprojects/api/cloud/projects/:slug/source-classification
```

`POST` refreshes deterministic suggestions for every verified source in the project. `GET` reads the persisted suggestions. Both are authenticated and same-origin. The refresh path also obeys the generic `source-write` project operation lock and the permanent-deletion freeze.

## Classifier v1 policy

- GLB/glTF/FBX: strong finished-model candidates. They may receive an advisory `geometry-authority` role and a high authority score.
- SKP/SKB: supporting authoring/backup sources with geometry/material recovery capability, but below the automatic authority threshold.
- DWG/DXF: dimensional/floor-plan evidence only; never automatic geometry authority.
- DRS: render dependency/material evidence.
- PDF: content/floor-plan/marketing/location evidence.
- JPG/PNG/WebP/etc.: presentation reference by default; texture-like filenames are material-recovery inputs.
- Unknown formats: conservative evidence with low confidence.

A unique candidate with score >= 0.85 may be returned as `authoritySuggestion.status = "suggested"`. If two strong candidates are close, or no strong candidate exists, the API returns `operator-review-required` instead of guessing.

## Representative Jyoti-style source pack

The policy intentionally yields the expected separation for the representative source pack without embedding any tenant/project name in runtime code:

```text
FBX  -> strong geometry candidate + material recovery
SKB  -> supporting authoring/material evidence
DWG  -> dimensions/floor-plan evidence
DRS  -> render/material dependency evidence
PDF  -> project/content evidence
JPG  -> visual/presentation reference
```

This preserves the architecture rule:

**Geometry Authority != Evidence Sources != Presentation References.**

## Next boundary

A later operator-review phase will create/edit draft `source_pack_files_3d` mappings and explicitly approve exactly one geometry authority before a pack can become `ready`. Automatic classification must never bypass that approval gate.
