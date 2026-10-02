import type { Asset, Project } from "./domain";
import { id, validateProject } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import { auditFbxSources } from "./sourceAudit";
import { prepareFbxWebModel } from "./fbxWebModel";
import { prepareSketchUpTextureRecovery } from "./sketchUpRecovery";
import { analyzeProjectFiles, type SmartProjectAnalysis } from "./projectAnalyzer";
import { buildSmartSceneDraft } from "./smartDraftBuilder";
import { suggestOpeningAssociations } from "./openingAssociator";
import { applyReadyOpeningWorkflow } from "./openingWorkflow";

export interface AutoBuildPipelineResult {
  project: Project;
  assets: Asset[];
  analysis: SmartProjectAnalysis;
  summary: {
    selectedModel: string;
    webModelPrepared: boolean;
    sketchUpTexturesRecovered: number;
    floors: number;
    walls: number;
    repeatedFloors: number;
    autoRooms: number;
    readyOpeningsApproved: number;
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

  let webModelPrepared = false;
  const currentPublish = next.scene.publishModelId
    ? workingFiles.find((file) => file.id === next.scene.publishModelId)
    : undefined;

  if (/\.glb$/i.test(authoring.name)) {
    next.scene.publishModelId = authoring.id;
  } else if (!currentPublish || !/\.glb$/i.test(currentPublish.name)) {
    const prepared = await prepareFbxWebModel(authoring, next.id);
    const equivalent = findEquivalentAsset(workingFiles, prepared.asset);
    const publishAsset = equivalent ?? prepared.asset;
    if (!equivalent) {
      createdAssets.push(publishAsset);
      workingFiles.push(publishAsset);
      next = appendAsset(next, publishAsset);
    }
    next.scene.publishModelId = publishAsset.id;
    webModelPrepared = true;
    if (prepared.externalTexturesBlocked)
      issues.push(
        "FBX web model was prepared without unresolved external texture maps; SketchUp/source texture recovery remains visual-review evidence.",
      );
  }

  let sketchUpTexturesRecovered = 0;
  if (workingFiles.some((file) => /\.(?:skb|skp)$/i.test(file.name))) {
    try {
      const recovery = await prepareSketchUpTextureRecovery(workingFiles, next);
      next = recovery.nextProject;
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

  let readyOpeningsApproved = 0;
  let openingReviewRemaining = 0;
  if (next.scene.rooms.length && analysis.architecturalCandidates.length) {
    const suggestions = suggestOpeningAssociations(analysis, next.scene);
    const workflow = applyReadyOpeningWorkflow(
      next.scene,
      analysis.architecturalCandidates,
      suggestions,
      id,
    );
    next = { ...next, scene: workflow.scene };
    readyOpeningsApproved = workflow.approved;
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
      floors: draft.summary.floors,
      walls: draft.summary.walls,
      repeatedFloors: draft.summary.repeatedFloors,
      autoRooms: draft.summary.autoRooms,
      readyOpeningsApproved,
      openingReviewRemaining,
    },
    issues: [...new Set([...issues, ...analysis.issues])],
  };
}
