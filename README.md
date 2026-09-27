# Rekixo AR3D Engine

Rekixo AR3D Engine is the realistic 3D authoring and rendering system in the **Rekixo AR3D** product family.

The engine is reusable infrastructure for multiple products and projects. **Jyoti
Paradise is the first project being developed on it**, rather than the definition
of the engine itself. Project-specific elevation finishes must remain isolated
from shared loading, navigation, floor selection, and project discovery.

The recovered Jyoti reference design and its required model asset are documented
in [Jyoti reference design](docs/JYOTI-REFERENCE-DESIGN.md).

It is a sibling of `rekixo-ar3d-platform`, not a separate product family. The repositories intentionally keep separate production databases, R2 assets, Workers and deployment pipelines so heavy 3D workloads cannot destabilize the plot/project platform.

## Repository identity

- Canonical repository name: `rekixo-ar3d-engine`
- Historical repository name: `rekixo-3d-engine`
- Product family: **Rekixo AR3D**
- Sibling control-plane repository: `rekixo-ar3d-platform`

Repository identity cleanup does not rename existing Cloudflare runtime resources.

## Production surfaces

- Admin: `https://admin.rekixo.com/3Dprojects`
- Public: `https://ar3dstudio.in/3Dprojects/[slug]`
- Existing production compatibility fixture: `jyoti-paradise`

Jyoti Paradise is a normal 3D project/tenant. Stage 4 removed it as an application default; the generic runtime now discovers/selects projects from Engine D1 or from the requested public slug.

## Workspace

- `apps/admin` — dynamic read-only 3D project administration surface
- `apps/public` — customer-facing 3D experience
- `packages/contracts` — shared Engine contracts
- `packages/engine-core` — reusable project slug/path/asset-key rules
- `workers/admin.mjs` — isolated admin Worker and project registry/status APIs
- `workers/public.mjs` — isolated public Worker
- `database/migrations` — immutable isolated 3D D1 migration history
- `scripts` — controlled provisioning helpers
- `docs` — architecture and operations

Future packages such as viewer, scenes, asset-pipeline and shared UI can be extracted behind the same workspace boundary without changing project identity or storage.

## Stable production resource IDs

These existing infrastructure names stay unchanged:

- D1: `rekixo-3d-production`
- R2: `rekixo-3d-assets`
- Admin Worker: `rekixo-3d-admin`
- Public Worker: `rekixo-3d-public`
- Browser route prefix: `/3Dprojects`

Do not rename live infrastructure just to match the GitHub repository name.

## Multi-project model

Projects live as data in Engine D1; they are not separate repositories or runtime copies.

- Admin project registry: `/3Dprojects/api/projects`
- Admin project status: `/3Dprojects/api/status?slug=[slug]`
- Public project: `/3Dprojects/[slug]`
- Public data: `/3Dprojects/api/projects/[slug]`
- R2 project prefix: `projects/[slug]/...`

New projects are provisioned as **draft** records through the controlled GitHub Actions workflow `Provision Rekixo AR3D Project`. Project creation is not encoded in new schema migrations.

## Isolation contract

The sibling AR3D Platform uses its own production resources and routes. The 3D Engine must not bind directly to the platform D1/R2 resources.

Later Platform ↔ Engine integration should use an explicit project-link/service contract. A shared database is not the integration boundary.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/STAGE-4-ENGINE-GENERALIZATION.md](./docs/STAGE-4-ENGINE-GENERALIZATION.md).

## Development

Prerequisite: Node.js `>=22.13.0`.

```bash
npm install
npm test
```

Local apps:

```bash
npm run dev:admin
npm run dev:public
```

## Production deployment

Merges to `main` deploy through GitHub Actions. The workflow verifies the generalized Engine, applies only checked-in additive D1 migrations, keeps the isolated R2 bucket, deploys both Workers, verifies the generic project registry, and then verifies the existing Jyoti production compatibility fixture.

## Safety rules

- Keep Engine D1/R2 isolated from the AR3D Platform.
- Keep raw CAD/FBX/SKP/MAX production source assets out of Git.
- Never rewrite already-applied migration history.
- Never treat Jyoti Paradise or any customer project as the Engine identity/default.
- Never create a code repository per normal 3D customer project.
- Never add host-wide route takeovers.
- Do not expose privileged 3D HTTP write APIs before authenticated Stage 5 handoff exists.


## Jyoti Paradise — completed public product

Live project:

`https://ar3dstudio.in/3Dprojects/jyoti-paradise`

The Jyoti Paradise production experience now includes:

- live exterior 3D model
- orbit / zoom / reset / fullscreen
- day/night lighting toggle
- floor isolation for Ground + Floors 1–5
- interactive section cut
- facade / balcony detail mode
- brochure-backed floor explorer
- brochure-backed location/connectivity overview
- amenities and nearby locations
- mobile responsive layout
- fail-safe preview geometry if the production model cannot load

Source discipline remains strict:

- DWG/SKB/FBX source files stay outside Git
- brochure facts are not silently expanded
- the Location Map diagram is a connectivity overview, not a surveyed cadastral map
- section view is interactive model clipping, not a structural section drawing
- unit numbering is shown only where the supplied brochure series supports it

See [docs/JYOTI-PARADISE.md](./docs/JYOTI-PARADISE.md) and [docs/JYOTI-PARADISE-PHASE-1-GEOMETRY-LOCK.md](./docs/JYOTI-PARADISE-PHASE-1-GEOMETRY-LOCK.md).


## Jyoti Paradise realistic Phase 1–3

The Jyoti Paradise Engine experience now uses the supplied project model as the visual source and applies a realistic runtime pass rather than replacing it with generic/cartoon geometry.

Completed in this milestone:

- source/geometry/material audit
- G+5 + terrace floor lock
- FBX material inventory tooling
- PBR material enhancement
- architectural environment lighting and shadows
- day/night mode
- orbit, zoom and pan
- Ground/F1–F5 isolation
- exploded-floor interaction
- section cut
- brochure-backed unit selection and area display

Exact unit-to-mesh binding remains intentionally gated when the supplied source model does not expose reliable semantic unit IDs. See [docs/JYOTI-PARADISE-REALISTIC-PHASE-1-3.md](./docs/JYOTI-PARADISE-REALISTIC-PHASE-1-3.md).


## Jyoti Paradise — reference digital twin

Jyoti Paradise now has a project-specific full-screen digital twin presentation based on the supplied reference-video direction:

- aerial Project Navigation
- Building Explorer
- exploded / focused Floor Explorer
- brochure-backed Unit Explorer
- Amenities context
- Balcony camera
- Distance & Context view

Walkthrough remains available as a secondary inspection mode. The dedicated shell is isolated to the `jyoti-paradise` project slug; other Engine tenants keep the generic UI.

See [docs/JYOTI-PARADISE-REFERENCE-DIGITAL-TWIN.md](./docs/JYOTI-PARADISE-REFERENCE-DIGITAL-TWIN.md).
