# Rekixo 3D Design Admin: ownership and reuse

The Engine is the reusable 3D product infrastructure. Jyoti Paradise is its first
project. The existing 2D/plot Super Admin continues to own its current workflow;
it is not converted into a model editor.

Verified against Platform's `docs/STAGE-5-PLATFORM-ENGINE-INTEGRATION.md` on GitHub
and Engine's Wrangler configuration on 27 September 2026:

| Surface | Existing contract to preserve |
| --- | --- |
| Engine admin | `admin.rekixo.com/3Dprojects` |
| Engine design workspace | `/3Dprojects/studio` inside Engine admin |
| Engine customer projects | `ar3dstudio.in/3Dprojects/[slug]` |
| Engine database / assets | `rekixo-3d-production` / `rekixo-3d-assets` |
| Platform database / assets | `tiyansh-production` / `tiyansh-gallery-production` |
| Platform customer projects | `/projects/*` |
| Super Admin handoff | Engine admin with `?project=[engine-slug]` context |

These are existing configuration values, not newly deployed resources. No DNS,
domain mapping, Platform code, database or asset bucket was changed by this work.
The Studio branch must be deployed before its new route exists on the admin domain.

Deployment now defaults to **admin-only**, including pushes to main. It deploys
only `rekixo-3d-admin` and verifies the Studio route and editor bundle. Public Worker
deployment, D1 migrations and R2 bucket provisioning run only with an explicit
manual `engine-all` workflow input. Read-only compatibility checks still verify
the existing public project and integration API. This prevents an editor release
from implicitly updating the customer viewer or storage infrastructure.

Platform stores a verified Engine ID/slug link in `project_3d_links`, not the
models or room scenes. It only exposes a 3D customer link when Engine confirms the
same published identity. Handoff transfers context, not credentials. Studio's
current local projects are not yet part of this production registry.

## Implemented reuse

- One editor for every local project; project data is separate from editor code.
- Editable slugs with local uniqueness, independent project/asset ownership and
  non-destructive legacy project compatibility.
- A saved design can seed another project, including source model and references.
- Furnished floors can be duplicated without modifying the source floor or its
  model bindings. Copied dimensions require a new review.
- Drafts, review snapshots and portable backups remain local in this milestone.

## Path to larger sites

The next data model extension should express site -> buildings -> floors -> units
-> rooms, plus outdoor landscape zones. Keep boundaries and dimensions derived
from reviewed drawings. Represent furniture, windows, doors and landscape assets
as reusable catalog instances rather than project-specific code.

Large campuses need independently loadable building/floor assets, instancing for
repeated objects, compressed textures, geometry levels of detail and progressive
loading. Validate memory, frame rate and navigation using a representative large
project before claiming campus-scale support. The current single-model browser
prototype has explicit file/room limits and is not a large-campus performance proof.

Before cloud authoring, add authenticated Engine operators, per-project access,
server-side slug uniqueness, asset processing jobs and immutable published release
manifests. Reuse the existing verified Platform link after publication. Keep the
current domains and separate Engine infrastructure throughout this progression.
