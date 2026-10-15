# Universal grass ground cover and curved horizon

The public Building viewer now receives a presentation-only ground layer for customer-facing views, independent of optional decorative dressing. The layer combines the existing locally generated turf detail texture with a radial, low-poly landscape surface that gradually curves upward and tints from natural grass into a blue-green atmospheric horizon, blending with the existing shader-based sky.

## Grass detail

- Three deterministic, instanced grass-clump tiers use exact nominal heights of 1 inch (0.0254 m), 2 inches (0.0508 m), and 3 inches (0.0762 m).
- The continuous procedural turf material provides the distant lawn; instances add local depth without creating one scene object per blade. The ground mesh now uses a compact mask rasterized from the loaded Building's actual projected triangles. The mask clips the terrain in the fragment shader, preserving concave, stepped, and sloping outlines rather than cutting an axis-aligned rectangle. When a reviewed profile box is unavailable, the viewer infers a tighter footprint from the loaded structural mesh bounds and filters ground/paving and short compound-wall geometry.
- Desktop and mobile use different instance/mesh-resolution budgets. Grass clumps do not cast individual shadows.
- Reviewed lawn/garden elements root blades at their actual surface height. Reviewed road, parking, and path footprints are excluded, with additional masks for fallback road, sidewalk, curb, and driveway geometry.

## Boundaries and safety

- The ground and grass are marked presentation-only and non-authoritative. They do not alter, cut, relocate, or rewrite a customer's building model or published Studio geometry. Only the measured Building footprint is conservatively excluded from both the ground surface and instanced blades; the broader loaded site bounds continue to size the surrounding lawn and horizon; the extra edge margin keeps turf just outside walls.
- If a project is a single merged, semantically unnamed mesh that combines the entire building and site, the runtime cannot confidently derive a separate Building footprint from its bounds and falls back to those bounds; for a precise cutout in that ambiguous case, the source needs a reviewed Building footprint/profile. A reliable surveyed parcel polygon is not currently available in every legacy project. For that reason the outer curved horizon is a cosmetic backdrop sized from model bounds, not a claim that it represents a surveyed plot boundary or the true legal parcel.
- Ground is omitted when model bounds are empty or the baseline elevation is not safe to infer.
- The former oversized flat surrounding-ground slab is disabled in this presentation path; the curved low-poly surface replaces it. Geometry tests cover a trapezoidal Building beside an oversized ground slab and assert that only the source Building is masked; open space outside its sloping wall remains available for grass.

## Verification

The tests cover real-world grass height tiers, bounded geometry detail, source-area masking, universal activation in customer views, and the presentation-only boundary.


## Mesh-outline and raster-mask validation
A regression test uses a trapezoidal Building mesh plus an oversized flat ground slab. It verifies the contour keeps real source vertices and does not invent corners from the axis-aligned box around that mesh. This prevents the ground cutout from defaulting to a white rectangle merely because the model contains many separate mesh bounds.
