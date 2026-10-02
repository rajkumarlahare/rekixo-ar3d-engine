import type { ModelTransform, RoomPoint } from "./domain";
import type {
  SmartArchitecturalCandidate,
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";

export type RegistrationRotation = 0 | 90 | 180 | 270;
export type RegistrationMode = "footprint" | "semantic";

export interface CadModelRegistration {
  compatible: boolean;
  rotationDeg: number;
  sourceRotationDeg: RegistrationRotation;
  sourceCentre: RoomPoint;
  targetCentre: RoomPoint;
  confidence: number;
  mode: RegistrationMode;
  semanticMatches: number;
  footprintError: number;
  score: number;
  ambiguous: boolean;
  reason?: string;
}

interface SemanticPoint {
  kind: "wall" | "door" | "window";
  point: RoomPoint;
}

const ROTATIONS: RegistrationRotation[] = [0, 90, 180, 270];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function rotatePoint(
  point: RoomPoint,
  degrees: number,
): RoomPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    point[0] * cos - point[1] * sin,
    point[0] * sin + point[1] * cos,
  ];
}

function worldModelPoint(
  x: number,
  z: number,
  scale: number,
  transform?: ModelTransform,
): RoomPoint {
  const rotated = rotatePoint(
    [x * scale, z * scale],
    transform?.rotationY ?? 0,
  );
  return [
    rotated[0] + (transform?.x ?? 0),
    rotated[1] + (transform?.z ?? 0),
  ];
}

function sampleEvenly<T>(values: readonly T[], max = 120): T[] {
  if (values.length <= max) return [...values];
  const result: T[] = [];
  for (let index = 0; index < max; index += 1) {
    const sourceIndex = Math.floor((index * values.length) / max);
    result.push(values[sourceIndex]);
  }
  return result;
}

function cadSemanticPoints(audit: SmartCadAudit): SemanticPoint[] {
  return sampleEvenly(
    (audit.semanticSegments ?? [])
      .filter(
        (segment) =>
          segment.kind === "wall" ||
          segment.kind === "door" ||
          segment.kind === "window",
      )
      .map((segment) => ({
        kind: segment.kind as SemanticPoint["kind"],
        point: [
          (segment.start[0] + segment.end[0]) / 2,
          (segment.start[1] + segment.end[1]) / 2,
        ] as RoomPoint,
      })),
  );
}

function modelSemanticPoints(
  analysis: SmartProjectAnalysis,
  floorIndex: number,
  scale: number,
  transform?: ModelTransform,
): SemanticPoint[] {
  const candidates = analysis.architecturalCandidates.filter(
    (candidate: SmartArchitecturalCandidate) =>
      candidate.floorIndex === floorIndex &&
      candidate.confidence >= 0.72 &&
      (candidate.kind === "wall" ||
        candidate.kind === "door" ||
        candidate.kind === "window"),
  );
  return sampleEvenly(
    candidates.map((candidate) => ({
      kind: candidate.kind as SemanticPoint["kind"],
      point: worldModelPoint(
        candidate.position[0],
        candidate.position[2],
        scale,
        transform,
      ),
    })),
  );
}

function nearestSemanticError(
  cadPoints: readonly SemanticPoint[],
  modelPoints: readonly SemanticPoint[],
  rotationDeg: number,
  sourceCentre: RoomPoint,
  targetCentre: RoomPoint,
  normalizer: number,
) {
  if (!cadPoints.length || !modelPoints.length)
    return { error: undefined as number | undefined, matches: 0 };

  let total = 0;
  let matches = 0;
  for (const source of cadPoints) {
    const compatible = modelPoints.filter((target) => target.kind === source.kind);
    if (!compatible.length) continue;
    const transformed = applyCadRegistrationPoint(
      source.point,
      sourceCentre,
      targetCentre,
      rotationDeg,
    );
    let nearest = Number.POSITIVE_INFINITY;
    for (const target of compatible)
      nearest = Math.min(
        nearest,
        Math.hypot(
          transformed[0] - target.point[0],
          transformed[1] - target.point[1],
        ),
      );
    if (!Number.isFinite(nearest)) continue;
    total += Math.min(1.5, nearest / normalizer);
    matches += 1;
  }
  return {
    error: matches ? total / matches : undefined,
    matches,
  };
}

function failure(reason: string): CadModelRegistration {
  return {
    compatible: false,
    rotationDeg: 0,
    sourceRotationDeg: 0,
    sourceCentre: [0, 0],
    targetCentre: [0, 0],
    confidence: 0,
    mode: "footprint",
    semanticMatches: 0,
    footprintError: Number.POSITIVE_INFINITY,
    score: Number.POSITIVE_INFINITY,
    ambiguous: true,
    reason,
  };
}

export function applyCadRegistrationPoint(
  point: RoomPoint,
  sourceCentre: RoomPoint,
  targetCentre: RoomPoint,
  rotationDeg: number,
): RoomPoint {
  const local: RoomPoint = [
    point[0] - sourceCentre[0],
    point[1] - sourceCentre[1],
  ];
  const rotated = rotatePoint(local, rotationDeg);
  return [
    Number((targetCentre[0] + rotated[0]).toFixed(4)),
    Number((targetCentre[1] + rotated[1]).toFixed(4)),
  ];
}

export function estimateCadModelRegistration(
  analysis: SmartProjectAnalysis,
  audit: SmartCadAudit,
  floorIndex: number,
  scale: number,
  transform?: ModelTransform,
): CadModelRegistration {
  if (!analysis.bounds)
    return failure(
      "Model footprint bounds are unavailable; CAD registration requires review anchors.",
    );

  const wallSegments = (audit.semanticSegments ?? []).filter(
    (segment) => segment.kind === "wall",
  );
  if (!wallSegments.length)
    return failure("CAD source contains no normalized wall geometry.");

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
  if (
    !Number.isFinite(cadWidth) ||
    !Number.isFinite(cadDepth) ||
    cadWidth < 0.5 ||
    cadDepth < 0.5
  )
    return failure("CAD wall bounds are too small for building reconstruction.");

  const sourceWidth =
    Math.max(0.01, analysis.bounds.max[0] - analysis.bounds.min[0]) * scale;
  const sourceDepth =
    Math.max(0.01, analysis.bounds.max[2] - analysis.bounds.min[2]) * scale;
  const modelCentreLocal: RoomPoint = [
    ((analysis.bounds.min[0] + analysis.bounds.max[0]) / 2) * scale,
    ((analysis.bounds.min[2] + analysis.bounds.max[2]) / 2) * scale,
  ];
  const rotatedModelCentre = rotatePoint(
    modelCentreLocal,
    transform?.rotationY ?? 0,
  );
  const targetCentre: RoomPoint = [
    rotatedModelCentre[0] + (transform?.x ?? 0),
    rotatedModelCentre[1] + (transform?.z ?? 0),
  ];
  const sourceCentre: RoomPoint = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  const normalizer = Math.max(
    1,
    Math.hypot(sourceWidth, sourceDepth) * 0.35,
  );

  const cadSemantics = cadSemanticPoints(audit);
  const modelSemantics = modelSemanticPoints(
    analysis,
    floorIndex,
    scale,
    transform,
  );
  const baseRotation = transform?.rotationY ?? 0;

  const candidates = ROTATIONS.map((rotation) => {
    const rotatedWidth = rotation % 180 === 0 ? cadWidth : cadDepth;
    const rotatedDepth = rotation % 180 === 0 ? cadDepth : cadWidth;
    const footprintError =
      Math.abs(Math.log(rotatedWidth / sourceWidth)) +
      Math.abs(Math.log(rotatedDepth / sourceDepth));
    const semantic = nearestSemanticError(
      cadSemantics,
      modelSemantics,
      baseRotation + rotation,
      sourceCentre,
      targetCentre,
      normalizer,
    );
    const semanticWeight = semantic.matches >= 3 ? 1.6 : 0;
    return {
      rotation,
      rotationDeg: baseRotation + rotation,
      footprintError,
      semanticError: semantic.error,
      semanticMatches: semantic.matches,
      score:
        footprintError +
        (semantic.error !== undefined ? semantic.error * semanticWeight : 0),
    };
  }).sort((left, right) => left.score - right.score);

  const best = candidates[0];
  const second = candidates[1];
  if (!best || best.footprintError > 0.75)
    return {
      ...failure(
        "CAD/model footprint dimensions disagree too much for automatic alignment.",
      ),
      footprintError: best?.footprintError ?? Number.POSITIVE_INFINITY,
      score: best?.score ?? Number.POSITIVE_INFINITY,
    };

  const hasSemanticEvidence = best.semanticMatches >= 3;
  const ambiguous =
    !second ||
    second.score - best.score < (hasSemanticEvidence ? 0.06 : 0.12);
  let confidence = clamp(
    1 - best.footprintError / 0.9 -
      (best.semanticError ?? 0) * (hasSemanticEvidence ? 0.8 : 0),
  );
  if (!hasSemanticEvidence) confidence = Math.min(confidence, 0.72);
  if (ambiguous) confidence = Math.min(confidence, 0.65);
  confidence = Number(confidence.toFixed(3));

  return {
    compatible: confidence >= 0.45,
    rotationDeg: Number(best.rotationDeg.toFixed(4)),
    sourceRotationDeg: best.rotation,
    sourceCentre,
    targetCentre,
    confidence,
    mode: hasSemanticEvidence ? "semantic" : "footprint",
    semanticMatches: best.semanticMatches,
    footprintError: Number(best.footprintError.toFixed(4)),
    score: Number(best.score.toFixed(4)),
    ambiguous,
    ...(!hasSemanticEvidence
      ? {
          reason:
            "CAD footprint is aligned, but orientation is not fully disambiguated by model semantics; keep the result reviewable.",
        }
      : ambiguous
        ? {
            reason:
              "Multiple CAD/model registrations remain similarly plausible; keep the result reviewable.",
          }
        : {}),
  };
}
