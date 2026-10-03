# Phase 11 — Public site and landscape runtime

Phase 11 carries reviewed Studio site/landscape elements into the customer-facing Building Experience without generating synthetic site geometry.

## Runtime flow

1. The normal public project experience is loaded.
2. The immutable Studio release is queried as an additive source of reviewed site data.
3. Only reviewed `garden`, `lawn`, `path`, `road`, `parking`, `tree`, `plant`, `gate` and `outdoor-light` elements are accepted.
4. Studio scene coordinates are converted back into the published model coordinate system using the stored model scale/translation/rotation.
5. The public site environment renders the source-backed elements. Repeated vegetation and surfaces use instancing to keep draw-call cost bounded.
6. Outdoor-light bulbs use emissive materials that respond to the existing day/night toggle without creating thousands of real-time point lights.

## Failure boundary

Site/landscape data is additive. If an older project has no immutable Studio release, or the optional Studio release request fails, the published building still loads normally and no synthetic replacement site is invented.

Unreviewed Studio elements are never promoted into the public runtime by this flow.
