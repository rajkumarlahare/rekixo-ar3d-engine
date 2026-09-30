# Jyoti demo acceptance

## Floor preparation and review

Select the profile's Floor 1 in 3D Edit and choose **Prepare Floor 1 rooms**.
The profile supplies reconstructed placements in model-local coordinates. The
existing model scale and planar transform map these into world coordinates;
preparation does not change the source files or certify the reconstruction.
Ground, roof and repeated floors must not receive the source unit numbers.

The floor review shows saved outlines grouped by unit. Compare each room against
the source plan, then accept it or choose **Needs correction** to enter the visual
mapper. Review progress uses the existing room verification field and local
autosave. Geometry edits clear acceptance. The source note and source identifiers
remain attached. The review can be reopened from **Review floor rooms**.

Expand **Repeat floors** to inspect the existing profile mappings. A source unit
must have its expected room count and every room accepted. Existing target units
are skipped; generated rooms remain unverified and require their own review.
Generation opens the first generated floor for visual inspection. Floor
elevations continue to come from the source floor skeleton, not array indices.

## Production acceptance still requires real source inspection

Automated fixture tests verify workflow and persistence, not architectural truth.
Before calling the actual project demo-ready, check the preserved model checksum,
all three source units against the brochure/CAD, repeated floor elevations,
opening confidence and shared-door connectivity, a furnished typical unit,
day/evening/night presentation, camera and walkthrough, publish validation and
the deployed customer experience. Do not promote inferred geometry merely to
remove a publish blocker.

The production workflow remains `.github/workflows/deploy-cloudflare.yml`.
Super Admin and original architectural assets are outside this change.
