import type { Floor, Scene, VerticalConnector, Wall } from "./domain";

export const READY_WALL_CONFIDENCE = 0.9;
export const READY_REPEAT_CONFIDENCE = 0.92;
export const READY_CONNECTOR_CONFIDENCE = 0.9;

export interface AutoBuildingReviewCounts {
  readyWalls: number;
  wallReview: number;
  approvedWalls: number;
  readyRepeats: number;
  repeatReview: number;
  acceptedRepeats: number;
  readyConnectors: number;
  connectorReview: number;
  approvedConnectors: number;
}

function automaticWall(wall: Wall) {
  return wall.origin === "model-auto" || wall.origin === "cad-auto";
}

function wallIsAutoReady(wall: Wall) {
  return (
    !wall.reviewed &&
    automaticWall(wall) &&
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

function connectorIsAutoReady(connector: VerticalConnector) {
  return (
    !connector.reviewed &&
    connector.origin !== "manual" &&
    (connector.reviewState === "auto_ready" ||
      (connector.reviewState === undefined &&
        (connector.confidence ?? 0) >= READY_CONNECTOR_CONFIDENCE))
  );
}

export function autoBuildingReviewCounts(
  scene: Scene,
): AutoBuildingReviewCounts {
  const walls = scene.walls ?? [];
  const repeated = scene.floors.filter((floor) => floor.repeatOfFloorId);
  const connectors = scene.verticalConnectors ?? [];
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
    readyConnectors: connectors.filter(connectorIsAutoReady).length,
    connectorReview: connectors.filter(
      (connector) =>
        !connector.reviewed && !connectorIsAutoReady(connector),
    ).length,
    approvedConnectors: connectors.filter(
      (connector) => connector.reviewed,
    ).length,
  };
}

/**
 * Marks conservative model/CAD wall suggestions as ready for a person to
 * approve. This function never turns machine confidence into human review.
 *
 * The legacy function name is retained because Studio already imports it.
 */
export function markAutoReadyModelWalls(scene: Scene): {
  scene: Scene;
  prepared: number;
} {
  let prepared = 0;
  const walls = (scene.walls ?? []).map((wall) => {
    if (
      wall.reviewed ||
      !automaticWall(wall) ||
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
 * Explicit user action: converts ready model/CAD wall suggestions into
 * human-reviewed architecture. Legacy high-confidence drafts without
 * reviewState remain approvable for backwards compatibility.
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


/**
 * Marks high-confidence automatic stair/lift connectors ready for explicit
 * operator review without turning machine confidence into human approval.
 */
export function markAutoReadyVerticalConnectors(scene: Scene): {
  scene: Scene;
  prepared: number;
} {
  let prepared = 0;
  const verticalConnectors = (scene.verticalConnectors ?? []).map(
    (connector) => {
      if (
        connector.reviewed ||
        connector.origin === "manual" ||
        (connector.confidence ?? 0) < READY_CONNECTOR_CONFIDENCE
      )
        return { ...connector, floorIds: [...connector.floorIds] };
      if (connector.reviewState !== "auto_ready") prepared += 1;
      return {
        ...connector,
        floorIds: [...connector.floorIds],
        reviewed: false,
        reviewState: "auto_ready" as const,
      };
    },
  );
  return {
    scene: {
      ...scene,
      verticalConnectors,
    },
    prepared,
  };
}

/**
 * Explicit user action: approves ready stair/lift connector suggestions.
 */
export function approveReadyVerticalConnectors(scene: Scene): {
  scene: Scene;
  approved: number;
} {
  let approved = 0;
  const verticalConnectors = (scene.verticalConnectors ?? []).map(
    (connector) => {
      if (!connectorIsAutoReady(connector))
        return { ...connector, floorIds: [...connector.floorIds] };
      approved += 1;
      return {
        ...connector,
        floorIds: [...connector.floorIds],
        reviewed: true,
        reviewState: "human_reviewed" as const,
      };
    },
  );
  return {
    scene: {
      ...scene,
      verticalConnectors,
    },
    approved,
  };
}
