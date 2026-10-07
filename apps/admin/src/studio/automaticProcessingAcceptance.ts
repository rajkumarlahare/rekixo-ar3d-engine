import type { AutoBuildExecutionReport } from "./autoBuildReport";
import type { AutoBuildSourcePlan } from "./autoBuildSourcePlan";
import type { CirculationHierarchyReport } from "./circulationHierarchy";
import type { SceneGeometryIntegrityReport } from "./sceneGeometryIntegrity";
import type { UnitHierarchyReport } from "./unitHierarchy";

export type AutomaticProcessingAcceptanceStatus =
  | "accepted"
  | "review-required"
  | "blocked";

export interface AutomaticProcessingAcceptanceGate {
  key: string;
  status: "passed" | "review" | "blocked";
  detail: string;
}

export interface AutomaticProcessingAcceptance {
  schema: 1;
  kind: "rekixo-automatic-processing-acceptance";
  status: AutomaticProcessingAcceptanceStatus;
  canBuildPresentation: boolean;
  canPublishWithoutReview: boolean;
  gates: AutomaticProcessingAcceptanceGate[];
  blockers: string[];
  reviewItems: string[];
}

export interface AutomaticProcessingAcceptanceInput {
  sourcePlan: AutoBuildSourcePlan;
  certificationReport: AutoBuildExecutionReport;
  geometryIntegrity: SceneGeometryIntegrityReport;
  circulationHierarchy: CirculationHierarchyReport;
  unitHierarchy: UnitHierarchyReport;
  sceneFingerprint: string;
}

function gate(
  key: string,
  status: AutomaticProcessingAcceptanceGate["status"],
  detail: string,
): AutomaticProcessingAcceptanceGate {
  return { key, status, detail };
}

function sourceAuthorityGate(
  sourcePlan: AutoBuildSourcePlan,
): AutomaticProcessingAcceptanceGate {
  if (sourcePlan.mode === "model-backed") {
    return sourcePlan.selectedModelAssetId
      ? gate(
          "source-authority",
          "passed",
          `Explicit model authority is ${sourcePlan.selectedModelAssetId}.`,
        )
      : gate(
          "source-authority",
          "blocked",
          "Model-backed processing requires one unambiguous selected geometry-authority model.",
        );
  }

  const cadCount =
    sourcePlan.groups.find((group) => group.role === "cad")?.assetIds.length ?? 0;
  return cadCount > 0
    ? gate(
        "source-authority",
        "review",
        `${cadCount} CAD source${cadCount === 1 ? "" : "s"} are available, but CAD-only reconstruction remains review-gated before publication.`,
      )
    : gate(
        "source-authority",
        "blocked",
        "Processing has neither a selected model authority nor a CAD reconstruction source.",
      );
}

/**
 * Final R2 acceptance boundary. It composes existing source, geometry and
 * hierarchy reports without mutating geometry or converting automatic evidence
 * into human review. Reviewable evidence may proceed to preview/presentation,
 * but only a completely accepted result may be treated as publish-ready.
 */
export function buildAutomaticProcessingAcceptance(
  input: AutomaticProcessingAcceptanceInput,
): AutomaticProcessingAcceptance {
  const gates: AutomaticProcessingAcceptanceGate[] = [
    sourceAuthorityGate(input.sourcePlan),
  ];

  gates.push(
    gate(
      "source-processing",
      input.certificationReport.overallStatus === "blocked"
        ? "blocked"
        : input.certificationReport.overallStatus === "needs-review"
          ? "review"
          : "passed",
      input.certificationReport.overallStatus === "passed"
        ? "Source processing certification passed."
        : input.certificationReport.overallStatus === "blocked"
          ? `${input.certificationReport.counts.blocked} processing check${input.certificationReport.counts.blocked === 1 ? "" : "s"} are blocking.`
          : `${input.certificationReport.counts.needsReview} processing check${input.certificationReport.counts.needsReview === 1 ? "" : "s"} require review.`,
    ),
  );

  gates.push(
    gate(
      "metric-geometry",
      input.geometryIntegrity.counts.blocker > 0
        ? "blocked"
        : input.geometryIntegrity.counts.review > 0
          ? "review"
          : "passed",
      input.geometryIntegrity.counts.blocker > 0
        ? `${input.geometryIntegrity.counts.blocker} geometry blocker${input.geometryIntegrity.counts.blocker === 1 ? "" : "s"} must be resolved.`
        : input.geometryIntegrity.counts.review > 0
          ? `${input.geometryIntegrity.counts.review} geometry item${input.geometryIntegrity.counts.review === 1 ? "" : "s"} require review.`
          : "Scene geometry integrity passed in canonical project metres.",
    ),
  );

  const validFingerprint = /^[a-f0-9]{64}$/.test(input.sceneFingerprint);
  gates.push(
    gate(
      "deterministic-scene",
      validFingerprint ? "passed" : "blocked",
      validFingerprint
        ? `Normalized scene fingerprint ${input.sceneFingerprint.slice(0, 12)}… is available.`
        : "A valid normalized scene fingerprint is required before automatic presentation.",
    ),
  );

  const hierarchyReview =
    input.circulationHierarchy.counts.reviewCores +
    input.circulationHierarchy.counts.unresolvedFloorEvidence +
    input.unitHierarchy.counts.reviewUnits +
    input.unitHierarchy.counts.unprovenUnitRooms +
    input.unitHierarchy.counts.unresolvedCirculationMembers;
  gates.push(
    gate(
      "source-backed-hierarchy",
      hierarchyReview > 0 ? "review" : "passed",
      hierarchyReview > 0
        ? `${hierarchyReview} hierarchy evidence item${hierarchyReview === 1 ? "" : "s"} remain explicitly review-gated; no unit/circulation geometry was invented.`
        : `${input.unitHierarchy.counts.sourceBackedUnits} source-backed unit${input.unitHierarchy.counts.sourceBackedUnits === 1 ? "" : "s"} and ${input.circulationHierarchy.counts.boundCores} bound circulation core${input.circulationHierarchy.counts.boundCores === 1 ? "" : "s"} are deterministic.`,
    ),
  );

  const blockers = gates
    .filter((item) => item.status === "blocked")
    .map((item) => item.detail);
  const reviewItems = gates
    .filter((item) => item.status === "review")
    .map((item) => item.detail);
  const status: AutomaticProcessingAcceptanceStatus = blockers.length
    ? "blocked"
    : reviewItems.length
      ? "review-required"
      : "accepted";

  return {
    schema: 1,
    kind: "rekixo-automatic-processing-acceptance",
    status,
    canBuildPresentation: blockers.length === 0,
    canPublishWithoutReview: status === "accepted",
    gates,
    blockers,
    reviewItems,
  };
}
