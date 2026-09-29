import type {
  ModelNodeTag,
  Opening,
  Room,
  Scene,
} from "./domain";
import type { OpeningSuggestion } from "./openingAssociator";
import type { SmartArchitecturalCandidate } from "./projectAnalyzer";

export interface OpeningWorkflowResult {
  scene: Scene;
  autoLabelsApplied: number;
  manualLabelsPreserved: number;
  readyFound: number;
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

export function applyReadyOpeningWorkflow(
  scene: Scene,
  candidates: readonly SmartArchitecturalCandidate[],
  suggestions: readonly OpeningSuggestion[],
  makeId: () => string = () => crypto.randomUUID(),
): OpeningWorkflowResult {
  const labels = applyConfidentArchitecturalLabels(scene, candidates);
  const existingOpenings = scene.openings ?? [];
  const existingKeys = new Set(
    existingOpenings
      .filter(
        (opening) =>
          opening.sourceNodeName &&
          opening.sourceOccurrence !== undefined,
      )
      .map((opening) =>
        nodeKey(opening.sourceNodeName!, opening.sourceOccurrence!),
      ),
  );

  const tagByKey = new Map<string, ModelNodeTag>(
    labels.tags.map((tag) => [
      nodeKey(tag.nodeName, tag.occurrence),
      { ...tag },
    ]),
  );
  const nextOpenings: Opening[] = [...existingOpenings];
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
    if (existingKeys.has(suggestion.key)) {
      alreadyApproved += 1;
      continue;
    }

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
      reviewed: true,
      sourceNodeName: suggestion.sourceNodeName,
      sourceOccurrence: suggestion.sourceOccurrence,
      confidence: suggestion.confidence,
    });
    existingKeys.add(suggestion.key);

    const current = tagByKey.get(suggestion.key) ?? {
      nodeName: suggestion.sourceNodeName,
      occurrence: suggestion.sourceOccurrence,
    };
    const associatedRooms = suggestion.roomIds
      .map((roomId) =>
        scene.rooms.find((candidate) => candidate.id === roomId),
      )
      .filter((candidate): candidate is Room => Boolean(candidate));
    const sharedUnit =
      associatedRooms.length > 0 &&
      associatedRooms.every(
        (candidate) => candidate.unit === associatedRooms[0].unit,
      )
        ? associatedRooms[0].unit
        : undefined;

    const reviewedTag: ModelNodeTag = {
      ...current,
      floorId: suggestion.floorId,
      assignment: "manual",
      confidence: 1,
      semantic: suggestion.kind,
      semanticAssignment: "manual",
      semanticConfidence: 1,
    };
    if (suggestion.roomIds.length === 1) {
      reviewedTag.roomId = suggestion.roomIds[0];
      if (associatedRooms[0]?.unit) reviewedTag.unit = associatedRooms[0].unit;
      else delete reviewedTag.unit;
    } else {
      delete reviewedTag.roomId;
      if (sharedUnit) reviewedTag.unit = sharedUnit;
      else delete reviewedTag.unit;
    }
    tagByKey.set(suggestion.key, reviewedTag);
    approved += 1;
  }

  const pendingKeys = new Set(
    suggestions
      .filter((suggestion) => !existingKeys.has(suggestion.key))
      .map((suggestion) => suggestion.key),
  );
  const reviewRemaining = suggestions.filter(
    (suggestion) =>
      pendingKeys.has(suggestion.key) &&
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
    approved,
    alreadyApproved,
    reviewRemaining,
  };
}
