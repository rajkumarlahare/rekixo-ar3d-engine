import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
import "./styles.css";

const Studio = lazy(() => import("./studio/Studio"));
const PublishedViewer = lazy(() => import("./studio/PublishedViewer"));
const CloudLogin = lazy(() => import("./CloudLogin"));

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
  return new URLSearchParams(window.location.search).get("project")?.trim().toLowerCase() || "";
}

function App() {
  const [projects, setProjects] = useState<EngineProjectSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [status, setStatus] = useState<ApiStatus>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void fetch(`${ADMIN_BASE_PATH}/api/projects`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as AdminProjectsResponse & { error?: string };
        if (!response.ok) {
          if (response.status === 401)
            window.location.replace(
              `/3Dprojects/login?return=${encodeURIComponent(
                window.location.pathname + window.location.search,
              )}`,
            );
          throw new Error(body.error ?? `Projects API failed (${response.status}).`);
        }
        assertAdminProjectsPayload(body);
        const items = body.projects ?? [];
        setProjects(items);
        const requested = requestedProjectSlug();
        const initial = items.find((item) => item.slug === requested)?.slug ?? items[0]?.slug ?? "";
        setSelectedSlug((current) => current || initial);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load 3D projects.");
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!selectedSlug) {
      setStatus(undefined);
      return;
    }
    const controller = new AbortController();
    setError(undefined);
    void fetch(`${ADMIN_BASE_PATH}/api/status?slug=${encodeURIComponent(selectedSlug)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as ApiStatus & { error?: string };
        if (!response.ok) {
          if (response.status === 401)
            window.location.replace(
              `/3Dprojects/login?return=${encodeURIComponent(
                window.location.pathname + window.location.search,
              )}`,
            );
          throw new Error(body.error ?? `Status API failed (${response.status}).`);
        }
        assertAdminStatusPayload(body);
        setStatus(body);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load 3D status.");
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

  const model = status?.activeModel;
  const scenes = useMemo(
    () => new Map(status?.scenes.map((scene) => [scene.type, scene]) ?? []),
    [status],
  );
  const enabledCount = status?.scenes.filter((scene) => scene.enabled).length ?? 0;
  const publicUrl = status
    ? `https://ar3dstudio.in${publicProjectPath(status.project.slug)}`
    : undefined;
  const assetPrefix = status ? `projects/${status.project.slug}` : "projects/{slug}";

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">REKIXO</p><h1>AR3D Project Engine</h1></div>
        <div className="topbar-actions">
          <a href="/3Dprojects/studio">Open Design Studio</a>
          <select
            className="project-select"
            aria-label="Select 3D project"
            value={selectedSlug}
            onChange={(event) => selectProject(event.target.value)}
            disabled={!projects.length}
          >
            {!projects.length && <option value="">No projects</option>}
            {projects.map((project) => (
              <option value={project.slug} key={project.id}>{project.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className={`status status--${status?.project.status ?? "loading"}`}>
            {status?.project.status ?? (selectedSlug ? "Loading" : "No project")}
          </span>
          <h2>{status?.project.name ?? "Select a 3D project"}</h2>
          <p>{status?.project.location ?? "Project metadata is loaded from the Engine database."}</p>
        </div>
        <div className="hero-meta">
          <small>Public production URL</small>
          {publicUrl ? <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a> : <span>—</span>}
        </div>
      </section>

      {error && <section className="alert"><strong>Engine data unavailable</strong><span>{error}</span></section>}

      <section className="health-grid">
        <article><span>PROJECTS</span><strong>{projects.length || "—"}</strong><small>Dynamic Engine registry</small></article>
        <article><span>3D STORAGE</span><strong>{status ? "Connected" : "Checking…"}</strong><small>{status?.storage.bucket ?? "rekixo-3d-assets"}</small></article>
        <article><span>ACTIVE MODEL</span><strong>{model?.available ? "Live" : "Upload pending"}</strong><small>{model ? `${model.name} · ${formatBytes(model.byteSize)}` : "No active model loaded"}</small></article>
        <article><span>PUBLIC MODULES</span><strong>{enabledCount || "—"}</strong><small>Enabled for selected project</small></article>
      </section>

      <section className="asset-panel">
        <div>
          <p className="eyebrow">PROJECT ASSET PIPELINE</p>
          <h3>Project-scoped production assets</h3>
          <p>Every project uses its own D1 records and R2 key prefix. Raw CAD/FBX/SKP source files remain outside Git; only web-ready production assets belong in Rekixo 3D storage.</p>
        </div>
        <dl>
          <div><dt>Format</dt><dd>{status?.uploadContract?.format ?? "GLB 2.0"}</dd></div>
          <div><dt>Recommended model key</dt><dd>{status?.uploadContract?.recommendedKey ?? `${assetPrefix}/models/exterior-v1.glb`}</dd></div>
          <div><dt>Media prefix</dt><dd>{assetPrefix}/media/</dd></div>
          <div><dt>Versioned keys</dt><dd>{status?.uploadContract?.versionedKeysRequired === false ? "Optional" : "Required"}</dd></div>
        </dl>
      </section>

      <section>
        <div className="section-heading">
          <div><p className="eyebrow">PROJECT WORKSPACE</p><h3>Configured modules</h3></div>
          <span className="read-only">Status view · edit, sync and publish from Design Studio</span>
        </div>
        <div className="module-grid">
          {moduleOrder.map(([type, label], index) => {
            const scene = scenes.get(type);
            const ready = Boolean(scene?.enabled);
            const settings = (scene?.settings ?? {}) as { reason?: string };
            return (
              <article className={ready ? "module-card module-card--ready" : "module-card"} key={type}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{label}</strong>
                <small>{ready ? "Available" : settings.reason ?? "Not configured"}</small>
              </article>
            );
          })}
        </div>
      </section>

      <footer>
        <span>Rekixo AR3D Engine · isolated D1/R2 resources</span>
        <span>{status ? `Project: ${status.project.slug}` : ADMIN_BASE_PATH}</span>
      </footer>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount node");
createRoot(root).render(
  <React.StrictMode>
    {window.location.pathname.startsWith("/3Dprojects/showcase/") ? (
      <Suspense fallback={<p>Loading published design…</p>}>
        <PublishedViewer />
      </Suspense>
    ) : window.location.pathname.replace(/\/$/, "") === "/3Dprojects/studio" ? (
      <Suspense fallback={<p>Opening Design Studio…</p>}>
        <Studio />
      </Suspense>
    ) : window.location.pathname.replace(/\/$/, "") === "/3Dprojects/login" ? (
      <Suspense fallback={<p>Opening Engine Admin sign-in…</p>}>
        <CloudLogin />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
