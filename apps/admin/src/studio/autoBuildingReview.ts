import type { Scene } from "./domain";

export const READY_WALL_CONFIDENCE = 0.9;
export const READY_REPEAT_CONFIDENCE = 0.92;

export interface AutoBuildingReviewCounts {
  readyWalls: number;
  wallReview: number;
  approvedWalls: number;
  readyRepeats: number;
  repeatReview: number;
  acceptedRepeats: number;
}

export function autoBuildingReviewCounts(
  scene: Scene,
): AutoBuildingReviewCounts {
  const walls = scene.walls ?? [];
  const repeated = scene.floors.filter((floor) => floor.repeatOfFloorId);
  return {
    readyWalls: walls.filter(
      (wall) =>
        !wall.reviewed &&
        wall.origin === "model-auto" &&
        (wall.confidence ?? 0) >= READY_WALL_CONFIDENCE,
    ).length,
    wallReview: walls.filter(
      (wall) =>
        !wall.reviewed &&
        !(
          wall.origin === "model-auto" &&
          (wall.confidence ?? 0) >= READY_WALL_CONFIDENCE
        ),
    ).length,
    approvedWalls: walls.filter((wall) => wall.reviewed).length,
    readyRepeats: repeated.filter(
      (floor) =>
        floor.repeatReviewed !== true &&
        (floor.repeatConfidence ?? 0) >= READY_REPEAT_CONFIDENCE,
    ).length,
    repeatReview: repeated.filter(
      (floor) =>
        floor.repeatReviewed !== true &&
        (floor.repeatConfidence ?? 0) < READY_REPEAT_CONFIDENCE,
    ).length,
    acceptedRepeats: repeated.filter(
      (floor) => floor.repeatReviewed === true,
    ).length,
  };
}

export function approveReadyModelWalls(scene: Scene): {
  scene: Scene;
  approved: number;
} {
  let approved = 0;
  const walls = (scene.walls ?? []).map((wall) => {
    if (
      wall.reviewed ||
      wall.origin !== "model-auto" ||
      (wall.confidence ?? 0) < READY_WALL_CONFIDENCE
    )
      return { ...wall, roomIds: [...wall.roomIds] };
    approved += 1;
    return {
      ...wall,
      roomIds: [...wall.roomIds],
      reviewed: true,
    };
  });
  return {
    scene: {
      ...scene,
      walls,
    },
    approved,
  };
}

export function acceptReadyRepeatedFloors(scene: Scene): {
  scene: Scene;
  accepted: number;
} {
  let accepted = 0;
  const floors = scene.floors.map((floor) => {
    if (
      !floor.repeatOfFloorId ||
      floor.repeatReviewed === true ||
      (floor.repeatConfidence ?? 0) < READY_REPEAT_CONFIDENCE
    )
      return { ...floor };
    accepted += 1;
    return {
      ...floor,
      repeatReviewed: true,
    };
  });
  return {
    scene: {
      ...scene,
      floors,
    },
    accepted,
  };
}
