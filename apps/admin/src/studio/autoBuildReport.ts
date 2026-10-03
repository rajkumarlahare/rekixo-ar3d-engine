import type { Asset, Project } from "./domain";
import type { SmartProjectAnalysis } from "./projectAnalyzer";
import type { Phase2CadFusionSummary } from "./phase2CadFusion";
import {
  GOLDEN_SOURCE_ROLES,
  assetMatchesGoldenRole,
  type GoldenSourceRole,
} from "./goldenSourceManifest";

export type AutoBuildReportStatus =
  | "passed"
  | "auto-derived"
  | "needs-review"
  | "blocked";

export interface AutoBuildReportCheck {
  key: string;
  group: "sources" | "processing" | "architecture" | "visual" | "review";
  label: string;
  status: AutoBuildReportStatus;
  detail: string;
}

export interface AutoBuildReportCounts {
  passed: number;
  autoDerived: number;
  needsReview: number;
  blocked: number;
}

export interface AutoBuildExecutionReport {
  overallStatus: "passed" | "needs-review" | "blocked";
  checkCoveragePercent: number;
  sourceRolesPresent: number;
  sourceRolesTotal: number;
  counts: AutoBuildReportCounts;
  checks: AutoBuildReportCheck[];
  blockers: string[];
  reviewItems: string[];
}

export interface AutoBuildReportSummaryInput {
  webModelPrepared: boolean;
  sketchUpTexturesRecovered: number;
  materialTexturesApplied: number;
  materialStylesApplied: number;
  resolvedExternalTextures: number;
  unresolvedExternalTextures: number;
  dwgProcessed: boolean;
  pdfPlanReferencesPrepared: number;
  pdfCadRegistrationConfidence: number;
  pdfCadRegistrationMatches: number;
  pdfReferenceAutoAligned: boolean;
  floors: number;
  walls: number;
  autoRooms: number;
  readyWallsPrepared: number;
  readyRepeatsPrepared: number;
  readyOpeningsPrepared: number;
  openingReviewRemaining: number;
  cadOpeningEvidence: number;
  cadOpeningMatches: number;
  cadOpeningReviewOnly: number;
  roomLabelsApplied: number;
  unitRoomsAssigned: number;
  unitGroupsDetected: number;
  roomSemanticReviewRemaining: number;
  autoFurniturePrepared: number;
  referenceImageEvidenceReady: boolean;
  siteElementsPrepared: number;
}

export interface AutoBuildStructuredEvidenceReportInput {
  rowCount: number;
  matched: number;
  applied: number;
  conflicts: number;
  ambiguous: number;
  unmatched: number;
  polygonReview: number;
  parseIssues: number;
}

export interface AutoBuildExecutionReportInput {
  project: Project;
  files: readonly Asset[];
  analysis: SmartProjectAnalysis;
  summary: AutoBuildReportSummaryInput;
  phase2: Phase2CadFusionSummary;
  structured: AutoBuildStructuredEvidenceReportInput;
  issues: readonly string[];
  sourcePlanMode: string;
}

function sourceRolePresence(files: readonly Asset[], role: GoldenSourceRole) {
  return files.some((file) => assetMatchesGoldenRole(file, role));
}

function check(
  key: string,
  group: AutoBuildReportCheck["group"],
  label: string,
  status: AutoBuildReportStatus,
  detail: string,
): AutoBuildReportCheck {
  return { key, group, label, status, detail };
}

function plural(count: number, singular: string, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

export function buildAutoBuildExecutionReport(
  input: AutoBuildExecutionReportInput,
): AutoBuildExecutionReport {
  const { project, files, analysis, summary, phase2, structured } = input;
  const checks: AutoBuildReportCheck[] = [];

  const invalidSourceRecords = files.filter(
    (file) =>
      file.projectId !== project.id ||
      !/^[a-f0-9]{64}$/i.test(file.hash) ||
      file.size !== file.blob.size ||
      file.size < 0,
  );
  checks.push(
    check(
      "source-integrity",
      "sources",
      "Source integrity",
      invalidSourceRecords.length ? "blocked" : "passed",
      invalidSourceRecords.length
        ? `${plural(invalidSourceRecords.length, "source record")} failed project/SHA-256/byte-size integrity checks.`
        : `${plural(files.length, "source/derived asset")} passed project/SHA-256/byte-size integrity checks.`,
    ),
  );

  const presentRoles = GOLDEN_SOURCE_ROLES.filter((role) =>
    sourceRolePresence(files, role),
  );
  checks.push(
    check(
      "six-role-source-pack",
      "sources",
      "Six-role source pack",
      presentRoles.length === GOLDEN_SOURCE_ROLES.length ? "passed" : "needs-review",
      presentRoles.length === GOLDEN_SOURCE_ROLES.length
        ? "FBX/GLB, CAD, SketchUp, PDF, visual reference and render metadata roles are all present."
        : `${presentRoles.length}/${GOLDEN_SOURCE_ROLES.length} golden source roles are present; missing roles stay explicit instead of being invented.`,
    ),
  );

  if (input.sourcePlanMode === "model-backed") {
    checks.push(
      check(
        "authoring-model",
        "processing",
        "Authoring model",
        analysis.modelAssetId ? "passed" : "blocked",
        analysis.modelAssetId
          ? `${analysis.modelName ?? "Selected model"} is resolved as the authoring model.`
          : "Model-backed AutoBuild did not resolve one authoring model.",
      ),
    );

    const publishModel = project.scene.publishModelId
      ? files.find((file) => file.id === project.scene.publishModelId)
      : undefined;
    const webModelReady = Boolean(publishModel && /\.glb$/i.test(publishModel.name));
    checks.push(
      check(
        "web-model",
        "processing",
        "Web model",
        webModelReady
          ? summary.webModelPrepared
            ? "auto-derived"
            : "passed"
          : "blocked",
        webModelReady
          ? `${publishModel!.name} is selected as the web-safe publication model${summary.webModelPrepared ? " and was prepared automatically in this build" : ""}.`
          : "A model-backed build has no GLB publication model; certification cannot treat the model path as complete.",
      ),
    );
  }

  const hasDwg = files.some((file) => /\.dwg$/i.test(file.name));
  if (hasDwg) {
    const readyDwg = analysis.cadAudits.filter(
      (audit) => audit.kind === "dwg" && audit.geometryReady,
    );
    checks.push(
      check(
        "dwg-architecture",
        "processing",
        "DWG architecture",
        readyDwg.length
          ? summary.dwgProcessed
            ? "auto-derived"
            : "passed"
          : "blocked",
        readyDwg.length
          ? `${plural(readyDwg.length, "DWG source")} has normalized editable geometry${summary.dwgProcessed ? "; native processing completed in this build" : "; an existing source-bound derivative was reused"}.`
          : "DWG is attached, but no normalized DWG geometry is ready. The build must not claim full six-file certification.",
      ),
    );
  }

  const hasSketchUp = files.some((file) => /\.(?:skp|skb)$/i.test(file.name));
  if (hasSketchUp) {
    const recovered =
      summary.sketchUpTexturesRecovered +
      summary.materialTexturesApplied +
      summary.materialStylesApplied;
    checks.push(
      check(
        "sketchup-material-recovery",
        "processing",
        "SketchUp material recovery",
        recovered > 0 ? "auto-derived" : "needs-review",
        recovered > 0
          ? `${plural(summary.sketchUpTexturesRecovered, "texture")} recovered; ${plural(summary.materialTexturesApplied, "material texture")} and ${plural(summary.materialStylesApplied, "material style")} applied.`
          : "SketchUp source is attached, but this build did not apply recoverable texture/style evidence; verify whether the source actually contains usable material data.",
      ),
    );
  }

  if (summary.unresolvedExternalTextures > 0) {
    checks.push(
      check(
        "external-textures",
        "processing",
        "External textures",
        "needs-review",
        `${summary.resolvedExternalTextures} external FBX texture references resolved; ${summary.unresolvedExternalTextures} remain unresolved with neutral fallback.`,
      ),
    );
  } else if (summary.resolvedExternalTextures > 0) {
    checks.push(
      check(
        "external-textures",
        "processing",
        "External textures",
        "auto-derived",
        `${plural(summary.resolvedExternalTextures, "external texture reference")} resolved automatically.`,
      ),
    );
  }

  const hasPdf = files.some((file) => /\.pdf$/i.test(file.name));
  if (hasPdf) {
    checks.push(
      check(
        "pdf-plan-extraction",
        "processing",
        "PDF plan extraction",
        summary.pdfPlanReferencesPrepared > 0 ? "auto-derived" : "needs-review",
        summary.pdfPlanReferencesPrepared > 0
          ? `${plural(summary.pdfPlanReferencesPrepared, "plan reference")} prepared from PDF evidence.`
          : "PDF is attached, but no plan reference was prepared automatically in this build.",
      ),
    );
  }

  const hasCad = files.some((file) => /\.(?:dwg|dxf)$/i.test(file.name));
  if (hasPdf && hasCad) {
    checks.push(
      check(
        "pdf-cad-registration",
        "processing",
        "PDF ↔ CAD alignment",
        summary.pdfReferenceAutoAligned ? "auto-derived" : "needs-review",
        summary.pdfReferenceAutoAligned
          ? `Reference alignment accepted automatically from ${summary.pdfCadRegistrationMatches} evidence matches at ${Math.round(summary.pdfCadRegistrationConfidence * 100)}% confidence.`
          : summary.pdfCadRegistrationMatches > 0
            ? `${summary.pdfCadRegistrationMatches} PDF/CAD evidence matches were found, but alignment stayed review-only at ${Math.round(summary.pdfCadRegistrationConfidence * 100)}% confidence.`
            : "PDF/CAD alignment did not reach a safe automatic registration; manual review remains required.",
      ),
    );
  }

  checks.push(
    check(
      "floors",
      "architecture",
      "Floors",
      summary.floors > 0 ? "auto-derived" : "blocked",
      summary.floors > 0
        ? `${plural(summary.floors, "floor")} reconstructed/prepared by AutoBuild.`
        : "AutoBuild did not produce any floor entity.",
    ),
  );

  const sceneWalls = project.scene.walls?.length ?? 0;
  checks.push(
    check(
      "walls",
      "architecture",
      "Walls",
      summary.walls > 0
        ? "auto-derived"
        : sceneWalls > 0
          ? "passed"
          : "blocked",
      summary.walls > 0
        ? `${plural(summary.walls, "wall")} prepared automatically; ${summary.readyWallsPrepared} are auto-ready for human acceptance.`
        : sceneWalls > 0
          ? `${plural(sceneWalls, "wall")} already exists in the scene; no new wall was reconstructed this run.`
          : "No wall topology is available after AutoBuild.",
    ),
  );

  const roomCount = project.scene.rooms.length;
  checks.push(
    check(
      "rooms",
      "architecture",
      "Rooms",
      summary.autoRooms > 0
        ? "auto-derived"
        : roomCount > 0
          ? "passed"
          : "needs-review",
      summary.autoRooms > 0
        ? `${plural(summary.autoRooms, "room")} reconstructed automatically.`
        : roomCount > 0
          ? `${plural(roomCount, "room")} already exists in the scene; no new room polygon was reconstructed this run.`
          : "No reliable room geometry was reconstructed; room mapping remains a review task.",
    ),
  );

  const openingCount = project.scene.openings?.length ?? 0;
  const openingPrepared = summary.readyOpeningsPrepared + phase2.openingsPrepared + phase2.openingsRefined;
  checks.push(
    check(
      "openings",
      "architecture",
      "Doors / windows",
      openingPrepared > 0
        ? "auto-derived"
        : openingCount > 0
          ? "passed"
          : "needs-review",
      openingPrepared > 0
        ? `${plural(openingPrepared, "opening operation")} prepared/refined automatically; ${summary.openingReviewRemaining + summary.cadOpeningReviewOnly} candidates remain review-only.`
        : openingCount > 0
          ? `${plural(openingCount, "opening")} already exists in the scene.`
          : summary.cadOpeningEvidence > 0
            ? `${plural(summary.cadOpeningEvidence, "CAD opening evidence item")} exists, but none became a safe editable opening automatically.`
            : "No safe door/window reconstruction is available yet.",
    ),
  );

  if (roomCount > 0) {
    const unitEvidence = summary.unitRoomsAssigned + phase2.unitRoomsAssigned;
    const semanticEvidence = summary.roomLabelsApplied + phase2.roomLabelsApplied;
    checks.push(
      check(
        "room-unit-semantics",
        "architecture",
        "Room / unit semantics",
        unitEvidence + semanticEvidence > 0 ? "auto-derived" : "needs-review",
        unitEvidence + semanticEvidence > 0
          ? `${plural(semanticEvidence, "room label")} applied and ${plural(unitEvidence, "room-to-unit assignment")} resolved from source evidence.`
          : "Rooms exist, but this build did not resolve room labels/unit hierarchy from source evidence.",
      ),
    );
  }

  if (phase2.structuralEvidence > 0) {
    checks.push(
      check(
        "structural-evidence",
        "architecture",
        "Structural primitives",
        phase2.structuralPrepared > 0 ? "auto-derived" : "needs-review",
        phase2.structuralPrepared > 0
          ? `${phase2.structuralPrepared}/${phase2.structuralEvidence} structural evidence items became source-backed 3D envelopes; ${phase2.structuralReviewOnly} remain review-only.`
          : `${plural(phase2.structuralEvidence, "structural evidence item")} was detected, but no safe 3D structural envelope was prepared automatically.`,
      ),
    );
  }

  const hasVisual = sourceRolePresence(files, "visual");
  if (hasVisual) {
    checks.push(
      check(
        "reference-visual",
        "visual",
        "Reference visual evidence",
        summary.referenceImageEvidenceReady || project.scene.referenceImageEvidence
          ? summary.referenceImageEvidenceReady
            ? "auto-derived"
            : "passed"
          : "needs-review",
        summary.referenceImageEvidenceReady || project.scene.referenceImageEvidence
          ? "Reference image palette/lighting evidence is available as non-dimensional visual guidance."
          : "A visual reference is attached, but no sufficiently confident image evidence was stored automatically.",
      ),
    );
  }

  if (summary.autoFurniturePrepared > 0) {
    checks.push(
      check(
        "auto-interior",
        "visual",
        "Automatic interior draft",
        "auto-derived",
        `${plural(summary.autoFurniturePrepared, "furniture item")} prepared from room-aware automatic interior rules.`,
      ),
    );
  }

  if (summary.siteElementsPrepared + phase2.siteElementsPrepared > 0) {
    const prepared = summary.siteElementsPrepared + phase2.siteElementsPrepared;
    checks.push(
      check(
        "site-elements",
        "visual",
        "Site / landscape evidence",
        "auto-derived",
        `${plural(prepared, "site element")} prepared from source-backed site evidence.`,
      ),
    );
  }

  if (structured.rowCount > 0) {
    const structuredReview =
      structured.conflicts +
      structured.ambiguous +
      structured.unmatched +
      structured.polygonReview +
      structured.parseIssues;
    checks.push(
      check(
        "structured-room-evidence",
        "architecture",
        "Structured room evidence",
        structuredReview === 0 && structured.applied > 0
          ? "auto-derived"
          : "needs-review",
        `${structured.applied}/${structured.matched} matched room measurements applied; ${structuredReview} structured evidence items need review.`,
      ),
    );
  }

  const reviewBurden =
    input.issues.length +
    summary.openingReviewRemaining +
    summary.cadOpeningReviewOnly +
    summary.roomSemanticReviewRemaining +
    phase2.structuralReviewOnly +
    structured.conflicts +
    structured.ambiguous +
    structured.unmatched +
    structured.polygonReview +
    structured.parseIssues;
  checks.push(
    check(
      "review-queue",
      "review",
      "Review queue",
      reviewBurden > 0 ? "needs-review" : "passed",
      reviewBurden > 0
        ? `${plural(reviewBurden, "review signal")} remain explicit; AutoBuild did not silently promote them to verified facts.`
        : "No unresolved review signal was reported by this AutoBuild pass.",
    ),
  );

  const counts = checks.reduce<AutoBuildReportCounts>(
    (value, row) => {
      if (row.status === "passed") value.passed += 1;
      else if (row.status === "auto-derived") value.autoDerived += 1;
      else if (row.status === "needs-review") value.needsReview += 1;
      else value.blocked += 1;
      return value;
    },
    { passed: 0, autoDerived: 0, needsReview: 0, blocked: 0 },
  );
  const completeChecks = counts.passed + counts.autoDerived;
  const checkCoveragePercent = checks.length
    ? Math.round((completeChecks / checks.length) * 100)
    : 0;
  const overallStatus = counts.blocked
    ? "blocked"
    : counts.needsReview
      ? "needs-review"
      : "passed";

  return {
    overallStatus,
    checkCoveragePercent,
    sourceRolesPresent: presentRoles.length,
    sourceRolesTotal: GOLDEN_SOURCE_ROLES.length,
    counts,
    checks,
    blockers: checks
      .filter((row) => row.status === "blocked")
      .map((row) => `${row.label}: ${row.detail}`),
    reviewItems: checks
      .filter((row) => row.status === "needs-review")
      .map((row) => `${row.label}: ${row.detail}`),
  };
}
