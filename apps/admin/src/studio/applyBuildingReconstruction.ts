import {
  validateProject,
  type Floor,
  type Project,
  type Room,
  type Wall,
} from "./domain";
import type { SmartCadAudit, SmartProjectAnalysis } from "./projectAnalyzer";
import type { BuildingReconstructionPlan } from "./buildingReconstructionPlan";
import {
  applyCadRegistrationPoint,
  estimateCadModelRegistration,
} from "./sourceRegistration";
import { regularizeWallTopology } from "./wallTopology";
import { deriveAutoRoomDrafts } from "./autoRoomDraft";
import { linkWallsToRooms } from "./architectureGraph";

export interface BuildingReconstructionExecution {
  project: Project;
  appliedFloorIds: string[];
  skippedFloorIds: string[];
  wallsPrepared: number;
  wallsReplaced: number;
  roomsPrepared: number;
  roomsReplaced: number;
  openingsRetired: number;
  furnitureRetired: number;
  issues: string[];
}

interface ModelWallDimensions {
  height: number;
  thickness: number;
  evidenceCount: number;
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))];
}

function median(values: readonly number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isAutomaticRoom(room: Room) {
  return (
    !room.verified &&
    Boolean(room.sourceAssetId) &&
    (room.unit === "Auto draft" ||
      /^Auto draft from a closed high-confidence parametric wall loop\./.test(
        room.source,
      ))
  );
}

function executionProtection(project: Project, floorId: string) {
  const rooms = project.scene.rooms.filter((room) => room.floorId === floorId);
  const roomIds = new Set(rooms.map((room) => room.id));
  const authoredRooms = rooms.filter((room) => !isAutomaticRoom(room));
  const protectedWalls = (project.scene.walls ?? []).filter(
    (wall) =>
      wall.floorId === floorId && (wall.reviewed || wall.origin === "manual"),
  );
  const protectedOpenings = (project.scene.openings ?? []).filter(
    (opening) =>
      opening.floorId === floorId &&
      (opening.reviewed || !opening.sourceNodeName),
  );
  const protectedSiteElements = (project.scene.siteElements ?? []).filter(
    (entry) =>
      entry.floorId === floorId &&
      (entry.reviewed || entry.origin === "manual"),
  );
  const manualFurniture = project.scene.furniture.filter(
    (item) => roomIds.has(item.roomId) && item.origin === undefined,
  );
  return {
    blocked:
      authoredRooms.length > 0 ||
      protectedWalls.length > 0 ||
      protectedOpenings.length > 0 ||
      protectedSiteElements.length > 0 ||
      manualFurniture.length > 0,
    authoredRooms: authoredRooms.length,
    protectedWalls: protectedWalls.length,
    protectedOpenings: protectedOpenings.length,
    protectedSiteElements: protectedSiteElements.length,
    manualFurniture: manualFurniture.length,
  };
}

function modelWallDimensions(
  analysis: SmartProjectAnalysis,
  floorIndex: number,
  scale: number,
): ModelWallDimensions | undefined {
  const candidates = analysis.architecturalCandidates.filter(
    (candidate) =>
      candidate.kind === "wall" &&
      candidate.floorIndex === floorIndex &&
      candidate.confidence >= 0.78,
  );
  const heights = candidates
    .map((candidate) => candidate.size[1] * scale)
    .filter((value) => Number.isFinite(value) && value >= 0.3 && value <= 20);
  const thicknesses = candidates
    .map((candidate) => Math.min(candidate.size[0], candidate.size[2]) * scale)
    .filter((value) => Number.isFinite(value) && value >= 0.03 && value <= 2);
  const height = median(heights);
  const thickness = median(thicknesses);
  if (height === undefined || thickness === undefined) return undefined;
  return {
    height: Number(height.toFixed(4)),
    thickness: Number(thickness.toFixed(4)),
    evidenceCount: candidates.length,
  };
}

function sourceAudit(
  analysis: SmartProjectAnalysis,
  assetId: string | undefined,
): SmartCadAudit | undefined {
  if (!assetId) return undefined;
  return analysis.cadAudits.find(
    (audit) =>
      audit.assetId === assetId &&
      (audit.kind === "dwg" || audit.kind === "dxf") &&
      audit.geometryReady,
  );
}

function buildRegisteredWalls(
  project: Project,
  analysis: SmartProjectAnalysis,
  audit: SmartCadAudit,
  floor: Floor,
  floorIndex: number,
  dimensions: ModelWallDimensions,
) {
  const registration = estimateCadModelRegistration(
    analysis,
    audit,
    floorIndex,
    project.scene.scale,
    project.scene.modelTransform,
  );
  if (
    !registration.compatible ||
    registration.ambiguous ||
    registration.confidence < 0.68
  )
    return {
      walls: [] as Wall[],
      registration,
      reason:
        "CAD-to-model registration changed or fell below the Phase 3 safety threshold before execution.",
    };

  const walls = (audit.semanticSegments ?? [])
    .map((segment, index): Wall | undefined => {
      if (segment.kind !== "wall" || (segment.confidence ?? 0) < 0.76)
        return undefined;
      const start = applyCadRegistrationPoint(
        segment.start,
        registration.sourceCentre,
        registration.targetCentre,
        registration.rotationDeg,
      );
      const end = applyCadRegistrationPoint(
        segment.end,
        registration.sourceCentre,
        registration.targetCentre,
        registration.rotationDeg,
      );
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.12)
        return undefined;
      const sourceConfidence = segment.confidence ?? 0;
      const registrationCeiling = Math.min(
        0.99,
        0.72 + registration.confidence * 0.27,
      );
      const confidence = Number(
        Math.min(sourceConfidence, registrationCeiling).toFixed(3),
      );
      const sourceWidth =
        segment.widthM !== undefined &&
        Number.isFinite(segment.widthM) &&
        segment.widthM >= 0.03 &&
        segment.widthM <= 2
          ? segment.widthM
          : undefined;
      return {
        id: `wall-reconstruction-${floor.id}-${audit.assetId.slice(0, 12)}-${index + 1}`,
        floorId: floor.id,
        roomIds: [],
        start: [Number(start[0].toFixed(4)), Number(start[1].toFixed(4))],
        end: [Number(end[0].toFixed(4)), Number(end[1].toFixed(4))],
        thickness: Number((sourceWidth ?? dimensions.thickness).toFixed(4)),
        height: dimensions.height,
        reviewed: false,
        origin: "cad-auto",
        confidence,
        reviewState: confidence >= 0.9 ? "auto_ready" : "suggested",
      };
    })
    .filter((wall): wall is Wall => Boolean(wall));

  const topology = regularizeWallTopology(walls);
  return {
    walls: topology.walls,
    registration,
    reason: undefined as string | undefined,
  };
}

/**
 * Executes only model-backed `auto-ready` Phase 3 floor rows. The executor
 * revalidates every safety decision against the live scene before mutating it.
 * CAD-only projects already use the dedicated multi-floor CAD reconstruction
 * pipeline and are intentionally left unchanged here.
 */
export function applyBuildingReconstructionPlan(
  project: Project,
  analysis: SmartProjectAnalysis,
  plan: BuildingReconstructionPlan,
): BuildingReconstructionExecution {
  if (plan.mode !== "model-backed" || !analysis.modelAssetId)
    return {
      project,
      appliedFloorIds: [],
      skippedFloorIds: [],
      wallsPrepared: 0,
      wallsReplaced: 0,
      roomsPrepared: 0,
      roomsReplaced: 0,
      openingsRetired: 0,
      furnitureRetired: 0,
      issues: [],
    };

  let next: Project = structuredClone(project);
  const appliedFloorIds: string[] = [];
  const skippedFloorIds: string[] = [];
  const issues: string[] = [];
  let wallsPrepared = 0;
  let wallsReplaced = 0;
  let roomsPrepared = 0;
  let roomsReplaced = 0;
  let openingsRetired = 0;
  let furnitureRetired = 0;

  for (const row of plan.floors.filter((floor) => floor.status === "auto-ready")) {
    const floorId = row.targetFloorId;
    if (!floorId) {
      issues.push(`Phase 3 floor ${row.sourceLevel} lost its target floor before execution.`);
      continue;
    }
    const floorIndex = next.scene.floors.findIndex((floor) => floor.id === floorId);
    const floor = next.scene.floors[floorIndex];
    if (!floor || floorIndex < 0) {
      issues.push(`Phase 3 target floor “${row.targetFloorName ?? floorId}” no longer exists.`);
      skippedFloorIds.push(floorId);
      continue;
    }

    const protection = executionProtection(next, floorId);
    if (protection.blocked) {
      issues.push(
        `Phase 3 preserved ${floor.name}: live scene contains ${protection.authoredRooms} authored room(s), ${protection.protectedWalls} protected wall(s), ${protection.protectedOpenings} protected opening(s), ${protection.protectedSiteElements} protected site/structural element(s) and ${protection.manualFurniture} user furniture item(s).`,
      );
      skippedFloorIds.push(floorId);
      continue;
    }

    const audit = sourceAudit(analysis, row.geometrySourceAssetId);
    if (!audit) {
      issues.push(
        `Phase 3 preserved ${floor.name}: the planned normalized CAD source is no longer geometry-ready.`,
      );
      skippedFloorIds.push(floorId);
      continue;
    }

    const dimensions = modelWallDimensions(
      analysis,
      floorIndex,
      next.scene.scale,
    );
    if (!dimensions) {
      issues.push(
        `Phase 3 preserved ${floor.name}: the 3D source does not provide reliable wall height/thickness evidence for this floor, so Rekixo will not invent vertical dimensions.`,
      );
      skippedFloorIds.push(floorId);
      continue;
    }

    const prepared = buildRegisteredWalls(
      next,
      analysis,
      audit,
      floor,
      floorIndex,
      dimensions,
    );
    if (prepared.reason || prepared.walls.length < 3) {
      issues.push(
        `Phase 3 preserved ${floor.name}: ${prepared.reason ?? "normalized CAD did not produce at least three reliable registered wall segments."}`,
      );
      skippedFloorIds.push(floorId);
      continue;
    }

    const roomDraft = deriveAutoRoomDrafts(
      prepared.walls,
      [floor],
      audit.assetId,
    );
    if (!roomDraft.rooms.length) {
      issues.push(
        `Phase 3 preserved ${floor.name}: registered CAD walls did not form a safe closed room topology; geometry remains review-only.`,
      );
      skippedFloorIds.push(floorId);
      continue;
    }

    const oldFloorRooms = next.scene.rooms.filter((room) => room.floorId === floorId);
    const oldRoomIds = new Set(oldFloorRooms.map((room) => room.id));
    const oldFloorWalls = (next.scene.walls ?? []).filter(
      (wall) => wall.floorId === floorId,
    );
    const retiredOpeningIds = new Set(
      (next.scene.openings ?? [])
        .filter(
          (opening) =>
            opening.floorId === floorId &&
            !opening.reviewed &&
            Boolean(opening.sourceNodeName),
        )
        .map((opening) => opening.id),
    );
    const retiredFurnitureIds = new Set(
      next.scene.furniture
        .filter(
          (item) => oldRoomIds.has(item.roomId) && item.origin !== undefined,
        )
        .map((item) => item.id),
    );

    const linkedNewWalls = linkWallsToRooms(prepared.walls, roomDraft.rooms);
    next = {
      ...next,
      scene: {
        ...next.scene,
        rooms: [
          ...next.scene.rooms.filter((room) => room.floorId !== floorId),
          ...roomDraft.rooms,
        ],
        walls: [
          ...(next.scene.walls ?? []).filter((wall) => wall.floorId !== floorId),
          ...linkedNewWalls,
        ],
        openings: (next.scene.openings ?? []).filter(
          (opening) => !retiredOpeningIds.has(opening.id),
        ),
        furniture: next.scene.furniture.filter(
          (item) => !retiredFurnitureIds.has(item.id),
        ),
      },
    };

    appliedFloorIds.push(floorId);
    wallsPrepared += linkedNewWalls.length;
    wallsReplaced += oldFloorWalls.length;
    roomsPrepared += roomDraft.rooms.length;
    roomsReplaced += oldFloorRooms.length;
    openingsRetired += retiredOpeningIds.size;
    furnitureRetired += retiredFurnitureIds.size;
  }

  validateProject(next);
  return {
    project: next,
    appliedFloorIds,
    skippedFloorIds: unique(skippedFloorIds),
    wallsPrepared,
    wallsReplaced,
    roomsPrepared,
    roomsReplaced,
    openingsRetired,
    furnitureRetired,
    issues: unique(issues),
  };
}
