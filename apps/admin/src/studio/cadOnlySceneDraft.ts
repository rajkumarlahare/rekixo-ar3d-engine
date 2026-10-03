import type {
  Floor,
  Opening,
  Project,
  Room,
  RoomPoint,
  Scene,
  Wall,
} from "./domain";
import type {
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";
import { regularizeWallTopology } from "./wallTopology";
import { deriveAutoRoomDrafts } from "./autoRoomDraft";
import { linkWallsToRooms } from "./architectureGraph";
import {
  applyRoomSemanticEvidence,
  classifyRoomSemanticText,
  type RoomSemanticEvidence,
} from "./roomSemanticBinding";
import {
  resolveCadFloorPlanRoles,
  type CadFloorPlanRole,
} from "./cadFloorPlanning";

export interface CadOnlySceneDraftResult {
  scene: Scene;
  sourceAssetId: string;
  sourceAssetIds: string[];
  floorCount: number;
  wallCount: number;
  roomCount: number;
  openingCount: number;
  unmatchedOpeningEvidence: number;
  semanticLabelsApplied: number;
  sourceCentre: RoomPoint;
  issues: string[];
}

function sourceAudits(analysis: SmartProjectAnalysis): SmartCadAudit[] {
  return analysis.cadAudits.filter(
    (audit) =>
      (audit.kind === "dwg" || audit.kind === "dxf") &&
      audit.geometryReady &&
      (audit.semanticSegments?.some((segment) => segment.kind === "wall") ??
        false),
  );
}

function wallBounds(audit: SmartCadAudit) {
  const points = (audit.semanticSegments ?? [])
    .filter((segment) => segment.kind === "wall")
    .flatMap((segment) => [segment.start, segment.end]);
  if (!points.length) return undefined;
  const xs = points.map((point) => point[0]);
  const zs = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (
    ![minX, maxX, minZ, maxZ, width, depth].every(Number.isFinite) ||
    width < 0.5 ||
    depth < 0.5 ||
    width > 5000 ||
    depth > 5000
  )
    return undefined;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    centre: [
      Number(((minX + maxX) / 2).toFixed(5)),
      Number(((minZ + maxZ) / 2).toFixed(5)),
    ] as RoomPoint,
  };
}

function assertCompatibleFloorFootprints(audits: readonly SmartCadAudit[]) {
  if (audits.length < 2) return;
  const bounds = audits.map((audit) => wallBounds(audit));
  if (bounds.some((value) => !value))
    throw Error("One CAD floor has unsafe wall bounds and cannot be stacked automatically.");
  const dimensions = bounds.map((value) => {
    const sorted = [value!.width, value!.depth].sort((a, b) => b - a);
    return { long: sorted[0], short: sorted[1], area: sorted[0] * sorted[1] };
  });
  const reference = dimensions[0];
  for (let index = 1; index < dimensions.length; index += 1) {
    const candidate = dimensions[index];
    const longRatio = Math.max(reference.long, candidate.long) /
      Math.min(reference.long, candidate.long);
    const shortRatio = Math.max(reference.short, candidate.short) /
      Math.min(reference.short, candidate.short);
    const areaRatio = Math.max(reference.area, candidate.area) /
      Math.min(reference.area, candidate.area);
    if (longRatio > 2.5 || shortRatio > 2.5 || areaRatio > 4)
      throw Error(
        `CAD source “${audits[index].name}” has a footprint that is too different from the other floor plans. Rekixo will not stack unrelated/detail drawings as building floors.`,
      );
  }
}

function localPoint(point: RoomPoint, centre: RoomPoint): RoomPoint {
  return [
    Number((point[0] - centre[0]).toFixed(4)),
    Number((point[1] - centre[1]).toFixed(4)),
  ];
}

function draftFloor(
  project: Project,
  audit: SmartCadAudit,
  role: CadFloorPlanRole,
  planCount: number,
): Floor {
  const existing = project.scene.floors[0];
  const useExistingId = planCount === 1 && existing;
  return {
    id: useExistingId
      ? existing.id
      : `floor-cad-${audit.assetId.slice(0, 10)}-${role.level}`,
    name:
      planCount === 1 && !role.explicit && existing?.name
        ? existing.name
        : role.label,
    elevation:
      planCount === 1 && !role.explicit && existing
        ? existing.elevation
        : role.elevation,
  };
}

function makeWalls(
  audit: SmartCadAudit,
  floor: Floor,
  centre: RoomPoint,
) {
  const candidates = (audit.semanticSegments ?? [])
    .filter(
      (segment) =>
        segment.kind === "wall" && (segment.confidence ?? 0) >= 0.76,
    )
    .map((segment, index): Wall | undefined => {
      const start = localPoint(segment.start, centre);
      const end = localPoint(segment.end, centre);
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.12)
        return undefined;
      const segmentConfidence = segment.confidence ?? 0;
      const confidence = Math.min(
        audit.kind === "dwg" ? 0.96 : 0.9,
        segmentConfidence,
      );
      return {
        id: `wall-cad-only-${audit.assetId.slice(0, 12)}-${index + 1}`,
        floorId: floor.id,
        roomIds: [],
        start,
        end,
        thickness:
          segment.widthM !== undefined &&
          segment.widthM >= 0.05 &&
          segment.widthM <= 1
            ? Number(segment.widthM.toFixed(4))
            : 0.12,
        height: 2.8,
        reviewed: false,
        origin: "cad-auto",
        confidence: Number(confidence.toFixed(3)),
        reviewState: confidence >= 0.9 ? "auto_ready" : "suggested",
      };
    })
    .filter((wall): wall is Wall => Boolean(wall));
  return regularizeWallTopology(candidates);
}

function pointSegmentDistance(
  point: RoomPoint,
  start: RoomPoint,
  end: RoomPoint,
) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx +
              (point[1] - start[1]) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  const x = start[0] + dx * t;
  const z = start[1] + dz * t;
  return Math.hypot(point[0] - x, point[1] - z);
}

function openingRoomIds(point: RoomPoint, walls: readonly Wall[]): string[] {
  const nearby = walls
    .map((wall) => ({
      wall,
      distance: pointSegmentDistance(point, wall.start, wall.end),
    }))
    .filter(
      (entry) =>
        entry.distance <= Math.max(0.35, entry.wall.thickness * 2.5),
    )
    .sort((left, right) => left.distance - right.distance);
  const result: string[] = [];
  for (const entry of nearby)
    for (const roomId of entry.wall.roomIds)
      if (!result.includes(roomId) && result.length < 2) result.push(roomId);
  return result;
}

function makeOpenings(
  audit: SmartCadAudit,
  floor: Floor,
  centre: RoomPoint,
  walls: readonly Wall[],
): { openings: Opening[]; unmatched: number } {
  const openings: Opening[] = [];
  let unmatched = 0;
  for (const [index, segment] of (audit.semanticSegments ?? []).entries()) {
    if (
      (segment.kind !== "door" && segment.kind !== "window") ||
      (segment.confidence ?? 0) < 0.7
    )
      continue;
    const kind: Opening["kind"] =
      segment.kind === "door" ? "door" : "window";
    const segmentConfidence = segment.confidence ?? 0;
    const start = localPoint(segment.start, centre);
    const end = localPoint(segment.end, centre);
    const width = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (
      !Number.isFinite(width) ||
      width < 0.25 ||
      width > (kind === "door" ? 3.5 : 8)
    ) {
      unmatched += 1;
      continue;
    }
    const x = (start[0] + end[0]) / 2;
    const z = (start[1] + end[1]) / 2;
    const roomIds = openingRoomIds([x, z], walls);
    if (!roomIds.length) {
      unmatched += 1;
      continue;
    }
    const height = kind === "door" ? 2.1 : 1.2;
    const sillHeight = kind === "window" ? 0.9 : undefined;
    openings.push({
      id: `opening-cad-only-${audit.assetId.slice(0, 12)}-${index + 1}`,
      floorId: floor.id,
      kind,
      roomIds,
      x: Number(x.toFixed(4)),
      y: Number(
        (
          floor.elevation +
          (kind === "door"
            ? height / 2
            : (sillHeight ?? 0) + height / 2)
        ).toFixed(4),
      ),
      z: Number(z.toFixed(4)),
      width: Number(width.toFixed(3)),
      height,
      ...(sillHeight !== undefined ? { sillHeight } : {}),
      rotationY: Number(
        (
          (Math.atan2(-(end[1] - start[1]), end[0] - start[0]) * 180) /
          Math.PI
        ).toFixed(3),
      ),
      reviewed: false,
      sourceNodeName: `CAD:${audit.assetId}:${segment.layer}:${segment.sourceEntity}`.slice(
        0,
        480,
      ),
      sourceOccurrence: index + 1,
      confidence: Number(
        Math.min(
          segmentConfidence,
          audit.kind === "dwg" ? 0.92 : 0.86,
        ).toFixed(3),
      ),
      reviewState: "suggested",
    });
  }
  return { openings, unmatched };
}

function applySemantics(
  project: Project,
  audit: SmartCadAudit,
  floor: Floor,
  centre: RoomPoint,
  rooms: Room[],
  walls: Wall[],
) {
  const evidence: RoomSemanticEvidence[] = [];
  for (let index = 0; index < (audit.textLabels ?? []).length; index += 1) {
    const label = audit.textLabels![index];
    const semantic = classifyRoomSemanticText(label.text);
    if (!semantic.roomName && !semantic.unitName) continue;
    evidence.push({
      id: `cad-only-text-${audit.assetId}-${index + 1}`,
      floorId: floor.id,
      point: localPoint(label.point, centre),
      text: label.text,
      sourceAssetId: audit.assetId,
      source: "cad-text",
      confidence: audit.kind === "dwg" ? 0.94 : 0.88,
      ...semantic,
    });
  }
  if (!rooms.length || !evidence.length)
    return { rooms, walls, applied: 0, reviewRemaining: 0 };
  const semantic = applyRoomSemanticEvidence(
    {
      ...project.scene,
      floors: [floor],
      rooms,
      walls,
      scale: 1,
    },
    evidence,
  );
  const nextRooms = semantic.scene.rooms;
  return {
    rooms: nextRooms,
    walls: linkWallsToRooms(walls, nextRooms),
    applied: semantic.roomNamesApplied + semantic.unitRoomsAssigned,
    reviewRemaining: semantic.reviewRemaining,
  };
}

export function buildCadOnlySceneDraft(
  project: Project,
  analysis: SmartProjectAnalysis,
): CadOnlySceneDraftResult {
  const issues: string[] = [];
  if (analysis.modelAssetId)
    throw Error(
      "CAD-only reconstruction is only for projects without a source 3D model.",
    );
  const authoredOneFloorContent =
    (project.scene.walls ?? []).some(
      (wall) => wall.reviewed || wall.origin === "manual",
    ) ||
    (project.scene.openings ?? []).some((opening) => opening.reviewed) ||
    project.scene.furniture.some((item) => item.origin === undefined);
  if (
    project.scene.rooms.length ||
    project.scene.floors.length > 1 ||
    authoredOneFloorContent
  )
    throw Error(
      "Model-less CAD AutoBuild requires an empty/default scene so existing authored rooms, walls, openings, furniture or multi-floor work is never overwritten.",
    );

  const audits = sourceAudits(analysis);
  if (!audits.length)
    throw Error(
      "Model-less AutoBuild needs normalized DWG/DXF wall geometry before reconstruction.",
    );

  const planning = resolveCadFloorPlanRoles(audits);
  if (!planning.roles.length)
    throw Error("CAD floor roles could not be resolved safely.");
  assertCompatibleFloorFootprints(
    planning.roles.map((role) => audits[role.auditIndex]),
  );
  issues.push(...planning.issues);

  const floors: Floor[] = [];
  const rooms: Room[] = [];
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  const centres: RoomPoint[] = [];
  let semanticLabelsApplied = 0;
  let unmatchedOpeningEvidence = 0;

  for (const role of planning.roles) {
    const audit = audits[role.auditIndex];
    const bounds = wallBounds(audit);
    if (!bounds)
      throw Error(`CAD source “${audit.name}” has unsafe wall bounds.`);
    const centre = bounds.centre;
    centres.push(centre);
    const floor = draftFloor(project, audit, role, planning.roles.length);
    const topology = makeWalls(audit, floor, centre);
    if (topology.walls.length < 3)
      throw Error(
        `CAD source “${audit.name}” does not contain enough reliable wall geometry to build ${floor.name}.`,
      );

    const roomDraft = deriveAutoRoomDrafts(
      topology.walls,
      [floor],
      audit.assetId,
    );
    let floorRooms = roomDraft.rooms;
    let floorWalls = linkWallsToRooms(topology.walls, floorRooms);
    const semantic = applySemantics(
      project,
      audit,
      floor,
      centre,
      floorRooms,
      floorWalls,
    );
    floorRooms = semantic.rooms;
    floorWalls = semantic.walls;
    semanticLabelsApplied += semantic.applied;
    if (semantic.reviewRemaining)
      issues.push(
        `${floor.name}: ${semantic.reviewRemaining} room/unit semantic assignment${semantic.reviewRemaining === 1 ? "" : "s"} remain review-only because source labels conflict or are ambiguous.`,
      );

    const floorOpenings = makeOpenings(
      audit,
      floor,
      centre,
      floorWalls,
    );
    unmatchedOpeningEvidence += floorOpenings.unmatched;
    if (roomDraft.skippedFloors.length)
      issues.push(
        `${floor.name}: wall geometry was reconstructed, but one or more closed room loops still need topology review.`,
      );

    floors.push(floor);
    rooms.push(...floorRooms);
    walls.push(...floorWalls);
    openings.push(...floorOpenings.openings);
  }

  if (openings.length)
    issues.push(
      "CAD door/window positions were reconstructed from plan geometry; default vertical heights/sills remain suggested until reviewed.",
    );
  if (unmatchedOpeningEvidence)
    issues.push(
      `${unmatchedOpeningEvidence} CAD door/window item${unmatchedOpeningEvidence === 1 ? "" : "s"} could not be bound to a reconstructed room wall and remain evidence-only instead of becoming invalid scene openings.`,
    );

  const firstAudit = audits[planning.roles[0].auditIndex];
  return {
    scene: {
      ...project.scene,
      floors,
      rooms,
      walls,
      openings,
      modelId: undefined,
      publishModelId: undefined,
      scale: 1,
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
      modelNodeTags: [],
    },
    sourceAssetId: firstAudit.assetId,
    sourceAssetIds: planning.roles.map(
      (role) => audits[role.auditIndex].assetId,
    ),
    floorCount: floors.length,
    wallCount: walls.length,
    roomCount: rooms.length,
    openingCount: openings.length,
    unmatchedOpeningEvidence,
    semanticLabelsApplied,
    sourceCentre: centres[0],
    issues,
  };
}
