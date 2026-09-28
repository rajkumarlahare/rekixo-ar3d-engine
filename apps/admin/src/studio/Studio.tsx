import { useEffect, useRef, useState } from "react";
import SceneCanvas, {
  type ModelMaterialSummary,
  type ModelNodeSummary,
  type RoomDrawResult,
  type TransformCommit,
  type TransformMode,
  type View,
} from "./SceneCanvas";
import ReferenceWorkspace from "./ReferenceWorkspace";
import VisualRoomMapper, {
  type RoomMapAction,
} from "./VisualRoomMapper";
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
  type MaterialOverride,
  type ModelNodeTag,
  type ModelTransform,
  type Project,
  type ReferenceLayer,
  type Room,
  type SceneAppearance,
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
import SmartProjectBuilder from "./SmartProjectBuilder";
import StudioSources from "./StudioSources";
import StudioEvidence from "./StudioEvidence";
import StudioPublish from "./StudioPublish";
import { buildStudioReadiness } from "./readiness";
import { auditFbxSources, type FbxSourceAudit } from "./sourceAudit";
import {
  analyzeProjectFiles,
  type SmartProjectAnalysis,
} from "./projectAnalyzer";
import "./studio.css";
import "./studio-operations.css";
import "./studio-superadmin-theme.css";
import "./studio-editor-core.css";

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
const DEFAULT_APPEARANCE: SceneAppearance = {
  exposure: 1,
  sunIntensity: 3.2,
  hemisphereIntensity: 2.8,
  background: "#dbe3e7",
  referenceVisual: true,
  nightMode: false,
};

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
  const [showReferenceWorkspace, setShowReferenceWorkspace] = useState(false);
  const [showRoomMapper, setShowRoomMapper] = useState(false);
  const [roomMapFloorId, setRoomMapFloorId] = useState("");
  const [roomMapUnit, setRoomMapUnit] = useState("Unit 101");
  const [roomMapName, setRoomMapName] = useState("Room");
  const [roomMapAction, setRoomMapAction] =
    useState<RoomMapAction>("idle");
  const [roomMapSnap, setRoomMapSnap] = useState(true);
  const [cameraOrientation, setCameraOrientation] = useState<
    "perspective" | "top"
  >("perspective");
  const [modelNodes, setModelNodes] = useState<ModelNodeSummary[]>([]);
  const [selectedModelNodeKey, setSelectedModelNodeKey] = useState("");
  const [modelNodeFilter, setModelNodeFilter] = useState("");
  const [isolateFloorId, setIsolateFloorId] = useState("");
  const [sectionCutEnabled, setSectionCutEnabled] = useState(false);
  const [sectionCutAxis, setSectionCutAxis] = useState<"x" | "y" | "z">("y");
  const [sectionCutOffset, setSectionCutOffset] = useState(0);
  const [sectionCutFlip, setSectionCutFlip] = useState(false);
  const [modelMaterials, setModelMaterials] = useState<ModelMaterialSummary[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState("");
  const [sourceAudits, setSourceAudits] = useState<FbxSourceAudit[]>([]);
  const [sourceAuditBusy, setSourceAuditBusy] = useState(false);
  const [smartAnalysis, setSmartAnalysis] = useState<SmartProjectAnalysis>();
  const [manifestText, setManifestText] = useState("");
  const [cloudSession, setCloudSession] = useState<cloud.CloudSession>();
  const [cloudProjects, setCloudProjects] = useState<cloud.CloudProjectSummary[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [cloudSearch, setCloudSearch] = useState("");
  const [cloudFilter, setCloudFilter] = useState<"active" | "archived">("active");
  const [cloudReleases, setCloudReleases] = useState<cloud.CloudReleaseSummary[]>([]);
  const [published, setPublished] = useState<PublishedCatalogEntry[]>([]);
  const [workspace, setWorkspace] = useState<
    "builder" | "overview" | "editor" | "sources" | "evidence" | "publish"
  >("builder");
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
    setSelectedModelNodeKey("");
    setModelNodes([]);
    setModelNodeFilter("");
    setIsolateFloorId("");
    setSectionCutEnabled(false);
    setSectionCutAxis("y");
    setSectionCutOffset(0);
    setSectionCutFlip(false);
    setModelMaterials([]);
    setSelectedMaterial("");
    setSourceAudits([]);
    setSmartAnalysis(undefined);
    setShowReferenceWorkspace(false);
    setShowRoomMapper(false);
    setRoomMapFloorId(
      p.scene.rooms[0]?.floorId ?? p.scene.floors[0]?.id ?? "",
    );
    setRoomMapUnit(p.scene.rooms[0]?.unit ?? "Unit 101");
    setRoomMapName("Room");
    setRoomMapAction("idle");
    setRoomMapSnap(true);
    setCameraOrientation("perspective");
    setProject(p);
    setRoomId(p.scene.rooms[0]?.id ?? "");
    setSelected(p.scene.rooms[0]?.id ?? "");
    setReview("");
    setWorkspace(
      p.assets.length || p.scene.rooms.length || p.scene.floors.length > 1
        ? "overview"
        : "builder",
    );
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
    let active = true;
    const fbxFiles = files.filter((file) => /\.fbx$/i.test(file.name));
    if (!fbxFiles.length) {
      setSourceAudits([]);
      setSourceAuditBusy(false);
      return;
    }
    setSourceAuditBusy(true);
    void auditFbxSources(files)
      .then((audits) => {
        if (active) setSourceAudits(audits);
      })
      .catch(() => {
        if (active) setSourceAudits([]);
      })
      .finally(() => {
        if (active) setSourceAuditBusy(false);
      });
    return () => {
      active = false;
    };
  }, [files]);

  useEffect(() => {
    if (!modelMaterials.length) {
      setSelectedMaterial("");
      return;
    }
    if (!modelMaterials.some((material) => material.name === selectedMaterial))
      setSelectedMaterial(modelMaterials[0].name);
  }, [modelMaterials, selectedMaterial]);
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
      .filter((node) => {
        const query = modelNodeFilter.trim().toLowerCase();
        if (!query) return true;
        const tag = p.scene.modelNodeTags?.find(
          (entry) =>
            entry.nodeName === node.name &&
            entry.occurrence === node.occurrence,
        );
        const floorName = tag?.floorId
          ? p.scene.floors.find((entry) => entry.id === tag.floorId)?.name ?? ""
          : "";
        return (
          node.name.toLowerCase().includes(query) ||
          floorName.toLowerCase().includes(query) ||
          (tag?.unit ?? "").toLowerCase().includes(query)
        );
      })
      .slice(0, 120),
    selectedModelNode = modelNodes.find(
      (node) => node.key === selectedModelNodeKey,
    ),
    selectedModelNodeTag = selectedModelNode
      ? p.scene.modelNodeTags?.find(
          (entry) =>
            entry.nodeName === selectedModelNode.name &&
            entry.occurrence === selectedModelNode.occurrence,
        )
      : undefined,
    taggedModelNodeCount = modelNodes.filter((node) =>
      p.scene.modelNodeTags?.some(
        (entry) =>
          entry.nodeName === node.name &&
          entry.occurrence === node.occurrence &&
          Boolean(entry.floorId),
      ),
    ).length,
    appearance = p.scene.appearance ?? DEFAULT_APPEARANCE,
    materialOverride = p.scene.materialOverrides?.find(
      (entry) => entry.materialName === selectedMaterial,
    ),
    materialSummary = modelMaterials.find(
      (entry) => entry.name === selectedMaterial,
    ),
    sourceTypeCounts = files.reduce<Record<string, number>>((counts, file) => {
      const extension = file.name.toLowerCase().split(".").pop() || "file";
      counts[extension] = (counts[extension] ?? 0) + 1;
      return counts;
    }, {}),
    modelTransform: ModelTransform = p.scene.modelTransform ?? {
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
    };
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
  function bindSelectedMeshToRoom(targetRoomId: string) {
    if (!selectedModelNode) return;
    const target = p.scene.rooms.find(
      (candidate) => candidate.id === targetRoomId,
    );
    if (!target) return;
    const previous = p.scene.modelNodeTags ?? [];
    const tag: ModelNodeTag = {
      nodeName: selectedModelNode.name,
      occurrence: selectedModelNode.occurrence,
      floorId: target.floorId,
      unit: target.unit,
      roomId: target.id,
      assignment: "manual",
      confidence: 1,
    };
    edit({
      ...p,
      scene: {
        ...p.scene,
        rooms: p.scene.rooms.map((candidate) =>
          candidate.id === target.id
            ? { ...candidate, mesh: selectedModelNode.name }
            : candidate,
        ),
        modelNodeTags: [
          ...previous.filter(
            (entry) =>
              !(
                entry.nodeName === selectedModelNode.name &&
                entry.occurrence === selectedModelNode.occurrence
              ),
          ),
          tag,
        ],
      },
    });
    setRoomId(target.id);
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
  function patchAppearance(change: Partial<SceneAppearance>) {
    edit({
      ...p,
      scene: {
        ...p.scene,
        appearance: { ...appearance, ...change },
      },
    });
  }
  function patchMaterial(change: Partial<MaterialOverride>) {
    if (!selectedMaterial) return;
    const previous = p.scene.materialOverrides ?? [];
    const existing = previous.find(
      (entry) => entry.materialName === selectedMaterial,
    );
    const nextOverride: MaterialOverride = {
      materialName: selectedMaterial,
      ...(existing ?? {}),
      ...change,
    };
    edit({
      ...p,
      scene: {
        ...p.scene,
        materialOverrides: [
          ...previous.filter(
            (entry) => entry.materialName !== selectedMaterial,
          ),
          nextOverride,
        ],
      },
    });
  }
  function resetMaterial() {
    if (!selectedMaterial) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        materialOverrides: (p.scene.materialOverrides ?? []).filter(
          (entry) => entry.materialName !== selectedMaterial,
        ),
      },
    });
  }
  function patchModelNodeTag(change: Partial<ModelNodeTag>) {
    if (!selectedModelNode) return;
    const previous = p.scene.modelNodeTags ?? [];
    const current =
      previous.find(
        (entry) =>
          entry.nodeName === selectedModelNode.name &&
          entry.occurrence === selectedModelNode.occurrence,
      ) ?? {
        nodeName: selectedModelNode.name,
        occurrence: selectedModelNode.occurrence,
      };
    const nextTag: ModelNodeTag = {
      ...current,
      ...change,
      assignment: "manual",
      confidence: 1,
    };
    if (change.floorId !== undefined) {
      if (!change.floorId) {
        delete nextTag.floorId;
        delete nextTag.roomId;
      } else {
        const boundRoom = nextTag.roomId
          ? p.scene.rooms.find((entry) => entry.id === nextTag.roomId)
          : undefined;
        if (boundRoom && boundRoom.floorId !== change.floorId)
          delete nextTag.roomId;
      }
    }
    if (change.unit !== undefined) {
      const value = change.unit.trim();
      if (value) nextTag.unit = value;
      else delete nextTag.unit;
      const boundRoom = nextTag.roomId
        ? p.scene.rooms.find((entry) => entry.id === nextTag.roomId)
        : undefined;
      if (boundRoom && value && boundRoom.unit !== value)
        delete nextTag.roomId;
    }
    if (change.roomId !== undefined) {
      if (!change.roomId) {
        delete nextTag.roomId;
      } else {
        const boundRoom = p.scene.rooms.find(
          (entry) => entry.id === change.roomId,
        );
        if (!boundRoom) return;
        nextTag.roomId = boundRoom.id;
        nextTag.floorId = boundRoom.floorId;
        nextTag.unit = boundRoom.unit;
      }
    }
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelNodeTags: [
          ...previous.filter(
            (entry) =>
              !(
                entry.nodeName === selectedModelNode.name &&
                entry.occurrence === selectedModelNode.occurrence
              ),
          ),
          nextTag,
        ],
      },
    });
  }
  function clearModelNodeTag() {
    if (!selectedModelNode) return;
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelNodeTags: (p.scene.modelNodeTags ?? []).filter(
          (entry) =>
            !(
              entry.nodeName === selectedModelNode.name &&
              entry.occurrence === selectedModelNode.occurrence
            ),
        ),
      },
    });
  }
  function upsertReferenceLayer(layer: ReferenceLayer) {
    const current = p.scene.referenceLayers ?? [];
    edit({
      ...p,
      scene: {
        ...p.scene,
        referenceLayers: current.some((entry) => entry.id === layer.id)
          ? current.map((entry) => (entry.id === layer.id ? layer : entry))
          : [...current, layer],
      },
    });
  }
  function removeReferenceLayer(layerId: string) {
    edit({
      ...p,
      scene: {
        ...p.scene,
        referenceLayers: (p.scene.referenceLayers ?? []).filter(
          (entry) => entry.id !== layerId,
        ),
      },
    });
  }
  function patchModelTransform(change: Partial<ModelTransform>) {
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelTransform: { ...modelTransform, ...change },
      },
    });
  }
  function commitCanvasTransform(change: TransformCommit) {
    if (review || busy) return;
    let next: Project;
    if (change.kind === "model") {
      next = {
        ...p,
        scene: {
          ...p.scene,
          modelTransform: {
            ...modelTransform,
            ...(change.x !== undefined ? { x: change.x } : {}),
            ...(change.y !== undefined ? { y: change.y } : {}),
            ...(change.z !== undefined ? { z: change.z } : {}),
            ...(change.rotationY !== undefined
              ? { rotationY: change.rotationY }
              : {}),
          },
        },
      };
    } else if (change.kind === "room") {
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
  function roomHeightForFloor(floorId: string) {
    const existing = p.scene.rooms.find((entry) => entry.floorId === floorId);
    if (existing) return existing.height;
    const floors = [...p.scene.floors].sort(
      (left, right) => left.elevation - right.elevation,
    );
    const index = floors.findIndex((entry) => entry.id === floorId);
    const current = floors[index];
    const next = floors[index + 1];
    if (current && next)
      return Math.max(2.4, Math.min(5, next.elevation - current.elevation - 0.18));
    return 2.8;
  }

  function commitMappedRoom(bounds: RoomDrawResult) {
    const floorId = roomMapFloorId || p.scene.floors[0]?.id;
    if (!floorId) {
      setError("Create or detect a floor before mapping rooms.");
      return;
    }
    if (roomMapAction === "reshape" && room) {
      const next: Project = {
        ...p,
        scene: {
          ...p.scene,
          rooms: p.scene.rooms.map((entry) =>
            entry.id === room.id
              ? {
                  ...entry,
                  x: bounds.x,
                  z: bounds.z,
                  width: bounds.width,
                  depth: bounds.depth,
                }
              : entry,
          ),
        },
      };
      try {
        validateProject(next);
        edit(next);
        setRoomMapAction("idle");
        setMessage(
          `${room.name} reshaped visually · ${bounds.width.toFixed(2)} × ${bounds.depth.toFixed(2)} m.`,
        );
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Room reshape failed.");
      }
      return;
    }

    const mapped: Room = {
      id: id(),
      name: roomMapName.trim() || `Room ${p.scene.rooms.length + 1}`,
      unit: roomMapUnit.trim() || "Unit",
      floorId,
      x: bounds.x,
      z: bounds.z,
      width: bounds.width,
      depth: bounds.depth,
      height: roomHeightForFloor(floorId),
      color: "#cdbfa9",
      source: "Visual Room Mapper draft",
      verified: false,
    };
    const next: Project = {
      ...p,
      scene: { ...p.scene, rooms: [...p.scene.rooms, mapped] },
    };
    try {
      validateProject(next);
      edit(next);
      setRoomId(mapped.id);
      setSelected(mapped.id);
      setRoomMapAction("create");
      setMessage(
        `${mapped.name} mapped · ${mapped.width.toFixed(2)} × ${mapped.depth.toFixed(2)} m · ${(mapped.width * mapped.depth).toFixed(2)} m².`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Room mapping failed.");
    }
  }

  function cloneMappedRoom() {
    if (!room || selected !== room.id) return;
    const clone: Room = {
      ...room,
      id: id(),
      name: `${room.name} copy`,
      x: room.x + room.width + 0.2,
      verified: false,
      source: "Visual Room Mapper clone",
      sourceAssetId: undefined,
      sourcePackSourceId: undefined,
      sourceClaimIds: undefined,
      mesh: undefined,
    };
    const next: Project = {
      ...p,
      scene: { ...p.scene, rooms: [...p.scene.rooms, clone] },
    };
    try {
      validateProject(next);
      edit(next);
      setRoomId(clone.id);
      setSelected(clone.id);
      setRoomMapFloorId(clone.floorId);
      setRoomMapUnit(clone.unit);
      setRoomMapAction("idle");
      setTransformMode("translate");
      setMessage("Room cloned. Drag it into place with the Move gizmo.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Room clone failed.");
    }
  }

  function mirrorMappedRoom(axis: "x" | "z") {
    if (!room || selected !== room.id) return;
    const unitRooms = p.scene.rooms.filter(
      (entry) =>
        entry.floorId === room.floorId &&
        entry.unit.trim() === room.unit.trim(),
    );
    if (unitRooms.length < 2) {
      setError("Map at least two rooms in this unit before using unit-centre mirror.");
      return;
    }
    const minX = Math.min(...unitRooms.map((entry) => entry.x - entry.width / 2));
    const maxX = Math.max(...unitRooms.map((entry) => entry.x + entry.width / 2));
    const minZ = Math.min(...unitRooms.map((entry) => entry.z - entry.depth / 2));
    const maxZ = Math.max(...unitRooms.map((entry) => entry.z + entry.depth / 2));
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;
    const mirrored: Room = {
      ...room,
      id: id(),
      name: `${room.name} mirror`,
      x: axis === "x" ? 2 * centreX - room.x : room.x,
      z: axis === "z" ? 2 * centreZ - room.z : room.z,
      verified: false,
      source: "Visual Room Mapper mirrored copy",
      sourceAssetId: undefined,
      sourcePackSourceId: undefined,
      sourceClaimIds: undefined,
      mesh: undefined,
    };
    const next: Project = {
      ...p,
      scene: { ...p.scene, rooms: [...p.scene.rooms, mirrored] },
    };
    try {
      validateProject(next);
      edit(next);
      setRoomId(mirrored.id);
      setSelected(mirrored.id);
      setTransformMode("translate");
      setMessage(
        `Mirrored copy created across the current unit centre. Drag to fine-tune if needed.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Room mirror failed.");
    }
  }
  function select(key: string) {
    setSelected(key);
    const r =
      scene.rooms.find((r) => r.id === key) ??
      scene.rooms.find(
        (r) => r.id === scene.furniture.find((f) => f.id === key)?.roomId,
      );
    if (r) {
      setRoomId(r.id);
      if (showRoomMapper) {
        setRoomMapFloorId(r.floorId);
        setRoomMapUnit(r.unit);
        setRoomMapName(r.name);
      }
    }
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
  async function uploadReferences(selectedFiles: File[]) {
    if (!selectedFiles.length) return;
    const assets = await Promise.all(
      selectedFiles.map((file) => storage.makeAsset(file, p.id)),
    );
    const existing = new Set(p.assets);
    const nextAssetIds = [
      ...p.assets,
      ...assets.map((asset) => asset.id).filter((key) => !existing.has(key)),
    ];
    await persist({ ...p, assets: nextAssetIds }, assets);
    undo.current = [];
    redo.current = [];
    setMessage(
      `${assets.length} source/reference file${assets.length === 1 ? "" : "s"} attached to the project.`,
    );
  }
  async function uploadSourcePack(selectedFiles: File[]) {
    if (!selectedFiles.length) return;
    const assets = await Promise.all(
      selectedFiles.map((file) => storage.makeAsset(file, p.id)),
    );
    const existing = new Set(p.assets);
    const nextAssetIds = [
      ...p.assets,
      ...assets.map((asset) => asset.id).filter((key) => !existing.has(key)),
    ];
    const modelCandidates = assets.filter((asset) => /\.(glb|fbx)$/i.test(asset.name));
    const glbCandidates = modelCandidates.filter((asset) => /\.glb$/i.test(asset.name));
    const autoModel =
      p.scene.modelId ??
      (glbCandidates.length === 1
        ? glbCandidates[0].id
        : modelCandidates.length === 1
          ? modelCandidates[0].id
          : undefined);
    const next: Project = {
      ...p,
      assets: nextAssetIds,
      scene: {
        ...p.scene,
        ...(autoModel && autoModel !== p.scene.modelId
          ? {
              modelId: autoModel,
              modelNodeTags: [],
              rooms: p.scene.rooms.map((entry) => ({
                ...entry,
                mesh: undefined,
              })),
            }
          : {}),
      },
    };
    await persist(next, assets);
    setSmartAnalysis(undefined);
    undo.current = [];
    redo.current = [];
    setMessage(
      `${assets.length} source file${assets.length === 1 ? "" : "s"} attached${autoModel && autoModel !== p.scene.modelId ? " · 3D model selected automatically" : ""}.`,
    );
  }

  function selectBuilderModel(assetId: string) {
    if (!assetId || assetId === p.scene.modelId) return;
    const candidate = files.find((file) => file.id === assetId);
    if (!candidate || !/\.(glb|fbx)$/i.test(candidate.name)) return;
    setSmartAnalysis(undefined);
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelId: assetId,
        modelNodeTags: [],
        rooms: p.scene.rooms.map((entry) => ({ ...entry, mesh: undefined })),
      },
    });
    setView("building");
  }

  async function analyzeSmartProject() {
    const result = await analyzeProjectFiles(
      files,
      p.scene.modelId,
      sourceAudits,
    );
    setSmartAnalysis(result);
    if (!p.scene.modelId && result.modelAssetId) {
      const candidate = files.find((file) => file.id === result.modelAssetId);
      if (candidate && /\.(glb|fbx)$/i.test(candidate.name))
        edit({
          ...p,
          scene: {
            ...p.scene,
            modelId: candidate.id,
            modelNodeTags: [],
          },
        });
    }
    setMessage(
      `Smart analysis complete · ${result.meshCount} meshes · ${result.floorCandidates.length} floor level suggestion${result.floorCandidates.length === 1 ? "" : "s"} · ${result.reviewAssignments + result.commonAssignments} review item${result.reviewAssignments + result.commonAssignments === 1 ? "" : "s"}.`,
    );
  }

  function buildSmartDraft() {
    if (!smartAnalysis?.modelAssetId)
      throw Error("Analyze a selected GLB/FBX model before building the draft.");
    if (!smartAnalysis.floorCandidates.length)
      throw Error("No reliable floor structure was detected. Review the model manually.");

    const hasAuthoredRooms = p.scene.rooms.length > 0;
    const replaceFloorSkeleton =
      !hasAuthoredRooms &&
      p.scene.floors.length === 1 &&
      !(p.scene.modelNodeTags?.length);
    const modelY = p.scene.modelTransform?.y ?? 0;
    const scale = p.scene.scale;
    const suggestedElevations = smartAnalysis.floorCandidates
      .map((candidate) => candidate.elevation * scale + modelY)
      .sort((left, right) => left - right);
    const floors = replaceFloorSkeleton
      ? suggestedElevations.map((elevation, index) => ({
          id: id(),
          name: index === 0 ? "Ground" : `Floor ${index}`,
          elevation: Number(elevation.toFixed(4)),
        }))
      : [...p.scene.floors].sort(
          (left, right) => left.elevation - right.elevation,
        );

    if (!floors.length)
      throw Error("Create or detect at least one floor before auto-tagging meshes.");

    const existingTags = p.scene.modelNodeTags ?? [];
    const manualKeys = new Set(
      existingTags
        .filter((tag) => tag.assignment !== "auto")
        .map((tag) => `${tag.nodeName}\u0000${tag.occurrence}`),
    );
    const autoTags = smartAnalysis.nodeAssignments
      .filter(
        (assignment) =>
          assignment.floorIndex !== undefined &&
          assignment.confidence >= 0.62,
      )
      .map((assignment) => {
        const sourceFloor = smartAnalysis.floorCandidates[assignment.floorIndex!];
        const worldElevation = sourceFloor.elevation * scale + modelY;
        const targetFloor = [...floors].sort(
          (left, right) =>
            Math.abs(left.elevation - worldElevation) -
            Math.abs(right.elevation - worldElevation),
        )[0];
        return {
          nodeName: assignment.nodeName,
          occurrence: assignment.occurrence,
          floorId: targetFloor.id,
          assignment: "auto" as const,
          confidence: Number(assignment.confidence.toFixed(3)),
        };
      })
      .filter(
        (tag) => !manualKeys.has(`${tag.nodeName}\u0000${tag.occurrence}`),
      );

    const autoKeys = new Set(
      autoTags.map((tag) => `${tag.nodeName}\u0000${tag.occurrence}`),
    );
    const preserved = existingTags.filter(
      (tag) =>
        tag.assignment !== "auto" ||
        !autoKeys.has(`${tag.nodeName}\u0000${tag.occurrence}`),
    );
    edit({
      ...p,
      scene: {
        ...p.scene,
        floors,
        modelNodeTags: [...preserved, ...autoTags],
      },
    });
    setMessage(
      `Smart draft built · ${floors.length} floors · ${autoTags.length} meshes auto-tagged. Ambiguous/multi-floor meshes remain unassigned for visual review.`,
    );
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
              setWorkspace("builder");
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
            ["builder", "Project Builder"],
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
              {key === "builder"
                ? "✦"
                : key === "overview"
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
      {workspace === "builder" && (
        <SmartProjectBuilder
          project={p}
          files={files}
          audits={sourceAudits}
          analysis={smartAnalysis}
          busy={busy || sourceAuditBusy}
          onProjectMeta={(change) => edit({ ...p, ...change })}
          onImportFiles={(selectedFiles) =>
            void task(() => uploadSourcePack(selectedFiles))
          }
          onAnalyze={() => void task(analyzeSmartProject)}
          onSelectModel={selectBuilderModel}
          onBuildDraft={() => {
            try {
              buildSmartDraft();
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Smart draft could not be built.",
              );
            }
          }}
          onOpenEditor={() => {
            setWorkspace("editor");
            setEditorFocus(true);
          }}
          onOpenSources={() => setWorkspace("sources")}
        />
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
            setEditorFocus(true);
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
                      className={
                        selectedModelNodeKey === node.key
                          ? "model-node active"
                          : "model-node"
                      }
                      title={node.name}
                      onClick={() => {
                        setView("building");
                        setMesh(node.name);
                        setSelectedModelNodeKey(node.key);
                        setSelected("");
                      }}
                    >
                      <span>
                        ◇ {node.name}
                        {node.occurrence > 1 ? ` #${node.occurrence}` : ""}
                      </span>
                      <small>
                        {(() => {
                          const tag = p.scene.modelNodeTags?.find(
                            (entry) =>
                              entry.nodeName === node.name &&
                              entry.occurrence === node.occurrence,
                          );
                          const floorName = tag?.floorId
                            ? p.scene.floors.find(
                                (entry) => entry.id === tag.floorId,
                              )?.name
                            : undefined;
                          return floorName
                            ? `${floorName}${tag?.unit ? ` · ${tag.unit}` : ""}`
                            : `${node.type} · y ${node.centreY.toFixed(2)}`;
                        })()}
                      </small>
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
          <section className="editor-source-health" aria-label="Source health">
            <div className="section-label">SOURCE HEALTH</div>
            <div className="source-health-types">
              {Object.entries(sourceTypeCounts).length ? (
                Object.entries(sourceTypeCounts)
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([extension, count]) => (
                    <span key={extension}>
                      {extension.toUpperCase()} <b>{count}</b>
                    </span>
                  ))
              ) : (
                <small>No source files attached.</small>
              )}
            </div>
            {sourceAuditBusy && <small>Auditing ASCII FBX source…</small>}
            {sourceAudits.map((audit) => (
              <article className="source-health-card" key={audit.assetId}>
                <b>{audit.filename}</b>
                {audit.ascii ? (
                  <>
                    <small>
                      {audit.meshCount ?? "—"} meshes · {audit.materialNames.length} materials
                    </small>
                    <small>
                      {audit.externalTextureFiles.length} external texture refs ·{" "}
                      {audit.matchedTextureFiles.length} matching files attached
                    </small>
                    {audit.externalTextureFiles.length >
                      audit.matchedTextureFiles.length && (
                      <em>
                        Texture package incomplete — keep source geometry safe;
                        use verified runtime restoration or attach the bitmap files.
                      </em>
                    )}
                  </>
                ) : (
                  <small>Binary FBX detected · detailed browser audit unavailable.</small>
                )}
              </article>
            ))}
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
                    <div className="outliner-room" key={r.id}>
                      <button
                        className={
                          r.id === roomId && selected === r.id
                            ? "tree-room active"
                            : "tree-room"
                        }
                        onClick={() => {
                          setRoomId(r.id);
                          setSelected(r.id);
                          setMesh("");
                          setSelectedModelNodeKey("");
                          if (showRoomMapper) {
                            setRoomMapFloorId(r.floorId);
                            setRoomMapUnit(r.unit);
                            setRoomMapName(r.name);
                          } else if (view === "building") {
                            setView("rooms");
                          }
                        }}
                      >
                        <span>
                          {r.verified ? "◉" : "○"} {r.name}
                        </span>
                        <small>
                          {r.unit} · {(r.width * r.depth).toFixed(1)} m²
                        </small>
                      </button>
                      {scene.furniture
                        .filter((entry) => entry.roomId === r.id)
                        .map((entry) => (
                          <button
                            type="button"
                            key={entry.id}
                            className={
                              selected === entry.id
                                ? "outliner-object active"
                                : "outliner-object"
                            }
                            onClick={() => {
                              setRoomId(r.id);
                              setSelected(entry.id);
                              setMesh("");
                              setSelectedModelNodeKey("");
                              setView("rooms");
                            }}
                          >
                            <span>└ {catalog[entry.kind].name}</span>
                            <small>
                              {entry.x.toFixed(1)}, {entry.z.toFixed(1)}
                            </small>
                          </button>
                        ))}
                    </div>
                  ))}
              </section>
            ))}
          </div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => {
              const floorId =
                room?.floorId ??
                roomMapFloorId ??
                p.scene.floors[0]?.id ??
                "";
              setRoomMapFloorId(floorId);
              setRoomMapUnit(room?.unit ?? roomMapUnit ?? "Unit 101");
              if (room) setSelected(room.id);
              setShowRoomMapper(true);
              setShowReferenceWorkspace(false);
              setShowAssetShelf(false);
              setRoomMapAction("create");
              setView("building");
              setCameraOrientation("top");
              setIsolateFloorId(floorId);
            }}
          >
            + Map room with mouse
          </button>
          <details className="editor-advanced-add">
            <summary>Advanced fallback</summary>
            <button
              className="wide"
              disabled={busy || Boolean(review)}
              onClick={addRoom}
            >
              Add default rectangular room
            </button>
          </details>
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
                  onClick={() => {
                    setView(v);
                    if (v === "walk") setCameraOrientation("perspective");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="editor-tool-group" aria-label="Camera orientation">
              <button
                type="button"
                className={cameraOrientation === "perspective" ? "active" : ""}
                disabled={view === "walk"}
                onClick={() => setCameraOrientation("perspective")}
              >
                Perspective
              </button>
              <button
                type="button"
                className={cameraOrientation === "top" ? "active" : ""}
                disabled={view === "walk"}
                onClick={() => {
                  setView("building");
                  setCameraOrientation("top");
                }}
              >
                Top
              </button>
            </div>
            <div className="editor-tool-group editor-transform-tools" aria-label="Transform tools">
              <button
                type="button"
                className={transformMode === "translate" ? "active" : ""}
                disabled={
                  Boolean(review) ||
                  busy ||
                  view === "walk" ||
                  (view === "building" &&
                    !showReferenceWorkspace &&
                    !(showRoomMapper && Boolean(room) && selected === room?.id))
                }
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
                  !(
                    (view === "rooms" && Boolean(item)) ||
                    (view === "building" && showReferenceWorkspace)
                  )
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
                  !(
                    view === "rooms" ||
                    (view === "building" && showRoomMapper)
                  ) ||
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
            <div className="editor-tool-group editor-floor-tools" aria-label="Floor isolation">
              <select
                aria-label="Isolate floor"
                value={isolateFloorId}
                disabled={view === "walk"}
                onChange={(event) => {
                  const next = event.target.value;
                  setIsolateFloorId(next);
                  if (next) {
                    const target = scene.floors.find((floor) => floor.id === next);
                    if (target) {
                      setSectionCutOffset(target.elevation + 1.5);
                      setView("building");
                    }
                  }
                }}
              >
                <option value="">All floors</option>
                {[...scene.floors]
                  .sort((a, b) => a.elevation - b.elevation)
                  .map((floor) => (
                    <option key={floor.id} value={floor.id}>
                      {floor.name} · {floor.elevation}m
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className={isolateFloorId ? "active" : ""}
                disabled={!isolateFloorId || view === "walk"}
                onClick={() => setIsolateFloorId("")}
                title="Clear floor isolation"
              >
                {isolateFloorId ? "Isolated" : "Floor"}
              </button>
              <button
                type="button"
                className={sectionCutEnabled ? "active" : ""}
                disabled={view === "walk"}
                onClick={() => setSectionCutEnabled((value) => !value)}
                title="Toggle live section clipping"
              >
                Section
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
                disabled={busy || Boolean(review)}
                title="Attach FBX/DWG/PDF/images/textures"
                onClick={() => referenceInput.current?.click()}
              >
                + Source
              </button>
              <button
                type="button"
                className={showReferenceWorkspace ? "active" : ""}
                title="Open calibrated plan/reference workspace"
                onClick={() => {
                  setShowReferenceWorkspace((value) => !value);
                  setView("building");
                  setCameraOrientation("top");
                }}
              >
                Reference
              </button>
              <button
                type="button"
                className={showRoomMapper ? "active" : ""}
                disabled={Boolean(review) || busy}
                title="Map units and rooms visually with the mouse"
                onClick={() => {
                  const next = !showRoomMapper;
                  const floorId =
                    room?.floorId ??
                    roomMapFloorId ??
                    p.scene.floors[0]?.id ??
                    "";
                  setShowRoomMapper(next);
                  if (next) {
                    setShowReferenceWorkspace(false);
                    setShowAssetShelf(false);
                    setRoomMapFloorId(floorId);
                    if (room) setSelected(room.id);
                    setRoomMapUnit(room?.unit ?? roomMapUnit ?? "Unit 101");
                    setRoomMapAction("idle");
                    setView("building");
                    setCameraOrientation("top");
                    setIsolateFloorId(floorId);
                  } else {
                    setRoomMapAction("idle");
                  }
                }}
              >
                Map Rooms
              </button>
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
          {sectionCutEnabled && (
            <div className="section-cut-bar" role="group" aria-label="Section cut controls">
              <b>SECTION CUT</b>
              <div className="section-axis">
                {(["x", "y", "z"] as const).map((axis) => (
                  <button
                    type="button"
                    key={axis}
                    className={sectionCutAxis === axis ? "active" : ""}
                    onClick={() => setSectionCutAxis(axis)}
                  >
                    {axis.toUpperCase()}
                  </button>
                ))}
              </div>
              <input
                aria-label="Section cut position"
                type="range"
                min="-50"
                max="50"
                step="0.05"
                value={sectionCutOffset}
                onChange={(event) =>
                  setSectionCutOffset(Number(event.target.value))
                }
              />
              <label>
                Position
                <input
                  type="number"
                  min="-10000"
                  max="10000"
                  step="0.05"
                  value={sectionCutOffset}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) setSectionCutOffset(next);
                  }}
                />
              </label>
              <button
                type="button"
                className={sectionCutFlip ? "active" : ""}
                onClick={() => setSectionCutFlip((value) => !value)}
              >
                Flip
              </button>
              <button type="button" onClick={() => setSectionCutEnabled(false)}>
                Close
              </button>
            </div>
          )}
          <SceneCanvas
            scene={scene}
            roomId={roomId}
            selected={selected}
            selectedMesh={mesh}
            selectedMeshKey={selectedModelNodeKey}
            view={view}
            transformMode={transformMode}
            transformEnabled={!review && !busy}
            modelTransformEnabled={showReferenceWorkspace}
            roomMapEnabled={showRoomMapper}
            roomDraw={{
              enabled:
                showRoomMapper &&
                (roomMapAction === "create" || roomMapAction === "reshape"),
              floorId: roomMapFloorId,
              snap: roomMapSnap,
            }}
            snap={transformSnap}
            focusRequest={focusRequest}
            cameraOrientation={cameraOrientation}
            showReferenceLayers
            isolateFloorId={isolateFloorId || undefined}
            sectionCut={{
              enabled: sectionCutEnabled,
              axis: sectionCutAxis,
              offset: sectionCutOffset,
              flip: sectionCutFlip,
            }}
            onSelect={select}
            onMesh={(name) => {
              setMesh(name);
              setSelected("");
            }}
            onModelNodeSelect={(node) => {
              setMesh(node.name);
              setSelectedModelNodeKey(node.key);
              setSelected("");
            }}
            onTransformCommit={commitCanvasTransform}
            onRoomDraw={commitMappedRoom}
            onModelNodes={setModelNodes}
            onModelMaterials={setModelMaterials}
          />
          {showRoomMapper && (
            <VisualRoomMapper
              scene={p.scene}
              floorId={roomMapFloorId || p.scene.floors[0]?.id || ""}
              unit={roomMapUnit}
              roomName={roomMapName}
              action={roomMapAction}
              snap={roomMapSnap}
              selectedRoom={selected === room?.id ? room : undefined}
              disabled={Boolean(review) || busy}
              onFloor={(floorId) => {
                setRoomMapFloorId(floorId);
                setIsolateFloorId(floorId);
                const target = p.scene.floors.find(
                  (entry) => entry.id === floorId,
                );
                if (target) setSectionCutOffset(target.elevation + 1.5);
              }}
              onUnit={setRoomMapUnit}
              onRoomName={setRoomMapName}
              onAction={setRoomMapAction}
              onSnap={setRoomMapSnap}
              onClone={cloneMappedRoom}
              onMirror={mirrorMappedRoom}
              onClose={() => {
                setShowRoomMapper(false);
                setRoomMapAction("idle");
              }}
            />
          )}
          {showReferenceWorkspace && (
            <ReferenceWorkspace
              files={files}
              modelId={p.scene.modelId}
              layers={p.scene.referenceLayers ?? []}
              modelTransform={modelTransform}
              disabled={Boolean(review) || busy}
              onUpsertLayer={upsertReferenceLayer}
              onRemoveLayer={removeReferenceLayer}
              onModelTransform={patchModelTransform}
              onTopView={() => {
                setView("building");
                setCameraOrientation("top");
              }}
              onClose={() => setShowReferenceWorkspace(false)}
            />
          )}
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
            {view === "building" && mesh ? (
              <>
                <h2>{mesh}</h2>
                <p>
                  Source geometry stays read-only. Tag this exact source mesh to
                  a floor, unit or room so isolation and future project
                  navigation use reviewed semantics instead of guesses.
                </p>
                <label>
                  Source mesh
                  <input
                    readOnly
                    value={
                      selectedModelNode
                        ? `${selectedModelNode.name} · occurrence ${selectedModelNode.occurrence}`
                        : mesh
                    }
                  />
                </label>
                {selectedModelNode && (
                  <>
                    <div className="semantic-tag-status">
                      <span>
                        Tagged {taggedModelNodeCount}/{modelNodes.length}
                      </span>
                      <span>
                        Source Y {selectedModelNode.centreY.toFixed(3)}
                      </span>
                    </div>
                    <label>
                      Floor tag
                      <select
                        value={selectedModelNodeTag?.floorId ?? ""}
                        onChange={(event) =>
                          patchModelNodeTag({ floorId: event.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {[...p.scene.floors]
                          .sort((a, b) => a.elevation - b.elevation)
                          .map((floor) => (
                            <option key={floor.id} value={floor.id}>
                              {floor.name} · {floor.elevation}m
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Unit / flat tag
                      <input
                        value={selectedModelNodeTag?.unit ?? ""}
                        onChange={(event) =>
                          patchModelNodeTag({ unit: event.target.value })
                        }
                        placeholder="e.g. 101"
                        list="model-node-units"
                      />
                    </label>
                    <datalist id="model-node-units">
                      {[
                        ...new Set(
                          p.scene.rooms
                            .filter(
                              (candidate) =>
                                !selectedModelNodeTag?.floorId ||
                                candidate.floorId ===
                                  selectedModelNodeTag.floorId,
                            )
                            .map((candidate) => candidate.unit)
                            .filter(Boolean),
                        ),
                      ].map((unit) => (
                        <option key={unit} value={unit} />
                      ))}
                    </datalist>
                    <label>
                      Exact room binding
                      <select
                        value={selectedModelNodeTag?.roomId ?? ""}
                        onChange={(event) => {
                          const targetRoomId = event.target.value;
                          if (targetRoomId) bindSelectedMeshToRoom(targetRoomId);
                          else patchModelNodeTag({ roomId: "" });
                        }}
                      >
                        <option value="">No exact room</option>
                        {p.scene.rooms
                          .filter(
                            (candidate) =>
                              !selectedModelNodeTag?.floorId ||
                              candidate.floorId ===
                                selectedModelNodeTag.floorId,
                          )
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.unit} · {candidate.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={!selectedModelNodeTag}
                      onClick={clearModelNodeTag}
                    >
                      Clear semantic tag
                    </button>
                  </>
                )}
                <button
                  disabled={!room}
                  onClick={() => {
                    if (room) bindSelectedMeshToRoom(room.id);
                  }}
                >
                  Bind mesh to current room
                </button>
                <button
                  type="button"
                  onClick={() => setFocusRequest((value) => value + 1)}
                >
                  Focus selected mesh
                </button>
              </>
            ) : item ? (
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
                <details className="advanced-properties">
                  <summary>Advanced numeric geometry</summary>
                  <p>
                    Normally use Map Rooms, Move and Scale with the mouse. Exact
                    values stay available here when engineering-level correction
                    is required.
                  </p>
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
                </details>
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
          {view === "building" && (
            <section className="editor-materials" aria-label="Material editor">
              <div className="section-label">MATERIALS</div>
              {modelMaterials.length ? (
                <>
                  <label>
                    Model material
                    <select
                      value={selectedMaterial}
                      onChange={(event) => setSelectedMaterial(event.target.value)}
                      disabled={Boolean(review) || busy}
                    >
                      {modelMaterials.map((material) => (
                        <option key={material.name} value={material.name}>
                          {material.name} · {material.meshCount} mesh
                          {material.meshCount === 1 ? "" : "es"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {materialSummary && (
                    <fieldset disabled={Boolean(review) || busy}>
                      <div className="material-color-row">
                        <label>
                          Base color
                          <input
                            type="color"
                            value={
                              materialOverride?.baseColor ??
                              materialSummary.baseColor
                            }
                            onChange={(event) =>
                              patchMaterial({ baseColor: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Emissive
                          <input
                            type="color"
                            value={
                              materialOverride?.emissive ??
                              materialSummary.emissive
                            }
                            onChange={(event) =>
                              patchMaterial({ emissive: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      {field(
                        "Roughness",
                        materialOverride?.roughness ??
                          materialSummary.roughness,
                        (roughness) => patchMaterial({ roughness }),
                        0.05,
                      )}
                      {field(
                        "Metalness",
                        materialOverride?.metalness ??
                          materialSummary.metalness,
                        (metalness) => patchMaterial({ metalness }),
                        0.05,
                      )}
                      {field(
                        "Opacity",
                        materialOverride?.opacity ?? materialSummary.opacity,
                        (opacity) => patchMaterial({ opacity }),
                        0.05,
                      )}
                      {field(
                        "Emissive intensity",
                        materialOverride?.emissiveIntensity ??
                          materialSummary.emissiveIntensity,
                        (emissiveIntensity) =>
                          patchMaterial({ emissiveIntensity }),
                        0.1,
                      )}
                      <button
                        type="button"
                        disabled={!materialOverride}
                        onClick={resetMaterial}
                      >
                        Reset material override
                      </button>
                      <small>
                        Runtime material override only; imported source bytes stay
                        unchanged.
                      </small>
                    </fieldset>
                  )}
                </>
              ) : (
                <small>Load the building model to inspect editable runtime materials.</small>
              )}
            </section>
          )}
          {view === "building" && (
            <section className="editor-lighting" aria-label="Lighting editor">
              <div className="section-label">LIGHTING & LOOK</div>
              <fieldset disabled={Boolean(review) || busy}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={appearance.referenceVisual}
                    onChange={(event) =>
                      patchAppearance({ referenceVisual: event.target.checked })
                    }
                  />
                  Jyoti verified reference look
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={appearance.nightMode}
                    onChange={(event) =>
                      patchAppearance({ nightMode: event.target.checked })
                    }
                  />
                  Evening / architectural lights
                </label>
                {field(
                  "Exposure",
                  appearance.exposure,
                  (exposure) => patchAppearance({ exposure }),
                  0.05,
                )}
                {field(
                  "Sun intensity",
                  appearance.sunIntensity,
                  (sunIntensity) => patchAppearance({ sunIntensity }),
                  0.1,
                )}
                {field(
                  "Sky / hemisphere",
                  appearance.hemisphereIntensity,
                  (hemisphereIntensity) =>
                    patchAppearance({ hemisphereIntensity }),
                  0.1,
                )}
                <label>
                  Studio background
                  <input
                    type="color"
                    value={appearance.background}
                    disabled={appearance.referenceVisual}
                    onChange={(event) =>
                      patchAppearance({ background: event.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    edit({
                      ...p,
                      scene: {
                        ...p.scene,
                        appearance: { ...DEFAULT_APPEARANCE },
                        materialOverrides: [],
                      },
                    })
                  }
                >
                  Reset look development
                </button>
              </fieldset>
            </section>
          )}
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
        multiple
        ref={referenceInput}
        type="file"
        accept=".fbx,.pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.skb,.skp,.drs,.csv,.json,.tif,.tiff"
        onChange={(e) => {
          const selectedFiles = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (selectedFiles.length)
            void task(() => uploadReferences(selectedFiles));
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
