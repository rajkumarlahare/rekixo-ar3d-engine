import {
  projectSlug,
  validateProject,
  type Asset,
  type Project,
} from "./domain";
import type {
  CloudReleaseSummary,
  CloudSession,
} from "./cloud";

export type ReadinessSeverity = "ready" | "warning" | "blocker";

export interface ReadinessItem {
  id: string;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
}

export interface StudioReadiness {
  items: ReadinessItem[];
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
  ready: ReadinessItem[];
  score: number;
  publishable: boolean;
  reviewedRooms: number;
  totalRooms: number;
  referenceAssets: number;
  modelAsset?: Asset;
  sourceModelAsset?: Asset;
  activeRelease?: CloudReleaseSummary;
}

function byId(files: Asset[]) {
  return new Map(files.map((file) => [file.id, file]));
}

function assetKind(file: Asset) {
  const name = file.name.toLowerCase();
  if (/\.(glb|fbx)$/.test(name)) return "model";
  if (/\.(dwg|dxf|pdf|skb|skp|drs|csv)$/.test(name)) return "source";
  if (/\.(png|jpe?g|webp)$/.test(name)) return "reference";
  return "other";
}

export function studioAssetKind(file: Asset) {
  return assetKind(file);
}

export function buildStudioReadiness(
  project: Project,
  files: Asset[],
  cloudDirty: boolean,
  session: CloudSession | undefined,
  releases: CloudReleaseSummary[],
): StudioReadiness {
  const items: ReadinessItem[] = [];
  const fileById = byId(files);
  let valid = true;

  try {
    validateProject(project);
    items.push({
      id: "schema",
      severity: "ready",
      title: "Project structure valid",
      detail: "Local project, scene references and object limits pass validation.",
    });
  } catch (error) {
    valid = false;
    items.push({
      id: "schema",
      severity: "blocker",
      title: "Project structure needs attention",
      detail:
        error instanceof Error
          ? error.message
          : "The project package is not valid.",
    });
  }

  const sourceModelAsset = project.scene.modelId
    ? fileById.get(project.scene.modelId)
    : undefined;
  const publishModelId =
    project.scene.publishModelId ?? project.scene.modelId;
  const modelAsset = publishModelId
    ? fileById.get(publishModelId)
    : undefined;

  if (!project.scene.modelId && !publishModelId && !project.scene.rooms.length) {
    items.push({
      id: "content",
      severity: "blocker",
      title: "No publishable 3D content",
      detail: "Import a model or author at least one measured room before publish.",
    });
  }
  if (project.scene.modelId && !sourceModelAsset) {
    items.push({
      id: "source-model-missing",
      severity: "blocker",
      title: "Authoring model bytes are missing",
      detail: "Re-import the source model before continuing Studio authoring.",
    });
  } else if (
    sourceModelAsset &&
    project.scene.publishModelId &&
    project.scene.publishModelId !== project.scene.modelId
  ) {
    items.push({
      id: "authoring-model",
      severity: "ready",
      title: "Source model retained for authoring",
      detail: `${sourceModelAsset.name} stays in Studio for analysis and mesh review; it is not sent as the customer web model.`,
    });
  }

  if (publishModelId && !modelAsset) {
    items.push({
      id: "model-missing",
      severity: "blocker",
      title: "Web publish model bytes are missing",
      detail: "Run project Auto Setup again or re-attach the approved GLB before publish.",
    });
  } else if (modelAsset && !modelAsset.name.toLowerCase().endsWith(".glb")) {
    items.push({
      id: "model-format",
      severity: "blocker",
      title: "Web publish model must be self-contained GLB",
      detail:
        "FBX may remain the Studio authoring model, but the customer release requires a separate web-safe GLB.",
    });
  } else if (modelAsset) {
    items.push({
      id: "model-format",
      severity: "ready",
      title: "Web publish model ready",
      detail: `${modelAsset.name} · ${(modelAsset.size / 1048576).toFixed(1)} MB`,
    });
  }

  const referencedFiles = project.assets
    .map((assetId) => fileById.get(assetId))
    .filter((asset): asset is Asset => Boolean(asset));
  const referenceAssets = referencedFiles.filter(
    (asset) =>
      asset.id !== project.scene.modelId &&
      asset.id !== project.scene.publishModelId,
  ).length;
  if (referenceAssets) {
    items.push({
      id: "sources",
      severity: "ready",
      title: `${referenceAssets} source/reference asset${referenceAssets === 1 ? "" : "s"} attached`,
      detail: "Source evidence remains project-scoped and checksum-addressed.",
    });
  } else {
    items.push({
      id: "sources",
      severity: "warning",
      title: "No reference/source asset attached",
      detail:
        "Attach the drawing, brochure, CAD or image used to author measurements when available.",
    });
  }

  const reviewedRooms = project.scene.rooms.filter((room) => room.verified).length;
  const unreviewedRooms = project.scene.rooms.length - reviewedRooms;
  if (!project.scene.rooms.length) {
    items.push({
      id: "evidence",
      severity: "warning",
      title: "No authored rooms",
      detail: "This is acceptable for an exterior-only release.",
    });
  } else if (unreviewedRooms) {
    items.push({
      id: "evidence",
      severity: "warning",
      title: `${unreviewedRooms} room${unreviewedRooms === 1 ? "" : "s"} still unreviewed`,
      detail:
        "Unreviewed dimensions remain disclosed as draft evidence and are not silently promoted to verified.",
    });
  } else {
    items.push({
      id: "evidence",
      severity: "ready",
      title: "All authored rooms reviewed",
      detail: `${reviewedRooms} of ${project.scene.rooms.length} rooms are marked reviewed.`,
    });
  }

  const openings = project.scene.openings ?? [];
  const reviewedOpenings = openings.filter((opening) => opening.reviewed);
  const reviewedConnections = reviewedOpenings.filter(
    (opening) => opening.kind === "door" && opening.roomIds.length >= 2,
  );
  if (project.scene.rooms.length > 0 && reviewedConnections.length === 0) {
    items.push({
      id: "walkthrough-openings",
      severity: "warning",
      title: openings.length
        ? "Walkthrough openings still need review"
        : "No source-backed walkthrough openings",
      detail: openings.length
        ? `${openings.length - reviewedOpenings.length} opening draft${openings.length - reviewedOpenings.length === 1 ? "" : "s"} remain unresolved; room-to-room walkthrough only uses reviewed shared doors.`
        : "The current Jyoti/source model did not yield a trustworthy reviewed shared door. Walkthrough connectivity stays disabled rather than inventing architectural openings.",
    });
  } else if (reviewedConnections.length > 0) {
    items.push({
      id: "walkthrough-openings",
      severity: "ready",
      title: `${reviewedConnections.length} reviewed walkthrough connection${reviewedConnections.length === 1 ? "" : "s"}`,
      detail: "Room-to-room walkthrough uses reviewed shared-door evidence only.",
    });
  }

  if (!project.location?.trim()) {
    items.push({
      id: "location",
      severity: "warning",
      title: "Project location is empty",
      detail: "Add a locality/city so operators can distinguish similarly named projects.",
    });
  }

  if (!session?.authenticated) {
    items.push({
      id: "auth",
      severity: "blocker",
      title: "Engine Admin cloud session required",
      detail: "Sign in before saving or publishing shared production state.",
    });
  } else if (!project.cloud) {
    items.push({
      id: "cloud",
      severity: "blocker",
      title: "Cloud draft not created",
      detail: "Save to cloud once before creating an immutable release.",
    });
  } else if (cloudDirty) {
    items.push({
      id: "draft",
      severity: "blocker",
      title: "Local draft is newer than cloud",
      detail:
        "Your work is autosaved in this browser. Save to cloud before publishing so the immutable release pins the exact latest revision.",
    });
  } else {
    items.push({
      id: "draft",
      severity: "ready",
      title: `Cloud draft r${project.cloud.revision} synchronized`,
      detail: "The next release can pin this exact cloud revision.",
    });
  }

  const activeRelease = releases.find((release) => release.active);
  if (activeRelease) {
    items.push({
      id: "release",
      severity: "ready",
      title: `Public release v${activeRelease.version} active`,
      detail: "Draft edits do not change this immutable release until another publish.",
    });
  } else {
    items.push({
      id: "release",
      severity: "warning",
      title: "No immutable public release yet",
      detail: "Publishing will create the first immutable customer-facing release.",
    });
  }

  const blockers = items.filter((item) => item.severity === "blocker");
  const warnings = items.filter((item) => item.severity === "warning");
  const ready = items.filter((item) => item.severity === "ready");
  const score = Math.max(
    0,
    Math.round((ready.length / Math.max(1, items.length)) * 100),
  );

  return {
    items,
    blockers,
    warnings,
    ready,
    score,
    publishable: valid && blockers.length === 0,
    reviewedRooms,
    totalRooms: project.scene.rooms.length,
    referenceAssets,
    modelAsset,
    sourceModelAsset,
    activeRelease,
  };
}

export function publicProjectUrl(project: Project) {
  return `/3Dprojects/${encodeURIComponent(projectSlug(project))}`;
}

export function publishedShowcaseUrl(project: Project) {
  return `/3Dprojects/showcase/${encodeURIComponent(projectSlug(project))}`;
}
