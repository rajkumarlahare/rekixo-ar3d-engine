import { useEffect, useMemo, useRef, useState } from "react";
import SceneCanvas, {
  type ModelMaterialSummary,
  type ModelNodeSummary,
  type RoomDrawResult,
  type TransformCommit,
  type TransformMode,
  type View,
} from "./SceneCanvas";
import ReferenceWorkspace from "./ReferenceWorkspace";
import FloorRoomReview from "./FloorRoomReview";
import VisualRoomMapper, {
  type RoomMapAction,
} from "./VisualRoomMapper";
import {
  catalog,
  DEFAULT_SCENE_APPEARANCE,
  duplicateFloor,
  projectSlug,
  id,
  newProject,
  roomArea,
  roomGeometryFromPolygon,
  snapshot,
  validateProject,
  type Asset,
  type Furniture,
  type Kind,
  type MaterialOverride,
  type ModelNodeTag,
  type Opening,
  type ModelTransform,
  type Project,
  type ReferenceLayer,
  type Room,
  type RoomPoint,
  type SceneAppearance,
} from "./domain";
import * as storage from "./storage";
import * as cloud from "./cloud";
import { rebindLocalProjectToEmptyCloud } from "./cloudIdentity";
import {
  importPublished,
  loadPublished,
  loadPublishedCatalog,
  type PublishedCatalogEntry,
} from "./published";
import { buildSceneManifestV2 } from "./manifestV2";
import StudioOverview from "./StudioOverview";
import SmartProjectBuilder from "./SmartProjectBuilder";
import RoomNavigationPanel from "./RoomNavigationPanel";
import ModelNodeInspector from "./ModelNodeInspector";
import { useStudioCloudState } from "./useStudioCloudState";
import StudioSources from "./StudioSources";
import StudioEvidence from "./StudioEvidence";
import {
  findSupersedingReviewedRoom,
  isRemovableUnsourcedDraft,
} from "./reviewDrafts";
import StudioPublish from "./StudioPublish";
import { buildStudioReadiness } from "./readiness";
import { auditFbxSources, type FbxSourceAudit } from "./sourceAudit";
import {
  analyzeProjectFiles,
  type SmartProjectAnalysis,
} from "./projectAnalyzer";
import {
  buildSourceFusionReport,
  type SourceFusionReport,
} from "./sourceFusion";
import { prepareFbxWebModel } from "./fbxWebModel";
import { buildSmartSceneDraft } from "./smartDraftBuilder";
import {
  autoBuildSummaryMessage,
  runAutoBuildPipeline,
} from "./autoBuildPipeline";
import { prepareSketchUpTextureRecovery } from "./sketchUpRecovery";
import {
  acceptReadyRepeatedFloors,
  approveReadyModelWalls,
} from "./autoBuildingReview";
import {
  suggestOpeningAssociations,
  type OpeningSuggestion,
} from "./openingAssociator";
import { applyReadyOpeningWorkflow } from "./openingWorkflow";
import {
  applyQuickSourceSetup,
  detectQuickSourceSetup,
  emptyQuickSourceSetup,
  prepareQuickPublishModel,
  type QuickSourceSetup,
} from "./sourcePackSetup";
import { floorSkeletonStatus } from "./floorSkeleton";
import {
  APPEARANCE_PRESETS,
  activeAppearancePreset,
  appearancePreset,
  type AppearancePresetId,
} from "./appearancePresets";
import type { PdfReferenceRasterOptions } from "./pdfReferenceRaster";
import {
  createSuggestedRoomDrafts,
  mappedRoomSheetKeys,
  parseRoomSheetAssets,
  profileRoomSheetRows,
  resolveRoomSheetFloorId,
  roomSheetMarker,
  type RoomSheetRow,
} from "./roomSheet";
import {
  applyBatchRepeatPlan,
  buildBatchRepeatPreview,
  isBatchRepeatedRoom,
} from "./unitRepeat";
import {
  auditDemoInterior,
  buildRepeatedDemoInterior,
  buildTypicalFloorDemoInterior,
  reconcileDemoInterior,
  repairDemoInterior,
} from "./demoInterior";
import {
  projectAheadOfCloud,
  withLocalSaveTimestamp,
} from "./localDraftState";
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
    [cloudDirty, setCloudDirty] = useState(false),
    [localSaveState, setLocalSaveState] = useState<
      "saved" | "saving" | "error"
    >("saved"),
    [review, setReview] = useState(""),
    [backup, setBackup] = useState<{ url: string; name: string }>(),
    [mesh, setMesh] = useState("");
  const [transformMode, setTransformMode] = useState<TransformMode>("translate");
  const [transformSnap, setTransformSnap] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const [autoAlignRequest, setAutoAlignRequest] = useState(0);
  const [editorFocus, setEditorFocus] = useState(false);
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showAssetShelf, setShowAssetShelf] = useState(true);
  const [interiorFloorOverview, setInteriorFloorOverview] = useState(false);
  const [showReferenceWorkspace, setShowReferenceWorkspace] = useState(false);
  const [showRoomMapper, setShowRoomMapper] = useState(false);
  const [showFloorReview, setShowFloorReview] = useState(false);
  const [roomMapFloorId, setRoomMapFloorId] = useState("");
  const [roomMapUnit, setRoomMapUnit] = useState("Unit 101");
  const [roomMapName, setRoomMapName] = useState("Room");
  const [roomMapAction, setRoomMapAction] =
    useState<RoomMapAction>("idle");
  const [roomMapSnap, setRoomMapSnap] = useState(true);
  const [roomSheetRows, setRoomSheetRows] = useState<RoomSheetRow[]>([]);
  const [roomSheetIssues, setRoomSheetIssues] = useState<string[]>([]);
  const [selectedRoomSheetKey, setSelectedRoomSheetKey] = useState("");
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
  const [sourceFusion, setSourceFusion] = useState<SourceFusionReport>();
  const [quickSourceSetup, setQuickSourceSetup] =
    useState<QuickSourceSetup>(emptyQuickSourceSetup());
  const [manifestText, setManifestText] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [published, setPublished] = useState<PublishedCatalogEntry[]>([]);
  const requestedCloudProjectRef = useRef("");
  const [workspace, setWorkspace] = useState<
    "builder" | "overview" | "editor" | "sources" | "evidence" | "publish"
  >("builder");
  const {
    cloudSession,
    cloudProjects,
    cloudSearch,
    setCloudSearch,
    cloudFilter,
    setCloudFilter,
    cloudReleases,
    refreshCloudProjects,
    refreshCloudReleases,
    markCloudSignedOut,
  } = useStudioCloudState(project, setError);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search)
      .get("project")
      ?.trim()
      .toLowerCase();
    if (
      !requested ||
      requestedCloudProjectRef.current === requested ||
      !cloudSession?.authenticated ||
      !cloudProjects.some((entry) => entry.slug === requested)
    )
      return;

    requestedCloudProjectRef.current = requested;
    void task(async () => {
      await openCloudProject(requested);
      setWorkspace("builder");
    });
  }, [cloudProjects, cloudSession?.authenticated]);

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
    redo = useRef<Project[]>([]),
    localEditSerial = useRef(0);
  const modelInput = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  async function refresh() {
    const entries = await storage.projects();
    setList(entries.sort((a, b) => b.updated.localeCompare(a.updated)));
  }
  function open(p: Project) {
    setFiles([]);
    setQuickSourceSetup(emptyQuickSourceSetup());
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
    setSourceFusion(undefined);
    setShowReferenceWorkspace(false);
    setShowRoomMapper(false);
    setShowFloorReview(false);
    setRoomMapFloorId(
      p.scene.rooms[0]?.floorId ?? p.scene.floors[0]?.id ?? "",
    );
    setRoomMapUnit(p.scene.rooms[0]?.unit ?? "Unit 101");
    setRoomMapName("Room");
    setRoomMapAction("idle");
    setRoomMapSnap(true);
    setRoomSheetRows([]);
    setRoomSheetIssues([]);
    setSelectedRoomSheetKey("");
    setCameraOrientation("perspective");
    localEditSerial.current += 1;
    setProject(p);
    setRoomId(p.scene.rooms[0]?.id ?? "");
    setSelected(p.scene.rooms[0]?.id ?? "");
    setReview("");
    setWorkspace("builder");
    setEditorFocus(false);
    setInteriorFloorOverview(false);
    setView(p.scene.modelId ? "building" : "rooms");
    setDirty(false);
    setCloudDirty(projectAheadOfCloud(p));
    setLocalSaveState("saved");
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
    void detectQuickSourceSetup(files)
      .then((setup) => {
        if (active) setQuickSourceSetup(setup);
      })
      .catch(() => {
        if (active) setQuickSourceSetup(emptyQuickSourceSetup());
      });
    return () => {
      active = false;
    };
  }, [files]);

  useEffect(() => {
    if (
      !project ||
      review ||
      busy ||
      !quickSourceSetup.profile ||
      !quickSourceSetup.interiorAutomation?.enabled ||
      !quickSourceSetup.interiorAutomation?.autoReconcile ||
      !quickSourceSetup.repeatPlan ||
      !quickSourceSetup.floorSkeleton?.length
    )
      return;

    const floorStatus = floorSkeletonStatus(
      project.scene,
      quickSourceSetup.profile,
      quickSourceSetup.floorSkeleton,
    );
    const typicalFloorId =
      floorStatus.floorIdByKey[quickSourceSetup.repeatPlan.sourceFloorKey];
    if (!typicalFloorId) return;

    const repeatPreview = buildBatchRepeatPreview(
      project.scene,
      quickSourceSetup.profile,
      quickSourceSetup.floorSkeleton,
      quickSourceSetup.repeatPlan,
    );
    const result = reconcileDemoInterior(
      project.scene,
      typicalFloorId,
      repeatPreview.rows,
      id,
    );
    const changed =
      result.removed.length +
      result.createdTypical.length +
      result.createdRepeated.length;
    if (!changed) return;

    const next: Project = {
      ...project,
      scene: { ...project.scene, furniture: result.furniture },
    };
    try {
      validateProject(next);
      edit(next);
      setSelected((current) =>
        result.removed.some((issue) => issue.furnitureId === current)
          ? roomId
          : current,
      );
      setMessage(
        `Demo interior auto-repaired · ${result.removed.length} misplaced removed · ${result.createdTypical.length + result.createdRepeated.length} correct items restored/repeated.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Demo interior automatic repair could not be applied safely.",
      );
    }
  }, [
    project,
    quickSourceSetup,
    review,
    busy,
    roomId,
  ]);

  useEffect(() => {
    let active = true;
    void parseRoomSheetAssets(files)
      .then((parsed) => {
        if (!active) return;
        const floorPlanAsset = quickSourceSetup.slots.find(
          (slot) => slot.key === "floorPlan",
        )?.asset;
        const profileRows =
          quickSourceSetup.profile && quickSourceSetup.roomSheetTemplate?.length
            ? profileRoomSheetRows(
                quickSourceSetup.roomSheetTemplate,
                quickSourceSetup.profile,
                floorPlanAsset,
              )
            : [];
        const rows = parsed.rows.length ? parsed.rows : profileRows;
        setRoomSheetRows(rows);
        setRoomSheetIssues(parsed.issues);
        setSelectedRoomSheetKey((current) =>
          rows.some((row) => row.key === current) ? current : "",
        );
      })
      .catch(() => {
        if (!active) return;
        setRoomSheetRows([]);
        setRoomSheetIssues(["Room-sheet source could not be read."]);
        setSelectedRoomSheetKey("");
      });
    return () => {
      active = false;
    };
  }, [files, quickSourceSetup]);

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
    let active = true;
    if (!files.length) {
      setSourceFusion(undefined);
      return;
    }
    void buildSourceFusionReport(
      files,
      smartAnalysis,
      sourceAudits,
      roomSheetRows,
    )
      .then((report) => {
        if (active) setSourceFusion(report);
      })
      .catch(() => {
        if (active) setSourceFusion(undefined);
      });
    return () => {
      active = false;
    };
  }, [files, smartAnalysis, sourceAudits, roomSheetRows]);

  useEffect(() => {
    if (!modelMaterials.length) {
      setSelectedMaterial("");
      return;
    }
    if (!modelMaterials.some((material) => material.name === selectedMaterial))
      setSelectedMaterial(modelMaterials[0].name);
  }, [modelMaterials, selectedMaterial]);
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

  useEffect(() => {
    if (!project || !dirty || review) return;
    const serial = localEditSerial.current;
    const projectId = project.id;
    const timer = window.setTimeout(() => {
      const next = withLocalSaveTimestamp(project);
      setLocalSaveState("saving");
      void storage
        .save(next)
        .then(() => {
          if (serial !== localEditSerial.current) return;
          setProject((current) =>
            current?.id === projectId
              ? { ...current, updated: next.updated }
              : current,
          );
          setDirty(false);
          setLocalSaveState("saved");
          setList((current) => {
            const updated = current.some((entry) => entry.id === projectId)
              ? current.map((entry) =>
                  entry.id === projectId ? next : entry,
                )
              : [...current, next];
            return updated.sort((left, right) =>
              right.updated.localeCompare(left.updated),
            );
          });
        })
        .catch(() => {
          if (serial !== localEditSerial.current) return;
          setLocalSaveState("error");
          setError(
            "Local autosave failed. Use Save local before reloading or closing this page.",
          );
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [project, dirty, review]);
  function edit(next: Project) {
    if (!project) return;
    setBackup(undefined);
    undo.current.push(project);
    if (undo.current.length > 40) undo.current.shift();
    redo.current = [];
    localEditSerial.current += 1;
    setProject(next);
    setDirty(true);
    if (next.cloud) setCloudDirty(true);
    setLocalSaveState("saving");
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
    const next = withLocalSaveTimestamp(p);
    await storage.save(next, assets);
    localEditSerial.current += 1;
    setProject(next);
    setDirty(false);
    setCloudDirty(projectAheadOfCloud(next));
    setLocalSaveState("saved");
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

  async function refreshPublishedCatalog() {
    setPublished(await loadPublishedCatalog());
  }

  async function openCloudProject(slug: string) {
    if (dirty)
      throw Error("Save your local changes before opening a cloud project.");
    try {
      const downloaded = await cloud.downloadProject(slug);
      const cached = await storage.cacheCloudProject(
        downloaded.project,
        downloaded.files,
      );
      await refresh();
      open(downloaded.project);
      setMessage(
        cached.backup
          ? `Cloud draft opened. The previous local copy was preserved as "${cached.backup.name}".`
          : "Cloud draft downloaded and cached locally for offline editing.",
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
      const cached = await storage.cacheCloudProject(
        projectFromPublished,
        ownedFiles,
      );
      await refresh();
      open(projectFromPublished);
      setMessage(
        cached.backup
          ? `Published Engine design opened under the correct cloud identity. Your previous local copy was preserved as "${cached.backup.name}". Save to cloud will create revision 1 without changing the live public project.`
          : "This Engine project had no cloud draft. Studio was seeded from its read-only published design; Save to cloud will create revision 1 without changing the live public project.",
      );
      return;
    }

    const blank = newProject(summary.name);
    blank.id = summary.id;
    blank.slug = summary.slug;
    blank.location = summary.location ?? "";
    blank.updated = new Date().toISOString();
    const cached = await storage.cacheCloudProject(blank);
    await refresh();
    open(blank);
    setMessage(
      cached.backup
        ? `Cloud identity opened with an empty draft. Your previous local copy was preserved as "${cached.backup.name}".`
        : "This Engine project had no Studio draft, so an empty local authoring draft was created. Save to cloud will create revision 1; existing live models/scenes remain untouched.",
    );
  }

  async function adoptCurrentBackupToEmptyCloud(
    target: (typeof cloudProjects)[number],
  ) {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before attaching a local backup.");
    if (target.draftRevision !== undefined)
      throw Error(
        "This Engine Cloud project already has a draft. Open that draft instead of replacing it.",
      );
    if (
      !window.confirm(
        `Use this preserved local project (${p.scene.rooms.length} rooms) as the first cloud draft for "${target.name}"? A downloadable .rekixo backup will be prepared first. The active public release will not change until you explicitly publish.`,
      )
    )
      return;

    const backupBlob = await storage.exportPackage(p);
    download(
      backupBlob,
      `${projectSlug(p)}-before-cloud-attach.rekixo.json`,
    );

    const rebound = rebindLocalProjectToEmptyCloud(
      p,
      files,
      target,
      { allowExplicitTarget: true },
    );
    const next = await cloud.syncProject(rebound.project, rebound.files);
    await storage.cacheCloudProject(next, rebound.files);
    localEditSerial.current += 1;
    setProject(next);
    setFiles(rebound.files);
    setDirty(false);
    setCloudDirty(false);
    setLocalSaveState("saved");
    await Promise.all([
      refresh(),
      refreshCloudProjects(),
      refreshCloudReleases(next),
    ]);
    setMessage(
      `Preserved local design attached to "${target.name}" safely · cloud revision ${next.cloud?.revision ?? "—"} · ${next.scene.rooms.length} rooms retained. The active public release is unchanged until Publish.`,
    );
  }

  async function syncCloudProject() {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before saving a cloud draft.");

    const slug = projectSlug(p);
    const cloudMatch = cloudProjects.find((entry) => entry.slug === slug);
    let sourceProject = p;
    let sourceFiles = files;
    let adoptedExistingIdentity = false;

    if (cloudMatch && cloudMatch.id !== p.id) {
      if (cloudMatch.draftRevision !== undefined)
        throw Error(
          "This slug already has a cloud draft. Open that cloud project first so a newer shared draft is never overwritten.",
        );
      if (
        !window.confirm(
          `The Engine registry already owns "${cloudMatch.name}" (${cloudMatch.slug}) but it has no Studio draft. Attach this current local design to that existing cloud identity? Your current local copy will be preserved as a local backup.`,
        )
      )
        return;
      const rebound = rebindLocalProjectToEmptyCloud(
        p,
        files,
        cloudMatch,
      );
      sourceProject = rebound.project;
      sourceFiles = rebound.files;
      adoptedExistingIdentity = true;
    }

    const next = await cloud.syncProject(sourceProject, sourceFiles);
    const cached = await storage.cacheCloudProject(next, sourceFiles);
    localEditSerial.current += 1;
    setProject(next);
    setFiles(sourceFiles);
    setDirty(false);
    setCloudDirty(false);
    setLocalSaveState("saved");
    await Promise.all([
      refresh(),
      refreshCloudProjects(),
      refreshCloudReleases(next),
    ]);
    setMessage(
      adoptedExistingIdentity
        ? `Existing Engine cloud identity adopted safely · cloud revision ${next.cloud?.revision ?? "—"} · previous local copy preserved${cached.backup ? ` as "${cached.backup.name}"` : ""}. Publishing remains a separate immutable step.`
        : `Cloud draft saved · revision ${next.cloud?.revision ?? "—"} · local cache updated. Publishing remains a separate immutable step.`,
    );
  }
  async function publishCurrentRelease() {
    if (!cloudSession?.authenticated)
      throw Error("Sign in to Engine Admin before publishing.");
    const gate = buildStudioReadiness(
      p,
      files,
      cloudDirty,
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
    if (cloudDirty)
      throw Error("Save to cloud before switching a release.");
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
      localEditSerial.current += 1;
      setProject(p);
      setDirty(true);
      if (p.cloud) setCloudDirty(true);
      setLocalSaveState("saving");
      setReview("");
    }
  }
  useEffect(() => {
    if (workspace !== "editor") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editorFocus) {
        event.preventDefault();
        setEditorFocus(false);
        return;
      }
      if (event.key === "Escape") setShowFloorReview(false);
      if (review || busy) return;
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
  }, [workspace, review, busy, project, editorFocus]);
  const openingSuggestions = useMemo(
    () =>
      project && smartAnalysis
        ? suggestOpeningAssociations(smartAnalysis, project.scene)
        : [],
    [project, smartAnalysis],
  );
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
    supersedingRoom = room ? findSupersedingReviewedRoom(scene, room) : undefined,
    legacyDraftFurnitureBlocked = Boolean(
      room &&
        !room.verified &&
        supersedingRoom &&
        isRemovableUnsourcedDraft(scene, room),
    ),
    item = scene.furniture.find((f) => f.id === selected),
    floor = scene.floors.find((f) => f.id === room?.floorId),
    readiness = buildStudioReadiness(
      p,
      files,
      cloudDirty,
      cloudSession,
      cloudReleases,
    ),
    publishedCurrent = published.some(
      (entry) => entry.slug === projectSlug(p),
    ),
    localBackupBaseName = p.name
      .replace(/\s*\(local backup\)\s*$/i, "")
      .trim(),
    backupCloudTarget = !p.cloud && /\(local backup\)\s*$/i.test(p.name)
      ? cloudProjects.find(
          (entry) =>
            entry.draftRevision === undefined &&
            (entry.name.trim().toLowerCase() ===
              localBackupBaseName.toLowerCase() ||
              projectSlug(p).startsWith(`${entry.slug}-local-backup-`)),
        )
      : undefined,
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
    mappedSheetKeys = mappedRoomSheetKeys(p.scene.rooms),
    typicalFloorId = quickSourceSetup.profile && quickSourceSetup.repeatPlan
      ? floorSkeletonStatus(p.scene, quickSourceSetup.profile, quickSourceSetup.floorSkeleton)
          .floorIdByKey[quickSourceSetup.repeatPlan.sourceFloorKey]
      : undefined,
    batchRepeatPreview = buildBatchRepeatPreview(
      p.scene,
      quickSourceSetup.profile,
      quickSourceSetup.floorSkeleton,
      quickSourceSetup.repeatPlan,
    ),
    profileDemoInteriorEnabled =
      Boolean(quickSourceSetup.interiorAutomation?.enabled) &&
      Boolean(typicalFloorId),
    demoInteriorIssues = profileDemoInteriorEnabled
      ? auditDemoInterior(p.scene)
      : [],
    typicalDemoInteriorPreview =
      profileDemoInteriorEnabled && typicalFloorId
        ? (() => {
            let previewIndex = 0;
            return buildTypicalFloorDemoInterior(
              p.scene,
              typicalFloorId,
              () => `preview-typical-${previewIndex++}`,
            );
          })()
        : { furniture: p.scene.furniture, created: [], skippedRooms: [] },
    typicalFloorRoomIds = new Set(
      typicalFloorId
        ? p.scene.rooms
            .filter((entry) => entry.floorId === typicalFloorId)
            .map((entry) => entry.id)
        : [],
    ),
    typicalFloorFurnitureCount = p.scene.furniture.filter((entry) =>
      typicalFloorRoomIds.has(entry.roomId),
    ).length,
    repeatDemoInteriorPreview =
      profileDemoInteriorEnabled &&
      typicalFloorId &&
      typicalDemoInteriorPreview.created.length === 0 &&
      typicalFloorFurnitureCount > 0
        ? (() => {
            let previewIndex = 0;
            return buildRepeatedDemoInterior(
              p.scene,
              batchRepeatPreview.rows,
              () => `preview-repeat-${previewIndex++}`,
            );
          })()
        : { furniture: p.scene.furniture, created: [], skippedRooms: [] },
    approvedOpeningKeys = new Set(
      (p.scene.openings ?? [])
        .filter(
          (opening) =>
            opening.sourceNodeName &&
            opening.sourceOccurrence !== undefined,
        )
        .map(
          (opening) =>
            `${opening.sourceNodeName}\u0000${opening.sourceOccurrence}`,
        ),
    ),
    openingWorkflowStatus = {
      analyzed: Boolean(smartAnalysis),
      approved: (p.scene.openings ?? []).filter(
        (opening) =>
          opening.reviewed &&
          (opening.kind === "door" || opening.kind === "window"),
      ).length,
      ready: openingSuggestions.filter(
        (suggestion) =>
          suggestion.ready && !approvedOpeningKeys.has(suggestion.key),
      ).length,
      review: openingSuggestions.filter(
        (suggestion) =>
          !suggestion.ready && !approvedOpeningKeys.has(suggestion.key),
      ).length,
      detected: openingSuggestions.filter(
        (suggestion) => !approvedOpeningKeys.has(suggestion.key),
      ).length,
    },
    activeRoomSheetRow = roomSheetRows.find(
      (row) => row.key === selectedRoomSheetKey,
    ),
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
          (tag?.unit ?? "").toLowerCase().includes(query) ||
          (tag?.semantic ?? "").toLowerCase().includes(query)
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
    appearance = p.scene.appearance ?? DEFAULT_SCENE_APPEARANCE,
    activeLookPreset = activeAppearancePreset(appearance),
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
          r.id === room.id ? { ...r, ...change,
            ...(["x", "z", "width", "depth", "height", "polygon", "floorId", "unit"].some((key) => key in change)
              ? { verified: false } : {}),
          } : r,
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
  function repairDemoInteriorConsistency() {
    if (!profileDemoInteriorEnabled) {
      setError("Interior automation is not enabled for this source profile.");
      return;
    }
    const result = repairDemoInterior(p.scene);
    if (!result.removed.length) {
      setMessage("Interior room assignments are already consistent.");
      return;
    }
    const next: Project = {
      ...p,
      scene: { ...p.scene, furniture: result.furniture },
    };
    try {
      validateProject(next);
      edit(next);
      if (result.removed.some((issue) => issue.furnitureId === selected))
        setSelected(roomId);
      setMessage(
        `${result.removed.length} misplaced furniture item${result.removed.length === 1 ? "" : "s"} removed from incompatible room types. Correct furniture and unsupported/custom rooms were preserved.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Interior consistency repair could not be applied safely.",
      );
    }
  }

  function prepareTypicalDemoInterior() {
    if (!profileDemoInteriorEnabled || !typicalFloorId) {
      setError("Typical floor is not ready for demo interior automation.");
      return;
    }
    const result = buildTypicalFloorDemoInterior(p.scene, typicalFloorId, id);
    if (!result.created.length) {
      setMessage("Typical-floor demo interior is already prepared.");
      return;
    }
    const next: Project = {
      ...p,
      scene: { ...p.scene, furniture: result.furniture },
    };
    try {
      validateProject(next);
      edit(next);
      setMessage(
        `${result.created.length} demo furniture item${result.created.length === 1 ? "" : "s"} prepared on Floor 1. Existing furniture was preserved; unsupported rooms were left unchanged.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Demo interior could not be prepared safely.",
      );
    }
  }

  function repeatDemoInteriorToUpperFloors() {
    if (
      !profileDemoInteriorEnabled ||
      !typicalFloorId ||
      typicalDemoInteriorPreview.created.length > 0
    ) {
      setError("Prepare and review the Floor 1 demo interior before repeating it.");
      return;
    }
    const result = buildRepeatedDemoInterior(
      p.scene,
      batchRepeatPreview.rows,
      id,
    );
    if (!result.created.length) {
      setMessage("Repeated-floor demo interior is already up to date.");
      return;
    }
    const next: Project = {
      ...p,
      scene: { ...p.scene, furniture: result.furniture },
    };
    try {
      validateProject(next);
      edit(next);
      setMessage(
        `${result.created.length} furniture item${result.created.length === 1 ? "" : "s"} repeated to reviewed upper-floor rooms. Existing target furniture was preserved.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Upper-floor demo interior could not be repeated safely.",
      );
    }
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
  function applyAppearancePreset(presetId: AppearancePresetId) {
    const preset = appearancePreset(presetId);
    edit({
      ...p,
      scene: {
        ...p.scene,
        appearance: { ...preset.appearance },
      },
    });
    setMessage(
      `${preset.label} visual preset applied. Fine-tune the lighting controls below if needed.`,
    );
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
    const structuralChange =
      change.floorId !== undefined ||
      change.unit !== undefined ||
      change.roomId !== undefined;
    const semanticChange = change.semantic !== undefined;
    const nextTag: ModelNodeTag = {
      ...current,
      ...change,
      ...(structuralChange
        ? { assignment: "manual" as const, confidence: 1 }
        : {}),
      ...(semanticChange
        ? {
            semanticAssignment: "manual" as const,
            semanticConfidence: 1,
          }
        : {}),
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
    if (change.semantic !== undefined && !change.semantic) {
      delete nextTag.semantic;
      delete nextTag.semanticAssignment;
      delete nextTag.semanticConfidence;
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
  function clearModelNodeSemantic() {
    if (!selectedModelNode) return;
    const previous = p.scene.modelNodeTags ?? [];
    const current = previous.find(
      (entry) =>
        entry.nodeName === selectedModelNode.name &&
        entry.occurrence === selectedModelNode.occurrence,
    );
    if (!current) return;
    const next = { ...current };
    delete next.semantic;
    delete next.semanticAssignment;
    delete next.semanticConfidence;
    const keep =
      Boolean(next.floorId) ||
      Boolean(next.unit) ||
      Boolean(next.roomId) ||
      Boolean(next.assignment) ||
      next.confidence !== undefined;
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelNodeTags: keep
          ? previous.map((entry) =>
              entry.nodeName === selectedModelNode.name &&
              entry.occurrence === selectedModelNode.occurrence
                ? next
                : entry,
            )
          : previous.filter(
              (entry) =>
                !(
                  entry.nodeName === selectedModelNode.name &&
                  entry.occurrence === selectedModelNode.occurrence
                ),
            ),
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

  function nudgeAlignment(change: Partial<ModelTransform>) {
    if (review || busy) return;
    patchModelTransform(change);
  }

  function startVisualAlignment() {
    setShowFloorReview(false);
    setWorkspace("editor");
    setEditorFocus(false);
    setShowReferenceWorkspace(true);
    setShowRoomMapper(false);
    setRoomMapAction("idle");
    setShowAssetShelf(false);
    setView("building");
    setCameraOrientation("top");
    setTransformMode("translate");
    setSelected("");
    setMesh("");
    setSelectedModelNodeKey("");
  }

  async function createPdfReferenceAsset(
    source: Asset,
    file: File,
    options: PdfReferenceRasterOptions,
  ) {
    const created = await storage.makeAsset(file, p.id);
    const existing = files.find(
      (candidate) =>
        candidate.hash === created.hash && candidate.size === created.size,
    );
    const nextAsset = existing ?? created;
    const currentLayers = p.scene.referenceLayers ?? [];
    const hasLayer = currentLayers.some(
      (layer) => layer.assetId === nextAsset.id,
    );
    const next: Project = {
      ...p,
      assets: p.assets.includes(nextAsset.id)
        ? p.assets
        : [...p.assets, nextAsset.id],
      scene: {
        ...p.scene,
        referenceLayers: hasLayer
          ? currentLayers
          : [
              ...currentLayers,
              {
                id: id(),
                assetId: nextAsset.id,
                visible: true,
                opacity: 0.46,
                x: 0,
                y: 0.01,
                z: 0,
                rotation: 0,
              },
            ],
      },
    };
    await persist(next, existing ? [] : [nextAsset]);
    if (!existing)
      setFiles((current) => [
        ...current.filter((asset) => asset.id !== nextAsset.id),
        nextAsset,
      ]);
    setMessage(
      `${source.name} page ${options.page} prepared as a cropped visual alignment reference. Original PDF remains unchanged.`,
    );
    return nextAsset;
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
          rooms: p.scene.rooms.map((candidate) => {
            if (candidate.id !== change.id) return candidate;
            let polygon = candidate.polygon?.map(
              (point) => [point[0], point[1]] as RoomPoint,
            );
            if (polygon?.length) {
              if (change.x !== undefined || change.z !== undefined) {
                const dx = (change.x ?? candidate.x) - candidate.x;
                const dz = (change.z ?? candidate.z) - candidate.z;
                polygon = polygon.map(
                  ([x, z]) => [x + dx, z + dz] as RoomPoint,
                );
              }
              if (change.width !== undefined || change.depth !== undefined) {
                const scaleX =
                  change.width !== undefined
                    ? change.width / candidate.width
                    : 1;
                const scaleZ =
                  change.depth !== undefined
                    ? change.depth / candidate.depth
                    : 1;
                polygon = polygon.map(
                  ([x, z]) =>
                    [
                      candidate.x + (x - candidate.x) * scaleX,
                      candidate.z + (z - candidate.z) * scaleZ,
                    ] as RoomPoint,
                );
              }
              const geometry = roomGeometryFromPolygon(polygon);
              return {
                ...candidate,
                ...geometry,
                verified: false,
                ...(change.height !== undefined
                  ? { height: change.height }
                  : {}),
              };
            }
            return {
              ...candidate,
              verified: false,
              ...(change.x !== undefined ? { x: change.x } : {}),
              ...(change.z !== undefined ? { z: change.z } : {}),
              ...(change.width !== undefined ? { width: change.width } : {}),
              ...(change.depth !== undefined ? { depth: change.depth } : {}),
              ...(change.height !== undefined ? { height: change.height } : {}),
            };
          }),
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

  function selectRoomSheetRow(row: RoomSheetRow) {
    const fallbackFloorId =
      roomMapFloorId || room?.floorId || p.scene.floors[0]?.id || "";
    const floorId = resolveRoomSheetFloorId(row, p.scene, fallbackFloorId);
    setSelectedRoomSheetKey(row.key);
    setRoomMapFloorId(floorId);
    setRoomMapUnit(row.unit);
    setRoomMapName(row.name);
    setRoomMapAction("stamp");
    setShowRoomMapper(true);
    setShowReferenceWorkspace(false);
    setShowAssetShelf(false);
    setView("building");
    setCameraOrientation("top");
    setIsolateFloorId(floorId);
    setSelected("");
    setRoomId("");
    const target = p.scene.floors.find((entry) => entry.id === floorId);
    if (target) setSectionCutOffset(target.elevation + 1.5);
    setMessage(
      `${row.unit} · ${row.name} ready · ${row.width.toFixed(2)} × ${row.depth.toFixed(2)} m. Click/tap once on the plan to place it.`,
    );
  }

  function prepareSuggestedTypicalFloor(
    targetFloorId: string,
    openMapper = true,
  ) {
    if (!targetFloorId || (quickSourceSetup.repeatPlan && targetFloorId !== typicalFloorId)) {
      setError("Select the source typical floor before preparing rooms. Use Repeat floors for upper floors.");
      return;
    }
    const suggestedRows = roomSheetRows.filter(
      (row) =>
        row.origin === "profile" &&
        typeof row.suggestedX === "number" &&
        Number.isFinite(row.suggestedX) &&
        typeof row.suggestedZ === "number" &&
        Number.isFinite(row.suggestedZ),
    );
    if (!suggestedRows.length) {
      setMessage("No project-profile suggested room positions are available.");
      return;
    }
    const additions = createSuggestedRoomDrafts(
      roomSheetRows,
      p.scene.rooms,
      targetFloorId,
      modelTransform,
      p.scene.scale,
    );
    if (!additions.length) {
      setMessage(
        "Suggested floor is already represented by mapped/existing rooms. Nothing was overwritten.",
      );
      return;
    }
    const next: Project = {
      ...p,
      scene: {
        ...p.scene,
        rooms: [...p.scene.rooms, ...additions],
      },
    };
    try {
      validateProject(next);
      edit(next);
      const first = additions[0];
      setShowRoomMapper(openMapper);
      setShowFloorReview(!openMapper);
      setShowReferenceWorkspace(false);
      setShowAssetShelf(false);
      setView("building");
      setCameraOrientation("top");
      setRoomMapFloorId(targetFloorId);
      setIsolateFloorId(targetFloorId);
      setRoomId(first.id);
      setSelected(first.id);
      setRoomMapUnit(first.unit);
      setRoomMapName(first.name);
      setRoomMapAction("idle");
      setSelectedRoomSheetKey("");
      const target = next.scene.floors.find(
        (entry) => entry.id === targetFloorId,
      );
      if (target) setSectionCutOffset(target.elevation + 1.5);
      const kept = suggestedRows.length - additions.length;
      setMessage(
        `${additions.length} suggested room${additions.length === 1 ? "" : "s"} prepared as unverified draft positions${kept > 0 ? ` · ${kept} existing/mapped room${kept === 1 ? "" : "s"} kept untouched` : ""}. Review against the plan and adjust with mouse/touch.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Suggested floor could not be prepared.",
      );
    }
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
                  polygon: undefined,
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

    const sheetRow =
      roomMapAction === "stamp" ? activeRoomSheetRow : undefined;
    const mapped: Room = {
      id: id(),
      name:
        sheetRow?.name ??
        (roomMapName.trim() || `Room ${p.scene.rooms.length + 1}`),
      unit: sheetRow?.unit ?? (roomMapUnit.trim() || "Unit"),
      floorId,
      x: bounds.x,
      z: bounds.z,
      width: sheetRow?.width ?? bounds.width,
      depth: sheetRow?.depth ?? bounds.depth,
      height: sheetRow?.height ?? roomHeightForFloor(floorId),
      color: "#cdbfa9",
      source: sheetRow
        ? roomSheetMarker(sheetRow)
        : "Visual Room Mapper draft",
      verified: false,
      ...(sheetRow?.assetId ? { sourceAssetId: sheetRow.assetId } : {}),
      ...(sheetRow?.sourcePackSourceId
        ? { sourcePackSourceId: sheetRow.sourcePackSourceId }
        : {}),
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
      if (sheetRow) {
        const nextMappedKeys = mappedRoomSheetKeys(next.scene.rooms);
        const nextRow =
          roomSheetRows.find(
            (candidate) =>
              candidate.unit === sheetRow.unit &&
              !nextMappedKeys.has(candidate.key),
          ) ??
          roomSheetRows.find(
            (candidate) => !nextMappedKeys.has(candidate.key),
          );
        if (nextRow) {
          const nextFloorId = resolveRoomSheetFloorId(
            nextRow,
            next.scene,
            floorId,
          );
          setSelectedRoomSheetKey(nextRow.key);
          setRoomMapFloorId(nextFloorId);
          setRoomMapUnit(nextRow.unit);
          setRoomMapName(nextRow.name);
          setRoomMapAction("stamp");
          setIsolateFloorId(nextFloorId);
          setMessage(
            `${mapped.name} placed exactly · next: ${nextRow.unit} · ${nextRow.name} ${nextRow.width.toFixed(2)} × ${nextRow.depth.toFixed(2)} m.`,
          );
        } else {
          setSelectedRoomSheetKey("");
          setRoomMapAction("idle");
          setMessage(
            `${mapped.name} placed exactly · room sheet complete (${roomSheetRows.length}/${roomSheetRows.length}).`,
          );
        }
      } else {
        setRoomMapAction("create");
        setMessage(
          `${mapped.name} mapped · ${mapped.width.toFixed(2)} × ${mapped.depth.toFixed(2)} m · ${(mapped.width * mapped.depth).toFixed(2)} m².`,
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Room mapping failed.");
    }
  }

  function commitMappedPolygon(points: RoomPoint[]) {
    const floorId = roomMapFloorId || p.scene.floors[0]?.id;
    if (!floorId) {
      setError("Create or detect a floor before mapping rooms.");
      return;
    }
    try {
      const geometry = roomGeometryFromPolygon(points);
      const mapped: Room = {
        id: id(),
        name: roomMapName.trim() || `Room ${p.scene.rooms.length + 1}`,
        unit: roomMapUnit.trim() || "Unit",
        floorId,
        ...geometry,
        height: roomHeightForFloor(floorId),
        color: "#cdbfa9",
        source: "Visual Room Mapper polygon draft",
        verified: false,
      };
      const next: Project = {
        ...p,
        scene: { ...p.scene, rooms: [...p.scene.rooms, mapped] },
      };
      validateProject(next);
      edit(next);
      setRoomId(mapped.id);
      setSelected(mapped.id);
      setRoomMapAction("polygon");
      setMessage(
        `${mapped.name} polygon mapped · ${roomArea(mapped).toFixed(2)} m² · ${mapped.polygon?.length ?? 0} corners.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Polygon room mapping failed.",
      );
    }
  }

  function commitEditedPolygon(roomId: string, points: RoomPoint[]) {
    const target = p.scene.rooms.find((entry) => entry.id === roomId);
    if (!target?.polygon?.length) return;
    try {
      const geometry = roomGeometryFromPolygon(points);
      const next: Project = {
        ...p,
        scene: {
          ...p.scene,
          rooms: p.scene.rooms.map((entry) =>
            entry.id === roomId
              ? { ...entry, ...geometry, verified: false }
              : entry,
          ),
        },
      };
      validateProject(next);
      edit(next);
      setMessage(
        `${target.name} corners updated · ${roomArea({
          ...target,
          ...geometry,
        }).toFixed(2)} m².`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "That polygon shape is not valid.",
      );
    }
  }

  function cloneMappedRoom() {
    if (!room || selected !== room.id) return;
    const shiftX = room.width + 0.2;
    const cloneGeometry = room.polygon?.length
      ? roomGeometryFromPolygon(
          room.polygon.map(
            ([x, z]) => [x + shiftX, z] as RoomPoint,
          ),
        )
      : { x: room.x + shiftX };
    const clone: Room = {
      ...room,
      ...cloneGeometry,
      id: id(),
      name: `${room.name} copy`,
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
    const mirroredGeometry = room.polygon?.length
      ? roomGeometryFromPolygon(
          room.polygon.map(
            ([x, z]) =>
              [
                axis === "x" ? 2 * centreX - x : x,
                axis === "z" ? 2 * centreZ - z : z,
              ] as RoomPoint,
          ),
        )
      : {
          x: axis === "x" ? 2 * centreX - room.x : room.x,
          z: axis === "z" ? 2 * centreZ - room.z : room.z,
        };
    const mirrored: Room = {
      ...room,
      ...mirroredGeometry,
      id: id(),
      name: `${room.name} mirror`,
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
  function generateBatchRepeatedUnits() {
    const result = applyBatchRepeatPlan(
      p.scene,
      quickSourceSetup.profile,
      quickSourceSetup.floorSkeleton,
      quickSourceSetup.repeatPlan,
      id,
    );
    if (!result.createdRooms.length) {
      const existing = result.existingTargets
        ? ` · ${result.existingTargets} existing target${result.existingTargets === 1 ? "" : "s"} preserved`
        : "";
      const blocked = result.blockedTargets
        ? ` · ${result.blockedTargets} target${result.blockedTargets === 1 ? "" : "s"} need review`
        : "";
      setMessage(`No repeated unit was generated${existing}${blocked}.`);
      return;
    }
    const next: Project = {
      ...p,
      scene: {
        ...p.scene,
        rooms: result.rooms,
      },
    };
    try {
      validateProject(next);
      edit(next);
      const first = result.createdRooms[0];
      setShowRoomMapper(false);
      setShowFloorReview(true);
      setShowReferenceWorkspace(false);
      setView("building");
      setCameraOrientation("top");
      setRoomMapFloorId(first.floorId);
      setRoomMapUnit(first.unit);
      setRoomMapName(first.name);
      setIsolateFloorId(first.floorId);
      setRoomId(first.id);
      setSelected(first.id);
      setRoomMapAction("idle");
      const target = next.scene.floors.find(
        (floor) => floor.id === first.floorId,
      );
      if (target) setSectionCutOffset(target.elevation + 1.5);
      setMessage(
        `${result.generatedTargets} repeated unit${result.generatedTargets === 1 ? "" : "s"} generated · ${result.createdRooms.length} unverified room drafts created${result.existingTargets ? ` · ${result.existingTargets} existing target${result.existingTargets === 1 ? "" : "s"} preserved` : ""}${result.blockedTargets ? ` · ${result.blockedTargets} target${result.blockedTargets === 1 ? "" : "s"} still need review` : ""}.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Repeated floors could not be generated.",
      );
    }
  }

  function reviewGeneratedFloor(targetFloorId: string) {
    const generated = p.scene.rooms.filter(
      (entry) => entry.floorId === targetFloorId && isBatchRepeatedRoom(entry),
    );
    if (!generated.length) {
      setMessage("No generated room drafts are waiting on this floor.");
      return;
    }

    const next: Project = {
      ...p,
      scene: {
        ...p.scene,
        rooms: p.scene.rooms.map((entry) =>
          entry.floorId === targetFloorId && isBatchRepeatedRoom(entry)
            ? { ...entry, verified: true }
            : entry,
        ),
      },
    };
    try {
      validateProject(next);
      edit(next);

      const nextPreview = buildBatchRepeatPreview(
        next.scene,
        quickSourceSetup.profile,
        quickSourceSetup.floorSkeleton,
        quickSourceSetup.repeatPlan,
      );
      const repeatTargets = nextPreview.rows.filter(
        (row) => row.targetFloorId && row.targetUnit,
      );
      const pendingRoom = [...next.scene.floors]
        .sort((left, right) => left.elevation - right.elevation)
        .flatMap((floor) =>
          next.scene.rooms.filter(
            (entry) =>
              entry.floorId === floor.id &&
              !entry.verified &&
              repeatTargets.some(
                (row) =>
                  row.targetFloorId === entry.floorId &&
                  row.targetUnit.trim().toLowerCase() ===
                    entry.unit.trim().toLowerCase(),
              ),
          ),
        )[0];

      if (pendingRoom) {
        setRoomMapFloorId(pendingRoom.floorId);
        setRoomMapUnit(pendingRoom.unit);
        setRoomMapName(pendingRoom.name);
        setIsolateFloorId(pendingRoom.floorId);
        setRoomId(pendingRoom.id);
        setSelected(pendingRoom.id);
        const target = next.scene.floors.find(
          (floor) => floor.id === pendingRoom.floorId,
        );
        if (target) setSectionCutOffset(target.elevation + 1.5);
        setMessage(
          `${generated.length} generated room drafts accepted on this floor · next repeated floor opened for review.`,
        );
        return;
      }

      if (nextPreview.readyTargets > 0 || nextPreview.blockedTargets > 0) {
        setMessage(
          `Generated rooms on this floor accepted · ${nextPreview.readyTargets} repeat target${nextPreview.readyTargets === 1 ? "" : "s"} ready and ${nextPreview.blockedTargets} still blocked by source review.`,
        );
        return;
      }

      if (next.scene.modelId) {
        setMessage(
          "Repeated-floor review complete. Analyzing high-confidence doors/windows next…",
        );
        void task(() => analyzeAndApproveReadyOpenings(next));
      } else {
        setMessage(
          "Repeated-floor review complete. Select a project model before doors/windows analysis.",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Generated floor review could not be saved.",
      );
    }
  }

  function repeatMappedUnit(targetFloorId: string, targetUnit: string) {
    const sourceFloorId = roomMapFloorId;
    const sourceUnit = roomMapUnit.trim();
    const nextUnit = targetUnit.trim();
    if (!sourceFloorId || !sourceUnit || !nextUnit || targetFloorId === sourceFloorId)
      return;
    const sourceRooms = p.scene.rooms.filter(
      (entry) =>
        entry.floorId === sourceFloorId &&
        entry.unit.trim() === sourceUnit,
    );
    if (!sourceRooms.length) {
      setError("Map at least one room in this unit before repeating its layout.");
      return;
    }
    if (
      p.scene.rooms.some(
        (entry) =>
          entry.floorId === targetFloorId &&
          entry.unit.trim() === nextUnit,
      )
    ) {
      setError("That target floor/unit already has mapped rooms.");
      return;
    }
    const copies = sourceRooms.map(
      (entry): Room => ({
        ...entry,
        id: id(),
        floorId: targetFloorId,
        unit: nextUnit,
        verified: false,
        source: "Visual Room Mapper repeated layout",
        sourceAssetId: undefined,
        sourcePackSourceId: undefined,
        sourceClaimIds: undefined,
        mesh: undefined,
        polygon: entry.polygon?.map(
          ([x, z]) => [x, z] as RoomPoint,
        ),
      }),
    );
    const next: Project = {
      ...p,
      scene: { ...p.scene, rooms: [...p.scene.rooms, ...copies] },
    };
    try {
      validateProject(next);
      edit(next);
      setRoomMapFloorId(targetFloorId);
      setRoomMapUnit(nextUnit);
      setIsolateFloorId(targetFloorId);
      setRoomId(copies[0].id);
      setSelected(copies[0].id);
      setMessage(
        `${sourceRooms.length} room layout repeated to ${nextUnit}. Source evidence and mesh bindings were intentionally not copied.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unit layout could not be repeated.",
      );
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
    const incoming = await Promise.all(
      selectedFiles.map((file) => storage.makeAsset(file, p.id)),
    );
    const knownHashes = new Set(files.map((asset) => asset.hash.toLowerCase()));
    const batchHashes = new Set<string>();
    const assets = incoming.filter((asset) => {
      const hash = asset.hash.toLowerCase();
      if (knownHashes.has(hash) || batchHashes.has(hash)) return false;
      batchHashes.add(hash);
      return true;
    });
    const duplicateCount = incoming.length - assets.length;
    const combinedFiles = [...files, ...assets];
    const quickSetup = await detectQuickSourceSetup(combinedFiles);
    const existing = new Set(p.assets);
    const nextAssetIds = [
      ...p.assets,
      ...assets.map((asset) => asset.id).filter((key) => !existing.has(key)),
    ];
    const modelCandidates = combinedFiles.filter((asset) =>
      /\.(glb|fbx)$/i.test(asset.name),
    );
    const glbCandidates = modelCandidates.filter((asset) =>
      /\.glb$/i.test(asset.name),
    );
    const autoModel =
      p.scene.modelId ??
      quickSetup.primaryModelId ??
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
    const sourceLock =
      quickSetup.profile
        ? ` · ${quickSetup.name ?? "project"} source lock ${quickSetup.matchedCount}/${quickSetup.requiredCount} detected`
        : "";
    const skipped = duplicateCount
      ? ` · ${duplicateCount} duplicate checksum${duplicateCount === 1 ? "" : "s"} skipped`
      : "";
    setMessage(
      `${assets.length} new source file${assets.length === 1 ? "" : "s"} attached${skipped}${sourceLock}${autoModel && autoModel !== p.scene.modelId ? " · primary 3D model selected automatically" : ""}.`,
    );
  }

  async function recoverSketchUpTextures() {
    const result = await prepareSketchUpTextureRecovery(files, p);
    if (!result.recoveredFiles) {
      setMessage(
        result.issues[0] ??
          "No material texture file was found inside the SketchUp source.",
      );
      return;
    }
    if (!result.assets.length) {
      setMessage("SketchUp textures are already attached to this project.");
      return;
    }
    await persist(result.nextProject, result.assets);
    setSmartAnalysis(undefined);
    const issueText = result.issues.length
      ? ` · ${result.issues.length} archive item${result.issues.length === 1 ? "" : "s"} skipped/reviewed`
      : "";
    setMessage(
      `${result.assets.length} SketchUp material texture${result.assets.length === 1 ? "" : "s"} recovered automatically${issueText}.`,
    );
  }

  function approveHighConfidenceWalls() {
    const result = approveReadyModelWalls(p.scene);
    if (!result.approved) {
      setMessage("No additional high-confidence wall is ready for one-click approval.");
      return;
    }
    edit({ ...p, scene: result.scene });
    setMessage(
      `${result.approved} high-confidence wall candidate${result.approved === 1 ? "" : "s"} approved. Lower-confidence walls remain review-only.`,
    );
  }

  function acceptHighConfidenceRepeatedFloors() {
    const result = acceptReadyRepeatedFloors(p.scene);
    if (!result.accepted) {
      setMessage("No additional high-confidence repeated floor is ready for one-click acceptance.");
      return;
    }
    edit({ ...p, scene: result.scene });
    setMessage(
      `${result.accepted} repeated floor relationship${result.accepted === 1 ? "" : "s"} accepted. Lower-confidence repeats remain review-only.`,
    );
  }

  async function autoSetupDetectedSourcePack() {
    let setup = await detectQuickSourceSetup(files);
    if (!setup.profile || !setup.slug)
      throw Error("Attach enough verified project source files before auto setup.");
    const slug = setup.slug;
    const profileId = setup.profile;
    const owner = list.find(
      (entry) => entry.id !== p.id && projectSlug(entry) === slug,
    );
    if (owner)
      throw Error(
        `${setup.name ?? "This project"} already exists in this browser workspace. Open that project instead of creating a duplicate.`,
      );

    const prepared = await prepareQuickPublishModel(
      setup,
      files,
      p.id,
    );
    setup = prepared.setup;
    const next = applyQuickSourceSetup(p, setup);
    validateProject(next);
    await persist(next, prepared.asset ? [prepared.asset] : []);
    if (prepared.asset)
      setFiles((current) => [
        ...current.filter((asset) => asset.id !== prepared.asset!.id),
        prepared.asset!,
      ]);

    const floors = floorSkeletonStatus(
      next.scene,
      profileId,
      setup.floorSkeleton,
    );
    if (floors.preferredFloorId) {
      setRoomMapFloorId(floors.preferredFloorId);
      setIsolateFloorId(floors.preferredFloorId);
      const target = next.scene.floors.find(
        (floor) => floor.id === floors.preferredFloorId,
      );
      if (target) setSectionCutOffset(target.elevation + 1.5);
    }
    setSmartAnalysis(undefined);
    undo.current = [];
    redo.current = [];
    setMesh("");
    setView("building");
    setMessage(
      `${setup.name ?? "Project"} source lock applied · ${setup.matchedCount}/${setup.requiredCount} canonical sources recognized · source authoring model selected${setup.publishModelId ? " · verified web GLB attached for publish" : ""}${setup.floorSkeleton?.length ? ` · ${floors.matched}/${floors.total} model-derived source levels ready` : ""} · project context ready.`,
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

  async function prepareSelectedWebModel() {
    const source = p.scene.modelId
      ? files.find((file) => file.id === p.scene.modelId)
      : undefined;
    if (!source || !/\.fbx$/i.test(source.name))
      throw Error("Select an FBX authoring model before preparing the web model.");

    const currentPublish = p.scene.publishModelId
      ? files.find((file) => file.id === p.scene.publishModelId)
      : undefined;
    if (currentPublish && /\.glb$/i.test(currentPublish.name)) {
      setMessage(`Web model already ready · ${currentPublish.name}.`);
      return;
    }

    const prepared = await prepareFbxWebModel(source, p.id);
    const existing = files.find(
      (file) =>
        /\.glb$/i.test(file.name) &&
        file.hash.toLowerCase() === prepared.asset.hash.toLowerCase() &&
        file.size === prepared.asset.size,
    );
    const publishAsset = existing ?? prepared.asset;
    const next: Project = {
      ...p,
      assets: p.assets.includes(publishAsset.id)
        ? p.assets
        : [...p.assets, publishAsset.id],
      scene: {
        ...p.scene,
        publishModelId: publishAsset.id,
      },
    };
    validateProject(next);
    await persist(next, existing ? [] : [publishAsset]);
    setMessage(
      `Web GLB ready · ${prepared.meshCount} meshes · ${prepared.materialCount} materials · ${prepared.triangleCount.toLocaleString()} triangles${prepared.externalTexturesBlocked ? " · external FBX textures were not embedded; visual material recovery still needs review" : ""}.`,
    );
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

  async function buildAutomatically() {
    const result = await runAutoBuildPipeline(p, files, sourceAudits);
    await persist(result.project, result.assets);
    setSmartAnalysis(result.analysis);
    setView("building");
    setMessage(autoBuildSummaryMessage(result));
  }

  function buildSmartDraft() {
    if (!smartAnalysis)
      throw Error("Analyze a selected GLB/FBX model before building the draft.");
    const result = buildSmartSceneDraft(p, smartAnalysis);
    edit({ ...p, scene: result.scene });
    const roomText = result.summary.autoRooms
      ? ` · ${result.summary.autoRooms} closed-loop room draft${result.summary.autoRooms === 1 ? "" : "s"} generated`
      : "";
    const skippedText = result.summary.skippedRoomFloors
      ? ` · ${result.summary.skippedRoomFloors} floor${result.summary.skippedRoomFloors === 1 ? "" : "s"} kept for manual room review`
      : "";
    setMessage(
      `Smart draft built · ${result.summary.floors} floors · ${result.summary.autoTagged} meshes auto-tagged · ${result.summary.walls} parametric wall candidate${result.summary.walls === 1 ? "" : "s"} · ${result.summary.repeatedFloors} repeated floor${result.summary.repeatedFloors === 1 ? "" : "s"} detected${roomText}${skippedText}. Ambiguous geometry remains review-only.`,
    );
  }

  async function analyzeAndApproveReadyOpenings(baseProject: Project = p) {
    if (!baseProject.scene.modelId)
      throw Error("Select the project model before analyzing doors/windows.");
    if (!baseProject.scene.rooms.length)
      throw Error("Map the typical-floor rooms before analyzing doors/windows.");

    const analysis = await analyzeProjectFiles(
      files,
      baseProject.scene.modelId,
      sourceAudits,
    );
    const suggestions = suggestOpeningAssociations(analysis, baseProject.scene);
    const workflow = applyReadyOpeningWorkflow(
      baseProject.scene,
      analysis.architecturalCandidates,
      suggestions,
      id,
    );
    const next: Project = {
      ...baseProject,
      scene: workflow.scene,
    };
    validateProject(next);
    edit(next);
    setSmartAnalysis(analysis);

    const approved =
      workflow.approved > 0
        ? `${workflow.approved} ready opening${workflow.approved === 1 ? "" : "s"} approved`
        : workflow.alreadyApproved > 0
          ? "ready openings already approved"
          : "no ready opening approved";
    const review = workflow.reviewRemaining
      ? ` · ${workflow.reviewRemaining} unclear candidate${workflow.reviewRemaining === 1 ? "" : "s"} left for review`
      : "";
    const labels = workflow.autoLabelsApplied
      ? ` · ${workflow.autoLabelsApplied} high-confidence source label${workflow.autoLabelsApplied === 1 ? "" : "s"} refreshed`
      : "";
    setMessage(
      `Door/window analysis complete · ${approved}${review}${labels}. Existing reviewed openings and manual labels were preserved.`,
    );
  }

  function applyArchitecturalCandidates() {
    if (!smartAnalysis?.architecturalCandidates.length) return;
    const threshold = 0.82;
    const previous = p.scene.modelNodeTags ?? [];
    const byKey = new Map<string, ModelNodeTag>();
    for (const tag of previous) {
      const cleaned = { ...tag };
      if (cleaned.semanticAssignment === "auto") {
        delete cleaned.semantic;
        delete cleaned.semanticAssignment;
        delete cleaned.semanticConfidence;
      }
      const keep =
        Boolean(cleaned.floorId) ||
        Boolean(cleaned.unit) ||
        Boolean(cleaned.roomId) ||
        Boolean(cleaned.assignment) ||
        cleaned.confidence !== undefined ||
        Boolean(cleaned.semantic) ||
        Boolean(cleaned.semanticAssignment) ||
        cleaned.semanticConfidence !== undefined;
      if (keep)
        byKey.set(
          `${cleaned.nodeName}\u0000${cleaned.occurrence}`,
          cleaned,
        );
    }
    let applied = 0;
    let preservedManual = 0;
    for (const candidate of smartAnalysis.architecturalCandidates) {
      if (candidate.confidence < threshold) continue;
      const key = `${candidate.nodeName}\u0000${candidate.occurrence}`;
      const original = previous.find(
        (tag) =>
          tag.nodeName === candidate.nodeName &&
          tag.occurrence === candidate.occurrence,
      );
      if (original?.semanticAssignment === "manual") {
        preservedManual += 1;
        continue;
      }
      const current = byKey.get(key) ?? {
        nodeName: candidate.nodeName,
        occurrence: candidate.occurrence,
      };
      byKey.set(key, {
        ...current,
        semantic: candidate.kind,
        semanticAssignment: "auto",
        semanticConfidence: candidate.confidence,
      });
      applied += 1;
    }
    if (!applied && !previous.some((tag) => tag.semanticAssignment === "auto")) {
      setMessage(
        preservedManual
          ? "No auto labels changed; existing manual architectural labels were preserved."
          : "No high-confidence architectural candidates are ready to apply.",
      );
      return;
    }
    edit({
      ...p,
      scene: {
        ...p.scene,
        modelNodeTags: [...byKey.values()],
      },
    });
    setMessage(
      `${applied} high-confidence wall/door/window source labels applied${preservedManual ? ` · ${preservedManual} manual labels preserved` : ""}. Review them visually before treating them as architecture.`,
    );
  }

  function applyOpeningSuggestions(
    suggestions: OpeningSuggestion[],
  ) {
    const ready = suggestions.filter(
      (suggestion) =>
        suggestion.ready &&
        suggestion.floorId &&
        suggestion.roomIds.length > 0,
    );
    if (!ready.length) {
      setMessage("No reviewed-ready door/window associations to approve.");
      return;
    }

    const existingOpenings = p.scene.openings ?? [];
    const existingKeys = new Set(
      existingOpenings
        .filter(
          (opening) =>
            opening.sourceNodeName &&
            opening.sourceOccurrence !== undefined,
        )
        .map(
          (opening) =>
            `${opening.sourceNodeName}\u0000${opening.sourceOccurrence}`,
        ),
    );
    const nextOpenings: Opening[] = [...existingOpenings];
    const tagByKey = new Map<string, ModelNodeTag>(
      (p.scene.modelNodeTags ?? []).map((tag) => [
        `${tag.nodeName}\u0000${tag.occurrence}`,
        { ...tag },
      ]),
    );
    let approved = 0;

    for (const suggestion of ready) {
      if (existingKeys.has(suggestion.key) || !suggestion.floorId) continue;
      const opening: Opening = {
        id: id(),
        floorId: suggestion.floorId,
        kind: suggestion.kind,
        roomIds: [...suggestion.roomIds],
        x: suggestion.position[0],
        y: suggestion.position[1],
        z: suggestion.position[2],
        width: suggestion.width,
        height: suggestion.height,
        ...(suggestion.sillHeight !== undefined
          ? { sillHeight: suggestion.sillHeight }
          : {}),
        rotationY: suggestion.rotationY,
        reviewed: true,
        sourceNodeName: suggestion.sourceNodeName,
        sourceOccurrence: suggestion.sourceOccurrence,
        confidence: suggestion.confidence,
      };
      nextOpenings.push(opening);
      existingKeys.add(suggestion.key);

      const current = tagByKey.get(suggestion.key) ?? {
        nodeName: suggestion.sourceNodeName,
        occurrence: suggestion.sourceOccurrence,
      };
      const associatedRooms = suggestion.roomIds
        .map((roomId) =>
          p.scene.rooms.find((candidate) => candidate.id === roomId),
        )
        .filter((candidate): candidate is Room => Boolean(candidate));
      const sharedUnit =
        associatedRooms.length > 0 &&
        associatedRooms.every(
          (candidate) => candidate.unit === associatedRooms[0].unit,
        )
          ? associatedRooms[0].unit
          : undefined;
      const reviewedTag: ModelNodeTag = {
        ...current,
        floorId: suggestion.floorId,
        assignment: "manual",
        confidence: 1,
        semantic: suggestion.kind,
        semanticAssignment: "manual",
        semanticConfidence: 1,
      };
      if (suggestion.roomIds.length === 1) {
        reviewedTag.roomId = suggestion.roomIds[0];
        if (associatedRooms[0]?.unit) reviewedTag.unit = associatedRooms[0].unit;
        else delete reviewedTag.unit;
      } else {
        delete reviewedTag.roomId;
        if (sharedUnit) reviewedTag.unit = sharedUnit;
        else delete reviewedTag.unit;
      }
      tagByKey.set(suggestion.key, reviewedTag);
      approved += 1;
    }

    if (!approved) {
      setMessage("These detected openings are already approved.");
      return;
    }
    const next: Project = {
      ...p,
      scene: {
        ...p.scene,
        openings: nextOpenings,
        modelNodeTags: [...tagByKey.values()],
      },
    };
    try {
      validateProject(next);
      edit(next);
      setMessage(
        `${approved} door/window opening${approved === 1 ? "" : "s"} approved and attached to mapped wall/room context.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Opening approval could not be saved.",
      );
    }
  }

  function approveOpeningSuggestion(suggestion: OpeningSuggestion) {
    applyOpeningSuggestions([suggestion]);
  }

  function approveReadyOpenings() {
    applyOpeningSuggestions(openingSuggestions);
  }

  function removeOpening(openingId: string) {
    const target = (p.scene.openings ?? []).find(
      (opening) => opening.id === openingId,
    );
    if (!target) return;
    const next: Project = {
      ...p,
      scene: {
        ...p.scene,
        openings: (p.scene.openings ?? []).filter(
          (opening) => opening.id !== openingId,
        ),
      },
    };
    try {
      validateProject(next);
      edit(next);
      setMessage(`${target.kind} opening removed.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Opening removal failed.",
      );
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
      <header className="studio-head studio-head--simple">
        <a className="studio-brand" href="/3Dprojects" aria-label="Rekixo 3D projects">
          R
          <span>
            REKIXO <small>3D DESIGN ADMIN</small>
          </span>
        </a>

        <div className="project-name project-name--simple">
          <strong>{p.name || "Untitled project"}</strong>
          <span>
            {p.scene.rooms.length} room{p.scene.rooms.length === 1 ? "" : "s"}
            {p.cloud ? ` · Cloud r${p.cloud.revision}` : " · Local project"}
          </span>
        </div>

        <nav className="studio-primary-nav" aria-label="Project workflow">
          {(
            [
              ["builder", "Setup"],
              ["editor", "3D Edit"],
              ["evidence", "Review"],
              ["publish", "Publish"],
            ] as const
          ).map(([key, label]) => {
            const active =
              workspace === key ||
              (key === "builder" &&
                (workspace === "sources" || workspace === "overview"));
            const reviewRemaining = Math.max(
              0,
              readiness.totalRooms - readiness.reviewedRooms,
            );
            return (
              <button
                key={key}
                type="button"
                className={active ? "active" : ""}
                onClick={() => {
                  setWorkspace(key);
                  if (key === "editor") {
                    setEditorFocus(false);
                    if (p.scene.modelId) setView("building");
                  }
                }}
              >
                {label}
                {key === "evidence" && reviewRemaining > 0 && (
                  <small>{reviewRemaining}</small>
                )}
                {key === "publish" && readiness.blockers.length > 0 && (
                  <small className="ops-tab-alert">
                    {readiness.blockers.length}
                  </small>
                )}
              </button>
            );
          })}
        </nav>

        <div className="studio-shell-status">
          <strong
            className={`storage-autosave storage-autosave--${localSaveState}`}
            role="status"
          >
            {localSaveState === "saving"
              ? "Saving…"
              : localSaveState === "error"
                ? "Save failed"
                : dirty
                  ? "Save queued"
                  : "Autosaved"}
          </strong>
          {cloudDirty && <small>Cloud update pending</small>}
        </div>

        <details className="studio-more-menu">
          <summary aria-label="More project actions" title="More project actions">
            <span aria-hidden="true">•••</span>
          </summary>
          <div className="studio-more-popover">
            <div className="studio-more-section">
              <span>PROJECT</span>
              <button
                type="button"
                disabled={busy || dirty}
                onClick={() => {
                  if (dirty) {
                    setError("Wait for local autosave before creating a project.");
                    return;
                  }
                  open(newProject("Untitled project"));
                  setWorkspace("builder");
                }}
              >
                + New project
              </button>
              <label>
                <span>Find project</span>
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
                <span>Switch local project</span>
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
              <div className="studio-more-links">
                <button type="button" onClick={() => setWorkspace("overview")}>
                  Project summary
                </button>
                <button type="button" onClick={() => setWorkspace("sources")}>
                  Source library
                </button>
              </div>
            </div>

            <div className="studio-more-section">
              <span>CLOUD</span>
              {cloudSession?.authenticated ? (
                <>
                  <label>
                    <span>Open cloud project</span>
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
                        {cloudProjects.length
                          ? "Choose cloud project…"
                          : "No cloud projects"}
                      </option>
                      {cloudProjects.map((entry) => (
                        <option key={entry.id} value={entry.slug}>
                          {entry.name} · r{entry.draftRevision ?? "—"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {backupCloudTarget ? (
                    <div className="studio-cloud-identity-notice">
                      <small>
                        Preserved local backup detected · {p.scene.rooms.length} rooms.
                        Existing cloud identity "{backupCloudTarget.name}" has no
                        shared Studio draft yet.
                      </small>
                      <button
                        type="button"
                        disabled={busy || dirty || Boolean(review)}
                        onClick={() =>
                          task(() =>
                            adoptCurrentBackupToEmptyCloud(backupCloudTarget),
                          )
                        }
                      >
                        Use this backup for {backupCloudTarget.name} cloud
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    disabled={
                      busy ||
                      Boolean(review) ||
                      Boolean(backupCloudTarget)
                    }
                    title={
                      backupCloudTarget
                        ? "Use the explicit backup-to-cloud action above so this preserved design cannot create a second cloud project."
                        : undefined
                    }
                    onClick={() => task(syncCloudProject)}
                  >
                    Save latest to cloud
                  </button>
                </>
              ) : (
                <a
                  href="/3Dprojects/login?return=/3Dprojects/studio"
                  className="studio-cloud-login"
                >
                  Cloud sign in
                </a>
              )}
            </div>

            <div className="studio-more-section">
              <span>BACKUP & ADVANCED</span>
              <div className="studio-more-links">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => importInput.current?.click()}
                >
                  Import backup
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(review)}
                  onClick={() =>
                    task(async () => {
                      await persist(p);
                    })
                  }
                >
                  Save local now
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      const blob = await storage.exportPackage(p);
                      setBackup({
                        url: URL.createObjectURL(blob),
                        name: `${p.name.replace(/[^a-z0-9-]/gi, "-")}.rekixo.json`,
                      });
                      setMessage(
                        "Backup ready with models, references and review versions.",
                      );
                    })
                  }
                >
                  Export backup
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    task(async () => {
                      validateProject(p);
                      const manifest = buildSceneManifestV2(p, files);
                      setManifestText(JSON.stringify(manifest, null, 2));
                      setMessage("Scene Manifest V2 ready.");
                    })
                  }
                >
                  Export scene manifest
                </button>
              </div>
              {backup && (
                <a
                  className="studio-more-download"
                  href={backup.url}
                  download={backup.name}
                >
                  Download backup
                </a>
              )}
              {manifestText && (
                <details className="studio-manifest-details">
                  <summary>Scene manifest</summary>
                  <textarea
                    aria-label="Scene manifest"
                    readOnly
                    value={manifestText}
                  />
                </details>
              )}
            </div>
          </div>
        </details>
      </header>
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
          fusion={sourceFusion}
          openingSuggestions={openingSuggestions}
          busy={busy || sourceAuditBusy}
          onProjectMeta={(change) => edit({ ...p, ...change })}
          onImportFiles={(selectedFiles) =>
            void task(() => uploadSourcePack(selectedFiles))
          }
          onAnalyze={() => void task(analyzeSmartProject)}
          onAutoBuild={() => void task(buildAutomatically)}
          onPrepareWebModel={() => void task(prepareSelectedWebModel)}
          onRecoverSketchUpTextures={() => void task(recoverSketchUpTextures)}
          onApproveReadyWalls={approveHighConfidenceWalls}
          onAcceptRepeatedFloors={acceptHighConfidenceRepeatedFloors}
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
          onApplyArchitecturalCandidates={applyArchitecturalCandidates}
          onApproveOpening={approveOpeningSuggestion}
          onApproveReadyOpenings={approveReadyOpenings}
          onOpenEditor={() => {
            setWorkspace("editor");
            setEditorFocus(false);
            if (p.scene.modelId) setView("building");
          }}
          onOpenSources={() => setWorkspace("sources")}
          onStartAlignment={startVisualAlignment}
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
            setEditorFocus(false);
            if (p.scene.modelId) setView("building");
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
            setEditorFocus(false);
          }}
          onRemoveDraft={(key) => {
            const target = p.scene.rooms.find((entry) => entry.id === key);
            if (!target || !isRemovableUnsourcedDraft(p.scene, target)) {
              setError("This room has source evidence or project dependencies and cannot be removed as an unsourced draft.");
              return;
            }
            if (
              !window.confirm(
                `Remove the unsourced draft "${target.name}"? The change is autosaved and can still be undone in this editing session.`,
              )
            )
              return;
            const replacement = findSupersedingReviewedRoom(
              p.scene,
              target,
            );
            const next: Project = {
              ...p,
              scene: {
                ...p.scene,
                rooms: p.scene.rooms.filter((entry) => entry.id !== key),
                furniture: p.scene.furniture.map((item) =>
                  item.roomId === key && replacement
                    ? { ...item, roomId: replacement.id }
                    : item,
                ),
                modelNodeTags: (p.scene.modelNodeTags ?? []).map((tag) => {
                  if (tag.roomId !== key) return tag;
                  const preserved = { ...tag };
                  delete preserved.roomId;
                  return preserved;
                }),
              },
            };
            try {
              validateProject(next);
              edit(next);
              if (roomId === key) setRoomId("");
              if (selected === key) setSelected("");
              setMessage(
                replacement
                  ? "Superseded draft removed. Linked furniture moved to the reviewed replacement room; model evidence was preserved."
                  : "Unsourced draft removed. Reviewed/source-backed rooms were left untouched.",
              );
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Unsourced draft could not be removed.",
              );
            }
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
          dirty={cloudDirty}
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
            showReferenceWorkspace ? "editor-core--alignment" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
        <aside className="studio-sidebar">
          <details className="editor-sidebar-details editor-project-tools">
            <summary>Project utilities</summary>
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
                          cloudDirty ||
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
                              disabled={busy || cloudDirty || Boolean(review)}
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
                        markCloudSignedOut();
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
          </details>
          <details className="editor-sidebar-details editor-advanced-model">
            <summary>Advanced model structure</summary>
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
                          const semantic = tag?.semantic
                            ? tag.semantic.toUpperCase()
                            : "";
                          return floorName
                            ? `${semantic ? `${semantic} · ` : ""}${floorName}${tag?.unit ? ` · ${tag.unit}` : ""}`
                            : `${semantic ? `${semantic} · ` : ""}${node.type} · y ${node.centreY.toFixed(2)}`;
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
          </details>
          <div className="section-label">
            PROJECT{" "}
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
                          {r.unit} · {roomArea(r).toFixed(1)} m²
                        </small>
                      </button>
                      {scene.furniture.some(
                        (entry) => entry.roomId === r.id,
                      ) && (
                        <details className="room-object-details">
                          <summary>
                            {
                              scene.furniture.filter(
                                (entry) => entry.roomId === r.id,
                              ).length
                            }{" "}
                            objects
                          </summary>
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
                                <span>{catalog[entry.kind].name}</span>
                                <small>
                                  {entry.x.toFixed(1)}, {entry.z.toFixed(1)}
                                </small>
                              </button>
                            ))}
                        </details>
                      )}
                    </div>
                  ))}
              </section>
            ))}
          </div>
          <button
            className="wide"
            disabled={busy || Boolean(review)}
            onClick={() => {
              const pending = roomSheetRows.find(
                (row) => !mappedSheetKeys.has(row.key),
              );
              if (pending) {
                selectRoomSheetRow(pending);
                return;
              }
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
          <details className="editor-sidebar-details editor-source-files">
            <summary>Source files</summary>
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
          </details>
        </aside>
        <section className="studio-center">
          {showReferenceWorkspace ? (
          <nav
            className="canvas-toolbar editor-toolbar editor-toolbar--alignment"
            aria-label="Plan alignment tools"
          >
            <div className="alignment-toolbar-title">
              <strong>Plan alignment</strong>
              <small>Auto position first · fine-tune only if needed</small>
            </div>
            <button
              type="button"
              className="primary alignment-auto-position"
              disabled={Boolean(review) || busy || !p.scene.modelId}
              onClick={() => {
                setView("building");
                setCameraOrientation("top");
                setTransformMode("translate");
                setAutoAlignRequest((value) => value + 1);
              }}
            >
              Auto position
            </button>
            <button
              type="button"
              className={cameraOrientation === "top" ? "active" : ""}
              onClick={() => {
                setView("building");
                setCameraOrientation("top");
                setSectionCutEnabled(false);
              }}
            >
              Top view
            </button>
            <button
              type="button"
              className={transformMode === "translate" ? "active" : ""}
              disabled={Boolean(review) || busy || !p.scene.modelId}
              onClick={() => setTransformMode("translate")}
            >
              Move <kbd>W</kbd>
            </button>
            <button
              type="button"
              className={transformMode === "rotate" ? "active" : ""}
              disabled={Boolean(review) || busy || !p.scene.modelId}
              onClick={() => setTransformMode("rotate")}
            >
              Rotate <kbd>E</kbd>
            </button>
            <label className="alignment-toolbar-snap">
              <input
                type="checkbox"
                checked={transformSnap}
                disabled={Boolean(review) || busy}
                onChange={(event) => setTransformSnap(event.target.checked)}
              />
              Snap
            </label>
            {transformMode === "translate" ? (
              <div className="alignment-fine-controls" role="group" aria-label="Fine move">
                <small>Fine move 10 cm</small>
                <button type="button" aria-label="Move model left 10 centimetres" onClick={() => nudgeAlignment({ x: modelTransform.x - 0.1 })}>←</button>
                <button type="button" aria-label="Move model forward 10 centimetres" onClick={() => nudgeAlignment({ z: modelTransform.z - 0.1 })}>↑</button>
                <button type="button" aria-label="Move model backward 10 centimetres" onClick={() => nudgeAlignment({ z: modelTransform.z + 0.1 })}>↓</button>
                <button type="button" aria-label="Move model right 10 centimetres" onClick={() => nudgeAlignment({ x: modelTransform.x + 0.1 })}>→</button>
              </div>
            ) : (
              <div className="alignment-fine-controls" role="group" aria-label="Fine rotate">
                <small>Fine rotate 1°</small>
                <button type="button" aria-label="Rotate model left 1 degree" onClick={() => nudgeAlignment({ rotationY: modelTransform.rotationY - 1 })}>↺</button>
                <button type="button" aria-label="Rotate model right 1 degree" onClick={() => nudgeAlignment({ rotationY: modelTransform.rotationY + 1 })}>↻</button>
              </div>
            )}
            <span className="editor-toolbar-spacer" />
            <button
              type="button"
              disabled={busy || Boolean(review)}
              onClick={() => referenceInput.current?.click()}
            >
              + Reference
            </button>
            <button
              type="button"
              className="primary alignment-done"
              onClick={() => setShowReferenceWorkspace(false)}
            >
              Done
            </button>
          </nav>
          ) : (
          <nav className="canvas-toolbar editor-toolbar editor-toolbar--simple" aria-label="3D editor tools">
            <div className="editor-mode-switch" role="group" aria-label="Editor mode">
              {(
                [
                  ["building", "Building"],
                  ["rooms", "Interior"],
                  ["walk", "Walk"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={view === v ? "active" : ""}
                  disabled={v === "walk" && !room}
                  onClick={() => {
                    setView(v);
                    if (v === "rooms") setInteriorFloorOverview(false);
                    if (v === "walk") setCameraOrientation("perspective");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "rooms" && room && (
              <button
                type="button"
                className={interiorFloorOverview ? "" : "active"}
                aria-pressed={!interiorFloorOverview}
                onClick={() =>
                  setInteriorFloorOverview((value) => !value)
                }
              >
                {interiorFloorOverview ? "Focus room" : "Show floor"}
              </button>
            )}

            <details className="editor-tool-menu">
              <summary>View <span aria-hidden="true">▾</span></summary>
              <div className="editor-tool-popover">
                <button
                  type="button"
                  className={cameraOrientation === "perspective" && !sectionCutEnabled ? "active" : ""}
                  disabled={view === "walk"}
                  onClick={() => {
                    setCameraOrientation("perspective");
                    setSectionCutEnabled(false);
                  }}
                >
                  Perspective
                </button>
                <button
                  type="button"
                  className={cameraOrientation === "top" && !sectionCutEnabled ? "active" : ""}
                  disabled={view === "walk"}
                  onClick={() => {
                    setView("building");
                    setCameraOrientation("top");
                    setSectionCutEnabled(false);
                  }}
                >
                  Top
                </button>
                <button
                  type="button"
                  className={sectionCutEnabled ? "active" : ""}
                  disabled={view === "walk"}
                  onClick={() => {
                    setView("building");
                    setSectionCutEnabled((value) => !value);
                  }}
                >
                  Section
                </button>
                <div className="editor-menu-divider" />
                <button
                  type="button"
                  className={showLeftPanel ? "active" : ""}
                  onClick={() => setShowLeftPanel((value) => !value)}
                >
                  Project panel
                </button>
                <button
                  type="button"
                  className={showRightPanel ? "active" : ""}
                  onClick={() => setShowRightPanel((value) => !value)}
                >
                  Properties panel
                </button>
                <button
                  type="button"
                  className={showAssetShelf ? "active" : ""}
                  disabled={view !== "rooms"}
                  onClick={() => setShowAssetShelf((value) => !value)}
                >
                  Furniture shelf
                </button>
                <button
                  type="button"
                  className={editorFocus ? "active" : ""}
                  onClick={() => setEditorFocus((value) => !value)}
                >
                  {editorFocus ? "Exit full screen" : "Full screen"}
                </button>
              </div>
            </details>

            <details className="editor-tool-menu">
              <summary>Edit <span aria-hidden="true">▾</span></summary>
              <div className="editor-tool-popover">
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
                  Move <kbd>W</kbd>
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
                  title="Rotate selected object (E)"
                  onClick={() => setTransformMode("rotate")}
                >
                  Rotate <kbd>E</kbd>
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
                  Scale <kbd>R</kbd>
                </button>
                <button
                  type="button"
                  className={transformSnap ? "active" : ""}
                  disabled={Boolean(review) || busy}
                  onClick={() => setTransformSnap((value) => !value)}
                >
                  Snap {transformSnap ? "On" : "Off"}
                </button>
                {!review && (
                  <>
                    <div className="editor-menu-divider" />
                    <button
                      type="button"
                      disabled={!undo.current.length || busy}
                      title="Undo (Ctrl+Z)"
                      onClick={() => history(true)}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      disabled={!redo.current.length || busy}
                      title="Redo (Ctrl+Y)"
                      onClick={() => history(false)}
                    >
                      Redo
                    </button>
                  </>
                )}
              </div>
            </details>

            <details className="editor-tool-menu editor-floor-menu">
              <summary>Floor <span aria-hidden="true">▾</span></summary>
              <div className="editor-tool-popover">
                <label>
                  <span>Visible floor</span>
                  <select
                    aria-label="Isolate floor"
                    value={isolateFloorId}
                    disabled={view === "walk"}
                    onChange={(event) => {
                      const next = event.target.value;
                      setIsolateFloorId(next);
                      if (next) {
                        setRoomMapFloorId(next);
                        const target = scene.floors.find((floor) => floor.id === next);
                        if (target) {
                          setSectionCutOffset(target.elevation + 1.5);
                          setView("building");
                        }
                        if (room?.floorId !== next) {
                          setSelected("");
                          setRoomId("");
                        }
                      }
                    }}
                  >
                    <option value="">All floors</option>
                    {[...scene.floors]
                      .sort((a, b) => a.elevation - b.elevation)
                      .map((floor) => (
                        <option key={floor.id} value={floor.id}>
                          {floor.name}
                        </option>
                      ))}
                  </select>
                </label>
                {isolateFloorId && (
                  <button type="button" onClick={() => setIsolateFloorId("")}>
                    Show all floors
                  </button>
                )}
              </div>
            </details>

            {isolateFloorId && (!quickSourceSetup.repeatPlan || isolateFloorId === typicalFloorId) &&
              roomSheetRows.some(
                (row) =>
                  row.origin === "profile" &&
                  typeof row.suggestedX === "number" &&
                  Number.isFinite(row.suggestedX) &&
                  typeof row.suggestedZ === "number" &&
                  Number.isFinite(row.suggestedZ) &&
                  !mappedSheetKeys.has(row.key),
              ) && (
                <button
                  type="button"
                  className="primary editor-prepare-floor-action"
                  disabled={busy || Boolean(review)}
                  onClick={(event) => {
                    event.currentTarget.closest("nav")?.querySelectorAll("details[open]")
                      .forEach((menu) => menu.removeAttribute("open"));
                    prepareSuggestedTypicalFloor(isolateFloorId, false);
                  }}
                >
                  Prepare{" "}
                  {scene.floors.find((floor) => floor.id === isolateFloorId)?.name ??
                    "floor"}{" "}
                  rooms
                </button>
              )}

            {isolateFloorId && scene.rooms.some((entry) => entry.floorId === isolateFloorId) && (
              <button type="button" onClick={(event) => {
                event.currentTarget.closest("nav")?.querySelectorAll("details[open]")
                  .forEach((menu) => menu.removeAttribute("open"));
                setShowFloorReview(true);
                setShowRoomMapper(false);
                setShowReferenceWorkspace(false);
                setView("building");
                setCameraOrientation("top");
              }}>Review floor rooms</button>
            )}

            <button
              type="button"
              className="editor-focus-action"
              title="Frame selected object (F)"
              onClick={() => setFocusRequest((value) => value + 1)}
            >
              Focus <kbd>F</kbd>
            </button>
            {editorFocus && (
              <button
                type="button"
                className="editor-fullscreen-exit"
                title="Exit full screen (Esc)"
                onClick={() => setEditorFocus(false)}
              >
                Exit full screen <kbd>Esc</kbd>
              </button>
            )}
          </nav>
          )}
          {sectionCutEnabled && !showReferenceWorkspace && (
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
            alignmentMode={showReferenceWorkspace}
            autoAlignRequest={autoAlignRequest}
            roomMapEnabled={showRoomMapper || showFloorReview}
            roomDraw={{
              enabled:
                showRoomMapper &&
                (roomMapAction === "create" || roomMapAction === "reshape"),
              floorId: roomMapFloorId,
              snap: roomMapSnap,
            }}
            roomStamp={{
              enabled:
                showRoomMapper &&
                roomMapAction === "stamp" &&
                Boolean(activeRoomSheetRow),
              floorId: roomMapFloorId,
              snap: roomMapSnap,
              width: activeRoomSheetRow?.width ?? 1,
              depth: activeRoomSheetRow?.depth ?? 1,
            }}
            roomPolygonDraw={{
              enabled: showRoomMapper && roomMapAction === "polygon",
              floorId: roomMapFloorId,
              snap: roomMapSnap,
            }}
            roomPolygonEdit={{
              enabled:
                showRoomMapper &&
                roomMapAction === "edit-polygon" &&
                Boolean(room?.polygon?.length) &&
                selected === room?.id,
              roomId: room?.id ?? "",
              snap: roomMapSnap,
            }}
            snap={transformSnap}
            focusRequest={focusRequest}
            cameraOrientation={cameraOrientation}
            showReferenceLayers={showReferenceWorkspace}
            soloRoomId={
              view === "rooms" && !interiorFloorOverview
                ? roomId || undefined
                : undefined
            }
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
            onRoomPolygonDraw={commitMappedPolygon}
            onRoomPolygonChange={commitEditedPolygon}
            onWalkRoomChange={(nextRoomId) => {
              const nextRoom = scene.rooms.find(
                (candidate) => candidate.id === nextRoomId,
              );
              if (!nextRoom) return;
              setRoomId(nextRoom.id);
              setSelected(nextRoom.id);
              setMesh("");
              setSelectedModelNodeKey("");
              setIsolateFloorId(nextRoom.floorId);
            }}
            onModelNodes={setModelNodes}
            onModelMaterials={setModelMaterials}
          />
          {showFloorReview && isolateFloorId && !showReferenceWorkspace && (
            <FloorRoomReview scene={scene} floorId={isolateFloorId} unit={roomMapUnit}
              selectedId={selected} disabled={Boolean(review) || busy} repeat={batchRepeatPreview}
              onUnit={(unit) => {
                setRoomMapUnit(unit);
                const first = scene.rooms.find((entry) => entry.floorId === isolateFloorId && entry.unit === unit);
                setSelected(first?.id ?? "");
                setRoomId(first?.id ?? "");
              }}
              onSelect={(entry) => { setRoomId(entry.id); setSelected(entry.id); }}
              onReview={(entry, accepted) => {
                if (review || busy) return;
                edit({ ...p, scene: { ...p.scene, rooms: p.scene.rooms.map((candidate) =>
                  candidate.id === entry.id ? { ...candidate, verified: accepted } : candidate) } });
                if (accepted) {
                  const next = scene.rooms.find((candidate) => candidate.floorId === isolateFloorId &&
                    candidate.unit === entry.unit && candidate.id !== entry.id && !candidate.verified);
                  if (next) { setRoomId(next.id); setSelected(next.id); }
                }
              }}
              onReviewUnit={(unit, accepted) => {
                if (review || busy) return;
                edit({ ...p, scene: { ...p.scene, rooms: p.scene.rooms.map((candidate) =>
                  candidate.floorId === isolateFloorId && candidate.unit === unit
                    ? { ...candidate, verified: accepted }
                    : candidate) } });
                const first = scene.rooms.find((candidate) =>
                  candidate.floorId === isolateFloorId && candidate.unit === unit);
                setRoomId(first?.id ?? "");
                setSelected(first?.id ?? "");
              }}
              onReviewGeneratedFloor={reviewGeneratedFloor}
              onCorrect={() => {
                setShowFloorReview(false); setShowRoomMapper(true);
                setRoomMapFloorId(isolateFloorId); setRoomMapAction("idle");
              }}
              onRepeat={generateBatchRepeatedUnits}
              onClose={() => setShowFloorReview(false)} />
          )}
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
                setSelected("");
                setRoomId("");
                setRoomMapAction("idle");
                setSelectedRoomSheetKey("");
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
              roomSheetRows={roomSheetRows}
              mappedRoomSheetKeys={mappedSheetKeys}
              selectedRoomSheetKey={selectedRoomSheetKey}
              roomSheetIssues={roomSheetIssues}
              onRoomSheetSelect={selectRoomSheetRow}
              onPrepareSuggestedLayout={prepareSuggestedTypicalFloor}
              canPrepare={!quickSourceSetup.repeatPlan || roomMapFloorId === typicalFloorId}
              batchRepeatPreview={batchRepeatPreview}
              onGenerateBatchRepeat={generateBatchRepeatedUnits}
              openingWorkflow={openingWorkflowStatus}
              onAnalyzeReadyOpenings={() =>
                void task(analyzeAndApproveReadyOpenings)
              }
              onReviewOpenings={() => {
                setWorkspace("builder");
                setEditorFocus(false);
              }}
              onRepeatUnit={repeatMappedUnit}
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
              quickSetup={quickSourceSetup}
              recommendedPdfPage={(() => {
                const value = sourceFusion?.facts.find(
                  (fact) => fact.key === "pdf.plan-page",
                )?.value;
                return typeof value === "number" ? value : undefined;
              })()}
              transformMode={transformMode}
              snap={transformSnap}
              disabled={Boolean(review) || busy}
              onUpsertLayer={upsertReferenceLayer}
              onRemoveLayer={removeReferenceLayer}
              onModelTransform={patchModelTransform}
              onTransformMode={(mode) => setTransformMode(mode)}
              onSnap={setTransformSnap}
              onCreatePdfReference={createPdfReferenceAsset}
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
          {view === "rooms" && showAssetShelf && (
          <div className="catalog">
            <div>
              <b>{review ? "Customer review" : "Furniture library"}</b>
              <small>
                {review
                  ? release?.name
                  : room
                    ? legacyDraftFurnitureBlocked
                      ? "Remove/review this superseded draft before furnishing"
                      : `Place in ${room.name}`
                    : "Select a room to furnish"}
              </small>
            </div>
            {profileDemoInteriorEnabled &&
              isolateFloorId === typicalFloorId &&
              !review && (
                <div className="interior-auto-action" role="group" aria-label="Demo interior automation">
                  {demoInteriorIssues.length > 0 ? (
                    <>
                      <span>
                        <b>Interior cleanup required</b>
                        <small>
                          {demoInteriorIssues.length} furniture item{demoInteriorIssues.length === 1 ? "" : "s"} are assigned to incompatible room types. Review-safe furniture will be preserved.
                        </small>
                      </span>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={repairDemoInteriorConsistency}
                      >
                        Fix misplaced furniture
                      </button>
                    </>
                  ) : typicalDemoInteriorPreview.created.length > 0 ? (
                    <>
                      <span>
                        <b>Demo interior</b>
                        <small>
                          Fill reviewed living, bedroom, dining and balcony rooms without replacing existing furniture.
                        </small>
                      </span>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={prepareTypicalDemoInterior}
                      >
                        Prepare demo interior
                      </button>
                    </>
                  ) : repeatDemoInteriorPreview.created.length > 0 ? (
                    <>
                      <span>
                        <b>Floor 1 interior ready</b>
                        <small>
                          Copy the reviewed typical-unit furniture to matching reviewed upper-floor rooms.
                        </small>
                      </span>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={repeatDemoInteriorToUpperFloors}
                      >
                        Repeat interior to upper floors
                      </button>
                    </>
                  ) : (
                    <span className="interior-auto-complete">
                      <b>Demo interior ready ✓</b>
                      <small>
                        Typical and matching repeated floors are furnished. Manual edits remain available below.
                      </small>
                    </span>
                  )}
                </div>
              )}
            {Object.entries(catalog).map(([kind, c]) => (
              <button
                key={kind}
                disabled={
                  !room ||
                  legacyDraftFurnitureBlocked ||
                  Boolean(review) ||
                  busy
                }
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
          )}
        </section>
        <aside className="studio-inspector">
          <div className="section-label">
            {review ? "REVIEW VERSION" : "DESIGN PROPERTIES"}
          </div>
          <fieldset disabled={Boolean(review) || busy}>
            {view === "building" && mesh ? (
              <details className="advanced-properties editor-context-advanced">
                <summary>Model properties</summary>
                <ModelNodeInspector
                mesh={mesh}
                selectedNode={selectedModelNode}
                selectedTag={selectedModelNodeTag}
                taggedCount={taggedModelNodeCount}
                totalCount={modelNodes.length}
                floors={p.scene.floors}
                rooms={p.scene.rooms}
                currentRoom={room}
                onPatchTag={patchModelNodeTag}
                onClearSemantic={clearModelNodeSemantic}
                onClearTag={clearModelNodeTag}
                onBindRoom={bindSelectedMeshToRoom}
                onFocus={() => setFocusRequest((value) => value + 1)}
                />
              </details>
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
                  <summary>More properties</summary>
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
                <details className="advanced-properties editor-room-evidence">
                  <summary>Source & verification</summary>
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
                  · {roomArea(room).toFixed(2)} m² mapped floor area
                  {room.polygon?.length
                    ? ` · ${room.polygon.length} corners`
                    : ""}
                </p>
                </details>
                <RoomNavigationPanel
                  scene={p.scene}
                  room={room}
                  onWalkRoom={(targetRoom) => {
                    setRoomId(targetRoom.id);
                    setSelected(targetRoom.id);
                    setView("walk");
                    setCameraOrientation("perspective");
                  }}
                  onRemoveOpening={removeOpening}
                />
                <details className="advanced-properties editor-room-source-binding">
                  <summary>Model binding</summary>
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
                </details>
                <details className="advanced-properties editor-room-actions">
                  <summary>Room actions</summary>
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
                        openings: (p.scene.openings ?? []).filter(
                          (opening) => !opening.roomIds.includes(room.id),
                        ),
                      },
                    });
                    setRoomId("");
                    setSelected("");
                  }}
                >
                  Remove room
                </button>
                </details>
              </>
            ) : (
              <p>Select a room or furniture item to edit its properties.</p>
            )}
            <details className="advanced-properties editor-context-advanced">
              <summary>Model scale</summary>
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
            </details>
          </fieldset>
          {view === "building" && (
            <details className="editor-materials editor-inspector-details">
              <summary>Materials</summary>
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
            </details>
          )}
          {view === "building" && (
            <section className="editor-lighting" aria-label="Lighting editor">
              <div className="section-label">LIGHTING & LOOK</div>
              <fieldset disabled={Boolean(review) || busy}>
                <div className="look-preset-panel">
                  <div className="look-preset-head">
                    <span>ONE-CLICK REALISM</span>
                    <small>{activeLookPreset?.label ?? "CUSTOM"}</small>
                  </div>
                  <div
                    className="look-preset-grid"
                    role="group"
                    aria-label="Visual realism presets"
                  >
                    {APPEARANCE_PRESETS.map((preset) => {
                      const active = activeLookPreset?.id === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          className={active ? "look-preset active" : "look-preset"}
                          aria-pressed={active}
                          title={preset.detail}
                          onClick={() => applyAppearancePreset(preset.id)}
                        >
                          <span
                            className={`look-preset-swatch look-preset-swatch--${preset.id}`}
                            aria-hidden="true"
                          />
                          <span>
                            <b>{preset.label}</b>
                            <small>{preset.shortDescription}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <small className="look-preset-note">
                    Presets change runtime lighting only. Source model bytes remain unchanged.
                  </small>
                </div>
                <details className="look-fine-tune">
                  <summary>Fine tune</summary>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={appearance.referenceVisual}
                    onChange={(event) =>
                      patchAppearance({ referenceVisual: event.target.checked })
                    }
                  />
                  Verified source/reference look
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
                        appearance: { ...DEFAULT_SCENE_APPEARANCE },
                        materialOverrides: [],
                      },
                    })
                  }
                >
                  Reset look development
                </button>
                </details>
              </fieldset>
            </section>
          )}
          <details className="editor-inspector-details editor-review-history">
            <summary>Review & versions</summary>
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
          </details>
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
