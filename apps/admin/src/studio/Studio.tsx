import { useEffect, useRef, useState } from "react";
import SceneCanvas, {
  type ModelNodeSummary,
  type TransformCommit,
  type TransformMode,
  type View,
} from "./SceneCanvas";
import {
  catalog,
  duplicateFloor,
  projectSlug,
  id,
  newProject,
  snapshot,
  validateProject,
  type Asset,
  type Furniture,
  type Kind,
  type Project,
  type Room,
} from "./domain";
import * as storage from "./storage";
import * as cloud from "./cloud";
import {
  importPublished,
  loadPublished,
  loadPublishedCatalog,
  type PublishedCatalogEntry,
} from "./published";
import { buildSceneManifestV2 } from "./manifestV2";
import StudioOverview from "./StudioOverview";
import StudioSources from "./StudioSources";
import StudioEvidence from "./StudioEvidence";
import StudioPublish from "./StudioPublish";
import { buildStudioReadiness } from "./readiness";
import "./studio.css";
import "./studio-operations.css";
import "./studio-superadmin-theme.css";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export default function Studio() {
  const [project, setProject] = useState<Project>(),
    [list, setList] = useState<Project[]>([]),
    [files, setFiles] = useState<Asset[]>([]),
    [roomId, setRoomId] = useState(""),
    [selected, setSelected] = useState(""),
    [view, setView] = useState<View>("rooms"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [dirty, setDirty] = useState(false),
    [review, setReview] = useState(""),
    [backup, setBackup] = useState<{ url: string; name: string }>(),
    [mesh, setMesh] = useState("");
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [transformSnap, setTransformSnap] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const [editorFocus, setEditorFocus] = useState(true);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showAssetShelf, setShowAssetShelf] = useState(true);
  const [modelNodes, setModelNodes] = useState<ModelNodeSummary[]>([]);
  const [modelNodeFilter, setModelNodeFilter] = useState("");
  const [manifestText, setManifestText] = useState("");
  const [cloudSession, setCloudSession] = useState<cloud.CloudSession>();
  const [cloudProjects, setCloudProjects] = useState<cloud.CloudProjectSummary[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [cloudSearch, setCloudSearch] = useState("");
  const [cloudFilter, setCloudFilter] = useState<"active" | "archived">("active");
  const [cloudReleases, setCloudReleases] = useState<cloud.CloudReleaseSummary[]>([]);
  const [published, setPublished] = useState<PublishedCatalogEntry[]>([]);
  const [workspace, setWorkspace] = useState<
    "overview" | "editor" | "sources" | "evidence" | "publish"
  >("overview");
  useEffect(() => {
    let active = true;
    void cloud
      .session()
      .then((next) => {
        if (!active) return;
        setCloudSession(next);
        if (next.authenticated)
          return cloud.projects("", "active", 50, 0).then((result) => {
            if (active) setCloudProjects(result.projects);
          });
      })
      .catch(() => {
        if (active)
          setCloudSession({
            configured: false,
            databaseReady: false,
            authenticated: false,
          });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!cloudSession?.authenticated) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void cloud
        .projects(cloudSearch, cloudFilter, 50, 0)
        .then((result) => {
          if (active) setCloudProjects(result.projects);
        })
        .catch((reason: unknown) => {
          if (active)
            setError(
              reason instanceof Error
                ? reason.message
                : "Cloud projects could not be loaded.",
            );
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cloudSearch, cloudFilter, cloudSession?.authenticated]);

  useEffect(() => {
    let active = true;
    void loadPublishedCatalog()
      .then((rows) => {
        if (active) setPublished(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const undo = useRef<Project[]>([]),
    redo = useRef<Project[]>([]);
  const modelInput = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const entries = await storage.projects();
    setList(entries.sort((a, b) => b.updated.localeCompare(a.updated)));
  }
  function open(p: Project) {
    setManifestText("");
    setBackup(undefined);
    setMessage("");
    setMesh("");
    setModelNodes([]);
    setModelNodeFilter("");
    setProject(p);
    setRoomId(p.scene.rooms[0]?.id ?? "");
    setSelected(p.scene.rooms[0]?.id ?? "");
    setReview("");
    setWorkspace("overview");
    setView(p.scene.modelId ? "building" : "rooms");
    setDirty(false);
    undo.current = [];
    redo.current = [];
    setError("");
  }
  useEffect(() => {
    return () => {
      if (backup) URL.revokeObjectURL(backup.url);
    };
  }, [backup]);
  useEffect(() => {
    let active = true;
    void storage
      .projects()
      .then((p) => {
        if (!active) return;
        p.sort((a, b) => b.updated.localeCompare(a.updated));
        setList(p);
        open(p[0] ?? newProject("Untitled project"));
      })
      .catch(() =>
        setError(
          "Cannot open browser storage. Enable site storage to use Studio.",
        ),
      );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!project) return;
    void Promise.all(project.assets.map(storage.asset))
      .then((a) => {
        if (active) setFiles(a.filter((f): f is Asset => Boolean(f)));
      })
      .catch(() => setError("Could not read project assets."));
    return () => {
      active = false;
    };
  }, [project?.id, project?.assets]);
  useEffect(() => {
    if (!cloudSession?.authenticated || !project?.cloud) {
      setCloudReleases([]);
      return;
    }
    let active = true;
    void cloud
      .releases(projectSlug(project))
      .then((result) => {
        if (active) setCloudReleases(result.releases);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Release history could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [
    cloudSession?.authenticated,
    project?.id,
    project?.cloud?.revision,
  ]);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(next: Project) {
    if (!project) return;
    setBackup(undefined);
    undo.current.push(project);
    if (undo.current.length > 40) undo.current.shift();
    redo.current = [];
    setProject(next);
    setDirty(true);
    setMessage("");
    setError("");
  }
  async function task(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function persist(p: Project, assets: Asset[] = []) {
    const next = { ...p, updated: new Date().toISOString() };
    await storage.save(next, assets);
    setProject(next);
    setDirty(false);
    await refresh();
    setMessage(
      "Saved in the local offline cache. Use Save to cloud for the shared Engine draft.",
    );
    return next;
  }
  function switchProject(p: Project) {
    if (dirty) {
      setError("Save your changes before switching projects.");
      return;
    }
    open(p);
  }

  async function refreshCloudProjects() {
    if (!cloudSession?.authenticated) return;
    const result = await cloud.projects(cloudSearch, cloudFilter, 50, 0);
    setCloudProjects(result.projects);
  }

  async function refreshCloudReleases(current?: Project) {
    const target = current ?? project;
    if (!cloudSession?.authenticated || !target?.cloud) {
      setCloudReleases([]);
      return;
    }
    const result = await cloud.releases(projectSlug(target));
    setCloudReleases(result.releases);
  }

  async function refreshPublishedCatalog() {
    setPublished(await loadPublishedCatalog());
  }

  async function openCloudProject(slug: string) {
    if (dirty)
      throw Error("Save your local changes before opening a cloud project.");
    try {
      const downloaded = await cloud.downloadProject(slug);
      await storage.save(downloaded.project, downloaded.files);
      await refresh();
      open(downloaded.project);
      setMessage(
        "Cloud draft downloaded and cached locally for offline editing.",
      );
      return;
    } catch (reason) {
      if (
        !(reason instanceof Error) ||
        !/Cloud draft not found/i.test(reason.message)
      )
        throw reason;
    }

    const summary = cloudProjects.find((entry) => entry.slug === slug);
    if (!summary)
      throw Error("Cloud project metadata is no longer available.");

    const publishedEntry = published.find((entry) => entry.slug === slug);
    if (publishedEntry) {
      const seeded = await loadPublished(slug);
      const projectFromPublished: Project = {
        ...seeded.project,
        id: summary.id,
        slug: summary.slug,
        name: summary.name,
        location: summary.location ?? "",
        updated: new Date().toISOString(),
      };
      delete projectFromPublished.cloud;
      const ownedFiles = seeded.files.map((asset) => ({
        ...asset,
        projectId: summary.id,
      }));
      await storage.save(projectFromPublished, ownedFiles);
      await refresh();
      open(projectFromPublished);
      setMessage(
        "This Engine project had no cloud draft. Studio was seeded from its read-only published design; Save to cloud will create revision 1 without changing the live public project.",
      );
      return;
    }

    const blank = newProject(summary.name);
    blank.id = summary.id;
    blank.slug = summary.slug;
    blank.location = summary.location ?? "";
    blank.updated = new Date().toISOString();
    await storage.save(blank);
    await refresh();
    open(blank);
    setMessage(
      "This Engine project had no Studio draft, so an empty local authoring draft was created. Save to cloud will create revision 1; existing live models/scenes remain untouched.",
    );
  }

  async function syncCloudProject() {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before saving a cloud draft.");
    const next = await cloud.syncProject(p, files);
    await storage.save(next);
    setProject(next);
    setDirty(false);
    await Promise.all([
      refresh(),
      refreshCloudProjects(),
      refreshCloudReleases(next),
    ]);
    setMessage(
      `Cloud draft saved · revision ${next.cloud?.revision ?? "—"} · local cache updated. Publishing remains a separate immutable step.`,
    );
  }
  async function publishCurrentRelease() {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before publishing.");
    const gate = buildStudioReadiness(
      p,
      files,
      dirty,
      cloudSession,
      cloudReleases,
    );
    if (gate.blockers.length)
      throw Error(
        `Publish blocked: ${gate.blockers[0].title}. ${gate.blockers[0].detail}`,
      );
    if (!p.cloud)
      throw Error("Save this project to cloud before publishing.");
    const result = await cloud.publishRelease(
      projectSlug(p),
      p.cloud.revision,
    );
    await Promise.all([
      refreshCloudReleases(p),
      refreshCloudProjects(),
      refreshPublishedCatalog(),
    ]);
    setMessage(
      `Immutable release v${result.release.version} is active. Draft edits will not change it until another explicit publish.`,
    );
  }

  async function activatePublishedRelease(releaseId: string, version: number) {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before changing the active release.");
    if (dirty)
      throw Error("Save or discard local draft changes before switching a release.");
    await cloud.activateRelease(projectSlug(p), releaseId);
    await Promise.all([
      refreshCloudReleases(p),
      refreshCloudProjects(),
      refreshPublishedCatalog(),
    ]);
    setMessage(
      `Release v${version} is now the active immutable public release.`,
    );
  }

  async function createReviewVersion() {
    const next = await persist(
      snapshot(p, `Review ${p.releases.length + 1}`),
    );
    setReview(next.releases.at(-1)!.id);
    setMessage(
      "Immutable local review created. This review remains a draft until you explicitly publish a cloud release.",
    );
  }

  function history(back: boolean) {
    if (!project) return;
    const from = back ? undo : redo,
      to = back ? redo : undo,
      p = from.current.pop();
    if (p) {
      to.current.push(project);
      setProject(p);
      setDirty(true);
      setReview("");
    }
  }
  useEffect(() => {
    if (workspace !== "editor" || review || busy) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        history(event.shiftKey ? false : true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        history(false);
        return;
      }
      if (key === "w") setTransformMode("translate");
      else if (key === "e") setTransformMode("rotate");
      else if (key === "r") setTransformMode("scale");
      else if (key === "f") {
        event.preventDefault();
        setFocusRequest((value) => value + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workspace, review, busy, project]);
  if (!project)
    return (
      <main className="studio">
        <p role="alert">{error || "Opening your workspace…"}</p>
      </main>
    );
  const p = project,
    release = p.releases.find((r) => r.id === review),
    scene = release?.scene ?? p.scene,
    room = scene.rooms.find((r) => r.id === roomId),
    item = scene.furniture.find((f) => f.id === selected),
    floor = scene.floors.find((f) => f.id === room?.floorId),
    readiness = buildStudioReadiness(
      p,
      files,
      dirty,
      cloudSession,
      cloudReleases,
    ),
    publishedCurrent = published.some(
      (entry) => entry.slug === projectSlug(p),
    ),
    visibleLocalProjects = list.filter((entry) => {
      const query = projectSearch.trim().toLowerCase();
      return (
        entry.id === p.id ||
        !query ||
        entry.name.toLowerCase().includes(query) ||
        projectSlug(entry).includes(query)
      );
    }),
    unitCount = new Set(
      p.scene.rooms.map(
        (candidate) =>
          `${candidate.floorId}\u0000${candidate.unit.trim()}`,
      ),
    ).size,
    filteredModelNodes = modelNodes
      .filter((node) =>
        node.name.toLowerCase().includes(modelNodeFilter.trim().toLowerCase()),
      )
      .slice(0, 120);
  function patchRoom(change: Partial<Room>) {
    if (!room) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        rooms: p.scene.rooms.map((r) =>
          r.id === room.id ? { ...r, ...change } : r,
        ),
      },
    });
  }
  function patchItem(change: Partial<Furniture>) {
    if (!item) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        furniture: p.scene.furniture.map((f) =>
          f.id === item.id ? { ...f, ...change } : f,
        ),
      },
    });
  }
  function commitCanvasTransform(change: TransformCommit) {
    if (review || busy) return;
    let next: Project;
    if (change.kind === "room") {
      next = {
        ...p,
        scene: {
          ...p.scene,
          rooms: p.scene.rooms.map((candidate) =>
            candidate.id === change.id
              ? {
                  ...candidate,
                  ...(change.x !== undefined ? { x: change.x } : {}),
                  ...(change.z !== undefined ? { z: change.z } : {}),
                  ...(change.width !== undefined ? { width: change.width } : {}),
                  ...(change.depth !== undefined ? { depth: change.depth } : {}),
                  ...(change.height !== undefined ? { height: change.height } : {}),
                }
              : candidate,
          ),
        },
      };
    } else {
      next = {
        ...p,
        scene: {
          ...p.scene,
          furniture: p.scene.furniture.map((candidate) =>
            candidate.id === change.id
              ? {
                  ...candidate,
                  ...(change.x !== undefined ? { x: change.x } : {}),
                  ...(change.z !== undefined ? { z: change.z } : {}),
                  ...(change.rotation !== undefined
                    ? { rotation: change.rotation }
                    : {}),
                }
              : candidate,
          ),
        },
      };
    }
    try {
      validateProject(next);
      edit(next);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That transform is outside the valid design bounds.",
      );
    }
  }
  function addRoom() {
    const prev = p.scene.rooms.at(-1);
    const r: Room = {
      id: id(),
      name: `Room ${p.scene.rooms.length + 1}`,
      unit: room?.unit ?? "Unit 101",
      floorId: room?.floorId ?? p.scene.floors[0].id,
      x: prev ? prev.x + prev.width / 2 + 3 : 0,
      z: 0,
      width: 4,
      depth: 3.5,
      height: 2.8,
      color: "#cdbfa9",
      source: "",
      verified: false,
    };
    edit({ ...p, scene: { ...p.scene, rooms: [...p.scene.rooms, r] } });
    setRoomId(r.id);
    setSelected(r.id);
    setView("rooms");
  }
  function select(key: string) {
    setSelected(key);
    const r =
      scene.rooms.find((r) => r.id === key) ??
      scene.rooms.find(
        (r) => r.id === scene.furniture.find((f) => f.id === key)?.roomId,
      );
    if (r) setRoomId(r.id);
  }
  async function upload(file: File, model: boolean) {
    if (model && !/\.(glb|fbx)$/i.test(file.name))
      throw Error("Choose a GLB or FBX model.");
    const a = await storage.makeAsset(file, p.id);
    const previousModelId = model ? p.scene.modelId : undefined;
    const previousModelNeededByReview = previousModelId
      ? p.releases.some((release) => release.scene.modelId === previousModelId)
      : false;
    const retainedAssets =
      previousModelId && !previousModelNeededByReview
        ? p.assets.filter((assetId) => assetId !== previousModelId)
        : p.assets;
    const next = {
      ...p,
      assets: [...retainedAssets, a.id],
      scene: {
        ...p.scene,
        ...(model
          ? {
              modelId: a.id,
              rooms: p.scene.rooms.map((r) => ({ ...r, mesh: undefined })),
            }
          : {}),
      },
    };
    await persist(next, [a]);
    if (previousModelId && !previousModelNeededByReview)
      await storage.removeAssetIfUnreferenced(previousModelId);
    undo.current = [];
    redo.current = [];
    if (model) {
      setMesh("");
      setView("building");
    }
  }
  const field = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 0.1,
  ) => (
    <label>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return (
    <main
      className={
        workspace === "editor" && editorFocus
          ? "studio studio--focus-editor"
          : "studio"
      }
    >
      <header className="studio-head">
        <a className="studio-brand" href="/3Dprojects">
          R
          <span>
            REKIXO <small>3D DESIGN ADMIN</small>
          </span>
        </a>
        <div className="project-name">
          <input
            aria-label="Project name"
            value={p.name}
            disabled={Boolean(review) || busy}
            onChange={(e) => edit({ ...p, name: e.target.value })}
          />
          <span>
            {dirty
              ? "Unsaved changes"
              : p.cloud
                ? `Cloud r${p.cloud.revision} · local cache`
                : "Local workspace"}{" "}
            · {p.scene.rooms.length} rooms
          </span>
        </div>
        <div className="studio-project-switcher">
          <label className="studio-project-search">
            <span>SEARCH</span>
            <input
              aria-label="Search 3D projects"
              value={projectSearch}
              onChange={(event) => {
                const value = event.target.value;
                setProjectSearch(value);
                setCloudSearch(value);
              }}
              placeholder="Name / slug"
              disabled={busy}
            />
          </label>
          <label>
            <span>PROJECT</span>
            <select
              aria-label="Selected local project"
              value={list.some((entry) => entry.id === p.id) ? p.id : ""}
              disabled={busy || dirty}
              onChange={(event) => {
                const next = list.find(
                  (entry) => entry.id === event.target.value,
                );
                if (next) switchProject(next);
              }}
            >
              <option value="">
                {list.some((entry) => entry.id === p.id)
                  ? "Select project"
                  : "Unsaved project"}
              </option>
              {visibleLocalProjects.map((entry) => (
                <option value={entry.id} key={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          {cloudSession?.authenticated && (
            <label>
              <span>CLOUD</span>
              <select
                aria-label="Selected cloud project"
                value=""
                disabled={busy || dirty || !cloudProjects.length}
                onChange={(event) => {
                  const slug = event.target.value;
                  if (!slug) return;
                  void task(() => openCloudProject(slug));
                }}
              >
                <option value="">
                  {cloudProjects.length ? "Open cloud project…" : "No cloud projects"}
                </option>
                {cloudProjects.map((entry) => (
                  <option key={entry.id} value={entry.slug}>
                    {entry.name} · r{entry.draftRevision ?? "—"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="studio-actions">
          <button
            disabled={busy || dirty}
            onClick={() => {
              if (dirty) {
                setError("Save your changes before creating a project.");
                return;
              }
              open(newProject("Untitled project"));
              setWorkspace("overview");
            }}
          >
            + New project
          </button>
          <button
            disabled={busy || Boolean(review)}
            onClick={() =>
              task(async () => {
                await persist(p);
              })
            }
          >
            Save local
          </button>
          {cloudSession?.authenticated ? (
            <>
              <button
                disabled={busy || Boolean(review)}
                onClick={() => task(syncCloudProject)}
              >
                Save to cloud
              </button>
              {p.cloud && (
                <button
                  disabled={
                    busy ||
                    dirty ||
                    Boolean(review) ||
                    !readiness.publishable
                  }
                  title={
                    readiness.publishable
                      ? "Publish current immutable release"
                      : readiness.blockers[0]?.detail
                  }
                  onClick={() => task(publishCurrentRelease)}
                >
                  Publish release
                </button>
              )}
            </>
          ) : (
            <a
              href="/3Dprojects/login?return=/3Dprojects/studio"
              className="studio-cloud-login"
            >
              Cloud sign in
            </a>
          )}
          <button
            disabled={busy}
            onClick={() =>
              task(async () => {
                const blob = await storage.exportPackage(p);
                setBackup({
                  url: URL.createObjectURL(blob),
                  name: `${p.name.replace(/[^a-z0-9-]/gi, "-")}.rekixo.json`,
                });
                setMessage(
                  "Backup ready with models, references and review versions. Click Download backup to save the file.",
                );
              })
            }
          >
            Export backup
          </button>
          {backup && (
            <a href={backup.url} download={backup.name}>
              Download backup
            </a>
          )}
          <button
            disabled={busy}
            onClick={() =>
              task(async () => {
                validateProject(p);
                const manifest = buildSceneManifestV2(p, files);
                setManifestText(JSON.stringify(manifest, null, 2));
                setMessage(
                  "Scene Manifest V2 ready. It is a portable scene contract; keep the full backup for model/reference bytes.",
                );
              })
            }
          >
            Export scene manifest
          </button>
        </div>
      </header>
      <nav className="studio-ops-tabs" aria-label="3D project workspace">
        {(
          [
            ["overview", "Overview"],
            ["editor", "3D Editor"],
            ["sources", "Sources"],
            ["evidence", "Evidence"],
            ["publish", "Preview & Publish"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={workspace === key ? "active" : ""}
            onClick={() => {
              setWorkspace(key);
              if (key === "editor") setEditorFocus(true);
            }}
          >
            <span aria-hidden="true">
              {key === "overview"
                ? "⌂"
                : key === "editor"
                  ? "◫"
                  : key === "sources"
                    ? "⇧"
                    : key === "evidence"
                      ? "✓"
                      : "↗"}
            </span>
            {label}
            {key === "evidence" && p.scene.rooms.length > 0 && (
              <small>
                {readiness.reviewedRooms}/{readiness.totalRooms}
              </small>
            )}
            {key === "publish" && readiness.blockers.length > 0 && (
              <small className="ops-tab-alert">{readiness.blockers.length}</small>
            )}
          </button>
        ))}
      </nav>
      <div className="storage-banner">
        {manifestText && (
          <label>
            Scene manifest
            <textarea
              aria-label="Scene manifest"
              readOnly
              value={manifestText}
            />
          </label>
        )}
        YOUR DESIGN WORKSPACE{" "}
        <span>
          {cloudSession?.authenticated
            ? "Local cache + authenticated Engine cloud drafts. Publish creates an immutable release; later draft edits do not change the live release."
            : "Local/offline cache is available. Cloud writes stay locked behind the dedicated Engine Admin session."}
        </span>
        <button disabled={busy} onClick={() => importInput.current?.click()}>
          Import backup
        </button>
      </div>
      {(error || message || busy) && (
        <div
          className={error ? "studio-feedback error" : "studio-feedback"}
          role={error ? "alert" : "status"}
        >
          {error || (busy ? "Working…" : message)}
        </div>
      )}
      {workspace === "overview" && (
        <StudioOverview
          project={p}
          dirty={dirty}
          readiness={readiness}
          unitCount={unitCount}
          onOpenEditor={() => {
            setWorkspace("editor");
            setEditorFocus(true);
            setEditorFocus(true);
          }}
          onOpenSources={() => setWorkspace("sources")}
          onOpenEvidence={() => setWorkspace("evidence")}
          onOpenPublish={() => setWorkspace("publish")}
        />
      )}
      {workspace === "sources" && (
        <StudioSources
          project={p}
          files={files}
          readiness={readiness}
          busy={busy}
          onImportModel={() => modelInput.current?.click()}
          onImportReference={() => referenceInput.current?.click()}
          onDownload={(asset) => download(asset.blob, asset.name)}
        />
      )}
      {workspace === "evidence" && (
        <StudioEvidence
          project={p}
          readiness={readiness}
          onOpenRoom={(key) => {
            setRoomId(key);
            setSelected(key);
            setReview("");
            setView("rooms");
            setWorkspace("editor");
          }}
        />
      )}
      {workspace === "publish" && (
        <StudioPublish
          project={p}
          readiness={readiness}
          session={cloudSession}
          releases={cloudReleases}
          published={publishedCurrent}
          busy={busy}
          dirty={dirty}
          onSaveLocal={() => void task(async () => { await persist(p); })}
          onSaveCloud={() => void task(syncCloudProject)}
          onPublish={() => void task(publishCurrentRelease)}
          onActivate={(releaseId, version) =>
            void task(() => activatePublishedRelease(releaseId, version))
          }
          onCreateReview={() => void task(createReviewVersion)}
        />
      )}
      {workspace === "editor" && (
        <div
          className={[
            "studio-layout",
            "editor-core",
            showLeftPanel ? "" : "editor-core--no-left",
            showRightPanel ? "" : "editor-core--no-right",
            showAssetShelf ? "" : "editor-core--no-assets",
          ]
            .filter(Boolean)
            .join(" ")}
        >
        <aside className="studio-sidebar">
          <div className="editor-project-admin">
          <section className="cloud-workspace" aria-label="Cloud project workspace">
            <div className="section-label">ENGINE CLOUD</div>
            {!cloudSession ? (
              <small>Checking private cloud workspace…</small>
            ) : !cloudSession.configured ? (
              <small>
                Cloud writes are locked until dedicated Engine Admin secrets are configured.
              </small>
            ) : !cloudSession.databaseReady ? (
              <small>
                Cloud schema is not installed yet. Local Studio remains available.
              </small>
            ) : !cloudSession.authenticated ? (
              <a
                className="wide cloud-signin-link"
                href="/3Dprojects/login?return=/3Dprojects/studio"
              >
                Sign in to cloud workspace
              </a>
            ) : (
              <>
                <input
                  aria-label="Search cloud projects"
                  value={cloudSearch}
                  onChange={(event) => setCloudSearch(event.target.value)}
                  placeholder="Search cloud projects"
                  disabled={busy}
                />
                <div className="cloud-filter">
                  <button
                    type="button"
                    className={cloudFilter === "active" ? "active" : ""}
                    onClick={() => setCloudFilter("active")}
                    disabled={busy}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    className={cloudFilter === "archived" ? "active" : ""}
                    onClick={() => setCloudFilter("archived")}
                    disabled={busy}
                  >
                    Archived
                  </button>
                </div>
                <select
                  aria-label="Cloud project library"
                  value=""
                  disabled={busy || dirty || !cloudProjects.length}
                  onChange={(event) => {
                    const slug = event.target.value;
                    if (!slug) return;
                    void task(async () => {
                      if (cloudFilter === "archived") {
                        await cloud.patchProject(slug, { action: "restore" });
                        setCloudFilter("active");
                      }
                      await openCloudProject(slug);
                      await refreshCloudProjects();
                    });
                  }}
                >
                  <option value="">
                    {cloudProjects.length
                      ? "Open cloud project…"
                      : "No matching cloud projects"}
                  </option>
                  {cloudProjects.map((entry) => (
                    <option key={entry.id} value={entry.slug}>
                      {cloudFilter === "archived" ? "Restore · " : ""}
                      {entry.name} · r{entry.draftRevision ?? "—"}
                    </option>
                  ))}
                </select>
                {p.cloud && (
                  <div className="release-panel">
                    <div className="release-panel-head">
                      <small>IMMUTABLE RELEASES</small>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          dirty ||
                          Boolean(review) ||
                          !readiness.publishable
                        }
                        title={
                          readiness.publishable
                            ? "Publish current immutable release"
                            : readiness.blockers[0]?.detail
                        }
                        onClick={() => task(publishCurrentRelease)}
                      >
                        Publish current
                      </button>
                    </div>
                    {!cloudReleases.length ? (
                      <small>
                        No immutable release yet. Cloud draft edits are not public
                        until you publish.
                      </small>
                    ) : (
                      cloudReleases.slice(0, 8).map((entry) => (
                        <div
                          className={
                            entry.active
                              ? "release-row release-row--active"
                              : "release-row"
                          }
                          key={entry.id}
                        >
                          <span>
                            <b>v{entry.version}</b>
                            <small>
                              {entry.active
                                ? "Active public release"
                                : entry.sourceDraftRevision
                                  ? `Draft r${entry.sourceDraftRevision}`
                                  : "Frozen legacy runtime"}
                            </small>
                          </span>
                          {entry.active ? (
                            <strong>LIVE</strong>
                          ) : (
                            <button
                              type="button"
                              disabled={busy || dirty || Boolean(review)}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Switch the public project to immutable release v${entry.version}? The current draft will not be changed.`,
                                  )
                                )
                                  return;
                                void task(() =>
                                  activatePublishedRelease(
                                    entry.id,
                                    entry.version,
                                  ),
                                );
                              }}
                            >
                              Switch to v{entry.version}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
                <div className="cloud-account-row">
                  <small>
                    Signed in as {cloudSession.user?.email ?? "Engine Admin"}.
                  </small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      task(async () => {
                        await cloud.logout();
                        setCloudSession({
                          configured: true,
                          databaseReady: true,
                          authenticated: false,
                        });
                        setCloudProjects([]);
                        setMessage("Engine cloud session signed out. Local drafts remain available.");
                      })
                    }
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </section>
          {published.length > 0 && (
            <section aria-label="Published projects">
              <div className="section-label">PUBLISHED PROJECTS</div>
              {published.map((entry) => (
                <div key={entry.slug}>
                  <a
                    href={`/3Dprojects/showcase/${entry.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.name} · View live
                  </a>
                  <button
                    className="wide"
                    disabled={busy || dirty}
                    onClick={() =>
                      task(async () => {
                        const draft = await importPublished(entry.slug);
                        await refresh();
                        open(draft);
                        setMessage(
                          "Published design opened as an independent editable copy on this browser. The live snapshot is unchanged.",
                        );
                      })
                    }
                  >
                    Open {entry.name} in editor
                  </button>
                </div>
              ))}
            </section>
          )}
          <div className="section-label">PROJECT LIBRARY</div>
          <select
            aria-label="Project library"
            value={list.some((i) => i.id === p.id) ? p.id : ""}
            disabled={busy}
            onChange={(e) => {
              const next = list.find((i) => i.id === e.target.value);
              if (next) switchProject(next);
            }}
          >
            <option value="" disabled>
              New unsaved project
            </option>
            {list.map((i) => (
              <option value={i.id} key={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <button
            className="wide"
            disabled={busy}
            onClick={() => {
              if (dirty) {
                setError("Save your changes before creating a project.");
                return;
              }
              open(newProject("Untitled project"));
            }}
          >
            + New project
          </button>
          <button
            className="wide"
            disabled={busy || dirty || Boolean(review)}
            onClick={() =>
              task(async () => {
                const copy = await storage.duplicateProject(p);
                await refresh();
                open(copy);
                setMessage(
                  "Independent project created from this design. Review dimensions and replace the source model as needed.",
                );
              })
            }
          >
            Use design for new project
          </button>
          <label>
            Project slug
            <input
              aria-label="Project slug"
              value={projectSlug(p)}
              disabled={busy || Boolean(review) || Boolean(p.cloud)}
              onChange={(e) => edit({ ...p, slug: e.target.value })}
            />
          </label>
          <small>
            Planned customer path: /3Dprojects/{projectSlug(p)}
            <br />
            {p.cloud
              ? `Cloud identity locked after first sync · revision ${p.cloud.revision}`
              : "Local draft · slug is reserved only after the first cloud save."}
          </small>
          <label>
            Project location
            <input
              aria-label="Project location"
              value={p.location ?? ""}
              disabled={busy || Boolean(review)}
              maxLength={180}
              onChange={(event) =>
                edit({ ...p, location: event.target.value })
              }
              placeholder="City / locality (optional)"
            />
          </label>
          {p.cloud && cloudSession?.authenticated && (
            <button
              className="wide danger"
              disabled={busy || dirty || Boolean(review)}
              onClick={() =>
                task(async () => {
                  await cloud.patchProject(projectSlug(p), {
                    action: "archive",
                  });
                  const localCopy = await storage.duplicateProject(p);
                  await refresh();
                  open(localCopy);
                  setCloudFilter("active");
                  await refreshCloudProjects();
                  setMessage(
                    "Cloud project archived. An independent local copy is open for further experimentation.",
                  );
                })
              }
            >
              Archive cloud project
            </button>
          )}
          </div>
          <section className="editor-outliner" aria-label="Scene outliner">
            <div className="section-label">SCENE OUTLINER</div>
            {p.scene.modelId ? (
              <>
                <button
                  type="button"
                  className={view === "building" ? "tree-room active" : "tree-room"}
                  onClick={() => {
                    setView("building");
                    setSelected("");
                  }}
                >
                  <span>▰ Imported building model</span>
                  <small>{modelNodes.length} mesh nodes</small>
                </button>
                <input
                  aria-label="Filter imported model nodes"
                  value={modelNodeFilter}
                  onChange={(event) => setModelNodeFilter(event.target.value)}
                  placeholder="Filter model meshes"
                />
                <div className="model-node-list">
                  {filteredModelNodes.map((node) => (
                    <button
                      type="button"
                      key={node.key}
                      className={mesh === node.name ? "model-node active" : "model-node"}
                      title={node.name}
                      onClick={() => {
                        setView("building");
                        setMesh(node.name);
                        setSelected("");
                      }}
                    >
                      <span>◇ {node.name}</span>
                      <small>{node.type}</small>
                    </button>
                  ))}
                  {modelNodes.length > filteredModelNodes.length && (
                    <small className="model-node-limit">
                      Showing first {filteredModelNodes.length} matching mesh nodes.
                    </small>
                  )}
                </div>
              </>
            ) : (
              <small>No imported building model yet.</small>
            )}
          </section>
          <div className="section-label">
            BUILDING STRUCTURE{" "}
            <button
              disabled={busy || Boolean(review)}
              onClick={() => {
                const last = p.scene.floors.at(-1)!;
                edit({
                  ...p,
                  scene: {
                    ...p.scene,
                    floors: [
                      ...p.scene.floors,
                      {
                        id: id(),
                        name: `Floor ${p.scene.floors.length}`,
                        elevation: last.elevation + 3,
                      },
                    ],
                  },
                });
              }}
            >
              + Floor
            </button>
          </div>
          <div className="room-tree">
            {scene.floors.map((f) => (
              <section key={f.id}>
                <div className="floor-name">
                  ▱ {f.name} <small>{f.elevation} m</small>
                </div>
                {scene.rooms
                  .filter((r) => r.floorId === f.id)
                  .map((r) => (
                    <button
                      className={
                        r.id === roomId ? "tree-room active" : "tree-room"
                      }
                      key={r.id}
                      onClick={() => {
                        setRoomId(r.id);
                        setSelected(r.id);
                        if (view === "building") setView("rooms");
                      }}
                    >
                      <span>
                        {r.verified ? "◉" : "○"} {r.name}
                      </span>
                      <small>
                        {r.unit} · {(r.width * r.depth).toFixed(1)} m²
                      </small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={addRoom}
          >
            + Add measured room
          </button>
          <div className="section-label">SOURCE LIBRARY</div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => modelInput.current?.click()}
          >
            ↑ Import model · GLB / FBX
          </button>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => referenceInput.current?.click()}
          >
            + Reference drawing or image
          </button>
          {local && !p.scene.modelId && (
            <button
              className="wide subtle"
              disabled={busy || Boolean(review)}
              onClick={() =>
                task(async () => {
                  const response = await fetch(
                    "/studio-assets/jyoti-source-preserved.glb",
                  );
                  if (!response.ok)
                    throw Error(
                      "Local Jyoti model unavailable. Use Import model.",
                    );
                  await upload(
                    new File(
                      [await response.blob()],
                      "jyoti-source-preserved.glb",
                      { type: "model/gltf-binary" },
                    ),
                    true,
                  );
                })
              }
            >
              Load local Jyoti model
            </button>
          )}
          <div className="asset-list">
            {files.map((f) => (
              <button
                key={f.id}
                title={f.hash}
                onClick={() => download(f.blob, f.name)}
              >
                <span>↧ {f.name}</span>
                <small>{(f.size / 1048576).toFixed(1)} MB · download</small>
              </button>
            ))}
          </div>
        </aside>
        <section className="studio-center">
          <nav className="canvas-toolbar editor-toolbar" aria-label="3D editor tools">
            <div className="editor-tool-group" aria-label="Viewer modes">
              {(
                [
                  ["building", "Building"],
                  ["rooms", "Interior"],
                  ["walk", "Walk"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={view === v ? "active" : ""}
                  disabled={v === "walk" && !room}
                  onClick={() => setView(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="editor-tool-group editor-transform-tools" aria-label="Transform tools">
              <button
                type="button"
                className={transformMode === "translate" ? "active" : ""}
                disabled={Boolean(review) || busy || view === "building" || view === "walk"}
                title="Move selected object (W)"
                onClick={() => setTransformMode("translate")}
              >
                ↔ Move <kbd>W</kbd>
              </button>
              <button
                type="button"
                className={transformMode === "rotate" ? "active" : ""}
                disabled={
                  Boolean(review) ||
                  busy ||
                  view !== "rooms" ||
                  !item
                }
                title="Rotate selected furniture (E)"
                onClick={() => setTransformMode("rotate")}
              >
                ↻ Rotate <kbd>E</kbd>
              </button>
              <button
                type="button"
                className={transformMode === "scale" ? "active" : ""}
                disabled={
                  Boolean(review) ||
                  busy ||
                  view !== "rooms" ||
                  !room ||
                  Boolean(item)
                }
                title="Scale selected room (R)"
                onClick={() => setTransformMode("scale")}
              >
                ⤢ Scale <kbd>R</kbd>
              </button>
              <button
                type="button"
                className={transformSnap ? "active" : ""}
                disabled={Boolean(review) || busy}
                title="Toggle transform snapping"
                onClick={() => setTransformSnap((value) => !value)}
              >
                # Snap
              </button>
            </div>
            <div className="editor-toolbar-spacer" />
            <div className="editor-tool-group">
              <button
                type="button"
                title="Frame selected object (F)"
                onClick={() => setFocusRequest((value) => value + 1)}
              >
                Focus <kbd>F</kbd>
              </button>
              {!review && (
                <>
                  <button
                    disabled={!undo.current.length || busy}
                    title="Undo (Ctrl+Z)"
                    onClick={() => history(true)}
                  >
                    ↶
                  </button>
                  <button
                    disabled={!redo.current.length || busy}
                    title="Redo (Ctrl+Y)"
                    onClick={() => history(false)}
                  >
                    ↷
                  </button>
                </>
              )}
              <button
                type="button"
                className={showLeftPanel ? "active" : ""}
                title="Toggle Scene Outliner"
                onClick={() => setShowLeftPanel((value) => !value)}
              >
                Left
              </button>
              <button
                type="button"
                className={showAssetShelf ? "active" : ""}
                title="Toggle Asset Shelf"
                onClick={() => setShowAssetShelf((value) => !value)}
              >
                Assets
              </button>
              <button
                type="button"
                className={showRightPanel ? "active" : ""}
                title="Toggle Inspector"
                onClick={() => setShowRightPanel((value) => !value)}
              >
                Right
              </button>
              <button
                type="button"
                className={editorFocus ? "active" : ""}
                onClick={() => setEditorFocus((value) => !value)}
              >
                {editorFocus ? "Exit full screen" : "Full screen"}
              </button>
            </div>
          </nav>
          <SceneCanvas
            scene={scene}
            roomId={roomId}
            selected={selected}
            selectedMesh={mesh}
            view={view}
            transformMode={transformMode}
            transformEnabled={!review && !busy}
            snap={transformSnap}
            focusRequest={focusRequest}
            onSelect={select}
            onMesh={setMesh}
            onTransformCommit={commitCanvasTransform}
            onModelNodes={setModelNodes}
          />
          {!scene.rooms.length && view !== "building" && (
            <div className="empty-guide">
              <b>Start with one room.</b>
              <p>
                Add a measured room, then choose furniture below.
                <br />
                Every project keeps its own rooms, sources and designs.
              </p>
            </div>
          )}
          <div className="catalog">
            <div>
              <b>{review ? "Customer review" : "Furniture library"}</b>
              <small>
                {review
                  ? release?.name
                  : room
                    ? `Place in ${room.name}`
                    : "Select a room to furnish"}
              </small>
            </div>
            {Object.entries(catalog).map(([kind, c]) => (
              <button
                key={kind}
                disabled={!room || Boolean(review) || busy}
                onClick={() => {
                  if (!room) return;
                  const f: Furniture = {
                    id: id(),
                    kind: kind as Kind,
                    roomId: room.id,
                    x: 0,
                    z: 0,
                    rotation: 0,
                    color: c.color,
                  };
                  const next = {
                    ...p,
                    scene: { ...p.scene, furniture: [...p.scene.furniture, f] },
                  };
                  try {
                    validateProject(next);
                    edit(next);
                    setSelected(f.id);
                    setView("rooms");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <span className={`furniture-icon ${kind}`} />
                {c.name}
                <small>
                  {c.width} × {c.depth} m
                </small>
              </button>
            ))}
          </div>
        </section>
        <aside className="studio-inspector">
          <div className="section-label">
            {review ? "REVIEW VERSION" : "DESIGN PROPERTIES"}
          </div>
          <fieldset disabled={Boolean(review) || busy}>
            {item ? (
              <>
                <h2>{catalog[item.kind].name}</h2>
                <p>Position relative to room centre, in metres.</p>
                {field("Position X", item.x, (x) => patchItem({ x }))}
                {field("Position Z", item.z, (z) => patchItem({ z }))}
                {field(
                  "Rotation °",
                  item.rotation,
                  (rotation) => patchItem({ rotation }),
                  15,
                )}
                <label>
                  Finish
                  <input
                    aria-label="Furniture finish"
                    type="color"
                    value={item.color}
                    onChange={(e) => patchItem({ color: e.target.value })}
                  />
                </label>
                <button
                  className="danger"
                  onClick={() => {
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        furniture: p.scene.furniture.filter(
                          (f) => f.id !== item.id,
                        ),
                      },
                    });
                    setSelected(roomId);
                  }}
                >
                  Remove furniture
                </button>
              </>
            ) : room ? (
              <>
                <h2>Room properties</h2>
                <button
                  onClick={() => {
                    try {
                      const next = duplicateFloor(p, room.floorId);
                      const copiedRoom = next.scene.rooms.find(
                        (r) => r.floorId === next.scene.floors.at(-1)!.id,
                      );
                      edit(next);
                      if (copiedRoom) {
                        setRoomId(copiedRoom.id);
                        setSelected(copiedRoom.id);
                      }
                      setView("rooms");
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not copy floor.",
                      );
                    }
                  }}
                >
                  Duplicate furnished floor
                </button>
                <label>
                  Room name
                  <input
                    value={room.name}
                    onChange={(e) => patchRoom({ name: e.target.value })}
                  />
                </label>
                <label>
                  Unit / flat
                  <input
                    value={room.unit}
                    onChange={(e) => patchRoom({ unit: e.target.value })}
                  />
                </label>
                <label>
                  Floor
                  <select
                    value={room.floorId}
                    onChange={(e) => patchRoom({ floorId: e.target.value })}
                  >
                    {p.scene.floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                {floor &&
                  field("Floor elevation (m)", floor.elevation, (elevation) =>
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        floors: p.scene.floors.map((f) =>
                          f.id === floor.id ? { ...f, elevation } : f,
                        ),
                      },
                    }),
                  )}
                <div className="property-grid">
                  {field("Width (m)", room.width, (width) =>
                    patchRoom({ width }),
                  )}
                  {field("Depth (m)", room.depth, (depth) =>
                    patchRoom({ depth }),
                  )}
                  {field("Height (m)", room.height, (height) =>
                    patchRoom({ height }),
                  )}
                  {field("Centre X (m)", room.x, (x) => patchRoom({ x }))}
                  {field("Centre Z (m)", room.z, (z) => patchRoom({ z }))}
                </div>
                <label>
                  Floor finish
                  <input
                    aria-label="Floor finish"
                    type="color"
                    value={room.color}
                    onChange={(e) => patchRoom({ color: e.target.value })}
                  />
                </label>
                <label>
                  Measurement source
                  <textarea
                    value={room.source}
                    placeholder="Drawing name, page and dimensions"
                    onChange={(e) => patchRoom({ source: e.target.value })}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={room.verified}
                    onChange={(e) => patchRoom({ verified: e.target.checked })}
                  />{" "}
                  Measurements reviewed
                </label>
                <p className="measurement-note">
                  {room.verified
                    ? "Reviewed by author"
                    : "Unverified draft measurements"}{" "}
                  · {(room.width * room.depth).toFixed(2)} m² clear rectangular
                  floor area
                </p>
                <label>
                  Model mesh binding
                  <input readOnly value={room.mesh ?? "Not bound"} />
                </label>
                <button disabled={!mesh} onClick={() => patchRoom({ mesh })}>
                  Bind clicked mesh
                </button>
                {mesh && <small className="wrap">Selected: {mesh}</small>}
                <p>
                  Binding identifies the source object; it does not move or
                  resize the room. Set its measured position above.
                </p>
                <button
                  className="danger"
                  onClick={() => {
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        rooms: p.scene.rooms.filter((r) => r.id !== room.id),
                        furniture: p.scene.furniture.filter(
                          (f) => f.roomId !== room.id,
                        ),
                      },
                    });
                    setRoomId("");
                    setSelected("");
                  }}
                >
                  Remove room
                </button>
              </>
            ) : (
              <p>Select a room or furniture item to edit its properties.</p>
            )}
            {field(
              "Model scale → metres",
              p.scene.scale,
              (scale) => edit({ ...p, scene: { ...p.scene, scale } }),
              0.001,
            )}
            <p>
              Confirm against a known drawing length. Imported units are not
              automatically certified.
            </p>
          </fieldset>
          <div className="section-label">REVIEW & VERSIONS</div>
          {review ? (
            <button className="wide primary" onClick={() => setReview("")}>
              Return to draft
            </button>
          ) : (
            <button
              className="wide primary"
              disabled={busy}
              onClick={() => task(createReviewVersion)}
            >
              Create review version
            </button>
          )}
          {p.releases.map((r) => (
            <div className="review-row" key={r.id}>
              <button
                onClick={() => {
                  setReview(r.id);
                  setRoomId(r.scene.rooms[0]?.id ?? "");
                  setSelected("");
                }}
              >
                {r.name}
                <small>{new Date(r.date).toLocaleString()}</small>
              </button>
              {!review && (
                <button
                  title="Restore this version into draft"
                  disabled={busy}
                  onClick={() => {
                    edit({ ...p, scene: structuredClone(r.scene) });
                    setRoomId(r.scene.rooms[0]?.id ?? "");
                    setSelected("");
                  }}
                >
                  ↶
                </button>
              )}
            </div>
          ))}
          <p>
            Export a backup to move this project to another device. Public link
            publishing needs authenticated Engine storage.
          </p>
        </aside>
        </div>
      )}
      <input
        hidden
        ref={modelInput}
        type="file"
        accept=".glb,.fbx"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void task(() => upload(file, true));
        }}
      />
      <input
        hidden
        ref={referenceInput}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.skb,.skp,.drs,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void task(() => upload(file, false));
        }}
      />
      <input
        hidden
        ref={importInput}
        type="file"
        accept=".json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            void task(async () => {
              if (dirty)
                throw Error("Save changes before importing another project.");
              const next = await storage.importPackage(file);
              await refresh();
              open(next);
              setMessage(
                "Backup imported as a separate project; existing projects unchanged.",
              );
            });
        }}
      />
    </main>
  );
}
