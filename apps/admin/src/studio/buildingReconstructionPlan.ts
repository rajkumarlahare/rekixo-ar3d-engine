import type { Floor, Project } from "./domain";
import type { SmartCadAudit, SmartProjectAnalysis } from "./projectAnalyzer";
import {
  inferExplicitFloorIndices,
  type DeepSourceIntelligenceReport,
  type PdfPageIntelligence,
} from "./deepSourceIntelligence";
import { estimateCadModelRegistration } from "./sourceRegistration";

export type FloorReconstructionStatus =
  | "auto-ready"
  | "preserve-existing"
  | "review";

export type FloorTargetBasis =
  | "explicit-scene-floor"
  | "model-storey-order"
  | "single-ground-floor"
  | "unresolved";

export interface ReconstructionRegistrationSummary {
  required: boolean;
  compatible: boolean;
  ambiguous: boolean;
  confidence: number;
  reason: string;
}

export interface HumanProtectionSummary {
  protected: boolean;
  reviewedRooms: number;
  reviewedWalls: number;
  reviewedOpenings: number;
  manualWalls: number;
  manualSiteElements: number;
  manualFurniture: number;
}

export interface BuildingFloorReconstructionPlan {
  sourceLevel: number;
  targetFloorId?: string;
  targetFloorName?: string;
  targetFloorIndex?: number;
  targetBasis: FloorTargetBasis;
  status: FloorReconstructionStatus;
  geometrySourceAssetId?: string;
  geometrySourceName?: string;
  geometryConfidence: number;
  wallSegments: number;
  openingSegments: number;
  semanticTextLabels: number;
  structuralEvidence: number;
  pdfCorroboration: Array<{
    sourceAssetId: string;
    sourceName: string;
    page: number;
    confidence: number;
    roomLabels: number;
    dimensions: number;
  }>;
  registration: ReconstructionRegistrationSummary;
  humanProtection: HumanProtectionSummary;
  reason: string;
}

export interface BuildingReconstructionPlan {
  version: 1;
  createdAt: string;
  mode: "model-backed" | "cad-only";
  floors: BuildingFloorReconstructionPlan[];
  unassignedCadSourceIds: string[];
  issues: string[];
  counts: {
    explicitCadFloors: number;
    autoReadyFloors: number;
    preservedFloors: number;
    reviewFloors: number;
    unassignedCadSources: number;
    cadWallSegments: number;
    cadOpeningSegments: number;
    pdfCorroborationPages: number;
  };
}

const STRUCTURAL_KINDS = new Set([
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "boundary",
  "stair",
  "lift",
]);

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function explicitFloorLevels(floor: Floor) {
  return inferExplicitFloorIndices(floor.name);
}

function resolveTargetFloor(
  project: Project,
  analysis: SmartProjectAnalysis,
  level: number,
): {
  floor?: Floor;
  floorIndex?: number;
  basis: FloorTargetBasis;
  confidence: number;
} {
  const namedMatches = project.scene.floors
    .map((floor, floorIndex) => ({ floor, floorIndex }))
    .filter(({ floor }) => explicitFloorLevels(floor).includes(level));
  if (namedMatches.length === 1)
    return {
      ...namedMatches[0],
      basis: "explicit-scene-floor",
      confidence: 0.98,
    };

  if (level === 0 && project.scene.floors.length === 1)
    return {
      floor: project.scene.floors[0],
      floorIndex: 0,
      basis: "single-ground-floor",
      confidence: 0.9,
    };

  // Model floor candidates are already ordered by storey elevation. Using that
  // order is acceptable only for non-negative explicit source levels; basements
  // remain fail-closed unless the scene itself names them explicitly.
  if (analysis.modelAssetId && level >= 0) {
    const ordered = project.scene.floors
      .map((floor, floorIndex) => ({ floor, floorIndex }))
      .sort(
        (left, right) =>
          left.floor.elevation - right.floor.elevation ||
          left.floor.id.localeCompare(right.floor.id),
      );
    const target = ordered[level];
    if (target)
      return {
        ...target,
        basis: "model-storey-order",
        confidence: 0.78,
      };
  }

  return { basis: "unresolved", confidence: 0 };
}

function humanProtection(project: Project, floorId?: string): HumanProtectionSummary {
  if (!floorId)
    return {
      protected: false,
      reviewedRooms: 0,
      reviewedWalls: 0,
      reviewedOpenings: 0,
      manualWalls: 0,
      manualSiteElements: 0,
      manualFurniture: 0,
    };

  const floorRooms = project.scene.rooms.filter((room) => room.floorId === floorId);
  const roomIds = new Set(floorRooms.map((room) => room.id));
  const reviewedRooms = floorRooms.filter((room) => room.verified).length;
  const reviewedWalls = (project.scene.walls ?? []).filter(
    (wall) => wall.floorId === floorId && wall.reviewed,
  ).length;
  const manualWalls = (project.scene.walls ?? []).filter(
    (wall) => wall.floorId === floorId && wall.origin === "manual",
  ).length;
  const reviewedOpenings = (project.scene.openings ?? []).filter(
    (opening) => opening.floorId === floorId && opening.reviewed,
  ).length;
  const manualSiteElements = (project.scene.siteElements ?? []).filter(
    (entry) =>
      entry.floorId === floorId &&
      (entry.origin === "manual" || entry.reviewed),
  ).length;
  const manualFurniture = project.scene.furniture.filter(
    (item) => roomIds.has(item.roomId) && item.origin === undefined,
  ).length;
  const protectedCount =
    reviewedRooms +
    reviewedWalls +
    reviewedOpenings +
    manualWalls +
    manualSiteElements +
    manualFurniture;
  return {
    protected: protectedCount > 0,
    reviewedRooms,
    reviewedWalls,
    reviewedOpenings,
    manualWalls,
    manualSiteElements,
    manualFurniture,
  };
}

function structuralEvidence(audit: SmartCadAudit | undefined) {
  if (!audit?.normalizedDwg) return 0;
  return [
    ...audit.normalizedDwg.objects.map((entry) => entry.kind),
    ...audit.normalizedDwg.inserts.map((entry) => entry.kind),
  ].filter((kind) => STRUCTURAL_KINDS.has(kind)).length;
}

function pdfForLevel(
  pages: readonly PdfPageIntelligence[],
  level: number,
) {
  return pages
    .filter(
      (page) =>
        page.role === "floor-plan" && page.floorIndices.includes(level),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.confidence - left.confidence ||
        left.sourceAssetId.localeCompare(right.sourceAssetId) ||
        left.page - right.page,
    )
    .map((page) => ({
      sourceAssetId: page.sourceAssetId,
      sourceName: page.sourceName,
      page: page.page,
      confidence: page.confidence,
      roomLabels: page.roomLabels,
      dimensions: page.dimensions,
    }));
}

function registrationFor(
  project: Project,
  analysis: SmartProjectAnalysis,
  audit: SmartCadAudit | undefined,
  targetFloorIndex: number | undefined,
): ReconstructionRegistrationSummary {
  if (!analysis.modelAssetId)
    return {
      required: false,
      compatible: true,
      ambiguous: false,
      confidence: 1,
      reason: "CAD-only reconstruction uses the normalized CAD coordinate system directly.",
    };
  if (!audit || targetFloorIndex === undefined)
    return {
      required: true,
      compatible: false,
      ambiguous: true,
      confidence: 0,
      reason: "A model-backed floor needs one resolved CAD source and one target model floor before registration.",
    };
  const registration = estimateCadModelRegistration(
    analysis,
    audit,
    targetFloorIndex,
    project.scene.scale,
    project.scene.modelTransform,
  );
  return {
    required: true,
    compatible: registration.compatible,
    ambiguous: registration.ambiguous,
    confidence: Number(registration.confidence.toFixed(3)),
    reason:
      registration.reason ??
      "CAD-to-model registration completed without an explicit processor reason.",
  };
}

function planReason(input: {
  candidates: number;
  walls: number;
  targetBasis: FloorTargetBasis;
  protection: HumanProtectionSummary;
  registration: ReconstructionRegistrationSummary;
}) {
  if (input.candidates > 1)
    return "Multiple normalized CAD sources explicitly claim this floor; geometry selection stays review-only.";
  if (input.candidates === 0)
    return "No normalized CAD geometry source resolves uniquely to this floor.";
  if (input.walls < 3)
    return "The resolved CAD source does not contain enough reliable wall segments for a closed building reconstruction pass.";
  if (input.targetBasis === "unresolved")
    return "The source floor is explicit, but no unique scene/model floor target can be resolved safely.";
  if (input.protection.protected)
    return "Human-reviewed/manual content already exists on this floor; automatic reconstruction must preserve it and stay review-only.";
  if (
    input.registration.required &&
    (!input.registration.compatible ||
      input.registration.ambiguous ||
      input.registration.confidence < 0.68)
  )
    return "CAD-to-model registration is not reliable enough to replace or supplement automatic geometry on this floor.";
  return "One normalized CAD source, one target floor and safe registration are resolved; source-backed reconstruction is ready for the execution stage.";
}

/**
 * Perfection Phase 3 planning is deliberately non-destructive. It converts
 * Phase 2 source intelligence into an explicit floor-by-floor execution plan,
 * but never treats a visual/PDF reference as metric geometry and never chooses
 * between competing CAD sources silently.
 */
export function buildBuildingReconstructionPlan(
  project: Project,
  analysis: SmartProjectAnalysis,
  intelligence: DeepSourceIntelligenceReport,
): BuildingReconstructionPlan {
  const cadAuditById = new Map(
    analysis.cadAudits.map((audit) => [audit.assetId, audit] as const),
  );
  const usableCad = intelligence.cadSources.filter(
    (cad) => cad.geometryReady && cad.floorIndices.length === 1,
  );
  const levels = unique(usableCad.map((cad) => cad.floorIndices[0])).sort(
    (left, right) => left - right,
  );
  const unassignedCadSourceIds = intelligence.cadSources
    .filter(
      (cad) =>
        cad.geometryReady && cad.floorIndices.length !== 1,
    )
    .map((cad) => cad.sourceAssetId);
  const issues: string[] = [];
  const floors: BuildingFloorReconstructionPlan[] = [];

  for (const sourceLevel of levels) {
    const candidates = usableCad
      .filter((cad) => cad.floorIndices[0] === sourceLevel)
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.sourceAssetId.localeCompare(right.sourceAssetId),
      );
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    const audit = selected
      ? cadAuditById.get(selected.sourceAssetId)
      : undefined;
    const target = resolveTargetFloor(project, analysis, sourceLevel);
    const protection = humanProtection(project, target.floor?.id);
    const registration = registrationFor(
      project,
      analysis,
      audit,
      target.floorIndex,
    );
    const walls = selected?.wallSegments ?? 0;
    const reason = planReason({
      candidates: candidates.length,
      walls,
      targetBasis: target.basis,
      protection,
      registration,
    });
    const status: FloorReconstructionStatus =
      candidates.length !== 1 ||
      walls < 3 ||
      target.basis === "unresolved" ||
      (registration.required &&
        (!registration.compatible ||
          registration.ambiguous ||
          registration.confidence < 0.68))
        ? "review"
        : protection.protected
          ? "preserve-existing"
          : "auto-ready";

    if (status !== "auto-ready")
      issues.push(`Floor ${sourceLevel}: ${reason}`);

    floors.push({
      sourceLevel,
      ...(target.floor ? { targetFloorId: target.floor.id, targetFloorName: target.floor.name } : {}),
      ...(target.floorIndex !== undefined ? { targetFloorIndex: target.floorIndex } : {}),
      targetBasis: target.basis,
      status,
      ...(selected
        ? {
            geometrySourceAssetId: selected.sourceAssetId,
            geometrySourceName: selected.sourceName,
          }
        : {}),
      geometryConfidence: selected?.confidence ?? 0,
      wallSegments: walls,
      openingSegments: selected?.openingSegments ?? 0,
      semanticTextLabels: selected?.textLabels ?? 0,
      structuralEvidence: structuralEvidence(audit),
      pdfCorroboration: pdfForLevel(intelligence.pdfPages, sourceLevel),
      registration,
      humanProtection: protection,
      reason,
    });
  }

  for (const assetId of unassignedCadSourceIds) {
    const cad = intelligence.cadSources.find(
      (entry) => entry.sourceAssetId === assetId,
    );
    issues.push(
      cad?.floorIndices.length
        ? `CAD “${cad.sourceName}” names multiple floors (${cad.floorIndices.join(", ")}); Rekixo will not duplicate one drawing across them automatically.`
        : `CAD “${cad?.sourceName ?? assetId}” has normalized geometry but no explicit single-floor identity; it remains review-only.`,
    );
  }

  const counts = {
    explicitCadFloors: floors.length,
    autoReadyFloors: floors.filter((floor) => floor.status === "auto-ready").length,
    preservedFloors: floors.filter((floor) => floor.status === "preserve-existing").length,
    reviewFloors: floors.filter((floor) => floor.status === "review").length,
    unassignedCadSources: unassignedCadSourceIds.length,
    cadWallSegments: floors.reduce((sum, floor) => sum + floor.wallSegments, 0),
    cadOpeningSegments: floors.reduce((sum, floor) => sum + floor.openingSegments, 0),
    pdfCorroborationPages: floors.reduce(
      (sum, floor) => sum + floor.pdfCorroboration.length,
      0,
    ),
  };

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: analysis.modelAssetId ? "model-backed" : "cad-only",
    floors,
    unassignedCadSourceIds,
    issues: unique(issues),
    counts,
  };
}
