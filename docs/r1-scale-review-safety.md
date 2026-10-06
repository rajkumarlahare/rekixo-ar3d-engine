# R1 FBX scale-review safety boundary

This R1 increment keeps suspicious FBX metric normalization fail-closed while adding one audited manual escape hatch.

- The first suspicious conversion attempt still fails with `FBX_SCALE_REVIEW_REQUIRED`.
- The failed attempt records the exact Source Pack, geometry-authority file, source SHA-256 and processor diagnostic.
- No replacement scale is inferred or prefilled by the Admin UI.
- An operator must enter an explicit metres-per-source-unit value and a written rationale.
- The API independently checks that the reviewed scale still produces broad plausible Building bounds.
- The database makes the approved decision immutable and blocks a retry while the preceding review is still pending.
- A retry forwards the durable decision ID and exact reviewed scale to the isolated FBX processor.
- The processor and Worker adapter both verify reviewed-scale provenance before canonical output is accepted.
- The canonical manifest and R2 metadata retain the decision provenance.

This work does not activate the dormant model-processor binding, switch any Building/Geo release, mutate original source bytes, or change the public runtime.
