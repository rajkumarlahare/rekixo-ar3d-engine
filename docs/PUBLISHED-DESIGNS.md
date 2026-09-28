# Published Studio designs

Jyoti Paradise's saved Studio scene is published at
`https://admin.rekixo.com/3Dprojects/showcase/jyoti-paradise`.
The live Studio's Published Projects section opens this view or imports a new
editable browser-local copy, retaining the original room layout and review.
The published view works without a previous local draft or IndexedDB record.

`published/[slug].json` is an explicitly reviewed release manifest, containing
project metadata, scene, reviews and asset hashes. The original Jyoti export has
one draft room and an exterior model; it does not claim a complete measured
building interior. Existing unverified measurement flags remain visible.

The optimized GLB is stored as a GitHub Release asset, outside Git history.
Deployment runs `scripts/prepare-published-designs.mjs` after building the admin.
It downloads only approved repository release assets, checks size and SHA-256,
and packages the model under a content-hash filename in Cloudflare Worker static
assets. A failed checksum stops deployment. Models must fit the 25 MiB static
asset limit; larger projects need a separate R2 publication pipeline.

Only the Engine Admin Worker is deployed. The existing public Worker, D1/R2
project registry, Platform/Super Admin and their project links are unchanged.
This published showcase has its own URL; it does not silently replace the older
`ar3dstudio.in/3Dprojects/jyoti-paradise` customer experience.

Publication is currently an operator-reviewed repository deployment, not an
unauthenticated browser write API. Editor copies remain local and cannot overwrite
the published snapshot. Automated authenticated cloud saving/publishing remains
a separate engine milestone. New projects can use the same manifest/viewer path.
