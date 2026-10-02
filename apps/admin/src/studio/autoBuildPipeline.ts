import type { Asset, Project } from "./domain";
import { id, validateProject } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import { auditFbxSources } from "./sourceAudit";
import { prepareFbxWebModel } from "./fbxWebModel";
import { prepareSketchUpTextureRecovery } from "./sketchUpRecovery";
import type { SketchUpMaterialTextureBinding } from "./sketchUpMaterialResolver";
import { analyzeProjectFiles, type SmartProjectAnalysis } from "./projectAnalyzer";
import { buildSmartSceneDraft } from "./smartDraftBuilder";
import { suggestOpeningAssociations } from "./openingAssociator";
import { applyReadyOpeningWorkflow } from "./openingWorkflow";
import {
  markAutoReadyModelWalls,
  markAutoReadyRepeatedFloors,
} from "./autoBuildingReview";

export interface AutoBuildPipelineResult {
  project: Project;
  assets: Asset[];
  analysis: SmartProjectAnalysis;
  summary: {
    selectedModel: string;
    webModelPrepared: boolean;
    sketchUpTexturesRecovered: number;
    materialTexturesApplied: number;
    resolvedExternalTextures: number;
    unresolvedExternalTextures: number;
    floors: number;
    walls: number;
    repeatedFloors: number;
    autoRooms: number;
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
): Promise<AutoBuildPipelineResult> {
  let next: Project = structuredClone(project);
  let workingFiles = [...files];
  const createdAssets: Asset[] = [];
  const issues: string[] = [];

  const authoring = chooseAuthoringModel(next, workingFiles);
  next.scene.modelId = authoring.id;

  let sketchUpTexturesRecovered = 0;
  let materialBindings: SketchUpMaterialTextureBinding[] = [];
  if (workingFiles.some((file) => /\.(?:skb|skp)$/i.test(file.name))) {
    try {
      const recovery = await prepareSketchUpTextureRecovery(workingFiles, next);
      next = recovery.nextProject;
      materialBindings = recovery.materialBindings;
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
  let resolvedExternalTextures = 0;
  let unresolvedExternalTextures = 0;

  if (/\.glb$/i.test(authoring.name)) {
    next.scene.publishModelId = authoring.id;
  } else {
    const prepared = await prepareFbxWebModel(authoring, next.id, {
      textureAssets: workingFiles,
      materialBindings,
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
      resolvedExternalTextures,
      unresolvedExternalTextures,
      floors: draft.summary.floors,
      walls: draft.summary.walls,
      repeatedFloors: draft.summary.repeatedFloors,
      autoRooms: draft.summary.autoRooms,
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
  const resolvedTextures = summary.resolvedExternalTextures
    ? ` · ${summary.resolvedExternalTextures} FBX texture reference${summary.resolvedExternalTextures === 1 ? "" : "s"} resolved`
    : "";
  const rooms = summary.autoRooms
    ? ` · ${summary.autoRooms} room draft${summary.autoRooms === 1 ? "" : "s"}`
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
  return `Automatic build complete · ${summary.floors} floors · ${summary.walls} wall candidate${summary.walls === 1 ? "" : "s"} · ${summary.repeatedFloors} repeated floor${summary.repeatedFloors === 1 ? "" : "s"}${rooms}${walls}${repeats}${openings}${web}${textures}${materialFusion}${resolvedTextures}${review ? ` · ${review} review item${review === 1 ? "" : "s"}` : " · no blocking review item"}.`;
}
