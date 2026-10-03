# Phase 2 structural footprint evidence

This slice upgrades normalized DWG evidence before Rekixo introduces publishable structural scene primitives.

The DWG processor now recognizes beam and boundary semantics in addition to column, slab, roof, duct, balcony, stair, lift and gate. Closed structural polylines and structural circles produce metre-space object bounds. Linear structural entities only produce footprint bounds when the source carries an explicit width. No height, slab thickness, beam depth or other vertical dimension is invented from a 2D plan.

Phase 2 reports bounded structural footprints separately from point/semantic-only structural evidence. These bounds are source evidence for the next dedicated structural scene primitive; they are not coerced into rooms, walls or landscape elements.

Fail-closed rules remain unchanged: missing units do not become metre geometry, open/point-only structural objects do not receive fabricated dimensions, and human-reviewed geometry is never overwritten by this evidence layer.
