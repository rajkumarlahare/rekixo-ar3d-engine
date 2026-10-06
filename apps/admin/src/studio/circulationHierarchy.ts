import type { Scene, SiteElement } from "./domain";

export type CirculationKind = "stair" | "lift";
export type CirculationBindingStatus = "auto-ready" | "review";

export interface CirculationHierarchyMember {
  elementId: string;
  kind: CirculationKind;
  floorId: string;
  floorName: string;
  floorIndex: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  confidence: number;
  reviewed: boolean;
  reviewState?: SiteElement["reviewState"];
  sourceAssetId?: string;
  sourceRef: string;
}

export interface CirculationCore {
  id: string;
  kind: CirculationKind;
  status: CirculationBindingStatus;
  confidence: number;
  members: CirculationHierarchyMember[];
  reason: string;
}

export interface CirculationHierarchyReport {
  cores: CirculationCore[];
  counts: {
    sourceBackedElements: number;
    boundCores: number;
    reviewCores: number;
    singletonEvidence: number;
    ambiguousBindings: number;
    unresolvedFloorEvidence: number;
  };
  issues: string[];
}

interface RankedCore {
  core: CirculationCore;
  score: number;
}

const CIRCULATION_KINDS = new Set<CirculationKind>(["stair", "lift"]);
const MAX_BIND_SCORE = 0.58;
const MIN_UNIQUE_SCORE_GAP = 0.12;

function isCirculationKind(kind: SiteElement["kind"]): kind is CirculationKind {
  return CIRCULATION_KINDS.has(kind as CirculationKind);
}

function isSourceBackedCirculation(
  element: SiteElement,
): element is SiteElement & { kind: CirculationKind; floorId: string; sourceRef: string } {
  return (
    isCirculationKind(element.kind) &&
    element.origin === "model-cad-auto" &&
    typeof element.floorId === "string" &&
    Boolean(element.floorId) &&
    typeof element.sourceRef === "string" &&
    Boolean(element.sourceRef) &&
    Number.isFinite(element.x) &&
    Number.isFinite(element.z) &&
    Number.isFinite(element.width) &&
    Number.isFinite(element.depth) &&
    element.width > 0 &&
    element.depth > 0
  );
}

function dimensionError(left: number, right: number) {
  return Math.abs(left - right) / Math.max(left, right, 0.05);
}

function bindingScore(
  left: CirculationHierarchyMember,
  right: CirculationHierarchyMember,
) {
  const leftDiagonal = Math.hypot(left.width, left.depth);
  const rightDiagonal = Math.hypot(right.width, right.depth);
  const referenceDiagonal = Math.max(0.5, Math.min(leftDiagonal, rightDiagonal));
  const centreDistance = Math.hypot(left.x - right.x, left.z - right.z);
  if (centreDistance > Math.max(0.6, referenceDiagonal * 0.42))
    return Number.POSITIVE_INFINITY;

  const leftSides = [left.width, left.depth].sort((a, b) => a - b);
  const rightSides = [right.width, right.depth].sort((a, b) => a - b);
  const sizeError =
    (dimensionError(leftSides[0], rightSides[0]) +
      dimensionError(leftSides[1], rightSides[1])) /
    2;
  if (sizeError > 0.42) return Number.POSITIVE_INFINITY;

  return centreDistance / referenceDiagonal + sizeError * 0.45;
}

function memberFromElement(
  element: SiteElement & {
    kind: CirculationKind;
    floorId: string;
    sourceRef: string;
  },
  floorName: string,
  floorIndex: number,
): CirculationHierarchyMember {
  return {
    elementId: element.id,
    kind: element.kind,
    floorId: element.floorId,
    floorName,
    floorIndex,
    x: element.x,
    z: element.z,
    width: element.width,
    depth: element.depth,
    confidence: Number((element.confidence ?? 0).toFixed(3)),
    reviewed: element.reviewed,
    reviewState: element.reviewState,
    sourceAssetId: element.sourceAssetId,
    sourceRef: element.sourceRef,
  };
}

function coreId(member: CirculationHierarchyMember) {
  const safe = member.elementId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `circulation-${member.kind}-${safe || member.floorIndex}`;
}

function refreshCore(core: CirculationCore) {
  const confidence = Math.min(...core.members.map((member) => member.confidence));
  const sourceReady = core.members.every(
    (member) => member.reviewed || member.reviewState === "auto_ready",
  );
  const bound = core.members.length >= 2;
  core.confidence = Number(confidence.toFixed(3));
  core.status = bound && sourceReady ? "auto-ready" : "review";
  core.reason = bound
    ? `${core.kind === "stair" ? "Stair" : "Lift"} evidence is uniquely aligned across ${core.members.length} adjacent floors. Derived binding is not a human review decision.`
    : `${core.kind === "stair" ? "Stair" : "Lift"} evidence exists on only one resolved floor; cross-floor binding remains review-only.`;
}

function rankedPreviousCores(
  cores: readonly CirculationCore[],
  member: CirculationHierarchyMember,
): RankedCore[] {
  return cores
    .filter((core) => {
      if (core.kind !== member.kind) return false;
      const last = core.members.at(-1);
      return Boolean(last && last.floorIndex === member.floorIndex - 1);
    })
    .map((core) => ({
      core,
      score: bindingScore(core.members.at(-1)!, member),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score <= MAX_BIND_SCORE)
    .sort(
      (left, right) =>
        left.score - right.score || left.core.id.localeCompare(right.core.id),
    );
}

/**
 * Derives vertical stair/lift hierarchy only from source-backed structural
 * primitives that already survived CAD + 3D fusion. This function never
 * invents circulation geometry, never marks anything human-reviewed, and does
 * not mutate the scene. Ambiguous or single-floor evidence remains review-only.
 */
export function buildCirculationHierarchy(
  scene: Scene,
): CirculationHierarchyReport {
  const orderedFloors = [...scene.floors].sort(
    (left, right) => left.elevation - right.elevation || left.id.localeCompare(right.id),
  );
  const floorIndexById = new Map(
    orderedFloors.map((floor, index) => [floor.id, index] as const),
  );
  const floorNameById = new Map(
    orderedFloors.map((floor) => [floor.id, floor.name] as const),
  );
  const sourceBacked = (scene.siteElements ?? []).filter(isSourceBackedCirculation);
  const members: CirculationHierarchyMember[] = [];
  let unresolvedFloorEvidence = 0;

  for (const element of sourceBacked) {
    const floorIndex = floorIndexById.get(element.floorId);
    const floorName = floorNameById.get(element.floorId);
    if (floorIndex === undefined || !floorName) {
      unresolvedFloorEvidence += 1;
      continue;
    }
    members.push(memberFromElement(element, floorName, floorIndex));
  }

  members.sort(
    (left, right) =>
      left.floorIndex - right.floorIndex ||
      left.kind.localeCompare(right.kind) ||
      left.x - right.x ||
      left.z - right.z ||
      left.elementId.localeCompare(right.elementId),
  );

  const cores: CirculationCore[] = [];
  let ambiguousBindings = 0;
  for (const member of members) {
    const ranked = rankedPreviousCores(cores, member);
    const best = ranked[0];
    const second = ranked[1];
    const unique =
      Boolean(best) &&
      (!second || second.score - best.score >= MIN_UNIQUE_SCORE_GAP);

    if (best && unique) {
      best.core.members.push(member);
      refreshCore(best.core);
      continue;
    }
    if (best && second) ambiguousBindings += 1;

    const core: CirculationCore = {
      id: coreId(member),
      kind: member.kind,
      status: "review",
      confidence: member.confidence,
      members: [member],
      reason: "",
    };
    refreshCore(core);
    cores.push(core);
  }

  const singletonEvidence = cores.filter((core) => core.members.length === 1).length;
  const boundCores = cores.filter((core) => core.members.length >= 2).length;
  const reviewCores = cores.filter((core) => core.status === "review").length;
  const issues: string[] = [];
  if (ambiguousBindings)
    issues.push(
      `${ambiguousBindings} stair/lift cross-floor binding${ambiguousBindings === 1 ? "" : "s"} stayed review-only because multiple adjacent-floor cores were plausible.`,
    );
  if (singletonEvidence)
    issues.push(
      `${singletonEvidence} stair/lift evidence item${singletonEvidence === 1 ? "" : "s"} could not yet be bound across adjacent floors.`,
    );
  if (unresolvedFloorEvidence)
    issues.push(
      `${unresolvedFloorEvidence} source-backed stair/lift item${unresolvedFloorEvidence === 1 ? "" : "s"} referenced an unresolved floor and stayed evidence-only.`,
    );

  return {
    cores,
    counts: {
      sourceBackedElements: sourceBacked.length,
      boundCores,
      reviewCores,
      singletonEvidence,
      ambiguousBindings,
      unresolvedFloorEvidence,
    },
    issues,
  };
}
