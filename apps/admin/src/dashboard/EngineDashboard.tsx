import { useEffect, useMemo, useState } from "react";
import {
  ADMIN_BASE_PATH,
  assertAdminProjectsPayload,
  assertAdminStatusPayload,
  type Admin3DProjectStatus,
  type AdminProjectsResponse,
  type EngineProjectSummary,
  type Scene3DType,
} from "@rekixo/3d-contracts";
import { publicProjectPath } from "@rekixo/3d-engine-core";
import { ensureProject } from "../studio/cloud";
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
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

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

  function selectProject(slug: string) {
    setSelectedSlug(slug);
    setStatus(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("project", slug);
    window.history.replaceState({}, "", url);
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
            + Create project
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
        <div>
          <p className="engine-kicker">ENGINE WORKFLOW</p>
          <h1>Project se live 3D tak sab ek jagah.</h1>
          <p>
            Project choose karein, Design Studio me model/editing karein, 3D Jio Mapper
            me real location set karein, phir published experience open karein.
          </p>
        </div>
        <div className="engine-home__steps" aria-label="3D project workflow">
          <article><span>01</span><strong>Project</strong><small>Create / select</small></article>
          <article><span>02</span><strong>Studio</strong><small>Model + rooms + publish</small></article>
          <article><span>03</span><strong>3D Jio</strong><small>Location + heading</small></article>
          <article><span>04</span><strong>Live</strong><small>Customer experience</small></article>
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
              <p className="engine-kicker">PROJECTS</p>
              <h2>{projects.length} Engine project{projects.length === 1 ? "" : "s"}</h2>
            </div>
            <button type="button" onClick={() => setShowCreate(true)}>New</button>
          </div>

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
        </aside>

        <div className="engine-workspace">
          <section className="engine-project-hero">
            <div>
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
                <span>Design Studio</span>
                <strong>Open editor</strong>
                <small>Model upload, rooms, materials, publish</small>
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
                <span>3D Jio Mapper</span>
                <strong>Place on map</strong>
                <small>Satellite anchor, heading, ground, public demo</small>
              </a>
              {liveUrl ? (
                <a
                  className="engine-action"
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>Published site</span>
                  <strong>Open live</strong>
                  <small>Customer-facing 3D experience</small>
                </a>
              ) : (
                <div className="engine-action engine-action--disabled">
                  <span>Published site</span>
                  <strong>Not live yet</strong>
                  <small>Publish from Design Studio first.</small>
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
              <small>{status?.project.slug ?? selectedSlug || "Select a project"}</small>
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
        </div>
      </section>

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
