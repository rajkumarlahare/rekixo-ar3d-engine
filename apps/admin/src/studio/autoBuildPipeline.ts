import type { Asset, Project } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import {
  autoBuildSummaryMessage as legacyAutoBuildSummaryMessage,
  runAutoBuildPipeline as runModelBackedAutoBuildPipeline,
  type AutoBuildPipelineOptions as LegacyAutoBuildPipelineOptions,
  type AutoBuildPipelineResult as LegacyAutoBuildPipelineResult,
} from "./autoBuildPipelineLegacy";
import { runCadOnlyAutoBuildPipeline } from "./cadOnlyAutoBuildPipeline";
import {
  buildAutoBuildSourcePlan,
  type AutoBuildSourcePlan,
} from "./autoBuildSourcePlan";
import {
  parseRoomSheetAssets,
  type RoomSheetRow,
} from "./roomSheet";
import {
  fuseRoomSheetEvidence,
  type RoomSheetFusionSummary,
} from "./roomSheetFusion";

export interface AutoBuildPipelineOptions
  extends LegacyAutoBuildPipelineOptions {
  /**
   * Optional pre-parsed structured evidence. Studio already parses room sheets
   * for Source Fusion, while API/tests may omit this and let AutoBuild parse the
   * attached CSV/TSV files itself.
   */
  roomSheetRows?: readonly RoomSheetRow[];
}

export interface AutoBuildStructuredEvidenceSummary
  extends RoomSheetFusionSummary {
  parseIssues: number;
}

export interface AutoBuildPipelineResult
  extends LegacyAutoBuildPipelineResult {
  sourcePlan: AutoBuildSourcePlan;
  structuredEvidence: AutoBuildStructuredEvidenceSummary;
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * One shared AutoBuild entry point for model-backed and CAD-only projects.
 * Routing is now derived from the same source plan that future processors can
 * consume, instead of each caller independently deciding which files matter.
 */
export async function runAutoBuildPipeline(
  project: Project,
  files: readonly Asset[],
  audits: readonly FbxSourceAudit[] = [],
  options: AutoBuildPipelineOptions = {},
): Promise<AutoBuildPipelineResult> {
  const sourcePlan = buildAutoBuildSourcePlan(project, files);
  const {
    roomSheetRows: suppliedRoomSheetRows,
    ...legacyOptions
  } = options;
  const parsedRoomSheets = suppliedRoomSheetRows
    ? {
        rows: [...suppliedRoomSheetRows],
        issues: [] as string[],
      }
    : await parseRoomSheetAssets([...files]);

  const base =
    sourcePlan.mode === "model-backed"
      ? await runModelBackedAutoBuildPipeline(
          project,
          files,
          audits,
          legacyOptions,
        )
      : await runCadOnlyAutoBuildPipeline(
          project,
          files,
          audits,
          legacyOptions,
        );

  const structured = fuseRoomSheetEvidence(
    base.project,
    parsedRoomSheets.rows,
  );

  return {
    ...base,
    project: structured.project,
    sourcePlan,
    structuredEvidence: {
      ...structured.summary,
      parseIssues: parsedRoomSheets.issues.length,
    },
    issues: unique([
      ...base.issues,
      ...sourcePlan.planningIssues,
      ...parsedRoomSheets.issues,
      ...structured.issues,
    ]),
  };
}

export function autoBuildSummaryMessage(result: AutoBuildPipelineResult) {
  const base = legacyAutoBuildSummaryMessage(result);
  const structured = result.structuredEvidence;
  if (!structured.rowCount) return base;

  const review =
    structured.conflicts +
    structured.ambiguous +
    structured.unmatched +
    structured.polygonReview +
    structured.parseIssues;
  return `${base} · CSV/TSV ${structured.applied}/${structured.matched} matched room measurement${structured.matched === 1 ? "" : "s"} applied${review ? ` · ${review} structured evidence item${review === 1 ? "" : "s"} need review` : ""}.`;
}

/**
 * The model-backed implementation intentionally lives in
 * autoBuildPipelineLegacy.ts so the mature source-recovery path stays stable
 * while the shared source plan and structured-evidence layer evolve around it.
 * These markers document delegated invariants that architecture source-gates
 * assert remain present.
 *
 * prepareFbxWebModel · prepareSketchUpTextureRecovery · materialBindings
 * const recovery = await prepareSketchUpTextureRecovery
 * const prepared = await prepareFbxWebModel
 * prepareDwgArchitectureDerivative · findDwgNormalizedDocument
 * rasterPdfReference · auto-plan-image · visible: false · metresPerPixel:
 * estimatePdfCadRegistration · estimateCadModelRegistration
 * applyPdfCadPoint · applyCadRegistrationPoint
 * pixelScaleAgreement <= 0.035 · pdfReferenceAutoAligned = true
 * buildSmartSceneDraft · applyReadyOpeningWorkflow · markAutoReadyModelWalls
 * markAutoReadyRepeatedFloors · readyWallsPrepared · readyRepeatsPrepared · "auto"
 * topologyIntersectionSplits · topology: delegated endpoint snap
 * inspectReferenceImage · referenceImageEvidence
 * Multiple visual reference images are attached
 * deriveSourceBackedSiteLandscape · siteElementsPrepared
 * scene.publishModelId · scene.modelId
 */
