import type {
  SemanticOpening,
  SemanticWall,
} from "./semanticInteriorRuntime";

export interface WallRenderPiece {
  wallId: string;
  floorId: string;
  center: [number, number, number];
  length: number;
  height: number;
  thickness: number;
  rotationY: number;
  from: number;
  to: number;
  bottom: number;
  top: number;
}

interface OpeningCut {
  start: number;
  end: number;
  bottom: number;
  top: number;
}

function roomEvidenceCompatible(
  wall: SemanticWall,
  opening: SemanticOpening,
) {
  if (!wall.roomIds.length || !opening.roomIds.length) return true;
  const rooms = new Set(wall.roomIds);
  return opening.roomIds.some((roomId) => rooms.has(roomId));
}

function cutsForWall(
  wall: SemanticWall,
  openings: readonly SemanticOpening[],
) {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dz);
  if (length < 0.03) return { length, dx, dz, cuts: [] as OpeningCut[] };
  const ux = dx / length;
  const uz = dz / length;
  const normalX = -uz;
  const normalZ = ux;
  const tolerance = Math.max(0.18, wall.thickness * 2.2);
  const cuts: OpeningCut[] = [];

  for (const opening of openings) {
    if (
      opening.floorId !== wall.floorId ||
      !roomEvidenceCompatible(wall, opening)
    )
      continue;
    const vx = opening.x - wall.start[0];
    const vz = opening.z - wall.start[1];
    const along = vx * ux + vz * uz;
    const perpendicular = Math.abs(vx * normalX + vz * normalZ);
    if (
      perpendicular > tolerance ||
      along < -opening.width / 2 ||
      along > length + opening.width / 2
    )
      continue;

    const start = Math.max(0, along - opening.width / 2);
    const end = Math.min(length, along + opening.width / 2);
    const bottom =
      opening.kind === "window"
        ? Math.max(
            0,
            opening.sillHeight ??
              opening.y - wall.elevation - opening.height / 2,
          )
        : Math.max(0, opening.sillHeight ?? 0);
    const top = Math.min(wall.height, bottom + opening.height);
    if (end - start < 0.02 || top - bottom < 0.02) continue;
    if (bottom >= wall.height || top <= 0) continue;
    cuts.push({
      start,
      end,
      bottom: Math.min(wall.height, bottom),
      top: Math.max(0, top),
    });
  }

  return { length, dx, dz, cuts };
}

export function buildReviewedWallPieces(
  wall: SemanticWall,
  openings: readonly SemanticOpening[],
): WallRenderPiece[] {
  const { length, dx, dz, cuts } = cutsForWall(wall, openings);
  if (length < 0.03) return [];
  const ux = dx / length;
  const uz = dz / length;
  const rotationY = (Math.atan2(-dz, dx) * 180) / Math.PI;
  const boundaries = Array.from(
    new Set([
      0,
      length,
      ...cuts.flatMap((cut) => [cut.start, cut.end]),
    ]),
  ).sort((left, right) => left - right);
  const pieces: WallRenderPiece[] = [];

  const addPiece = (
    from: number,
    to: number,
    bottom: number,
    top: number,
  ) => {
    const pieceLength = to - from;
    const pieceHeight = top - bottom;
    if (pieceLength < 0.02 || pieceHeight < 0.02) return;
    const mid = (from + to) / 2;
    pieces.push({
      wallId: wall.id,
      floorId: wall.floorId,
      center: [
        wall.start[0] + ux * mid,
        wall.elevation + bottom + pieceHeight / 2,
        wall.start[1] + uz * mid,
      ],
      length: pieceLength,
      height: pieceHeight,
      thickness: wall.thickness,
      rotationY,
      from,
      to,
      bottom,
      top,
    });
  };

  if (!cuts.length) {
    addPiece(0, length, 0, wall.height);
    return pieces;
  }

  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const from = boundaries[index];
    const to = boundaries[index + 1];
    if (to - from < 0.02) continue;
    const mid = (from + to) / 2;
    const active = cuts.filter(
      (cut) => mid >= cut.start - 1e-6 && mid <= cut.end + 1e-6,
    );
    if (!active.length) {
      addPiece(from, to, 0, wall.height);
      continue;
    }
    const bottom = Math.min(...active.map((cut) => cut.bottom));
    const top = Math.max(...active.map((cut) => cut.top));
    if (bottom > 0.02) addPiece(from, to, 0, bottom);
    if (top < wall.height - 0.02) addPiece(from, to, top, wall.height);
  }
  return pieces;
}

export function buildAllReviewedWallPieces(
  walls: readonly SemanticWall[],
  openings: readonly SemanticOpening[],
) {
  return walls.flatMap((wall) => buildReviewedWallPieces(wall, openings));
}
