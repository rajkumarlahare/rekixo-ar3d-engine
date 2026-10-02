import type { Asset, Project } from "./domain";
import { id, validateProject } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import { auditFbxSources } from "./sourceAudit";
import { prepareFbxWebModel } from "./fbxWebModel";
import { prepareSketchUpTextureRecovery } from "./sketchUpRecovery";
import type {
  SketchUpMaterialStyleBinding,
  SketchUpMaterialTextureBinding,
} from "./sketchUpMaterialResolver";
import {
  findDwgNormalizedDocument,
  type DwgNormalizedDocument,
} from "./dwgNormalized";
import {
  prepareDwgArchitectureDerivative,
  type DwgArchitectureProcessor,
} from "./dwgProcessor";
import { analyzeProjectFiles, type SmartProjectAnalysis } from "./projectAnalyzer";
import { buildSmartSceneDraft } from "./smartDraftBuilder";
import { suggestOpeningAssociations } from "./openingAssociator";
import { applyReadyOpeningWorkflow } from "./openingWorkflow";
import {
  markAutoReadyModelWalls,
  markAutoReadyRepeatedFloors,
} from "./autoBuildingReview";
import { makeAsset } from "./storage";

export interface AutoBuildPipelineOptions {
  processDwgArchitecture?: DwgArchitectureProcessor;
}

export interface AutoBuildPipelineResult {
  project: Project;
  assets: Asset[];
  analysis: SmartProjectAnalysis;
  summary: {
    selectedModel: string;
    webModelPrepared: boolean;
    sketchUpTexturesRecovered: number;
    materialTexturesApplied: number;
    materialStylesApplied: number;
    resolvedExternalTextures: number;
    unresolvedExternalTextures: number;
    dwgProcessed: boolean;
    dwgSegments: number;
    dwgDimensions: number;
    dwgObjects: number;
    dwgFloorLabels: number;
    pdfPlanReferencesPrepared: number;
    pdfPlanPage?: number;
    pdfSpatialLabels: number;
    pdfEmbeddedImages: number;
    floors: number;
    walls: number;
    repeatedFloors: number;
    autoRooms: number;
    topologySnappedEndpoints: number;
    topologyIntersectionSplits: number;
    topologyDuplicatesRemoved: number;
    topologyTinySegmentsRemoved: number;
    readyWallsPrepared: number;
    readyRepeatsPrepared: number;
    readyOpeningsPrepared: number;
    openingReviewRemaining: number;
  };
  issues: string[];
}

function sourceModelCandidates(files: readonly Asset[]) {
  return files.filter((file) => /\.(?:fbx|glb)$/i.test(file.name));
}

function chooseAuthoringModel(
  project: Project,
  files: readonly Asset[],
): Asset {
  const selected = project.scene.modelId
    ? files.find((file) => file.id === project.scene.modelId)
    : undefined;
  if (selected && /\.(?:fbx|glb)$/i.test(selected.name)) return selected;

  const models = sourceModelCandidates(files);
  if (models.length === 1) return models[0];

  const fbx = models.filter((file) => /\.fbx$/i.test(file.name));
  if (fbx.length === 1) return fbx[0];

  throw Error(
    models.length
      ? "Multiple 3D model candidates are attached. Select the authoring model once, then Build automatically."
      : "Attach an FBX or GLB authoring model before automatic building.",
  );
}

function appendAsset(project: Project, asset: Asset) {
  if (project.assets.includes(asset.id)) return project;
  return { ...project, assets: [...project.assets, asset.id] };
}

function findEquivalentAsset(files: readonly Asset[], candidate: Asset) {
  return files.find(
    (file) =>
      file.hash.toLowerCase() === candidate.hash.toLowerCase() &&
      file.size === candidate.size &&
      file.type === candidate.type,
  );
}

export async function runAutoBuildPipeline(
  project: Project,
  files: readonly Asset[],
  audits: readonly FbxSourceAudit[] = [],
  options: AutoBuildPipelineOptions = {},
): Promise<AutoBuildPipelineResult> {
  let next: Project = structuredClone(project);
  let workingFiles = [...files];
  const createdAssets: Asset[] = [];
  const issues: string[] = [];

  const authoring = chooseAuthoringModel(next, workingFiles);
  next.scene.modelId = authoring.id;

  let dwgProcessed = false;
  let dwgDocument: DwgNormalizedDocument | undefined;
  const dwgSources = workingFiles.filter((file) => /\.dwg$/i.test(file.name));
  if (dwgSources.length > 1) {
    issues.push(
      "Multiple DWG sources are attached. Select/fuse their floor roles during cross-source alignment instead of guessing which drawing is authoritative.",
    );
  } else if (dwgSources.length === 1) {
    const dwgSource = dwgSources[0];
    const existing = await findDwgNormalizedDocument(workingFiles, dwgSource);
    if (existing) {
      dwgDocument = existing.document;
    } else if (options.processDwgArchitecture) {
      try {
        const prepared = await prepareDwgArchitectureDerivative(
          dwgSource,
          next.id,
          options.processDwgArchitecture,
        );
        const equivalent = findEquivalentAsset(workingFiles, prepared.asset);
        const derivative = equivalent ?? prepared.asset;
        if (!equivalent) {
          createdAssets.push(derivative);
          workingFiles.push(derivative);
          next = appendAsset(next, derivative);
        }
        dwgDocument = prepared.document;
        dwgProcessed = true;
      } catch (error) {
        issues.push(
          error instanceof Error
            ? `DWG architecture processor: ${error.message}`
            : "DWG architecture processor could not complete.",
        );
      }
    } else {
      issues.push(
        "DWG architecture processor is unavailable in this session; raw DWG remains source evidence and is not guessed into geometry.",
      );
    }
  }

  let pdfPlanReferencesPrepared = 0;
  let pdfPlanPage: number | undefined;
  let pdfSpatialLabels = 0;
  let pdfEmbeddedImages = 0;
  const pdfSources = workingFiles.filter((file) => /\.pdf$/i.test(file.name));
  if (pdfSources.length > 1) {
    issues.push(
      "Multiple PDF drawings are attached. Automatic plan extraction stays reviewable instead of guessing which PDF is authoritative.",
    );
  } else if (pdfSources.length === 1) {
    try {
      const pdfSource = pdfSources[0];
      const { inspectPdfPlans } = await import("./pdfPlanInspector");
      const inspection = await inspectPdfPlans(pdfSource);
      const best = inspection.pages.find(
        (page) => page.page === inspection.bestPage,
      );
      if (best) {
        pdfPlanPage = best.page;
        pdfSpatialLabels = best.spatialLabels.filter(
          (entry) => entry.kind !== "other",
        ).length;
        pdfEmbeddedImages = best.embeddedImages.length;

        const { rasterPdfReference } = await import("./pdfReferenceRaster");
        const strongest = best.embeddedImages[0];
        const crop =
          strongest &&
          strongest.confidence >= 0.62 &&
          strongest.area >= 0.02
            ? {
                x: Math.max(0, strongest.x - 0.01),
                y: Math.max(0, strongest.y - 0.01),
                width: Math.min(
                  1 - Math.max(0, strongest.x - 0.01),
                  strongest.width + 0.02,
                ),
                height: Math.min(
                  1 - Math.max(0, strongest.y - 0.01),
                  strongest.height + 0.02,
                ),
              }
            : undefined;
        const referenceFile = await rasterPdfReference(pdfSource, {
          page: best.page,
          ...(crop ? { crop } : {}),
          label: crop ? "auto-plan-image" : "auto-plan-page",
        });
        const candidate = await makeAsset(referenceFile, next.id);
        const equivalent = findEquivalentAsset(workingFiles, candidate);
        const referenceAsset = equivalent ?? candidate;
        if (!equivalent) {
          createdAssets.push(referenceAsset);
          workingFiles.push(referenceAsset);
        }
        next = appendAsset(next, referenceAsset);

        const layers = next.scene.referenceLayers ?? [];
        if (!layers.some((layer) => layer.assetId === referenceAsset.id)) {
          next = {
            ...next,
            scene: {
              ...next.scene,
              referenceLayers: [
                ...layers,
                {
                  id: id(),
                  assetId: referenceAsset.id,
                  visible: false,
                  opacity: 0.35,
                  x: 0,
                  y: next.scene.floors[0]?.elevation ?? 0,
                  z: 0,
                  rotation: 0,
                },
              ],
            },
          };
        }
        pdfPlanReferencesPrepared = 1;
      }
      issues.push(...inspection.issues);
    } catch (error) {
      issues.push(
        error instanceof Error
          ? `PDF plan extraction: ${error.message}`
          : "PDF plan extraction could not complete.",
      );
    }
  }

  let sketchUpTexturesRecovered = 0;
  let materialBindings: SketchUpMaterialTextureBinding[] = [];
  let materialStyles: SketchUpMaterialStyleBinding[] = [];
  if (workingFiles.some((file) => /\.(?:skb|skp)$/i.test(file.name))) {
    try {
      const recovery = await prepareSketchUpTextureRecovery(workingFiles, next);
      next = recovery.nextProject;
      materialBindings = recovery.materialBindings;
      materialStyles = recovery.materialStyles;
      for (const asset of recovery.assets) {
        const equivalent = findEquivalentAsset(workingFiles, asset);
        if (equivalent) continue;
        createdAssets.push(asset);
        workingFiles.push(asset);
        sketchUpTexturesRecovered += 1;
      }
      issues.push(...recovery.issues);
    } catch (error) {
      issues.push(
        error instanceof Error
          ? `SketchUp recovery: ${error.message}`
          : "SketchUp recovery could not complete.",
      );
    }
  }

  let webModelPrepared = false;
  let materialTexturesApplied = 0;
  let materialStylesApplied = 0;
  let resolvedExternalTextures = 0;
  let unresolvedExternalTextures = 0;

  if (/\.glb$/i.test(authoring.name)) {
    next.scene.publishModelId = authoring.id;
  } else {
    const prepared = await prepareFbxWebModel(authoring, next.id, {
      textureAssets: workingFiles,
      materialBindings,
      materialStyles,
    });
    const equivalent = findEquivalentAsset(workingFiles, prepared.asset);
    const publishAsset = equivalent ?? prepared.asset;
    if (!equivalent) {
      createdAssets.push(publishAsset);
      workingFiles.push(publishAsset);
      next = appendAsset(next, publishAsset);
    }
    next.scene.publishModelId = publishAsset.id;
    webModelPrepared = true;
    materialTexturesApplied = prepared.materialTexturesApplied;
    materialStylesApplied = prepared.materialStylesApplied;
    resolvedExternalTextures = prepared.resolvedExternalTextures;
    unresolvedExternalTextures = prepared.unresolvedExternalTextures;

    if (prepared.unresolvedExternalTextures)
      issues.push(
        `${prepared.unresolvedExternalTextures} FBX texture reference${prepared.unresolvedExternalTextures === 1 ? "" : "s"} could not be resolved from the uploaded source pack; neutral material fallback was kept.`,
      );
    if (prepared.textureLoadErrors)
      issues.push(
        `${prepared.textureLoadErrors} recovered texture${prepared.textureLoadErrors === 1 ? "" : "s"} could not be decoded for the web model.`,
      );
  }

  const latestAudits =
    workingFiles.some((file) => /\.fbx$/i.test(file.name))
      ? await auditFbxSources(workingFiles)
      : [...audits];

  const analysis = await analyzeProjectFiles(
    workingFiles,
    next.scene.modelId,
    latestAudits,
  );
  if (!analysis.modelAssetId)
    throw Error("Automatic analysis could not resolve the authoring model.");
  const draft = buildSmartSceneDraft(next, analysis);
  next = { ...next, scene: draft.scene };

  const wallReview = markAutoReadyModelWalls(next.scene);
  next = { ...next, scene: wallReview.scene };
  const repeatReview = markAutoReadyRepeatedFloors(next.scene);
  next = { ...next, scene: repeatReview.scene };

  let readyOpeningsPrepared = 0;
  let openingReviewRemaining = 0;
  if (next.scene.rooms.length && analysis.architecturalCandidates.length) {
    const suggestions = suggestOpeningAssociations(analysis, next.scene);
    const workflow = applyReadyOpeningWorkflow(
      next.scene,
      analysis.architecturalCandidates,
      suggestions,
      id,
      "auto",
    );
    next = { ...next, scene: workflow.scene };
    readyOpeningsPrepared = workflow.prepared;
    openingReviewRemaining = workflow.reviewRemaining;
  }

  validateProject(next);

  return {
    project: next,
    assets: createdAssets,
    analysis,
    summary: {
      selectedModel: authoring.name,
      webModelPrepared,
      sketchUpTexturesRecovered,
      materialTexturesApplied,
      materialStylesApplied,
      resolvedExternalTextures,
      unresolvedExternalTextures,
      dwgProcessed,
      dwgSegments: dwgDocument?.segments.length ?? 0,
      dwgDimensions: dwgDocument?.dimensions.length ?? 0,
      dwgObjects:
        (dwgDocument?.objects.length ?? 0) +
        (dwgDocument?.inserts.length ?? 0),
      dwgFloorLabels: dwgDocument?.floors.length ?? 0,
      pdfPlanReferencesPrepared,
      ...(pdfPlanPage !== undefined ? { pdfPlanPage } : {}),
      pdfSpatialLabels,
      pdfEmbeddedImages,
      floors: draft.summary.floors,
      walls: draft.summary.walls,
      repeatedFloors: draft.summary.repeatedFloors,
      autoRooms: draft.summary.autoRooms,
      topologySnappedEndpoints: draft.summary.topologySnappedEndpoints,
      topologyIntersectionSplits: draft.summary.topologyIntersectionSplits,
      topologyDuplicatesRemoved: draft.summary.topologyDuplicatesRemoved,
      topologyTinySegmentsRemoved: draft.summary.topologyTinySegmentsRemoved,
      readyWallsPrepared: wallReview.prepared,
      readyRepeatsPrepared: repeatReview.prepared,
      readyOpeningsPrepared,
      openingReviewRemaining,
    },
    issues: [...new Set([...issues, ...analysis.issues])],
  };
}


export function autoBuildSummaryMessage(result: AutoBuildPipelineResult) {
  const summary = result.summary;
  const web = summary.webModelPrepared ? " · web GLB prepared" : "";
  const textures = summary.sketchUpTexturesRecovered
    ? ` · ${summary.sketchUpTexturesRecovered} SketchUp texture${summary.sketchUpTexturesRecovered === 1 ? "" : "s"} recovered`
    : "";
  const materialFusion = summary.materialTexturesApplied
    ? ` · ${summary.materialTexturesApplied} FBX material texture${summary.materialTexturesApplied === 1 ? "" : "s"} fused`
    : "";
  const materialStyles = summary.materialStylesApplied
    ? ` · ${summary.materialStylesApplied} SketchUp material style${summary.materialStylesApplied === 1 ? "" : "s"} applied`
    : "";
  const resolvedTextures = summary.resolvedExternalTextures
    ? ` · ${summary.resolvedExternalTextures} FBX texture reference${summary.resolvedExternalTextures === 1 ? "" : "s"} resolved`
    : "";
  const dwg = summary.dwgSegments || summary.dwgDimensions || summary.dwgObjects
    ? ` · DWG: ${summary.dwgSegments} segments · ${summary.dwgDimensions} dimensions · ${summary.dwgObjects} semantic objects${summary.dwgFloorLabels ? ` · ${summary.dwgFloorLabels} floor label${summary.dwgFloorLabels === 1 ? "" : "s"}` : ""}`
    : "";
  const pdf = summary.pdfPlanReferencesPrepared
    ? ` · PDF plan page ${summary.pdfPlanPage ?? "?"} prepared · ${summary.pdfSpatialLabels} spatial label${summary.pdfSpatialLabels === 1 ? "" : "s"} · ${summary.pdfEmbeddedImages} embedded image candidate${summary.pdfEmbeddedImages === 1 ? "" : "s"}`
    : "";
  const rooms = summary.autoRooms
    ? ` · ${summary.autoRooms} room draft${summary.autoRooms === 1 ? "" : "s"}`
    : "";
  const topologyChanges =
    summary.topologySnappedEndpoints +
    summary.topologyIntersectionSplits +
    summary.topologyDuplicatesRemoved +
    summary.topologyTinySegmentsRemoved;
  const topology = topologyChanges
    ? ` · topology: ${summary.topologySnappedEndpoints} endpoint snap${summary.topologySnappedEndpoints === 1 ? "" : "s"}, ${summary.topologyIntersectionSplits} intersection split${summary.topologyIntersectionSplits === 1 ? "" : "s"}, ${summary.topologyDuplicatesRemoved} duplicate${summary.topologyDuplicatesRemoved === 1 ? "" : "s"} removed`
    : "";
  const walls = summary.readyWallsPrepared
    ? ` · ${summary.readyWallsPrepared} high-confidence wall${summary.readyWallsPrepared === 1 ? "" : "s"} ready for review`
    : "";
  const repeats = summary.readyRepeatsPrepared
    ? ` · ${summary.readyRepeatsPrepared} repeated floor${summary.readyRepeatsPrepared === 1 ? "" : "s"} ready for review`
    : "";
  const openings = summary.readyOpeningsPrepared
    ? ` · ${summary.readyOpeningsPrepared} opening${summary.readyOpeningsPrepared === 1 ? "" : "s"} ready for review`
    : "";
  const review =
    result.issues.length +
    summary.openingReviewRemaining +
    summary.readyWallsPrepared +
    summary.readyRepeatsPrepared +
    summary.readyOpeningsPrepared;
  return `Automatic build complete · ${summary.floors} floors · ${summary.walls} wall candidate${summary.walls === 1 ? "" : "s"} · ${summary.repeatedFloors} repeated floor${summary.repeatedFloors === 1 ? "" : "s"}${rooms}${topology}${walls}${repeats}${openings}${web}${textures}${materialFusion}${materialStyles}${resolvedTextures}${dwg}${pdf}${review ? ` · ${review} review item${review === 1 ? "" : "s"}` : " · no blocking review item"}.`;
}
