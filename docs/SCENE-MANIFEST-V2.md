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
- materials and camera presets

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
- openings, materials and cameras stay empty until they are actually authored.

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
- invalid hashes, transforms, colours and excessive collection sizes.

A source node name is explicitly a legacy binding strategy. Re-import-safe
semantic IDs remain the preferred future strategy.

## Compatibility and safety

No D1 schema or R2 object is changed by this phase. Existing Jyoti production
migrations, published JSON and browser backup packages remain valid. The V2
manifest is a new export contract only.

The next persistence phase can store V2 drafts/releases directly and add stable
semantic model IDs, multi-building authoring, doors/windows, polygons, materials
and cameras without changing the manifest version for already-supported fields.
Breaking semantic changes require a future contract version rather than silent
reinterpretation.
