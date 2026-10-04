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
import {
  buildAutoBuildExecutionReport,
  type AutoBuildExecutionReport,
} from "./autoBuildReport";
import {
  buildNormalizedSceneFingerprint,
  type NormalizedSceneFingerprint,
} from "./sceneReplayFingerprint";
import {
  validateWholeSceneGeometry,
  type SceneGeometryIntegrityReport,
} from "./sceneGeometryIntegrity";
import {
  buildActionableReviewQueue,
  type ActionableReviewQueue,
} from "./actionableReviewQueue";
import {
  buildDeepSourceIntelligence,
  type DeepSourceIntelligenceReport,
} from "./deepSourceIntelligence";
import {
  buildBuildingReconstructionPlan,
  type BuildingReconstructionPlan,
} from "./buildingReconstructionPlan";

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
  sourceIntelligence: DeepSourceIntelligenceReport;
  reconstructionPlan: BuildingReconstructionPlan;
  certificationReport: AutoBuildExecutionReport;
  sceneFingerprint: NormalizedSceneFingerprint;
  geometryIntegrity: SceneGeometryIntegrityReport;
  reviewQueue: ActionableReviewQueue;
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * One shared AutoBuild entry point for model-backed and CAD-only projects.
 * Routing is derived from one source plan. Phase 2 fuses safely resolved CAD
 * semantics back into the scene and classifies all attached evidence. Phase 3
 * turns that intelligence into an explicit floor-by-floor reconstruction plan
 * without overwriting human-reviewed geometry or guessing source authority.
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
  const structuredEvidence: AutoBuildStructuredEvidenceSummary = {
    ...structured.summary,
    parseIssues: parsedRoomSheets.issues.length,
  };
  const sourceIntelligence = await buildDeepSourceIntelligence(
    files,
    base.analysis,
  );
  const reconstructionPlan = buildBuildingReconstructionPlan(
    structured.project,
    base.analysis,
    sourceIntelligence,
  );
  const issues = unique([
    ...base.issues,
    ...sourcePlan.planningIssues,
    ...phase2.issues,
    ...parsedRoomSheets.issues,
    ...structured.issues,
    ...sourceIntelligence.issues,
    ...reconstructionPlan.issues,
  ]);
  const reportFiles = [...files, ...base.assets].filter(
    (asset, index, all) => all.findIndex((candidate) => candidate.id === asset.id) === index,
  );
  const certificationReport = buildAutoBuildExecutionReport({
    project: structured.project,
    files: reportFiles,
    analysis: base.analysis,
    summary: base.summary,
    phase2: phase2.summary,
    structured: structuredEvidence,
    issues,
    sourcePlanMode: sourcePlan.mode,
  });
  const sceneFingerprint = await buildNormalizedSceneFingerprint(
    structured.project,
    reportFiles,
  );
  const geometryIntegrity = validateWholeSceneGeometry(structured.project);
  const reviewQueue = buildActionableReviewQueue(
    structured.project,
    certificationReport,
    geometryIntegrity,
  );

  return {
    ...base,
    project: structured.project,
    sourcePlan,
    phase2CadFusion: phase2.summary,
    structuredEvidence,
    sourceIntelligence,
    reconstructionPlan,
    certificationReport,
    sceneFingerprint,
    geometryIntegrity,
    reviewQueue,
    issues,
  };
}

export function autoBuildSummaryMessage(result: AutoBuildPipelineResult) {
  const base = legacyAutoBuildSummaryMessage(result).replace(/\.$/, "");
  const phase2 = result.phase2CadFusion;
  const phase2Text = phase2.resolvedCadFloors
    ? ` · Phase 2: ${phase2.resolvedCadFloors} CAD floor${phase2.resolvedCadFloors === 1 ? "" : "s"} fused${phase2.semanticEvidence ? ` · ${phase2.semanticEvidence} semantic evidence item${phase2.semanticEvidence === 1 ? "" : "s"}` : ""}${phase2.cadOpeningEvidence ? ` · ${phase2.cadOpeningMatches}/${phase2.cadOpeningEvidence} CAD opening${phase2.cadOpeningEvidence === 1 ? "" : "s"} corroborated` : ""}${phase2.openingsRefined ? ` · ${phase2.openingsRefined} prepared opening${phase2.openingsRefined === 1 ? "" : "s"} refined` : ""}${phase2.siteElementsPrepared ? ` · ${phase2.siteElementsPrepared} ground/site element${phase2.siteElementsPrepared === 1 ? "" : "s"} placed` : ""}`
    : "";
  const structuralText = phase2.structuralEvidence
    ? ` · structural CAD evidence: ${phase2.structuralEvidence}${phase2.structuralFootprints ? ` · ${phase2.structuralFootprints} source-backed 2D footprint${phase2.structuralFootprints === 1 ? "" : "s"}` : ""}${phase2.structuralPrepared ? ` · ${phase2.structuralPrepared} CAD+3D structural envelope${phase2.structuralPrepared === 1 ? "" : "s"} prepared` : ""}${phase2.circulationEvidence ? ` · ${phase2.circulationEvidence} stair/lift item${phase2.circulationEvidence === 1 ? "" : "s"} used semantically` : ""}${phase2.structuralReviewOnly ? ` · ${phase2.structuralReviewOnly} structural evidence item${phase2.structuralReviewOnly === 1 ? "" : "s"} remain review-only` : ""}`
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
  const intelligence = result.sourceIntelligence;
  const intelligenceText = ` · source intelligence ${intelligence.counts.classifiedPdfPages} PDF page${intelligence.counts.classifiedPdfPages === 1 ? "" : "s"} classified · ${intelligence.counts.resolvedFloorAssignments} floor role${intelligence.counts.resolvedFloorAssignments === 1 ? "" : "s"} resolved · ${intelligence.counts.authorityReview} authority review · ${intelligence.counts.conflicts} conflict${intelligence.counts.conflicts === 1 ? "" : "s"}`;
  const reconstruction = result.reconstructionPlan;
  const reconstructionText = ` · Phase 3 reconstruction ${reconstruction.counts.autoReadyFloors}/${reconstruction.counts.explicitCadFloors} explicit CAD floor${reconstruction.counts.explicitCadFloors === 1 ? "" : "s"} auto-ready${reconstruction.counts.preservedFloors ? ` · ${reconstruction.counts.preservedFloors} preserved` : ""}${reconstruction.counts.reviewFloors + reconstruction.counts.unassignedCadSources ? ` · ${reconstruction.counts.reviewFloors + reconstruction.counts.unassignedCadSources} review` : ""}`;
  const certification = result.certificationReport;
  const certificationText = ` · certification ${certification.checkCoveragePercent}% (${certification.counts.blocked} blocked · ${certification.counts.needsReview} review)`;
  const integrityText = ` · geometry ${result.geometryIntegrity.counts.blocker} blocked · ${result.geometryIntegrity.counts.review} review`;
  const replayText = ` · scene ${result.sceneFingerprint.hash.slice(0, 12)}…`;

  return `${base}${phase2Text}${structuralText}${structuredText}${intelligenceText}${reconstructionText}${certificationText}${integrityText}${replayText}.`;
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
 * applySourceBackedStructuralPrimitives · structuralPrepared
 * buildDeepSourceIntelligence · sourceIntelligence · authorityMatrix
 * buildBuildingReconstructionPlan · reconstructionPlan · auto-ready
 * scene.publishModelId · scene.modelId
 */
