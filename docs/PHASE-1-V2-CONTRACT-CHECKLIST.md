# Phase 1 — V2 Contract Checklist

This checklist gates the finalized Rekixo AR3D automatic-presentation and 3D Geo architecture before additive schema/runtime work begins.

## Locked contracts

- Building remains the mandatory/default Experience for an Engine Project.
- Geo is an optional first-class Experience referencing an exact immutable Building release.
- Source-pack inputs have explicit authority/evidence/presentation roles; evidence cannot silently replace finished Building geometry.
- Canonical Building units are metres.
- Geo durable coordinates are WGS84.
- Geo local fine alignment is ENU (East/North/Up) in metres.
- Geo Building placement is rigid: translation, orientation, vertical alignment and uniform scale only.
- The model placement uses an explicit local model anchor.
- Masterplan imagery may use control-point homography calibration; that transform never warps Building geometry.
- Geo height behavior is explicit: ground-clamped, ground-relative, or absolute.
- Geo publication uses draft revision -> verification -> immutable Geo release -> active release/rollback.
- Publishing a new Building release never silently retargets an already-active Geo release.
- Provider-specific map/screen pixels are not persistent geographic truth.

## Phase 1 safety boundary

Phase 1 does not:

- deploy production runtime changes;
- alter active Building or Geo releases;
- switch the public Geo renderer;
- add/destructively migrate production schema;
- remove legacy Geo compatibility data;
- remove Studio/reconstruction code;
- mutate or purge Jyoti Paradise data/assets.

## Exit gate

Phase 1 is ready to advance only when repository typecheck/build/tests/migration verification/worker dry-run/E2E/whitespace checks are green and Phase 0 production-protection work is accepted.
