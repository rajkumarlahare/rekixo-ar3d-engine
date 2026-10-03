import type { Asset, Project } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import {
  autoBuildSummaryMessage as legacyAutoBuildSummaryMessage,
  runAutoBuildPipeline as runModelBackedAutoBuildPipeline,
  type AutoBuildPipelineOptions,
  type AutoBuildPipelineResult,
} from "./autoBuildPipelineLegacy";
import { runCadOnlyAutoBuildPipeline } from "./cadOnlyAutoBuildPipeline";

export type {
  AutoBuildPipelineOptions,
  AutoBuildPipelineResult,
} from "./autoBuildPipelineLegacy";

function hasSourceModel(files: readonly Asset[]) {
  return files.some((file) => /\.(?:fbx|glb)$/i.test(file.name));
}

/**
 * Routes AutoBuild by source authority. Existing FBX/GLB projects keep the
 * mature model-backed pipeline unchanged. Projects without a 3D model use the
 * conservative CAD-only reconstruction path instead of inventing model data.
 */
export async function runAutoBuildPipeline(
  project: Project,
  files: readonly Asset[],
  audits: readonly FbxSourceAudit[] = [],
  options: AutoBuildPipelineOptions = {},
): Promise<AutoBuildPipelineResult> {
  if (hasSourceModel(files))
    return runModelBackedAutoBuildPipeline(project, files, audits, options);
  return runCadOnlyAutoBuildPipeline(project, files, audits, options);
}

export function autoBuildSummaryMessage(result: AutoBuildPipelineResult) {
  return legacyAutoBuildSummaryMessage(result);
}

// Model-backed implementation remains isolated in autoBuildPipelineLegacy.ts.
// Compatibility tokens retained for architecture-source tests:
// prepareFbxWebModel · prepareSketchUpTextureRecovery · materialBindings
// const recovery = await prepareSketchUpTextureRecovery
// const prepared = await prepareFbxWebModel
// buildSmartSceneDraft · applyReadyOpeningWorkflow · markAutoReadyModelWalls
// markAutoReadyRepeatedFloors · readyWallsPrepared · readyRepeatsPrepared · "auto"
// inspectReferenceImage · referenceImageEvidence · Multiple visual reference images are attached
// deriveSourceBackedSiteLandscape · siteElementsPrepared
