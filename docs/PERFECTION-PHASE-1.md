# Rekixo AR3D Perfection Phase 1 — Golden Six-File AutoBuild Certification

Status: P1.1–P1.7 IMPLEMENTED; REAL PRIVATE SOURCE CERTIFICATION STILL REQUIRES A PROTECTED RUN

This phase is intentionally separate from the older numbered implementation phases in the repository. Its purpose is to certify the current generic engine against a real six-role customer source pack before larger visual/editor features are added.

## Product rule

The target workflow remains:

`source files -> automatic processing -> explicit review queue -> mouse/touch correction -> immutable publish`

The engine must never convert missing or ambiguous evidence into a green "verified" result merely because the overall AutoBuild function completed.

## P1.1 — Golden source manifest contract

Implemented in `apps/admin/src/studio/goldenSourceManifest.ts`.

A golden pack records exactly these six generic roles:

1. authoring model — FBX or GLB
2. CAD — DWG or DXF
3. SketchUp — SKP or SKB
4. drawing — PDF
5. visual reference — raster image
6. render metadata — DRS or JSON

Each expected source records SHA-256 and exact byte size. Verification checks:

- current project ownership;
- SHA-256 identity;
- exact asset/blob byte size;
- valid source format for the declared role;
- missing/ambiguous candidates;
- untracked additional assets.

The engine-side manifest contract is generic. No customer name, customer hash or customer geometry is compiled into the product.

## P1.2 — AutoBuild certification report

Implemented in `apps/admin/src/studio/autoBuildReport.ts` and attached to every shared `runAutoBuildPipeline` result.

Every check is classified as one of:

- `passed` — an existing prerequisite/result is proven;
- `auto-derived` — this AutoBuild path produced or fused the result automatically;
- `needs-review` — non-blocking evidence remains unresolved;
- `blocked` — a critical certification requirement is missing or unusable.

Current certification checks include:

- source record integrity;
- six-role pack presence;
- authoring model and web-safe GLB path;
- real normalized DWG geometry readiness;
- SketchUp material recovery evidence;
- external texture resolution;
- PDF plan extraction;
- PDF↔CAD registration;
- floors, walls, rooms and openings;
- room/unit semantics;
- source-backed structural primitives;
- visual-reference evidence;
- automatic interior/site evidence when produced;
- structured room-sheet evidence when attached;
- explicit aggregate review burden.

The report exposes `checkCoveragePercent`, but this is deliberately only the percentage of certification checks currently completed. It must not be presented as "percent of the building automatically correct" or as architectural accuracy.

## Important fail-closed rule for DWG

If a `.dwg` file is attached but no source-bound normalized DWG audit has `geometryReady`, the certification report marks the DWG architecture check as `blocked`.

Therefore a model-backed build can still produce a useful draft, but it cannot pretend that the six-file DWG path was actually proven.

## P1.3 — Real binary DWG certification harness

Implemented by `scripts/certify-golden-source-pack.mjs` plus the manual protected workflow `.github/workflows/certify-golden-source-pack.yml`.

The public repository still contains no private source bytes or customer fingerprints. The runner accepts the private six-file directory and private manifest at runtime.

Generate a private manifest locally:

```bash
npm run golden:manifest -- \
  --dir /private/path/to/source-pack \
  --out /private/path/pack.golden-manifest.json \
  --key golden-building-v1
```

Verify exact source bytes without claiming native DWG success yet:

```bash
npm run golden:certify -- \
  --dir /private/path/to/source-pack \
  --manifest /private/path/pack.golden-manifest.json \
  --allow-dwg-pending
```

A real certification run omits `--allow-dwg-pending` and supplies the pinned processor:

```bash
npm run golden:certify -- \
  --dir /private/path/to/source-pack \
  --manifest /private/path/pack.golden-manifest.json \
  --processor-url http://127.0.0.1:18080 \
  --out /private/path/certificate.json
```

For a DWG to pass, the runner requires all of the following:

- exact source SHA-256 and byte size match the private manifest;
- normalized contract/version match Rekixo's DWG contract;
- normalized output points back to the exact source asset/hash/size;
- processor engine is GNU LibreDWG;
- CAD units are resolved/reviewed with a positive metres-per-unit value;
- the normalized document contains usable segment/object/insert geometry.

A processor error, unresolved units, empty normalized geometry, source mismatch or over-limit DWG blocks certification.

## P1.4 — Protected real six-file browser E2E

Implemented in `e2e/golden-source-pack.spec.ts`.

This test is opt-in and skips in normal public CI. It runs only when these runtime variables are present:

- `REKIXO_GOLDEN_PACK_DIR`
- `REKIXO_GOLDEN_MANIFEST`
- `REKIXO_DWG_PROCESSOR_URL`

The test uploads the six exact private files through the real Studio source drop, bridges the Studio DWG request to the native processor, runs `Build automatically`, requires the final AutoBuild certification summary to contain **0 blocked** checks, waits for autosave, reloads the browser, verifies the selected source model is retained, and opens the visual editor.

The repository exposes this opt-in command:

```bash
npm run test:e2e:golden
```

### Manual GitHub certification workflow

`Certify Private Golden Source Pack` is `workflow_dispatch` only. It does not run on public pull requests. Before running it, configure these repository Actions secrets outside the codebase:

- `REKIXO_GOLDEN_PACK_URL` — private/signed URL for a ZIP whose root contains the six source files;
- `REKIXO_GOLDEN_PACK_TOKEN` — optional bearer token for that download;
- `REKIXO_GOLDEN_PACK_SHA256` — exact SHA-256 of the ZIP;
- `REKIXO_GOLDEN_MANIFEST_B64` — base64 of the private manifest JSON.

The workflow verifies the ZIP checksum, builds the pinned GNU LibreDWG container, runs real DWG certification, runs the protected browser E2E and uploads only a redacted certification summary. Source files, private manifest fingerprints and full certificate are kept under `.private/`, which is ignored by Git.

## P1.5 — Deterministic replay / normalized scene fingerprint

Implemented in `apps/admin/src/studio/sceneReplayFingerprint.ts` and attached to every shared AutoBuild result.

`buildNormalizedSceneFingerprint` creates a project-neutral `scene-v1` canonical scene and SHA-256 fingerprint. Normalization removes volatile project/entity IDs, timestamps, cloud revisions and array insertion order while preserving the semantic output that matters: floor/room/wall/opening geometry, room relationships, furniture, site/structural envelopes, model/reference bindings, material/appearance state and model semantic tags.

Asset bindings use source SHA-256/byte-size identity when the source bytes are available. Numeric geometry is normalized to bounded precision before hashing.

`certifyDeterministicReplay` is deliberately stricter than merely generating a hash:

- one run => `pending`;
- two or more independently produced identical normalized hashes => `passed`;
- any normalized hash mismatch => `blocked`.

Therefore the presence of a scene hash must never be described as proof that the real private source pack is deterministic. Real-pack deterministic replay is proven only after independent protected AutoBuild runs are compared.

## P1.6 — Whole-scene geometry integrity validator

Implemented in `apps/admin/src/studio/sceneGeometryIntegrity.ts` and executed after every shared AutoBuild as well as during Preview & Release readiness.

The validator keeps the existing strict domain validation and adds cross-entity checks for contradictions that cannot be detected by per-object range validation alone, including:

- floor elevation collisions;
- repeated-floor cycles;
- duplicate or heavily overlapping room geometry;
- duplicate wall segments;
- wall-to-room boundary disagreement;
- doors/windows with no plausible same-floor host wall;
- openings wider than their host wall;
- opening room bindings that disagree with the host wall;
- duplicate opening geometry.

Human-reviewed contradictory geometry becomes a publish blocker. Ambiguous automatic/unreviewed geometry remains an explicit review item where it can safely stay non-blocking.

This validator is geometric integrity, not structural engineering, building-code, fire, seismic, wind or fabrication certification.

## P1.7 — Actionable review queue + publish gate integration

Implemented in `apps/admin/src/studio/actionableReviewQueue.ts`, `readiness.ts` and `StudioPublish.tsx`.

The queue converts machine findings into operator work with:

- blocker/review severity;
- category and affected entity/floor where available;
- a concrete problem description;
- a concrete next action instead of a generic warning.

The AutoBuild result combines certification findings, geometry findings and unresolved room/wall/opening/site/floor review state. Preview & Release recomputes whole-scene geometry from the current editable project so a later manual edit cannot bypass the gate by relying on a stale AutoBuild result.

Critical geometry contradictions are fail-closed: `readiness.publishable` remains false while any blocker exists, and the immutable publish button stays disabled. Non-critical draft evidence stays visible as review work instead of being silently promoted to human-reviewed truth.

The queue is capped for UI responsiveness; resolving visible work and rerunning/reopening review refreshes it.

## Current proof boundary

P1.1–P1.7 code now provides the complete Phase 1 certification, determinism, geometry-integrity and operator-gating foundation. This still does **not** mean the owner's real production DWG/six-file pack has passed every proof step.

The private pack is source-certified only when the protected workflow (or equivalent trusted local run) completes with the exact source bytes. Deterministic replay is certified only when two or more independent real AutoBuild runs produce the same normalized scene fingerprint. Harness-ready, fingerprint-generated and source/replay-certified are different states.

## Acceptance for Phase 1 code

- generic manifest contract exists without customer hardcoding;
- AutoBuild always returns a certification report;
- DWG cannot show complete certification unless normalized geometry is actually ready;
- exact private bytes can be fingerprinted and checked outside Git;
- real DWG certification uses the same pinned native processor contract as production;
- protected browser E2E uses the six runtime files instead of synthetic substitutes;
- normal public CI remains source-independent and does not need private customer assets;
- private artifacts are ignored and are never uploaded as public build output;
- every AutoBuild emits a normalized semantic scene SHA-256 fingerprint;
- replay certification requires at least two independent matching fingerprints;
- every AutoBuild emits a whole-scene cross-entity geometry integrity report;
- the operator receives an explicit actionable review queue;
- critical geometry contradictions block immutable publication;
- Preview & Release recomputes current-scene integrity instead of trusting stale automation state;
- normal typecheck/build/test/browser gates remain the merge gate.
