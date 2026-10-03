import {
  id,
  type Scene,
  type SiteElement,
  type StructuralElementKind,
} from "./domain";
import type { DwgNormalizedObject } from "./dwgNormalized";
import type {
  SmartCadAudit,
  SmartProjectAnalysis,
  SmartStructuralCandidate,
} from "./projectAnalyzer";
import {
  applyCadRegistrationPoint,
  type CadModelRegistration,
} from "./sourceRegistration";

export interface StructuralCadFloorContext {
  audit: SmartCadAudit;
  floorIndex: number;
  floorId: string;
  registration: CadModelRegistration;
}

export interface StructuralPrimitiveFusionResult {
  scene: Scene;
  prepared: number;
  autoReady: number;
  reviewOnly: number;
  preservedReviewed: number;
  issues: string[];
}

const PRIMITIVE_KINDS = new Set<StructuralElementKind>([
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "stair",
  "lift",
]);

const SAFE_FOOTPRINT_ENTITIES = new Set([
  "LWPOLYLINE",
  "POLYLINE",
  "CIRCLE",
]);

const COLORS: Record<StructuralElementKind, string> = {
  column: "#9d9992",
  beam: "#aaa49b",
  slab: "#b9b3aa",
  roof: "#a9a29a",
  duct: "#8e9697",
  balcony: "#b2aca3",
  boundary: "#77736d",
  stair: "#a59f96",
  lift: "#8f9498",
};

interface SpatialEnvelope {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

interface Match {
  candidate: SmartStructuralCandidate;
  envelope: SpatialEnvelope;
  score: number;
  confidence: number;
}

function stableKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function candidateKey(candidate: SmartStructuralCandidate) {
  return `${candidate.nodeName}\u0000${candidate.occurrence}`;
}

function rotatePoint(x: number, z: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    x * cosine - z * sine,
    x * sine + z * cosine,
  ] as const;
}

function modelEnvelope(
  candidate: SmartStructuralCandidate,
  scene: Scene,
): SpatialEnvelope {
  const scale = scene.scale;
  const transform = scene.modelTransform;
  const [rx, rz] = rotatePoint(
    candidate.position[0] * scale,
    candidate.position[2] * scale,
    transform?.rotationY ?? 0,
  );
  const angle = ((transform?.rotationY ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const sourceWidth = Math.abs(candidate.size[0] * scale);
  const sourceDepth = Math.abs(candidate.size[2] * scale);
  const height = Math.abs(candidate.size[1] * scale);
  return {
    x: rx + (transform?.x ?? 0),
    y:
      candidate.position[1] * scale +
      (transform?.y ?? 0) -
      height / 2,
    z: rz + (transform?.z ?? 0),
    width: sourceWidth * cosine + sourceDepth * sine,
    depth: sourceWidth * sine + sourceDepth * cosine,
    height,
  };
}

function cadEnvelope(
  object: DwgNormalizedObject,
  registration: CadModelRegistration,
) {
  if (!object.bounds) return undefined;
  const corners: Array<[number, number]> = [
    [object.bounds.min[0], object.bounds.min[1]],
    [object.bounds.max[0], object.bounds.min[1]],
    [object.bounds.max[0], object.bounds.max[1]],
    [object.bounds.min[0], object.bounds.max[1]],
  ];
  const transformed = corners.map((point) =>
    applyCadRegistrationPoint(
      point,
      registration.sourceCentre,
      registration.targetCentre,
      registration.rotationDeg,
    ),
  );
  const xs = transformed.map((point) => point[0]);
  const zs = transformed.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width < 0.02 ||
    depth < 0.02
  )
    return undefined;
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    width,
    depth,
  };
}

function dimensionError(left: number, right: number) {
  return Math.abs(left - right) / Math.max(left, right, 0.05);
}

function scoreMatch(
  cad: { x: number; z: number; width: number; depth: number },
  candidate: SmartStructuralCandidate,
  scene: Scene,
) {
  const envelope = modelEnvelope(candidate, scene);
  if (
    envelope.width < 0.02 ||
    envelope.depth < 0.02 ||
    envelope.height < 0.02
  )
    return undefined;

  const diagonal = Math.max(0.5, Math.hypot(cad.width, cad.depth));
  const centreDistance = Math.hypot(cad.x - envelope.x, cad.z - envelope.z);
  if (centreDistance > Math.max(0.45, diagonal * 0.18)) return undefined;

  const cadSides = [cad.width, cad.depth].sort((a, b) => a - b);
  const modelSides = [envelope.width, envelope.depth].sort((a, b) => a - b);
  const shortError = dimensionError(cadSides[0], modelSides[0]);
  const longError = dimensionError(cadSides[1], modelSides[1]);
  if (shortError > 0.32 || longError > 0.32) return undefined;

  const score =
    centreDistance / diagonal + shortError * 0.55 + longError * 0.55;
  return { envelope, score };
}

function bestMatch(
  object: DwgNormalizedObject,
  row: StructuralCadFloorContext,
  analysis: SmartProjectAnalysis,
  scene: Scene,
  usedCandidates: Set<string>,
): Match | undefined {
  if (!object.bounds || !PRIMITIVE_KINDS.has(object.kind as StructuralElementKind))
    return undefined;
  if (!SAFE_FOOTPRINT_ENTITIES.has(object.sourceEntity.toUpperCase()))
    return undefined;
  if (object.confidence < 0.88 || row.registration.confidence < 0.72)
    return undefined;

  const cad = cadEnvelope(object, row.registration);
  if (!cad) return undefined;
  const kind = object.kind as StructuralElementKind;
  const candidates = (analysis.structuralCandidates ?? [])
    .filter(
      (candidate) =>
        candidate.kind === kind &&
        candidate.floorIndex === row.floorIndex &&
        candidate.confidence >= 0.88 &&
        !usedCandidates.has(candidateKey(candidate)),
    )
    .flatMap((candidate) => {
      const scored = scoreMatch(cad, candidate, scene);
      if (!scored) return [];
      const confidence = Math.min(
        object.confidence,
        candidate.confidence,
        row.registration.confidence,
        Math.max(0, 1 - scored.score * 0.75),
      );
      return [
        {
          candidate,
          envelope: {
            ...scored.envelope,
            x: cad.x,
            z: cad.z,
            width: cad.width,
            depth: cad.depth,
          },
          score: scored.score,
          confidence,
        },
      ];
    })
    .sort((left, right) => left.score - right.score);

  const best = candidates[0];
  if (!best || best.score > 0.5 || best.confidence < 0.8) return undefined;
  const second = candidates[1];
  if (second && second.score - best.score < 0.12) return undefined;
  return best;
}

function structuralSourceRef(
  row: StructuralCadFloorContext,
  object: DwgNormalizedObject,
  candidate: SmartStructuralCandidate,
) {
  const node = candidate.nodeName.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 180);
  return `structural:${row.audit.assetId}:${object.id}:${node}:${candidate.occurrence}`.slice(
    0,
    500,
  );
}

function replaceOrAppend(
  values: SiteElement[],
  next: SiteElement,
) {
  const index = values.findIndex(
    (item) =>
      item.origin === "model-cad-auto" &&
      item.sourceRef === next.sourceRef,
  );
  if (index < 0) {
    values.push(next);
    return { preservedReviewed: false };
  }
  if (values[index].reviewed) return { preservedReviewed: true };
  values[index] = { ...next, id: values[index].id };
  return { preservedReviewed: false };
}

/**
 * Builds a reviewable structural envelope only when two independent sources
 * agree: a normalized CAD footprint supplies X/Z dimensions and a named 3D
 * model mesh supplies the vertical envelope. CAD-only evidence never receives
 * an invented height. Ambiguous matches stay as source evidence.
 */
export function applySourceBackedStructuralPrimitives(
  scene: Scene,
  analysis: SmartProjectAnalysis,
  rows: readonly StructuralCadFloorContext[],
): StructuralPrimitiveFusionResult {
  const siteElements = [...(scene.siteElements ?? [])];
  const issues: string[] = [];
  const usedCandidates = new Set<string>();
  let prepared = 0;
  let autoReady = 0;
  let reviewOnly = 0;
  let preservedReviewed = 0;

  for (const row of rows) {
    const document = row.audit.normalizedDwg;
    if (!document) continue;
    for (const object of document.objects) {
      if (!object.bounds) continue;
      if (object.kind === "boundary") {
        reviewOnly += 1;
        continue;
      }
      if (!PRIMITIVE_KINDS.has(object.kind as StructuralElementKind)) continue;
      const match = bestMatch(
        object,
        row,
        analysis,
        scene,
        usedCandidates,
      );
      if (!match) {
        reviewOnly += 1;
        continue;
      }

      const kind = object.kind as StructuralElementKind;
      const sourceRef = structuralSourceRef(row, object, match.candidate);
      const ready = match.confidence >= 0.84 && match.score <= 0.42;
      if (!ready) {
        reviewOnly += 1;
        continue;
      }
      const generated: SiteElement = {
        id: `struct-${row.audit.assetId.slice(0, 10)}-${stableKey(sourceRef)}-${id().slice(0, 8)}`,
        kind,
        x: Number(match.envelope.x.toFixed(4)),
        y: Number(match.envelope.y.toFixed(4)),
        z: Number(match.envelope.z.toFixed(4)),
        width: Number(match.envelope.width.toFixed(4)),
        depth: Number(match.envelope.depth.toFixed(4)),
        height: Number(match.envelope.height.toFixed(4)),
        rotation: 0,
        color: COLORS[kind],
        reviewed: false,
        reviewState: "auto_ready",
        origin: "model-cad-auto",
        confidence: Number(match.confidence.toFixed(3)),
        floorId: row.floorId,
        sourceAssetId: row.audit.assetId,
        sourceRef,
        sourceNodeName: match.candidate.nodeName,
        sourceOccurrence: match.candidate.occurrence,
        shape:
          object.sourceEntity.toUpperCase() === "CIRCLE" &&
          (kind === "column" || kind === "duct")
            ? "cylinder"
            : "box",
      };
      const result = replaceOrAppend(siteElements, generated);
      if (result.preservedReviewed) {
        preservedReviewed += 1;
        usedCandidates.add(candidateKey(match.candidate));
        continue;
      }
      prepared += 1;
      autoReady += 1;
      usedCandidates.add(candidateKey(match.candidate));
    }
  }

  if (reviewOnly)
    issues.push(
      `${reviewOnly} structural CAD footprint${reviewOnly === 1 ? "" : "s"} stayed evidence-only because a unique source-backed 3D vertical envelope could not be proven.`,
    );
  if (preservedReviewed)
    issues.push(
      `${preservedReviewed} human-reviewed structural primitive${preservedReviewed === 1 ? " was" : "s were"} preserved unchanged during AutoBuild.`,
    );

  return {
    scene: { ...scene, siteElements },
    prepared,
    autoReady,
    reviewOnly,
    preservedReviewed,
    issues,
  };
}
