import { id, type Project, type RoomPoint, type Scene } from "./domain";
import {
  suggestOpeningAssociations,
  type OpeningSuggestion,
} from "./openingAssociator";
import { applyReadyOpeningWorkflow } from "./openingWorkflow";
import { fuseCadOpeningEvidence } from "./cadOpeningFusion";
import {
  applyRoomSemanticEvidence,
  classifyRoomSemanticText,
  type RoomSemanticEvidence,
} from "./roomSemanticBinding";
import {
  applyCadRegistrationPoint,
  estimateCadModelRegistration,
  type CadModelRegistration,
} from "./sourceRegistration";
import { resolveCadFloorIndex } from "./architectureGraph";
import {
  deriveSourceBackedSiteLandscape,
} from "./siteLandscapeDraft";
import { classifySiteSemantic } from "./siteSemantics";
import type {
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";

export interface Phase2CadFusionSummary {
  resolvedCadFloors: number;
  semanticCadFloors: number;
  semanticEvidence: number;
  roomLabelsApplied: number;
  unitRoomsAssigned: number;
  circulationEvidence: number;
  cadOpeningEvidence: number;
  cadOpeningMatches: number;
  cadOpeningReviewOnly: number;
  openingsPrepared: number;
  openingsRefined: number;
  siteElementsPrepared: number;
  siteElementsReady: number;
  structuralEvidence: number;
  structuralReviewOnly: number;
}

export interface Phase2CadFusionResult {
  project: Project;
  summary: Phase2CadFusionSummary;
  issues: string[];
}

interface ResolvedCadFloor {
  audit: SmartCadAudit;
  floorIndex: number;
  floorId: string;
  floorElevation: number;
  registration: CadModelRegistration;
}

const STRUCTURAL_KINDS = new Set([
  "stair",
  "lift",
  "column",
  "slab",
  "roof",
  "duct",
  "balcony",
  "gate",
]);

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function structuralRows(audit: SmartCadAudit) {
  const document = audit.normalizedDwg;
  if (!document) return [];
  return [
    ...document.objects.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
    })),
    ...document.inserts.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
    })),
  ].filter((entry) => STRUCTURAL_KINDS.has(entry.kind));
}

export function phase2StructuralEvidenceCounts(
  analysis: Pick<SmartProjectAnalysis, "cadAudits">,
) {
  let structuralEvidence = 0;
  let circulationEvidence = 0;
  for (const audit of analysis.cadAudits) {
    for (const entry of structuralRows(audit)) {
      structuralEvidence += 1;
      if (entry.kind === "stair" || entry.kind === "lift")
        circulationEvidence += 1;
    }
  }
  return {
    structuralEvidence,
    circulationEvidence,
    structuralReviewOnly: Math.max(
      0,
      structuralEvidence - circulationEvidence,
    ),
  };
}

function resolveModelBackedCadFloors(
  analysis: SmartProjectAnalysis,
  scene: Scene,
) {
  const resolved: ResolvedCadFloor[] = [];
  const issues: string[] = [];
  const seenFloors = new Set<number>();

  for (const audit of analysis.cadAudits) {
    if (
      (audit.kind !== "dwg" && audit.kind !== "dxf") ||
      !audit.geometryReady
    )
      continue;
    const floorIndex = resolveCadFloorIndex(audit, scene.floors.length);
    if (floorIndex === undefined || !scene.floors[floorIndex]) {
      issues.push(
        `CAD “${audit.name}” could not be assigned to one model floor safely; cross-source fusion stayed review-only.`,
      );
      continue;
    }
    if (seenFloors.has(floorIndex)) {
      issues.push(
        `More than one CAD source resolves to ${scene.floors[floorIndex].name}; Rekixo will not silently mix competing floor plans.`,
      );
      continue;
    }
    const registration = estimateCadModelRegistration(
      analysis,
      audit,
      floorIndex,
      scene.scale,
      scene.modelTransform,
    );
    if (
      !registration.compatible ||
      registration.ambiguous ||
      registration.confidence < 0.68
    ) {
      issues.push(
        `CAD “${audit.name}” resolves to ${scene.floors[floorIndex].name}, but CAD↔3D registration is not reliable enough for automatic fusion.`,
      );
      continue;
    }
    seenFloors.add(floorIndex);
    resolved.push({
      audit,
      floorIndex,
      floorId: scene.floors[floorIndex].id,
      floorElevation: scene.floors[floorIndex].elevation,
      registration,
    });
  }

  return { resolved, issues };
}

function semanticEvidenceForFloor(
  row: ResolvedCadFloor,
): RoomSemanticEvidence[] {
  const result: RoomSemanticEvidence[] = [];
  const confidence = Math.min(
    0.98,
    0.08 + row.registration.confidence * 0.9,
  );

  for (let index = 0; index < (row.audit.textLabels ?? []).length; index += 1) {
    const label = row.audit.textLabels![index];
    const semantic = classifyRoomSemanticText(label.text);
    if (!semantic.roomName && !semantic.unitName) continue;
    const point = applyCadRegistrationPoint(
      label.point,
      row.registration.sourceCentre,
      row.registration.targetCentre,
      row.registration.rotationDeg,
    );
    result.push({
      id: `phase2-cad-text-${row.audit.assetId}-${index + 1}`,
      floorId: row.floorId,
      point,
      text: label.text,
      sourceAssetId: row.audit.assetId,
      source: "cad-text",
      confidence,
      ...semantic,
    });
  }

  const document = row.audit.normalizedDwg;
  if (!document) return result;
  const circulation = [
    ...document.inserts
      .filter((entry) => entry.kind === "stair" || entry.kind === "lift")
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        point: entry.point,
        text: entry.name,
        confidence: entry.confidence,
      })),
    ...document.objects
      .filter((entry) => entry.kind === "stair" || entry.kind === "lift")
      .flatMap((entry) => {
        const point: RoomPoint | undefined =
          entry.point ??
          (entry.bounds
            ? [
                (entry.bounds.min[0] + entry.bounds.max[0]) / 2,
                (entry.bounds.min[1] + entry.bounds.max[1]) / 2,
              ]
            : undefined);
        return point
          ? [
              {
                id: entry.id,
                kind: entry.kind,
                point,
                text: entry.sourceEntity,
                confidence: entry.confidence,
              },
            ]
          : [];
      }),
  ];

  for (const entry of circulation) {
    const point = applyCadRegistrationPoint(
      entry.point,
      row.registration.sourceCentre,
      row.registration.targetCentre,
      row.registration.rotationDeg,
    );
    result.push({
      id: `phase2-cad-object-${row.audit.assetId}-${entry.id}`,
      floorId: row.floorId,
      point,
      text: entry.text,
      sourceAssetId: row.audit.assetId,
      source: "cad-object",
      confidence: Math.min(
        confidence,
        entry.confidence * 0.85 + row.registration.confidence * 0.15,
      ),
      roomName: entry.kind === "lift" ? "Lift" : "Stair",
    });
  }

  return result;
}

function sourceKey(value: {
  sourceNodeName?: string;
  sourceOccurrence?: number;
}) {
  return `${value.sourceNodeName ?? ""}\u0000${value.sourceOccurrence ?? 0}`;
}

function refinePreparedOpenings(
  scene: Scene,
  suggestions: readonly OpeningSuggestion[],
) {
  const ready = new Map(
    suggestions
      .filter(
        (suggestion) =>
          suggestion.ready &&
          suggestion.floorId &&
          suggestion.roomIds.length > 0,
      )
      .map((suggestion) => [sourceKey(suggestion), suggestion] as const),
  );
  let refined = 0;
  const openings = (scene.openings ?? []).map((opening) => {
    if (
      opening.reviewed ||
      !opening.sourceNodeName ||
      opening.sourceOccurrence === undefined
    )
      return opening;
    const suggestion = ready.get(sourceKey(opening));
    if (
      !suggestion ||
      suggestion.floorId !== opening.floorId ||
      suggestion.confidence + 0.001 < (opening.confidence ?? 0)
    )
      return opening;
    const moved =
      Math.hypot(suggestion.position[0] - opening.x, suggestion.position[2] - opening.z) >
        0.01 ||
      Math.abs(suggestion.width - opening.width) > 0.01 ||
      Math.abs(suggestion.rotationY - opening.rotationY) > 0.5;
    if (!moved) return opening;
    refined += 1;
    return {
      ...opening,
      roomIds: [...suggestion.roomIds],
      x: suggestion.position[0],
      z: suggestion.position[2],
      width: suggestion.width,
      rotationY: suggestion.rotationY,
      confidence: suggestion.confidence,
      reviewState: "auto_ready" as const,
    };
  });
  return { scene: { ...scene, openings }, refined };
}

function auditHasSiteEvidence(audit: SmartCadAudit) {
  const document = audit.normalizedDwg;
  if (!document) return false;
  return (
    document.objects.some((entry) =>
      Boolean(
        classifySiteSemantic(
          [entry.layer, entry.sourceEntity, entry.kind].join(" "),
        ),
      ),
    ) ||
    document.inserts.some((entry) =>
      Boolean(
        classifySiteSemantic(
          [entry.layer, entry.name, entry.kind].join(" "),
        ),
      ),
    )
  );
}

/**
 * Phase 2 cross-source fusion deliberately runs after the mature model-backed
 * AutoBuild. It adds evidence from several explicitly resolved CAD floors
 * without weakening the existing fail-closed rules or touching human-reviewed
 * geometry.
 */
export function applyPhase2CadFusion(
  project: Project,
  analysis: SmartProjectAnalysis,
): Phase2CadFusionResult {
  const counts = phase2StructuralEvidenceCounts(analysis);
  const empty: Phase2CadFusionSummary = {
    resolvedCadFloors: 0,
    semanticCadFloors: 0,
    semanticEvidence: 0,
    roomLabelsApplied: 0,
    unitRoomsAssigned: 0,
    circulationEvidence: counts.circulationEvidence,
    cadOpeningEvidence: 0,
    cadOpeningMatches: 0,
    cadOpeningReviewOnly: 0,
    openingsPrepared: 0,
    openingsRefined: 0,
    siteElementsPrepared: 0,
    siteElementsReady: 0,
    structuralEvidence: counts.structuralEvidence,
    structuralReviewOnly: counts.structuralReviewOnly,
  };

  // CAD-only reconstruction already resolves every CAD plan while building the
  // parametric scene. Re-running model registration there would manufacture a
  // second coordinate system, so Phase 2 only supplements model-backed builds.
  if (!analysis.modelAssetId)
    return { project, summary: empty, issues: [] };

  const resolution = resolveModelBackedCadFloors(analysis, project.scene);
  if (!resolution.resolved.length)
    return {
      project,
      summary: empty,
      issues: unique(resolution.issues),
    };

  let scene = project.scene;
  const issues = [...resolution.issues];
  const semanticEvidence = resolution.resolved.flatMap(semanticEvidenceForFloor);
  let semanticCadFloors = 0;
  let roomLabelsApplied = 0;
  let unitRoomsAssigned = 0;
  if (semanticEvidence.length) {
    const semantics = applyRoomSemanticEvidence(scene, semanticEvidence);
    scene = semantics.scene;
    semanticCadFloors = new Set(semanticEvidence.map((entry) => entry.floorId)).size;
    roomLabelsApplied = semantics.roomNamesApplied;
    unitRoomsAssigned = semantics.unitRoomsAssigned;
    if (semantics.reviewRemaining)
      issues.push(
        `${semantics.reviewRemaining} multi-CAD room/unit semantic item${semantics.reviewRemaining === 1 ? "" : "s"} remain review-only because source evidence is ambiguous or conflicts.`,
      );
  }

  let suggestions = suggestOpeningAssociations(analysis, scene);
  let cadOpeningEvidence = 0;
  let cadOpeningMatches = 0;
  let cadOpeningReviewOnly = 0;
  for (const row of resolution.resolved) {
    if (
      !(row.audit.semanticSegments ?? []).some(
        (segment) => segment.kind === "door" || segment.kind === "window",
      )
    )
      continue;
    const fusion = fuseCadOpeningEvidence(
      suggestions,
      row.audit,
      row.floorId,
      row.floorElevation,
      scene,
      row.registration,
    );
    suggestions = fusion.suggestions;
    cadOpeningEvidence += fusion.cadEvidence;
    cadOpeningMatches += fusion.matched;
    cadOpeningReviewOnly += fusion.cadOnlyReview;
  }

  const workflow = applyReadyOpeningWorkflow(
    scene,
    analysis.architecturalCandidates,
    suggestions,
    id,
    "auto",
  );
  scene = workflow.scene;
  const refined = refinePreparedOpenings(scene, suggestions);
  scene = refined.scene;

  const groundSiteRows = resolution.resolved.filter(
    (row) => row.floorIndex === 0 && auditHasSiteEvidence(row.audit),
  );
  let siteElementsPrepared = 0;
  let siteElementsReady = 0;
  if (groundSiteRows.length === 1) {
    const site = deriveSourceBackedSiteLandscape(
      { ...analysis, cadAudits: [groundSiteRows[0].audit] },
      scene,
    );
    scene = site.scene;
    siteElementsPrepared = site.created.length;
    siteElementsReady = site.readyForReview;
    issues.push(...site.issues);
  } else if (groundSiteRows.length > 1) {
    issues.push(
      "Multiple resolved ground-floor CAD sources contain site/landscape evidence; site placement remains review-only instead of choosing one plan silently.",
    );
  }

  if (counts.structuralReviewOnly)
    issues.push(
      `${counts.structuralReviewOnly} CAD structural object${counts.structuralReviewOnly === 1 ? "" : "s"} (column/slab/roof/duct/balcony/gate class) remain first-class source evidence; Phase 2 does not coerce them into wall/room geometry without a dedicated structural scene primitive.`,
    );

  return {
    project: { ...project, scene },
    summary: {
      resolvedCadFloors: resolution.resolved.length,
      semanticCadFloors,
      semanticEvidence: semanticEvidence.length,
      roomLabelsApplied,
      unitRoomsAssigned,
      circulationEvidence: counts.circulationEvidence,
      cadOpeningEvidence,
      cadOpeningMatches,
      cadOpeningReviewOnly,
      openingsPrepared: workflow.prepared,
      openingsRefined: refined.refined,
      siteElementsPrepared,
      siteElementsReady,
      structuralEvidence: counts.structuralEvidence,
      structuralReviewOnly: counts.structuralReviewOnly,
    },
    issues: unique(issues),
  };
}
