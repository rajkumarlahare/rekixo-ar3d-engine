import type { Asset, Project } from "./domain";
import { id, validateProject } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import {
  analyzeProjectFiles,
  type SmartProjectAnalysis,
} from "./projectAnalyzer";
import {
  findDwgNormalizedDocument,
  type DwgNormalizedDocument,
} from "./dwgNormalized";
import { prepareDwgArchitectureDerivative } from "./dwgProcessor";
import { buildCadOnlySceneDraft } from "./cadOnlySceneDraft";
import { buildSourceAutoInterior } from "./autoInteriorDraft";
import {
  markAutoReadyModelWalls,
  markAutoReadyRepeatedFloors,
} from "./autoBuildingReview";
import {
  inspectReferenceImage,
  looksLikeGeneratedPlanReference,
} from "./referenceImageInspector";
import type {
  AutoBuildPipelineOptions,
  AutoBuildPipelineResult,
} from "./autoBuildPipelineLegacy";

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

function uniqueIssues(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

async function inspectSingleVisualReference(
  next: Project,
  analysis: SmartProjectAnalysis,
  workingFiles: readonly Asset[],
  issues: string[],
) {
  const visualSourceIds = new Set(
    analysis.sources
      .filter((source) => source.role === "visual")
      .map((source) => source.assetId),
  );
  const references = workingFiles.filter(
    (file) =>
      visualSourceIds.has(file.id) &&
      !looksLikeGeneratedPlanReference(file.name) &&
      /\.(?:png|jpe?g|webp|bmp)$/i.test(file.name),
  );

  if (references.length > 1) {
    issues.push(
      "Multiple visual reference images are attached. Rekixo kept facade appearance evidence review-only instead of choosing one automatically.",
    );
    return next;
  }
  if (references.length !== 1) return next;

  try {
    const evidence = await inspectReferenceImage(references[0]);
    if (evidence.confidence < 0.55) {
      issues.push(
        "Reference image was decoded, but visual evidence confidence is too low to store as automatic project evidence.",
      );
      return next;
    }
    return {
      ...next,
      scene: {
        ...next.scene,
        referenceImageEvidence: evidence,
      },
    };
  } catch (error) {
    issues.push(
      error instanceof Error
        ? `Reference image analysis: ${error.message}`
        : "Reference image analysis could not complete.",
    );
    return next;
  }
}

export async function runCadOnlyAutoBuildPipeline(
  project: Project,
  files: readonly Asset[],
  audits: readonly FbxSourceAudit[] = [],
  options: AutoBuildPipelineOptions = {},
): Promise<AutoBuildPipelineResult> {
  if (files.some((file) => /\.(?:fbx|glb)$/i.test(file.name)))
    throw Error("CAD-only AutoBuild cannot run while a source 3D model is attached.");

  let next: Project = structuredClone(project);
  let workingFiles = [...files];
  const createdAssets: Asset[] = [];
  const issues: string[] = [];
  const cadSources = workingFiles.filter((file) => /\.(?:dwg|dxf)$/i.test(file.name));
  if (cadSources.length !== 1)
    throw Error(
      cadSources.length
        ? "Model-less AutoBuild needs exactly one DWG/DXF source so floor roles are never guessed."
        : "Attach one DWG or DXF plan before model-less AutoBuild.",
    );

  let dwgProcessed = false;
  let dwgDocument: DwgNormalizedDocument | undefined;
  const cadSource = cadSources[0];
  if (/\.dwg$/i.test(cadSource.name)) {
    const existing = await findDwgNormalizedDocument(workingFiles, cadSource);
    if (existing) {
      dwgDocument = existing.document;
    } else if (options.processDwgArchitecture) {
      try {
        const prepared = await prepareDwgArchitectureDerivative(
          cadSource,
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
        throw Error(
          error instanceof Error
            ? `DWG architecture processor: ${error.message}`
            : "DWG architecture processor could not complete.",
        );
      }
    } else {
      throw Error(
        "DWG needs the controlled architecture processor before model-less geometry can be reconstructed.",
      );
    }
  }

  const analysis = await analyzeProjectFiles(workingFiles, undefined, [...audits]);
  const cadDraft = buildCadOnlySceneDraft(next, analysis);
  next = { ...next, scene: cadDraft.scene };
  issues.push(...cadDraft.issues);

  next = await inspectSingleVisualReference(
    next,
    analysis,
    workingFiles,
    issues,
  );

  const readyBeforeMark = (next.scene.walls ?? []).filter(
    (wall) => !wall.reviewed && wall.reviewState === "auto_ready",
  ).length;
  const wallReview = markAutoReadyModelWalls(next.scene);
  next = { ...next, scene: wallReview.scene };
  const repeatReview = markAutoReadyRepeatedFloors(next.scene);
  next = { ...next, scene: repeatReview.scene };

  const autoInterior = buildSourceAutoInterior(next.scene, id);
  next = { ...next, scene: autoInterior.scene };

  validateProject(next);

  return {
    project: next,
    assets: createdAssets,
    analysis,
    summary: {
      selectedModel: "CAD-only parametric scene",
      webModelPrepared: false,
      sketchUpTexturesRecovered: 0,
      materialTexturesApplied: 0,
      materialStylesApplied: 0,
      resolvedExternalTextures: 0,
      unresolvedExternalTextures: 0,
      dwgProcessed,
      dwgSegments: dwgDocument?.segments.length ?? 0,
      dwgDimensions: dwgDocument?.dimensions.length ?? 0,
      dwgObjects:
        (dwgDocument?.objects.length ?? 0) +
        (dwgDocument?.inserts.length ?? 0),
      dwgFloorLabels: dwgDocument?.floors.length ?? 0,
      pdfPlanReferencesPrepared: 0,
      pdfSpatialLabels: 0,
      pdfEmbeddedImages: 0,
      pdfCadRegistrationConfidence: 0,
      pdfCadRegistrationMatches: 0,
      pdfReferenceAutoAligned: false,
      floors: next.scene.floors.length,
      walls: cadDraft.wallCount,
      repeatedFloors: 0,
      autoRooms: cadDraft.roomCount,
      topologySnappedEndpoints: 0,
      topologyIntersectionSplits: 0,
      topologyDuplicatesRemoved: 0,
      topologyTinySegmentsRemoved: 0,
      readyWallsPrepared: readyBeforeMark + wallReview.prepared,
      readyRepeatsPrepared: repeatReview.prepared,
      readyOpeningsPrepared: 0,
      openingReviewRemaining: cadDraft.openingCount,
      cadOpeningEvidence: 0,
      cadOpeningMatches: 0,
      cadOpeningReviewOnly: cadDraft.openingCount,
      roomLabelsApplied: cadDraft.semanticLabelsApplied,
      unitAnchorsMatched: 0,
      unitRoomsAssigned: 0,
      unitGroupsDetected: 0,
      roomSemanticReviewRemaining: 0,
      autoFurniturePrepared: autoInterior.created.length,
      autoFurnishedRooms: autoInterior.furnishedRooms,
      autoFurnitureRepaired: autoInterior.removedInvalidAutomatic,
      autoFurnitureSkippedRooms: autoInterior.skippedRooms.length,
      referenceImageEvidenceReady: Boolean(
        next.scene.referenceImageEvidence,
      ),
      referencePaletteColors:
        next.scene.referenceImageEvidence?.renderedPalette.length ?? 0,
      referenceLightingMood:
        next.scene.referenceImageEvidence?.lightingMood ?? "",
      referenceImageConfidence:
        next.scene.referenceImageEvidence?.confidence ?? 0,
      referenceVerticalEdgeStrength:
        next.scene.referenceImageEvidence?.verticalEdgeStrength ?? 0,
      referenceHorizontalEdgeStrength:
        next.scene.referenceImageEvidence?.horizontalEdgeStrength ?? 0,
      siteElementsPrepared: 0,
      siteElementsReady: 0,
      siteElementsReviewOnly: 0,
      siteElementsReplaced: 0,
    },
    issues: uniqueIssues([...issues, ...analysis.issues]),
  };
}
