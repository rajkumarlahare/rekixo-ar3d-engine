import type {
  ModelNodeTag,
  Opening,
  Room,
  Scene,
} from "./domain";
import type { OpeningSuggestion } from "./openingAssociator";
import type { SmartArchitecturalCandidate } from "./projectAnalyzer";

export type OpeningApprovalMode = "auto" | "human";

export interface OpeningWorkflowResult {
  scene: Scene;
  autoLabelsApplied: number;
  manualLabelsPreserved: number;
  readyFound: number;
  prepared: number;
  approved: number;
  alreadyApproved: number;
  reviewRemaining: number;
}

function nodeKey(nodeName: string, occurrence: number) {
  return `${nodeName}\u0000${occurrence}`;
}

function applyConfidentArchitecturalLabels(
  scene: Scene,
  candidates: readonly SmartArchitecturalCandidate[],
  threshold = 0.82,
) {
  const previous = scene.modelNodeTags ?? [];
  const byKey = new Map<string, ModelNodeTag>();

  for (const tag of previous) {
    const cleaned = { ...tag };
    if (cleaned.semanticAssignment === "auto") {
      delete cleaned.semantic;
      delete cleaned.semanticAssignment;
      delete cleaned.semanticConfidence;
    }
    const keep =
      Boolean(cleaned.floorId) ||
      Boolean(cleaned.unit) ||
      Boolean(cleaned.roomId) ||
      Boolean(cleaned.assignment) ||
      cleaned.confidence !== undefined ||
      Boolean(cleaned.semantic) ||
      Boolean(cleaned.semanticAssignment) ||
      cleaned.semanticConfidence !== undefined;
    if (keep)
      byKey.set(
        nodeKey(cleaned.nodeName, cleaned.occurrence),
        cleaned,
      );
  }

  let applied = 0;
  let preservedManual = 0;
  for (const candidate of candidates) {
    if (candidate.confidence < threshold) continue;
    const key = nodeKey(candidate.nodeName, candidate.occurrence);
    const original = previous.find(
      (tag) =>
        tag.nodeName === candidate.nodeName &&
        tag.occurrence === candidate.occurrence,
    );
    if (original?.semanticAssignment === "manual") {
      preservedManual += 1;
      continue;
    }
    const current = byKey.get(key) ?? {
      nodeName: candidate.nodeName,
      occurrence: candidate.occurrence,
    };
    byKey.set(key, {
      ...current,
      semantic: candidate.kind,
      semanticAssignment: "auto",
      semanticConfidence: candidate.confidence,
    });
    applied += 1;
  }

  return {
    tags: [...byKey.values()],
    applied,
    preservedManual,
  };
}

function reviewedTagForSuggestion(
  current: ModelNodeTag,
  suggestion: OpeningSuggestion,
  associatedRooms: Room[],
  mode: OpeningApprovalMode,
): ModelNodeTag {
  const sharedUnit =
    associatedRooms.length > 0 &&
    associatedRooms.every(
      (candidate) => candidate.unit === associatedRooms[0].unit,
    )
      ? associatedRooms[0].unit
      : undefined;
  const human = mode === "human";
  const next: ModelNodeTag = {
    ...current,
    floorId: suggestion.floorId,
    assignment: human ? "manual" : "auto",
    confidence: human ? 1 : suggestion.confidence,
    semantic: suggestion.kind,
    semanticAssignment: human ? "manual" : "auto",
    semanticConfidence: human ? 1 : suggestion.confidence,
  };
  if (suggestion.roomIds.length === 1) {
    next.roomId = suggestion.roomIds[0];
    if (associatedRooms[0]?.unit) next.unit = associatedRooms[0].unit;
    else delete next.unit;
  } else {
    delete next.roomId;
    if (sharedUnit) next.unit = sharedUnit;
    else delete next.unit;
  }
  return next;
}

export function applyReadyOpeningWorkflow(
  scene: Scene,
  candidates: readonly SmartArchitecturalCandidate[],
  suggestions: readonly OpeningSuggestion[],
  makeId: () => string = () => crypto.randomUUID(),
  mode: OpeningApprovalMode = "human",
): OpeningWorkflowResult {
  const labels = applyConfidentArchitecturalLabels(scene, candidates);
  const existingOpenings = scene.openings ?? [];
  const nextOpenings: Opening[] = existingOpenings.map((opening) => ({
    ...opening,
    roomIds: [...opening.roomIds],
  }));
  const existingByKey = new Map<string, number>();
  nextOpenings.forEach((opening, index) => {
    if (opening.sourceNodeName && opening.sourceOccurrence !== undefined)
      existingByKey.set(
        nodeKey(opening.sourceNodeName, opening.sourceOccurrence),
        index,
      );
  });

  const tagByKey = new Map<string, ModelNodeTag>(
    labels.tags.map((tag) => [
      nodeKey(tag.nodeName, tag.occurrence),
      { ...tag },
    ]),
  );
  let prepared = 0;
  let approved = 0;
  let alreadyApproved = 0;
  let readyFound = 0;

  for (const suggestion of suggestions) {
    if (
      !suggestion.ready ||
      !suggestion.floorId ||
      suggestion.roomIds.length === 0
    )
      continue;
    readyFound += 1;

    const existingIndex = existingByKey.get(suggestion.key);
    if (existingIndex !== undefined) {
      const existing = nextOpenings[existingIndex];
      if (mode === "human" && !existing.reviewed) {
        nextOpenings[existingIndex] = {
          ...existing,
          reviewed: true,
          reviewState: "human_reviewed",
        };
        approved += 1;
      } else if (existing.reviewed) {
        alreadyApproved += 1;
        if (mode === "auto") continue;
      }
    } else {
      const human = mode === "human";
      nextOpenings.push({
        id: makeId(),
        floorId: suggestion.floorId,
        kind: suggestion.kind,
        roomIds: [...suggestion.roomIds],
        x: suggestion.position[0],
        y: suggestion.position[1],
        z: suggestion.position[2],
        width: suggestion.width,
        height: suggestion.height,
        ...(suggestion.sillHeight !== undefined
          ? { sillHeight: suggestion.sillHeight }
          : {}),
        rotationY: suggestion.rotationY,
        reviewed: human,
        reviewState: human ? "human_reviewed" : "auto_ready",
        sourceNodeName: suggestion.sourceNodeName,
        sourceOccurrence: suggestion.sourceOccurrence,
        confidence: suggestion.confidence,
      });
      existingByKey.set(suggestion.key, nextOpenings.length - 1);
      if (human) approved += 1;
      else prepared += 1;
    }

    const associatedRooms = suggestion.roomIds
      .map((roomId) =>
        scene.rooms.find((candidate) => candidate.id === roomId),
      )
      .filter((candidate): candidate is Room => Boolean(candidate));
    const current = tagByKey.get(suggestion.key) ?? {
      nodeName: suggestion.sourceNodeName,
      occurrence: suggestion.sourceOccurrence,
    };
    tagByKey.set(
      suggestion.key,
      reviewedTagForSuggestion(current, suggestion, associatedRooms, mode),
    );
  }

  const knownKeys = new Set(existingByKey.keys());
  const reviewRemaining = suggestions.filter(
    (suggestion) =>
      !knownKeys.has(suggestion.key) &&
      (!suggestion.ready ||
        !suggestion.floorId ||
        suggestion.roomIds.length === 0),
  ).length;

  return {
    scene: {
      ...scene,
      openings: nextOpenings,
      modelNodeTags: [...tagByKey.values()],
    },
    autoLabelsApplied: labels.applied,
    manualLabelsPreserved: labels.preservedManual,
    readyFound,
    prepared,
    approved,
    alreadyApproved,
    reviewRemaining,
  };
}
