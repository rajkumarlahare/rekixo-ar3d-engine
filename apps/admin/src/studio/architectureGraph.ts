import type {
  Floor,
  ModelTransform,
  Room,
  Wall,
  RoomPoint,
} from "./domain";
import type {
  SmartArchitecturalCandidate,
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";

function rotatePoint(
  x: number,
  z: number,
  degrees: number,
): RoomPoint {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - z * sin, x * sin + z * cos];
}

function worldPoint(
  x: number,
  z: number,
  scale: number,
  transform: ModelTransform | undefined,
): RoomPoint {
  const [rx, rz] = rotatePoint(
    x * scale,
    z * scale,
    transform?.rotationY ?? 0,
  );
  return [rx + (transform?.x ?? 0), rz + (transform?.z ?? 0)];
}

function candidateWall(
  candidate: SmartArchitecturalCandidate,
  floor: Floor,
  scale: number,
  transform: ModelTransform | undefined,
): Wall | undefined {
  const width = Math.max(0, candidate.size[0] * scale);
  const depth = Math.max(0, candidate.size[2] * scale);
  const height = Math.max(0, candidate.size[1] * scale);
  const horizontalLength = Math.max(width, depth);
  if (
    candidate.kind !== "wall" ||
    candidate.confidence < 0.78 ||
    horizontalLength < 0.35 ||
    height < 0.3
  )
    return undefined;

  const alongX = width >= depth;
  const halfSource =
    Math.max(candidate.size[0], candidate.size[2]) / 2;
  const localStart: RoomPoint = alongX
    ? [candidate.position[0] - halfSource, candidate.position[2]]
    : [candidate.position[0], candidate.position[2] - halfSource];
  const localEnd: RoomPoint = alongX
    ? [candidate.position[0] + halfSource, candidate.position[2]]
    : [candidate.position[0], candidate.position[2] + halfSource];

  const start = worldPoint(
    localStart[0],
    localStart[1],
    scale,
    transform,
  );
  const end = worldPoint(localEnd[0], localEnd[1], scale, transform);
  const thickness = Math.min(
    1.2,
    Math.max(0.06, Math.min(width, depth) || 0.12),
  );

  return {
    id: `wall-auto-${candidate.floorIndex ?? 0}-${candidate.occurrence}-${candidate.nodeName
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)}`,
    floorId: floor.id,
    roomIds: [],
    start: start.map((value) => Number(value.toFixed(4))) as RoomPoint,
    end: end.map((value) => Number(value.toFixed(4))) as RoomPoint,
    thickness: Number(thickness.toFixed(4)),
    height: Number(Math.min(20, Math.max(0.3, height)).toFixed(4)),
    reviewed: false,
    origin: "model-auto",
    sourceNodeName: candidate.nodeName,
    sourceOccurrence: candidate.occurrence,
    confidence: Number(candidate.confidence.toFixed(3)),
  };
}

function segmentKey(
  floorId: string,
  start: RoomPoint,
  end: RoomPoint,
) {
  const rounded = (value: number) => Math.round(value * 20) / 20;
  const a = [rounded(start[0]), rounded(start[1])];
  const b = [rounded(end[0]), rounded(end[1])];
  const [left, right] =
    a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])
      ? [a, b]
      : [b, a];
  return `${floorId}:${left[0]},${left[1]}:${right[0]},${right[1]}`;
}

export function deriveModelWallGraph(
  analysis: SmartProjectAnalysis,
  floors: readonly Floor[],
  scale: number,
  transform?: ModelTransform,
): Wall[] {
  const bySourceIndex = new Map(
    [...floors]
      .sort((a, b) => a.elevation - b.elevation)
      .map((floor, index) => [index, floor] as const),
  );
  const byKey = new Map<string, Wall>();

  for (const candidate of analysis.architecturalCandidates) {
    if (candidate.floorIndex === undefined) continue;
    const floor = bySourceIndex.get(candidate.floorIndex);
    if (!floor) continue;
    const wall = candidateWall(candidate, floor, scale, transform);
    if (!wall) continue;
    const key = segmentKey(floor.id, wall.start, wall.end);
    const existing = byKey.get(key);
    if (!existing || (wall.confidence ?? 0) > (existing.confidence ?? 0))
      byKey.set(key, wall);
  }

  return [...byKey.values()];
}

export function deriveRoomBoundaryWalls(
  rooms: readonly Room[],
): Wall[] {
  const byKey = new Map<string, Wall>();
  for (const room of rooms) {
    const points: RoomPoint[] = room.polygon?.length
      ? room.polygon
      : [
          [room.x - room.width / 2, room.z - room.depth / 2],
          [room.x + room.width / 2, room.z - room.depth / 2],
          [room.x + room.width / 2, room.z + room.depth / 2],
          [room.x - room.width / 2, room.z + room.depth / 2],
        ];
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.03)
        continue;
      const key = segmentKey(room.floorId, start, end);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.roomIds.includes(room.id) && existing.roomIds.length < 2)
          existing.roomIds.push(room.id);
        existing.reviewed = existing.reviewed && room.verified;
        continue;
      }
      byKey.set(key, {
        id: `wall-room-${room.id}-${index}`,
        floorId: room.floorId,
        roomIds: [room.id],
        start: [...start],
        end: [...end],
        thickness: 0.12,
        height: room.height,
        reviewed: room.verified,
        origin: "room-derived",
        confidence: room.verified ? 1 : 0.75,
      });
    }
  }
  return [...byKey.values()];
}

export function mergeWallGraphs(
  preferred: readonly Wall[],
  fallback: readonly Wall[],
) {
  const result = new Map<string, Wall>();
  for (const wall of fallback)
    result.set(segmentKey(wall.floorId, wall.start, wall.end), {
      ...wall,
      roomIds: [...wall.roomIds],
    });
  for (const wall of preferred)
    result.set(segmentKey(wall.floorId, wall.start, wall.end), {
      ...wall,
      roomIds: [...wall.roomIds],
    });
  return [...result.values()];
}


function boundaryPoints(room: Room): RoomPoint[] {
  return room.polygon?.length
    ? room.polygon
    : [
        [room.x - room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z - room.depth / 2],
        [room.x + room.width / 2, room.z + room.depth / 2],
        [room.x - room.width / 2, room.z + room.depth / 2],
      ];
}

function wallRoomOverlap(
  wall: Pick<Wall, "start" | "end" | "thickness">,
  left: RoomPoint,
  right: RoomPoint,
) {
  const wx = wall.end[0] - wall.start[0];
  const wz = wall.end[1] - wall.start[1];
  const wallLength = Math.hypot(wx, wz);
  const ex = right[0] - left[0];
  const ez = right[1] - left[1];
  const edgeLength = Math.hypot(ex, ez);
  if (wallLength < 0.03 || edgeLength < 0.03) return 0;

  const wux = wx / wallLength;
  const wuz = wz / wallLength;
  const eux = ex / edgeLength;
  const euz = ez / edgeLength;
  const parallel = Math.abs(wux * eux + wuz * euz);
  if (parallel < 0.985) return 0;

  const edgeMidX = (left[0] + right[0]) / 2;
  const edgeMidZ = (left[1] + right[1]) / 2;
  const vx = edgeMidX - wall.start[0];
  const vz = edgeMidZ - wall.start[1];
  const perpendicular = Math.abs(vx * -wuz + vz * wux);
  if (perpendicular > Math.max(0.16, wall.thickness * 1.5)) return 0;

  const a = (left[0] - wall.start[0]) * wux + (left[1] - wall.start[1]) * wuz;
  const b = (right[0] - wall.start[0]) * wux + (right[1] - wall.start[1]) * wuz;
  const from = Math.max(0, Math.min(a, b));
  const to = Math.min(wallLength, Math.max(a, b));
  return Math.max(0, to - from);
}

export function linkWallsToRooms(
  walls: readonly Wall[],
  rooms: readonly Room[],
): Wall[] {
  return walls.map((wall) => {
    const matches = rooms
      .filter((room) => room.floorId === wall.floorId)
      .map((room) => {
        const points = boundaryPoints(room);
        let overlap = 0;
        for (let index = 0; index < points.length; index += 1)
          overlap = Math.max(
            overlap,
            wallRoomOverlap(
              wall,
              points[index],
              points[(index + 1) % points.length],
            ),
          );
        return { roomId: room.id, overlap };
      })
      .filter((match) => match.overlap >= 0.18)
      .sort((left, right) => right.overlap - left.overlap);

    const strong = matches.filter(
      (match) => match.overlap >= Math.max(0.18, matches[0]?.overlap * 0.35),
    );
    const roomIds =
      strong.length <= 2
        ? strong.map((match) => match.roomId)
        : [];

    return {
      ...wall,
      roomIds,
    };
  });
}


function cadFloorIndex(
  audit: SmartCadAudit,
  floorCount: number,
): number | undefined {
  if (floorCount === 1) return 0;
  const text = [
    audit.name,
    ...audit.layerHints.map((entry) => entry.layer),
    ...(audit.textLabels ?? []).map((entry) => entry.text),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  if (/\b(?:ground floor|ground|gf|g floor)\b/.test(text)) return 0;
  const words: Array<[RegExp, number]> = [
    [/\b(?:first floor|1st floor|floor 1|f1)\b/, 1],
    [/\b(?:second floor|2nd floor|floor 2|f2)\b/, 2],
    [/\b(?:third floor|3rd floor|floor 3|f3)\b/, 3],
    [/\b(?:fourth floor|4th floor|floor 4|f4)\b/, 4],
    [/\b(?:fifth floor|5th floor|floor 5|f5)\b/, 5],
    [/\b(?:sixth floor|6th floor|floor 6|f6)\b/, 6],
  ];
  for (const [pattern, index] of words)
    if (index < floorCount && pattern.test(text)) return index;
  return undefined;
}

function transformedCadPoint(
  point: RoomPoint,
  centre: RoomPoint,
  targetCentre: RoomPoint,
  quarterTurn: boolean,
): RoomPoint {
  const x = point[0] - centre[0];
  const z = point[1] - centre[1];
  const rx = quarterTurn ? -z : x;
  const rz = quarterTurn ? x : z;
  return [
    Number((targetCentre[0] + rx).toFixed(4)),
    Number((targetCentre[1] + rz).toFixed(4)),
  ];
}

export interface CadWallGraphResult {
  walls: Wall[];
  auditAssetId?: string;
  floorIndex?: number;
  quarterTurn: boolean;
  compatible: boolean;
  reason?: string;
}

export function deriveCadWallGraph(
  analysis: SmartProjectAnalysis,
  floors: readonly Floor[],
  scale: number,
  transform?: ModelTransform,
): CadWallGraphResult {
  const audit = analysis.cadAudits.find(
    (entry) =>
      (entry.kind === "dxf" || entry.kind === "dwg") &&
      entry.geometryReady &&
      (entry.semanticSegments?.some((segment) => segment.kind === "wall") ??
        false),
  );
  if (!audit)
    return {
      walls: [],
      quarterTurn: false,
      compatible: false,
      reason: "No normalized CAD wall geometry is ready.",
    };

  const floorIndex = cadFloorIndex(audit, floors.length);
  const floor = floorIndex !== undefined ? floors[floorIndex] : undefined;
  if (!floor)
    return {
      walls: [],
      auditAssetId: audit.assetId,
      quarterTurn: false,
      compatible: false,
      reason:
        "CAD floor identity is ambiguous; keep normalized geometry as review evidence.",
    };

  const wallSegments = (audit.semanticSegments ?? []).filter(
    (segment) => segment.kind === "wall",
  );
  if (!wallSegments.length)
    return {
      walls: [],
      auditAssetId: audit.assetId,
      floorIndex,
      quarterTurn: false,
      compatible: false,
      reason: "CAD source contains no normalized wall segments.",
    };

  const cadPoints = wallSegments.flatMap((segment) => [
    segment.start,
    segment.end,
  ]);
  const minX = Math.min(...cadPoints.map((point) => point[0]));
  const maxX = Math.max(...cadPoints.map((point) => point[0]));
  const minZ = Math.min(...cadPoints.map((point) => point[1]));
  const maxZ = Math.max(...cadPoints.map((point) => point[1]));
  const cadWidth = maxX - minX;
  const cadDepth = maxZ - minZ;
  if (cadWidth < 0.5 || cadDepth < 0.5)
    return {
      walls: [],
      auditAssetId: audit.assetId,
      floorIndex,
      quarterTurn: false,
      compatible: false,
      reason: "CAD wall bounds are too small for building reconstruction.",
    };

  let targetCentre: RoomPoint = [0, 0];
  let quarterTurn = false;
  if (analysis.bounds) {
    const sourceWidth =
      Math.max(0.01, analysis.bounds.max[0] - analysis.bounds.min[0]) *
      scale;
    const sourceDepth =
      Math.max(0.01, analysis.bounds.max[2] - analysis.bounds.min[2]) *
      scale;
    const directError =
      Math.abs(Math.log(cadWidth / sourceWidth)) +
      Math.abs(Math.log(cadDepth / sourceDepth));
    const rotatedError =
      Math.abs(Math.log(cadDepth / sourceWidth)) +
      Math.abs(Math.log(cadWidth / sourceDepth));
    quarterTurn = rotatedError + 0.03 < directError;
    const bestError = Math.min(directError, rotatedError);
    if (bestError > 0.75)
      return {
        walls: [],
        auditAssetId: audit.assetId,
        floorIndex,
        quarterTurn,
        compatible: false,
        reason:
          "CAD/model footprint dimensions disagree too much for automatic alignment.",
      };

    const modelCentreX =
      ((analysis.bounds.min[0] + analysis.bounds.max[0]) / 2) * scale;
    const modelCentreZ =
      ((analysis.bounds.min[2] + analysis.bounds.max[2]) / 2) * scale;
    const rotated = rotatePoint(
      modelCentreX,
      modelCentreZ,
      transform?.rotationY ?? 0,
    );
    targetCentre = [
      rotated[0] + (transform?.x ?? 0),
      rotated[1] + (transform?.z ?? 0),
    ];
  } else {
    targetCentre = [transform?.x ?? 0, transform?.z ?? 0];
  }

  const cadCentre: RoomPoint = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const walls = wallSegments
    .map((segment, index): Wall | undefined => {
      const start = transformedCadPoint(
        segment.start,
        cadCentre,
        targetCentre,
        quarterTurn,
      );
      const end = transformedCadPoint(
        segment.end,
        cadCentre,
        targetCentre,
        quarterTurn,
      );
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.12)
        return undefined;
      return {
        id: `wall-cad-${audit.assetId.slice(0, 12)}-${index + 1}`,
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
        confidence: audit.kind === "dwg" ? 0.92 : 0.86,
      };
    })
    .filter((wall): wall is Wall => Boolean(wall));

  return {
    walls,
    auditAssetId: audit.assetId,
    floorIndex,
    quarterTurn,
    compatible: walls.length > 0,
  };
}
