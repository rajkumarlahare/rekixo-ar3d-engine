import type { Floor, Scene, Wall } from "./domain";

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

function wallIsAutoReady(wall: Wall) {
  return (
    !wall.reviewed &&
    wall.origin === "model-auto" &&
    (wall.reviewState === "auto_ready" ||
      (wall.reviewState === undefined &&
        (wall.confidence ?? 0) >= READY_WALL_CONFIDENCE))
  );
}

function repeatIsAutoReady(floor: Floor) {
  return (
    Boolean(floor.repeatOfFloorId) &&
    floor.repeatReviewed !== true &&
    (floor.repeatReviewState === "auto_ready" ||
      (floor.repeatReviewState === undefined &&
        (floor.repeatConfidence ?? 0) >= READY_REPEAT_CONFIDENCE))
  );
}

export function autoBuildingReviewCounts(
  scene: Scene,
): AutoBuildingReviewCounts {
  const walls = scene.walls ?? [];
  const repeated = scene.floors.filter((floor) => floor.repeatOfFloorId);
  return {
    readyWalls: walls.filter(wallIsAutoReady).length,
    wallReview: walls.filter(
      (wall) => !wall.reviewed && !wallIsAutoReady(wall),
    ).length,
    approvedWalls: walls.filter((wall) => wall.reviewed).length,
    readyRepeats: repeated.filter(repeatIsAutoReady).length,
    repeatReview: repeated.filter(
      (floor) => floor.repeatReviewed !== true && !repeatIsAutoReady(floor),
    ).length,
    acceptedRepeats: repeated.filter(
      (floor) => floor.repeatReviewed === true,
    ).length,
  };
}

/**
 * Marks conservative algorithmic wall suggestions as ready for a person to
 * approve. This function never turns machine confidence into human review.
 */
export function markAutoReadyModelWalls(scene: Scene): {
  scene: Scene;
  prepared: number;
} {
  let prepared = 0;
  const walls = (scene.walls ?? []).map((wall) => {
    if (
      wall.reviewed ||
      wall.origin !== "model-auto" ||
      (wall.confidence ?? 0) < READY_WALL_CONFIDENCE
    )
      return { ...wall, roomIds: [...wall.roomIds] };
    if (wall.reviewState !== "auto_ready") prepared += 1;
    return {
      ...wall,
      roomIds: [...wall.roomIds],
      reviewed: false,
      reviewState: "auto_ready" as const,
    };
  });
  return {
    scene: {
      ...scene,
      walls,
    },
    prepared,
  };
}

/**
 * Explicit user action: converts ready wall suggestions into human-reviewed
 * architecture. Legacy high-confidence drafts without reviewState remain
 * approvable for backwards compatibility.
 */
export function approveReadyModelWalls(scene: Scene): {
  scene: Scene;
  approved: number;
} {
  let approved = 0;
  const walls = (scene.walls ?? []).map((wall) => {
    if (!wallIsAutoReady(wall))
      return { ...wall, roomIds: [...wall.roomIds] };
    approved += 1;
    return {
      ...wall,
      roomIds: [...wall.roomIds],
      reviewed: true,
      reviewState: "human_reviewed" as const,
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

/**
 * Marks repeated-floor detections as ready without accepting them on behalf of
 * the operator.
 */
export function markAutoReadyRepeatedFloors(scene: Scene): {
  scene: Scene;
  prepared: number;
} {
  let prepared = 0;
  const floors = scene.floors.map((floor) => {
    if (
      !floor.repeatOfFloorId ||
      floor.repeatReviewed === true ||
      (floor.repeatConfidence ?? 0) < READY_REPEAT_CONFIDENCE
    )
      return { ...floor };
    if (floor.repeatReviewState !== "auto_ready") prepared += 1;
    return {
      ...floor,
      repeatReviewed: false,
      repeatReviewState: "auto_ready" as const,
    };
  });
  return {
    scene: {
      ...scene,
      floors,
    },
    prepared,
  };
}

/**
 * Explicit user action: accepts a repeated-floor relationship.
 */
export function acceptReadyRepeatedFloors(scene: Scene): {
  scene: Scene;
  accepted: number;
} {
  let accepted = 0;
  const floors = scene.floors.map((floor) => {
    if (!repeatIsAutoReady(floor)) return { ...floor };
    accepted += 1;
    return {
      ...floor,
      repeatReviewed: true,
      repeatReviewState: "human_reviewed" as const,
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
