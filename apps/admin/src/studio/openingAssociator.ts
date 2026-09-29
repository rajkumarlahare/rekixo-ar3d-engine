import {
  roomBoundaryPoints,
  type OpeningKind,
  type Room,
  type RoomPoint,
  type Scene,
} from "./domain";
import type {
  SmartArchitecturalCandidate,
  SmartProjectAnalysis,
} from "./projectAnalyzer";

export interface OpeningSuggestion {
  key: string;
  sourceNodeName: string;
  sourceOccurrence: number;
  kind: Extract<OpeningKind, "door" | "window">;
  floorId?: string;
  roomIds: string[];
  position: [number, number, number];
  width: number;
  height: number;
  sillHeight?: number;
  rotationY: number;
  wallDistance: number;
  confidence: number;
  ready: boolean;
  reasons: string[];
}

interface WallHit {
  room: Room;
  edgeIndex: number;
  point: RoomPoint;
  distance: number;
  direction: RoomPoint;
}

function closestPointOnSegment(
  point: RoomPoint,
  left: RoomPoint,
  right: RoomPoint,
): { point: RoomPoint; distance: number; direction: RoomPoint } {
  const dx = right[0] - left[0];
  const dz = right[1] - left[1];
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - left[0]) * dx + (point[1] - left[1]) * dz) /
              lengthSquared,
          ),
        )
      : 0;
  const closest: RoomPoint = [left[0] + t * dx, left[1] + t * dz];
  const length = Math.hypot(dx, dz) || 1;
  return {
    point: closest,
    distance: Math.hypot(point[0] - closest[0], point[1] - closest[1]),
    direction: [dx / length, dz / length],
  };
}

function nearestRoomWall(room: Room, point: RoomPoint): WallHit | undefined {
  const boundary = roomBoundaryPoints(room);
  let best: WallHit | undefined;
  for (let index = 0; index < boundary.length; index += 1) {
    const result = closestPointOnSegment(
      point,
      boundary[index],
      boundary[(index + 1) % boundary.length],
    );
    if (!best || result.distance < best.distance)
      best = {
        room,
        edgeIndex: index,
        point: result.point,
        distance: result.distance,
        direction: result.direction,
      };
  }
  return best;
}

function transformXZ(
  x: number,
  z: number,
  scene: Scene,
): [number, number] {
  const scale = scene.scale;
  const angle =
    ((scene.modelTransform?.rotationY ?? 0) * Math.PI) / 180;
  const sx = x * scale;
  const sz = z * scale;
  return [
    (scene.modelTransform?.x ?? 0) +
      sx * Math.cos(angle) +
      sz * Math.sin(angle),
    (scene.modelTransform?.z ?? 0) -
      sx * Math.sin(angle) +
      sz * Math.cos(angle),
  ];
}

function candidateFloor(
  candidate: SmartArchitecturalCandidate,
  analysis: Pick<SmartProjectAnalysis, "floorCandidates">,
  scene: Scene,
) {
  const modelY = scene.modelTransform?.y ?? 0;
  const sourceFloor =
    candidate.floorIndex !== undefined
      ? analysis.floorCandidates[candidate.floorIndex]
      : undefined;
  const expectedElevation = sourceFloor
    ? sourceFloor.elevation * scene.scale + modelY
    : candidate.position[1] * scene.scale +
      modelY -
      (candidate.size[1] * scene.scale) / 2;
  return [...scene.floors].sort(
    (left, right) =>
      Math.abs(left.elevation - expectedElevation) -
      Math.abs(right.elevation - expectedElevation),
  )[0];
}

function dimensionsArePlausible(
  kind: "door" | "window",
  width: number,
  height: number,
  sillHeight: number,
) {
  if (kind === "door")
    return (
      width >= 0.45 &&
      width <= 4 &&
      height >= 1.5 &&
      height <= 3.8 &&
      sillHeight <= 0.4
    );
  return (
    width >= 0.25 &&
    width <= 8 &&
    height >= 0.25 &&
    height <= 4 &&
    sillHeight >= 0.05 &&
    sillHeight <= 3
  );
}

export function suggestOpeningAssociations(
  analysis: Pick<
    SmartProjectAnalysis,
    "architecturalCandidates" | "floorCandidates"
  >,
  scene: Scene,
): OpeningSuggestion[] {
  const result: OpeningSuggestion[] = [];
  const modelY = scene.modelTransform?.y ?? 0;

  for (const candidate of analysis.architecturalCandidates) {
    if (candidate.kind !== "door" && candidate.kind !== "window") continue;

    const floor = candidateFloor(candidate, analysis, scene);
    const [worldX, worldZ] = transformXZ(
      candidate.position[0],
      candidate.position[2],
      scene,
    );
    const worldY = candidate.position[1] * scene.scale + modelY;
    const width =
      Math.max(candidate.size[0], candidate.size[2]) * scene.scale;
    const thickness =
      Math.min(candidate.size[0], candidate.size[2]) * scene.scale;
    const height = candidate.size[1] * scene.scale;
    const sillHeight = floor
      ? Math.max(0, worldY - height / 2 - floor.elevation)
      : 0;

    const hits = floor
      ? scene.rooms
          .filter((room) => room.floorId === floor.id)
          .map((room) => nearestRoomWall(room, [worldX, worldZ]))
          .filter((hit): hit is WallHit => Boolean(hit))
          .sort((left, right) => left.distance - right.distance)
      : [];
    const best = hits[0];
    const maxWallDistance = Math.min(
      1.2,
      Math.max(0.35, thickness * 3 + 0.2),
    );

    const rooms: Room[] = [];
    if (best && best.distance <= maxWallDistance) {
      rooms.push(best.room);
      if (candidate.kind === "door") {
        const second = hits.find((hit) => {
          if (hit.room.id === best.room.id) return false;
          if (hit.distance > Math.min(maxWallDistance, best.distance + 0.1))
            return false;
          const anchorDistance = Math.hypot(
            hit.point[0] - best.point[0],
            hit.point[1] - best.point[1],
          );
          const parallel = Math.abs(
            hit.direction[0] * best.direction[0] +
              hit.direction[1] * best.direction[1],
          );
          return anchorDistance <= 0.4 && parallel >= 0.94;
        });
        if (second) rooms.push(second.room);
      }
    }

    const wallDistance = best?.distance ?? Number.POSITIVE_INFINITY;
    const distanceFactor =
      best && wallDistance <= maxWallDistance
        ? 1 - Math.min(0.45, (wallDistance / maxWallDistance) * 0.45)
        : 0.45;
    const plausible = dimensionsArePlausible(
      candidate.kind,
      width,
      height,
      sillHeight,
    );
    const confidence = Number(
      Math.max(
        0.1,
        Math.min(
          0.99,
          candidate.confidence *
            distanceFactor *
            (plausible ? 1 : 0.65) *
            (rooms.length ? 1 : 0.65),
        ),
      ).toFixed(3),
    );
    const ready =
      Boolean(floor) &&
      rooms.length > 0 &&
      wallDistance <= maxWallDistance &&
      plausible &&
      confidence >= 0.78;

    const reasons = [...candidate.reasons];
    if (!floor) reasons.push("no mapped floor association");
    if (best)
      reasons.push(
        `nearest mapped wall ${wallDistance.toFixed(2)} m away`,
      );
    else reasons.push("no mapped room wall on candidate floor");
    if (rooms.length === 2) reasons.push("shared wall links two rooms");
    if (!plausible) reasons.push("opening dimensions need review");

    result.push({
      key: `${candidate.nodeName}\u0000${candidate.occurrence}`,
      sourceNodeName: candidate.nodeName,
      sourceOccurrence: candidate.occurrence,
      kind: candidate.kind,
      floorId: floor?.id,
      roomIds: rooms.map((room) => room.id),
      position: [
        best?.point[0] ?? worldX,
        worldY,
        best?.point[1] ?? worldZ,
      ],
      width: Number(width.toFixed(3)),
      height: Number(height.toFixed(3)),
      sillHeight:
        candidate.kind === "window"
          ? Number(sillHeight.toFixed(3))
          : undefined,
      rotationY: best
        ? Number(
            (
              (Math.atan2(-best.direction[1], best.direction[0]) * 180) /
              Math.PI
            ).toFixed(3),
          )
        : 0,
      wallDistance: Number(
        Number.isFinite(wallDistance) ? wallDistance.toFixed(3) : 9999,
      ),
      confidence,
      ready,
      reasons,
    });
  }

  return result.sort(
    (left, right) =>
      Number(right.ready) - Number(left.ready) ||
      right.confidence - left.confidence ||
      left.sourceNodeName.localeCompare(right.sourceNodeName),
  );
}
