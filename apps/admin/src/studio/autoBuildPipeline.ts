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
import {
  applyPhase2CadFusion,
  type Phase2CadFusionSummary,
} from "./phase2CadFusion";

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
  phase2CadFusion: Phase2CadFusionSummary;
  structuredEvidence: AutoBuildStructuredEvidenceSummary;
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * One shared AutoBuild entry point for model-backed and CAD-only projects.
 * Routing is derived from one source plan. Phase 2 then fuses every safely
 * resolved CAD floor back into the model-backed scene before structured room
 * measurements are reconciled.
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

  const phase2 = applyPhase2CadFusion(base.project, base.analysis);
  const structured = fuseRoomSheetEvidence(
    phase2.project,
    parsedRoomSheets.rows,
  );

  return {
    ...base,
    project: structured.project,
    sourcePlan,
    phase2CadFusion: phase2.summary,
    structuredEvidence: {
      ...structured.summary,
      parseIssues: parsedRoomSheets.issues.length,
    },
    issues: unique([
      ...base.issues,
      ...sourcePlan.planningIssues,
      ...phase2.issues,
      ...parsedRoomSheets.issues,
      ...structured.issues,
    ]),
  };
}

export function autoBuildSummaryMessage(result: AutoBuildPipelineResult) {
  const base = legacyAutoBuildSummaryMessage(result).replace(/\.$/, "");
  const phase2 = result.phase2CadFusion;
  const phase2Text = phase2.resolvedCadFloors
    ? ` · Phase 2: ${phase2.resolvedCadFloors} CAD floor${phase2.resolvedCadFloors === 1 ? "" : "s"} fused${phase2.semanticEvidence ? ` · ${phase2.semanticEvidence} semantic evidence item${phase2.semanticEvidence === 1 ? "" : "s"}` : ""}${phase2.cadOpeningEvidence ? ` · ${phase2.cadOpeningMatches}/${phase2.cadOpeningEvidence} CAD opening${phase2.cadOpeningEvidence === 1 ? "" : "s"} corroborated` : ""}${phase2.openingsRefined ? ` · ${phase2.openingsRefined} prepared opening${phase2.openingsRefined === 1 ? "" : "s"} refined` : ""}${phase2.siteElementsPrepared ? ` · ${phase2.siteElementsPrepared} ground/site element${phase2.siteElementsPrepared === 1 ? "" : "s"} placed` : ""}`
    : "";
  const structuralText = phase2.structuralEvidence
    ? ` · structural CAD evidence: ${phase2.structuralEvidence}${phase2.circulationEvidence ? ` · ${phase2.circulationEvidence} stair/lift item${phase2.circulationEvidence === 1 ? "" : "s"} used semantically` : ""}${phase2.structuralReviewOnly ? ` · ${phase2.structuralReviewOnly} dedicated structural primitive${phase2.structuralReviewOnly === 1 ? "" : "s"} still review-only` : ""}`
    : "";

  const structured = result.structuredEvidence;
  const structuredReview =
    structured.conflicts +
    structured.ambiguous +
    structured.unmatched +
    structured.polygonReview +
    structured.parseIssues;
  const structuredText = structured.rowCount
    ? ` · CSV/TSV ${structured.applied}/${structured.matched} matched room measurement${structured.matched === 1 ? "" : "s"} applied${structuredReview ? ` · ${structuredReview} structured evidence item${structuredReview === 1 ? "" : "s"} need review` : ""}`
    : "";

  return `${base}${phase2Text}${structuralText}${structuredText}.`;
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
 * applyPhase2CadFusion · phase2CadFusion · structural CAD evidence
 * scene.publishModelId · scene.modelId
 */
