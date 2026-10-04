# Perfection Roadmap — Next Execution Order

Current active milestone: **Phase 3 — Complete Building Reconstruction**.

Implementation order after the Phase 3.1 reconstruction planner:

1. Apply only `auto-ready` CAD floor geometry into model-backed scenes.
2. Rebuild automatic room polygons from the selected CAD wall graph without touching verified rooms.
3. Re-run CAD/model opening association after wall replacement; reviewed openings stay immutable.
4. Reconcile stairs/lifts/columns/slabs as source-backed envelopes and connect circulation across resolved floors.
5. Add automatic floor-envelope and vertical-stack consistency checks.
6. Add reconstruction replay tests proving the same normalized sources produce the same floor/source plan and semantic scene fingerprint.
7. Promote Phase 3 from planning-ready to reconstruction-certified only after real six-file protected certification passes the same flow.

No step may use image appearance, PDF page order, upload order or guessed dimensions as metric truth.
