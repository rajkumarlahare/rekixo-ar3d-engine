import { useEffect, useMemo, useState } from "react";
import {
  ADMIN_BASE_PATH,
  assertAdminProjectsPayload,
  assertAdminStatusPayload,
  type Admin3DProjectStatus,
  type AdminProjectsResponse,
  type EngineExperienceSummary,
  type EngineProjectSummary,
  type Scene3DType,
} from "@rekixo/3d-contracts";
import { geoPublicProjectPath, publicProjectPath } from "@rekixo/3d-engine-core";
import {
  createGeoExperience,
  deleteAllProjects,
  ensureProject,
  experiences,
  geoPlacement,
  releases,
  type CloudGeoPlacementState,
  type CloudReleaseSummary,
} from "../studio/cloud";
import { newProject, projectSlug } from "../studio/domain";
import "./engine-dashboard.css";

interface ApiStatus extends Admin3DProjectStatus {
  uploadContract?: {
    recommendedKey: string;
    format: string;
    versionedKeysRequired: boolean;
    maxRecommendedMobileBytes: number;
  };
}

const moduleOrder: Array<[Scene3DType, string]> = [
  ["project-navigation", "Project Navigation"],
  ["typical-floor", "Typical Floor"],
  ["amenity", "Amenities"],
  ["section", "Section View"],
  ["wing-distance", "Wing Distance"],
  ["balcony", "Balcony View"],
];

function formatBytes(value?: number) {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function requestedProjectSlug() {
  return new URLSearchParams(window.location.search)
    .get("project")
    ?.trim()
    .toLowerCase() || "";
}

function projectUrl(path: "studio" | "geo-mapper", slug: string) {
  return `/3Dprojects/${path}?project=${encodeURIComponent(slug)}`;
}

export default function EngineDashboard() {
  const [projects, setProjects] = useState<EngineProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [status, setStatus] = useState<ApiStatus>();
  const [experienceItems, setExperienceItems] = useState<EngineExperienceSummary[]>([]);
  const [releaseItems, setReleaseItems] = useState<CloudReleaseSummary[]>([]);
  const [geoState, setGeoState] = useState<CloudGeoPlacementState>();
  const [experienceBusy, setExperienceBusy] = useState(false);
  const [experienceError, setExperienceError] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch(`${ADMIN_BASE_PATH}/api/projects`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as AdminProjectsResponse & {
          error?: string;
        };
        if (!response.ok) {
          if (response.status === 401) {
            window.location.replace(
              `/3Dprojects/login?return=${encodeURIComponent(
                window.location.pathname + window.location.search,
              )}`,
            );
          }
          throw new Error(body.error ?? `Projects API failed (${response.status}).`);
        }
        assertAdminProjectsPayload(body);
        const items = body.projects ?? [];
        setProjects(items);
        setProjectsLoaded(true);
        const requested = requestedProjectSlug();
        setSelectedSlug((current) => {
          if (current && items.some((item) => item.slug === current)) return current;
          return (
            items.find((item) => item.slug === requested)?.slug ??
            items[0]?.slug ??
            ""
          );
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setProjectsLoaded(true);
        setError(
          reason instanceof Error ? reason.message : "Could not load 3D projects.",
        );
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selectedSlug) {
      setStatus(undefined);
      return;
    }
    const controller = new AbortController();
    setError("");
    setStatus(undefined);
    void fetch(
      `${ADMIN_BASE_PATH}/api/status?slug=${encodeURIComponent(selectedSlug)}`,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const body = (await response.json()) as ApiStatus & { error?: string };
        if (!response.ok) {
          if (response.status === 401) {
            window.location.replace(
              `/3Dprojects/login?return=${encodeURIComponent(
                window.location.pathname + window.location.search,
              )}`,
            );
          }
          throw new Error(body.error ?? `Status API failed (${response.status}).`);
        }
        assertAdminStatusPayload(body);
        setStatus(body);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : "Could not load 3D status.",
        );
      });
    return () => controller.abort();
  }, [selectedSlug, refresh]);


  useEffect(() => {
    if (!selectedSlug) {
      setExperienceItems([]);
      setReleaseItems([]);
      setGeoState(undefined);
      setExperienceError("");
      return;
    }

    let cancelled = false;
    setExperienceItems([]);
    setReleaseItems([]);
    setGeoState(undefined);
    setExperienceError("");

    void Promise.all([
      experiences(selectedSlug),
      releases(selectedSlug),
      geoPlacement(selectedSlug),
    ])
      .then(([experienceResult, releaseResult, placementResult]) => {
        if (cancelled) return;
        setExperienceItems(experienceResult.experiences);
        setReleaseItems(releaseResult.releases);
        setGeoState(placementResult);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setExperienceError(
          reason instanceof Error
            ? reason.message
            : "Project Experiences load nahi ho sake.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSlug, refresh]);

  function selectProject(slug: string) {
    setSelectedSlug(slug);
    setStatus(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("project", slug);
    window.history.replaceState({}, "", url);
  }

  async function deleteEveryProject() {
    if (deleteConfirm !== "DELETE ALL PROJECTS") {
      setDeleteError("DELETE ALL PROJECTS exactly type karein.");
      return;
    }

    setDeleteBusy(true);
    setDeleteError("");
    try {
      const result = await deleteAllProjects(projects.length, deleteConfirm);
      if (result.remainingProjects !== 0)
        throw new Error("Project registry empty nahi hua.");

      setProjects([]);
      setSelectedSlug("");
      setStatus(undefined);
      setSearch("");
      setDeleteConfirm("");
      setShowDeleteAll(false);
      setProjectsLoaded(true);

      const url = new URL(window.location.href);
      url.searchParams.delete("project");
      window.history.replaceState({}, "", url);
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "Projects permanently delete nahi ho sake.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  async function createProject() {
    const name = createName.trim();
    if (!name) {
      setCreateError("Project name required hai.");
      return;
    }

    setCreateBusy(true);
    setCreateError("");
    try {
      const project = newProject(name);
      project.location = createLocation.trim();
      const slug = projectSlug(project);
      project.slug = slug;
      const result = await ensureProject(project);
      window.location.assign(
        projectUrl("studio", result.project.slug),
      );
    } catch (reason) {
      setCreateError(
        reason instanceof Error
          ? reason.message
          : "Project create nahi ho saka.",
      );
    } finally {
      setCreateBusy(false);
    }
  }

  const selectedProject = projects.find((item) => item.slug === selectedSlug);
  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      [project.name, project.slug, project.location]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [projects, search]);

  const model = status?.activeModel;
  const scenes = useMemo(
    () => new Map(status?.scenes.map((scene) => [scene.type, scene]) ?? []),
    [status],
  );
  const enabledCount = status?.scenes.filter((scene) => scene.enabled).length ?? 0;
  const liveUrl = status
    ? `https://ar3dstudio.in${publicProjectPath(status.project.slug)}`
    : "";
  const assetPrefix = status
    ? `projects/${status.project.slug}`
    : "projects/{slug}";

  return (
    <main className="engine-home">
      <header className="engine-home__topbar">
        <a className="engine-home__brand" href="/3Dprojects">
          <span>R</span>
          <div>
            <small>REKIXO</small>
            <strong>AR3D Engine</strong>
          </div>
        </a>

        <nav className="engine-home__nav" aria-label="3D Engine navigation">
          <a className="active" href="/3Dprojects">Projects</a>
          <a
            href={selectedSlug ? projectUrl("studio", selectedSlug) : "/3Dprojects/studio"}
          >
            Design Studio
          </a>
          <a
            href={
              selectedSlug
                ? projectUrl("geo-mapper", selectedSlug)
                : "/3Dprojects/geo-mapper"
            }
          >
            3D Jio Mapper
          </a>
        </nav>

        <div className="engine-home__top-actions">
          <button
            className="engine-button engine-button--primary"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            + Create 3D Project
          </button>
          <button
            className="engine-button"
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="engine-home__intro">
        <div className="engine-home__intro-copy">
          <p className="engine-kicker">START HERE</p>
          <h1>Create → Edit → Map → Live</h1>
          <p>
            Naya 3D project yahin create hota hai. Create ke baad wahi project Design Studio
            me khulega; publish hone ke baad 3D Jio Mapper se real location set karein.
          </p>
          <button
            className="engine-button engine-button--primary engine-button--hero"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            + Create New 3D Project
          </button>
        </div>
        <div className="engine-home__steps" aria-label="3D project workflow">
          <button type="button" onClick={() => setShowCreate(true)}>
            <span>01</span><strong>Create Project</strong><small>Name + location se start karein</small>
          </button>
          <a href={selectedSlug ? projectUrl("studio", selectedSlug) : "/3Dprojects/studio"}>
            <span>02</span><strong>Design Studio</strong><small>GLB, rooms, material, publish</small>
          </a>
          <a href={selectedSlug ? projectUrl("geo-mapper", selectedSlug) : "/3Dprojects/geo-mapper"}>
            <span>03</span><strong>3D Jio Mapper</strong><small>Real location + heading + ground</small>
          </a>
          {liveUrl ? (
            <a href={liveUrl} target="_blank" rel="noreferrer">
              <span>04</span><strong>Open Live</strong><small>Customer-facing experience</small>
            </a>
          ) : (
            <div>
              <span>04</span><strong>Go Live</strong><small>Studio se publish karne ke baad</small>
            </div>
          )}
        </div>
      </section>

      {error ? (
        <section className="engine-home__alert">
          <strong>Engine data unavailable</strong>
          <span>{error}</span>
        </section>
      ) : null}

      <section className="engine-home__layout">
        <aside className="engine-projects">
          <div className="engine-section-title">
            <div>
              <p className="engine-kicker">YOUR PROJECTS</p>
              <h2>{projects.length} Engine project{projects.length === 1 ? "" : "s"}</h2>
              <small>Select karke usi project ka Studio / Jio / Live open karein.</small>
            </div>
          </div>

          <button
            className="engine-create-callout"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            <b>＋ Create New Project</b>
            <span>Naya project banane ke liye yahin click karein</span>
          </button>

          <label className="engine-project-search">
            <span>Search project</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name / slug / location"
            />
          </label>

          <div className="engine-project-list">
            {visibleProjects.map((project) => (
              <button
                type="button"
                key={project.id}
                className={
                  project.slug === selectedSlug
                    ? "engine-project-row engine-project-row--active"
                    : "engine-project-row"
                }
                onClick={() => selectProject(project.slug)}
              >
                <span className="engine-project-row__status" data-status={project.status} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.location || project.slug}</small>
                </span>
                <b>{project.status === "published" ? "LIVE" : "DRAFT"}</b>
              </button>
            ))}
            {!visibleProjects.length ? (
              <div className="engine-project-empty">
                <strong>No matching project</strong>
                <small>Search clear karein ya naya project banayein.</small>
              </div>
            ) : null}
          </div>

          {projects.length > 0 ? (
            <button
              className="engine-delete-all"
              type="button"
              onClick={() => {
                setDeleteError("");
                setDeleteConfirm("");
                setShowDeleteAll(true);
              }}
            >
              Delete all projects
            </button>
          ) : null}
        </aside>

        <div className="engine-workspace">
          {projectsLoaded && projects.length === 0 ? (
            <section className="engine-empty-workspace">
              <div className="engine-empty-workspace__icon">R</div>
              <p className="engine-kicker">CLEAN ENGINE</p>
              <h2>No 3D projects yet</h2>
              <p>
                Engine registry ab empty hai. Naya project create karne par hi Studio,
                3D Jio Mapper aur Live workflow start hoga.
              </p>
              <button
                className="engine-button engine-button--primary"
                type="button"
                onClick={() => setShowCreate(true)}
              >
                + Create First 3D Project
              </button>
            </section>
          ) : (
            <>
          <section className="engine-project-hero">
            <div>
              <p className="engine-kicker">SELECTED PROJECT</p>
              <span className={`engine-status engine-status--${status?.project.status ?? "loading"}`}>
                {status?.project.status ?? (selectedSlug ? "Loading" : "No project")}
              </span>
              <h2>{status?.project.name ?? selectedProject?.name ?? "Project select karein"}</h2>
              <p>
                {status?.project.location ??
                  selectedProject?.location ??
                  "Project select karke editor, Jio Mapper aur live controls use karein."}
              </p>
              <small>{selectedSlug || "No project selected"}</small>
            </div>

            <div className="engine-project-hero__actions">
              <a
                className="engine-action engine-action--primary"
                href={selectedSlug ? projectUrl("studio", selectedSlug) : "/3Dprojects/studio"}
                aria-disabled={!selectedSlug}
              >
                <span>01 · DESIGN STUDIO</span>
                <strong>Edit this project</strong>
                <small>Model upload, rooms, materials aur publish</small>
              </a>
              <a
                className="engine-action engine-action--geo"
                href={
                  selectedSlug
                    ? projectUrl("geo-mapper", selectedSlug)
                    : "/3Dprojects/geo-mapper"
                }
                aria-disabled={!selectedSlug}
              >
                <span>02 · 3D JIO MAPPER</span>
                <strong>Set real location</strong>
                <small>Satellite anchor, heading, ground aur public demo</small>
              </a>
              {liveUrl ? (
                <a
                  className="engine-action"
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>03 · LIVE SITE</span>
                  <strong>Open customer view</strong>
                  <small>Published customer-facing 3D experience</small>
                </a>
              ) : (
                <div className="engine-action engine-action--disabled">
                  <span>03 · LIVE SITE</span>
                  <strong>Publish required</strong>
                  <small>Design Studio se publish karne ke baad live hoga.</small>
                </div>
              )}
            </div>
          </section>

          <section className="engine-health-grid">
            <article>
              <span>MODEL</span>
              <strong>{model?.available ? "Ready" : "Upload needed"}</strong>
              <small>
                {model
                  ? `${model.name} · ${formatBytes(model.byteSize)}`
                  : "Open Design Studio to add the project GLB."}
              </small>
            </article>
            <article>
              <span>STORAGE</span>
              <strong>{status ? "Connected" : "Checking…"}</strong>
              <small>{status?.storage.bucket ?? "rekixo-3d-assets"}</small>
            </article>
            <article>
              <span>MODULES</span>
              <strong>{enabledCount}/6</strong>
              <small>Published project modules enabled</small>
            </article>
            <article>
              <span>RELEASE</span>
              <strong>{status?.project.status === "published" ? "Published" : "Draft"}</strong>
              <small>{status?.project.slug || selectedSlug || "Select a project"}</small>
            </article>
          </section>

          <section className="engine-home__panel">
            <div className="engine-section-title">
              <div>
                <p className="engine-kicker">PROJECT READINESS</p>
                <h3>Configured modules</h3>
              </div>
              <a href={selectedSlug ? projectUrl("studio", selectedSlug) : "/3Dprojects/studio"}>
                Edit in Studio
              </a>
            </div>

            <div className="engine-module-grid">
              {moduleOrder.map(([type, label], index) => {
                const scene = scenes.get(type);
                const ready = Boolean(scene?.enabled);
                const settings = (scene?.settings ?? {}) as { reason?: string };
                return (
                  <article
                    className={
                      ready
                        ? "engine-module engine-module--ready"
                        : "engine-module"
                    }
                    key={type}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{label}</strong>
                    <small>
                      {ready ? "Ready" : settings.reason ?? "Not configured"}
                    </small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="engine-home__panel engine-home__panel--compact">
            <div>
              <p className="engine-kicker">ASSET PIPELINE</p>
              <h3>Project storage details</h3>
              <p>
                Raw source files local/source archive me rahenge. Web-ready GLB aur
                release assets Engine ke isolated R2 storage me versioned keys ke saath rahenge.
              </p>
            </div>
            <dl>
              <div><dt>Format</dt><dd>{status?.uploadContract?.format ?? "GLB 2.0"}</dd></div>
              <div><dt>Model key</dt><dd>{status?.uploadContract?.recommendedKey ?? `${assetPrefix}/models/exterior-v1.glb`}</dd></div>
              <div><dt>Media</dt><dd>{assetPrefix}/media/</dd></div>
            </dl>
          </section>
            </>
          )}
        </div>
      </section>

      {showDeleteAll ? (
        <div className="engine-modal-backdrop" role="presentation">
          <section
            className="engine-create-modal engine-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="engine-delete-all-title"
          >
            <div className="engine-create-modal__head">
              <div>
                <p className="engine-kicker">PERMANENT DELETE</p>
                <h2 id="engine-delete-all-title">Delete all {projects.length} projects?</h2>
                <p>
                  D1 project data, releases, Studio drafts, 3D Jio placements aur
                  project-owned R2 assets permanently delete honge.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteAll(false)}
                aria-label="Close delete all projects"
                disabled={deleteBusy}
              >
                ×
              </button>
            </div>

            <label>
              <span>Confirmation</span>
              <input
                autoFocus
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="DELETE ALL PROJECTS"
                autoComplete="off"
              />
            </label>

            <div className="engine-delete-warning">
              <strong>Ye undo nahi hoga.</strong>
              <span>Existing public 3D URLs bhi project delete hote hi unavailable ho jayenge.</span>
            </div>

            {deleteError ? <p className="engine-create-error">{deleteError}</p> : null}

            <div className="engine-create-modal__actions">
              <button
                type="button"
                onClick={() => setShowDeleteAll(false)}
                disabled={deleteBusy}
              >
                Cancel
              </button>
              <button
                className="engine-delete-confirm"
                type="button"
                onClick={() => void deleteEveryProject()}
                disabled={deleteBusy || deleteConfirm !== "DELETE ALL PROJECTS"}
              >
                {deleteBusy ? "Deleting everything…" : "Permanently delete all projects"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showCreate ? (
        <div className="engine-modal-backdrop" role="presentation">
          <section className="engine-create-modal" role="dialog" aria-modal="true" aria-labelledby="engine-create-title">
            <div className="engine-create-modal__head">
              <div>
                <p className="engine-kicker">NEW ENGINE PROJECT</p>
                <h2 id="engine-create-title">Create 3D project</h2>
                <p>Naya isolated Engine project banega; existing projects change nahi honge.</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} aria-label="Close create project">×</button>
            </div>

            <label>
              <span>Project name</span>
              <input
                autoFocus
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="e.g. Sunrise Residency"
              />
            </label>
            <label>
              <span>Location</span>
              <input
                value={createLocation}
                onChange={(event) => setCreateLocation(event.target.value)}
                placeholder="City / project location"
              />
            </label>

            <div className="engine-create-next">
              <strong>Project create hone ke baad:</strong>
              <span>1. Design Studio open hoga</span>
              <span>2. Model upload/edit karke Publish karein</span>
              <span>3. 3D Jio Mapper me real location set karein</span>
            </div>

            {createError ? <p className="engine-create-error">{createError}</p> : null}

            <div className="engine-create-modal__actions">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={createBusy}
              >
                Cancel
              </button>
              <button
                className="engine-button engine-button--primary"
                type="button"
                onClick={() => void createProject()}
                disabled={createBusy}
              >
                {createBusy ? "Creating…" : "Create & open Studio"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="engine-home__footer">
        <span>Rekixo AR3D Engine · D1 + R2 isolated project runtime</span>
        <span>{selectedSlug ? `Selected: ${selectedSlug}` : ADMIN_BASE_PATH}</span>
      </footer>
    </main>
  );
}
