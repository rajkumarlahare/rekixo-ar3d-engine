# Scene Manifest V2

Status: implemented as the reusable authoring/viewer interchange contract on 28 September 2026.

Scene Manifest V2 is the project-neutral data boundary between authoring tools,
future cloud draft storage, publish releases and the reusable runtime. It does
not replace the current IndexedDB draft package yet; the existing backup format
remains readable and unchanged.

## Contract

Every manifest declares:

- `format: "rekixo-scene-manifest"`
- `version: 2`
- project identity and stable slug
- metres, Y-up and right-handed coordinates
- project assets and source hashes
- one or more models with explicit roles and transforms
- Site -> Building -> Floor -> Unit -> Room hierarchy
- rectangular or polygonal room boundaries
- measurement evidence and review status
- semantic or source-node mesh bindings
- openings for doors/windows/connections
- furniture instances with full transforms
- optional semantic room surfaces (`floor` / `ceiling` / boundary-indexed `wall`)
- optional furniture catalog items with real dimensions and collision footprints
- PBR-ready materials with texture asset references, roughness/metalness and UV controls
- camera presets

The contract deliberately supports more than the current Studio UI. The current
editor still authors one default site/building, rectangular rooms, no explicit
openings and a small furniture catalog. Its adapter exports those capabilities
without pretending that missing data has been verified.

## Legacy Studio bridge

`apps/admin/src/studio/manifestV2.ts` converts the existing local project model
into V2. The conversion is deterministic:

- the existing project becomes one default site and building;
- existing floors keep their IDs and elevations;
- room `unit` labels become floor-scoped unit entities with deterministic IDs;
- current room rectangles become explicit V2 rectangle boundaries;
- reviewed room dimensions retain their source note;
- legacy mesh-name bindings are marked `source-node-name`, not semantic IDs;
- the imported building model becomes a `shell` model;
- non-model files are exported as reference assets;
- furniture positions become explicit world-space transforms;
- every legacy room exports deterministic semantic floor/ceiling/wall targets;
- the existing five-item procedural furniture shelf exports as catalog metadata, so
  furniture keys have an explicit catalog contract before real GLB assets are added;
- openings export only after review, while materials and cameras stay empty until
  they are actually authored.

This bridge lets future viewers and cloud services adopt V2 without first
rewriting the whole local editor.

## Validation rules

The shared contract validator rejects:

- unsupported format/version values;
- duplicate IDs or broken Site/Building/Floor/Unit/Room references;
- invalid model/asset bindings;
- impossible rectangle/polygon geometry;
- reviewed measurements that have no source evidence;
- mesh bindings to unknown models;
- furniture, camera or opening references to unknown rooms;
- invalid semantic surface room/edge/material references;
- invalid furniture catalog entries or catalog keys when a catalog is present;
- PBR texture references that do not point to `texture` assets;
- invalid hashes, transforms, colours and excessive collection sizes.

A source node name is explicitly a legacy binding strategy. Re-import-safe
semantic IDs remain the preferred future strategy.

## Compatibility and safety

No D1 schema or R2 object is changed by this phase. Existing Jyoti production
migrations, published JSON and browser backup packages remain valid. The V2
manifest is a new export contract only.

The next persistence phase can store V2 drafts/releases directly and move the
Studio from its narrow V1 authoring model toward this manifest as the canonical
scene source. Semantic surfaces and catalog items are optional additive V2 fields,
so older V2 releases remain readable. Real furniture GLBs can later replace a
procedural catalog item by using `source: "asset"` and a manifest asset with
role `catalog`; no furniture-instance schema change is required.

Breaking semantic changes still require a future contract version rather than
silent reinterpretation.


## Source evidence linkage

Scene Manifest V2 can now attach structured provenance to room measurement
evidence with `sourcePackSourceId` and optional `sourceClaimIds`. These fields
do not make a reconstructed room authoritative by themselves. The room's
`status` still controls whether the authored measurement is reviewed.

Use `assertSceneSourceEvidenceV2(scene, sourcePack)` when a Scene Manifest is
published together with a Source Pack. The cross-validator requires matching
project identity, verifies referenced source/claim IDs, compares source asset
fingerprints when both are present, and rejects a reviewed room that relies on
a conflicted claim.

The base Scene V2 validator also enforces:

- model instances reference assets whose role is `model`;
- a room's unit belongs to the same floor as the room;
- an opening references one or two distinct rooms on the opening's own floor;
- polygon rooms have non-zero area, no repeated closing/consecutive points and
  no self-intersection.

These checks are additive within V2 and do not reinterpret older valid fields.
