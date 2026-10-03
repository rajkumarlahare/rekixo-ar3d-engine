import type {
  Floor,
  Opening,
  Project,
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

export interface CadOnlySceneDraftResult {
  scene: Scene;
  sourceAssetId: string;
  wallCount: number;
  roomCount: number;
  openingCount: number;
  semanticLabelsApplied: number;
  sourceCentre: RoomPoint;
  issues: string[];
}

function sourceAudit(analysis: SmartProjectAnalysis): SmartCadAudit | undefined {
  const candidates = analysis.cadAudits.filter(
    (audit) =>
      (audit.kind === "dwg" || audit.kind === "dxf") &&
      audit.geometryReady &&
      (audit.semanticSegments?.some((segment) => segment.kind === "wall") ??
        false),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function centreOfWalls(audit: SmartCadAudit): RoomPoint | undefined {
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
  if (
    ![minX, maxX, minZ, maxZ].every(Number.isFinite) ||
    maxX - minX < 0.5 ||
    maxZ - minZ < 0.5 ||
    maxX - minX > 5000 ||
    maxZ - minZ > 5000
  )
    return undefined;
  return [
    Number(((minX + maxX) / 2).toFixed(5)),
    Number(((minZ + maxZ) / 2).toFixed(5)),
  ];
}

function localPoint(point: RoomPoint, centre: RoomPoint): RoomPoint {
  return [
    Number((point[0] - centre[0]).toFixed(4)),
    Number((point[1] - centre[1]).toFixed(4)),
  ];
}

function floorName(audit: SmartCadAudit) {
  const text = [
    audit.name,
    ...(audit.textLabels ?? []).map((entry) => entry.text),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (/\b(?:ground floor|ground|gf|g floor)\b/.test(text)) return "Ground";
  const names: Array<[RegExp, string]> = [
    [/\b(?:first floor|1st floor|floor 1|f1)\b/, "Floor 1"],
    [/\b(?:second floor|2nd floor|floor 2|f2)\b/, "Floor 2"],
    [/\b(?:third floor|3rd floor|floor 3|f3)\b/, "Floor 3"],
    [/\b(?:fourth floor|4th floor|floor 4|f4)\b/, "Floor 4"],
    [/\b(?:fifth floor|5th floor|floor 5|f5)\b/, "Floor 5"],
    [/\b(?:sixth floor|6th floor|floor 6|f6)\b/, "Floor 6"],
  ];
  for (const [pattern, label] of names) if (pattern.test(text)) return label;
  return "CAD Plan";
}

function draftFloor(project: Project, audit: SmartCadAudit): Floor {
  const current = project.scene.floors[0];
  return {
    id: current?.id ?? `floor-cad-${audit.assetId.slice(0, 12)}`,
    name:
      project.scene.floors.length === 1 && current?.name !== "Ground"
        ? current.name
        : floorName(audit),
    elevation: current?.elevation ?? 0,
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

function openingRoomIds(
  point: RoomPoint,
  walls: readonly Wall[],
): string[] {
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
): Opening[] {
  return (audit.semanticSegments ?? [])
    .filter(
      (segment) =>
        (segment.kind === "door" || segment.kind === "window") &&
        (segment.confidence ?? 0) >= 0.7,
    )
    .flatMap((segment, index) => {
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
      )
        return [];
      const x = (start[0] + end[0]) / 2;
      const z = (start[1] + end[1]) / 2;
      const height = kind === "door" ? 2.1 : 1.2;
      const sillHeight = kind === "window" ? 0.9 : undefined;
      const opening: Opening = {
        id: `opening-cad-only-${audit.assetId.slice(0, 12)}-${index + 1}`,
        floorId: floor.id,
        kind,
        roomIds: openingRoomIds([x, z], walls),
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
      };
      return [opening];
    });
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

  const audit = sourceAudit(analysis);
  if (!audit)
    throw Error(
      "Model-less AutoBuild needs exactly one normalized DWG/DXF source with reliable metre wall geometry.",
    );
  const centre = centreOfWalls(audit);
  if (!centre)
    throw Error("CAD wall bounds are not safe enough for model-less reconstruction.");

  const floor = draftFloor(project, audit);
  const topology = makeWalls(audit, floor, centre);
  if (topology.walls.length < 3)
    throw Error(
      "CAD source does not contain enough reliable wall geometry to build a draft.",
    );

  const roomDraft = deriveAutoRoomDrafts(topology.walls, [floor], audit.assetId);
  let rooms = roomDraft.rooms;
  let walls = linkWallsToRooms(topology.walls, rooms);

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

  let semanticLabelsApplied = 0;
  if (rooms.length && evidence.length) {
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
    rooms = semantic.scene.rooms;
    semanticLabelsApplied =
      semantic.roomNamesApplied + semantic.unitRoomsAssigned;
    walls = linkWallsToRooms(walls, rooms);
    if (semantic.reviewRemaining)
      issues.push(
        `${semantic.reviewRemaining} CAD room/unit semantic assignment${semantic.reviewRemaining === 1 ? "" : "s"} remain review-only because source labels conflict or are ambiguous.`,
      );
  }

  const openings = makeOpenings(audit, floor, centre, walls);
  if (roomDraft.skippedFloors.length)
    issues.push(
      "CAD walls were reconstructed, but one or more closed room loops still need topology review.",
    );
  if (openings.length)
    issues.push(
      "CAD door/window positions were reconstructed from plan geometry; default vertical heights/sills remain suggested until reviewed.",
    );

  return {
    scene: {
      ...project.scene,
      floors: [floor],
      rooms,
      walls,
      openings,
      modelId: undefined,
      publishModelId: undefined,
      scale: 1,
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
      modelNodeTags: [],
    },
    sourceAssetId: audit.assetId,
    wallCount: walls.length,
    roomCount: rooms.length,
    openingCount: openings.length,
    semanticLabelsApplied,
    sourceCentre: centre,
    issues,
  };
}
