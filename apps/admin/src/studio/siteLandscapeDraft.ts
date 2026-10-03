import type {
  LandscapeSiteElementKind,
  Scene,
  SiteElement,
} from "./domain";
import type {
  SmartCadAudit,
  SmartProjectAnalysis,
} from "./projectAnalyzer";
import {
  applyCadRegistrationPoint,
  estimateCadModelRegistration,
} from "./sourceRegistration";
import { resolveCadFloorIndex } from "./architectureGraph";
import { classifySiteSemantic } from "./siteSemantics";

export interface SiteLandscapeDraftResult {
  scene: Scene;
  created: SiteElement[];
  replacedAutomatic: number;
  readyForReview: number;
  reviewOnly: number;
  sourceAssetId?: string;
  issues: string[];
}

const DEFAULTS: Record<
  LandscapeSiteElementKind,
  { width: number; depth: number; height: number; color: string }
> = {
  garden: { width: 4, depth: 4, height: 0.06, color: "#6f8c55" },
  lawn: { width: 4, depth: 4, height: 0.04, color: "#6f965a" },
  path: { width: 1.4, depth: 4, height: 0.05, color: "#b8afa0" },
  road: { width: 5.5, depth: 8, height: 0.05, color: "#67696b" },
  parking: { width: 2.5, depth: 5, height: 0.05, color: "#85878a" },
  tree: { width: 2.2, depth: 2.2, height: 5, color: "#4f7b48" },
  plant: { width: 0.8, depth: 0.8, height: 1.2, color: "#5f8754" },
  gate: { width: 3.5, depth: 0.25, height: 1.8, color: "#5e5851" },
  "outdoor-light": {
    width: 0.25,
    depth: 0.25,
    height: 3.2,
    color: "#4f5357",
  },
};

function stableKey(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedRotation(value: number) {
  let rotation = value % 360;
  if (rotation > 180) rotation -= 360;
  if (rotation < -180) rotation += 360;
  return Number(rotation.toFixed(3));
}

function dimensionsFromBounds(
  kind: LandscapeSiteElementKind,
  bounds: { min: [number, number]; max: [number, number] } | undefined,
) {
  const fallback = DEFAULTS[kind];
  if (!bounds)
    return {
      width: fallback.width,
      depth: fallback.depth,
      height: fallback.height,
      sourceSized: false,
    };
  const width = bounds.max[0] - bounds.min[0];
  const depth = bounds.max[1] - bounds.min[1];
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width < 0.05 ||
    depth < 0.05 ||
    width > 1000 ||
    depth > 1000
  )
    return {
      width: fallback.width,
      depth: fallback.depth,
      height: fallback.height,
      sourceSized: false,
    };
  return {
    width: Number(width.toFixed(3)),
    depth: Number(depth.toFixed(3)),
    height: fallback.height,
    sourceSized: true,
  };
}

function areaKind(kind: LandscapeSiteElementKind) {
  return ["garden", "lawn", "path", "road", "parking"].includes(kind);
}

function pointCentre(
  point: [number, number] | undefined,
  bounds: { min: [number, number]; max: [number, number] } | undefined,
) {
  if (point) return point;
  if (!bounds) return undefined;
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
  ] as [number, number];
}

function dedupe(values: readonly SiteElement[]) {
  const byKey = new Map<string, SiteElement>();
  for (const value of values) {
    const key = [
      value.kind,
      Math.round(value.x * 10),
      Math.round(value.z * 10),
      Math.round(value.width * 10),
      Math.round(value.depth * 10),
    ].join(":");
    const current = byKey.get(key);
    if (!current || (value.confidence ?? 0) > (current.confidence ?? 0))
      byKey.set(key, value);
  }
  return [...byKey.values()];
}

function auditHasSiteEvidence(audit: SmartCadAudit) {
  const document = audit.normalizedDwg;
  if (!document) return false;
  return (
    document.objects.some((entry) =>
      Boolean(
        classifySiteSemantic(
          [entry.layer, entry.sourceEntity, entry.kind].join(" "),
        ),
      ),
    ) ||
    document.inserts.some((entry) =>
      Boolean(
        classifySiteSemantic(
          [entry.layer, entry.name, entry.kind].join(" "),
        ),
      ),
    )
  );
}

export function deriveSourceBackedSiteLandscape(
  analysis: SmartProjectAnalysis,
  scene: Scene,
): SiteLandscapeDraftResult {
  const issues: string[] = [];
  const audits = analysis.cadAudits.filter(
    (audit) =>
      audit.kind === "dwg" &&
      audit.geometryReady &&
      Boolean(audit.normalizedDwg) &&
      auditHasSiteEvidence(audit),
  );

  if (!audits.length)
    return {
      scene,
      created: [],
      replacedAutomatic: 0,
      readyForReview: 0,
      reviewOnly: 0,
      issues,
    };

  if (audits.length > 1) {
    issues.push(
      "Multiple DWG sources contain site/landscape semantics. Rekixo kept them review-only instead of mixing site plans automatically.",
    );
    return {
      scene,
      created: [],
      replacedAutomatic: 0,
      readyForReview: 0,
      reviewOnly: 0,
      issues,
    };
  }

  const audit = audits[0];
  const floorIndex = resolveCadFloorIndex(audit, scene.floors.length);
  if (floorIndex !== 0) {
    issues.push(
      "Site/landscape semantics were found outside an unambiguous ground-floor CAD role, so automatic site placement was skipped.",
    );
    return {
      scene,
      created: [],
      replacedAutomatic: 0,
      readyForReview: 0,
      reviewOnly: 0,
      sourceAssetId: audit.assetId,
      issues,
    };
  }

  const registration = estimateCadModelRegistration(
    analysis,
    audit,
    floorIndex,
    scene.scale,
    scene.modelTransform,
  );
  if (
    !registration.compatible ||
    registration.ambiguous ||
    registration.confidence < 0.7
  ) {
    issues.push(
      "Site/landscape source evidence exists, but CAD/model alignment is not reliable enough for automatic placement.",
    );
    return {
      scene,
      created: [],
      replacedAutomatic: 0,
      readyForReview: 0,
      reviewOnly: 0,
      sourceAssetId: audit.assetId,
      issues,
    };
  }

  const document = audit.normalizedDwg!;
  const generated: SiteElement[] = [];

  for (const entry of document.objects) {
    const descriptor = [entry.layer, entry.sourceEntity, entry.kind].join(" ");
    const kind = classifySiteSemantic(descriptor);
    if (!kind) continue;
    const sourcePoint = pointCentre(entry.point, entry.bounds);
    if (!sourcePoint) continue;
    const sizing = dimensionsFromBounds(kind, entry.bounds);
    if (areaKind(kind) && !sizing.sourceSized) {
      issues.push(
        "A CAD " +
          kind +
          " object was detected without trustworthy area bounds; it remains source evidence instead of becoming guessed geometry.",
      );
      continue;
    }
    const world = applyCadRegistrationPoint(
      sourcePoint,
      registration.sourceCentre,
      registration.targetCentre,
      registration.rotationDeg,
    );
    const confidence = Number(
      Math.min(
        0.97,
        (entry.confidence ?? 0.7) *
          (0.72 + registration.confidence * 0.28) *
          (sizing.sourceSized ? 1 : 0.86),
      ).toFixed(3),
    );
    const ready = confidence >= 0.84 && (sizing.sourceSized || !areaKind(kind));
    const sourceRef = "object:" + entry.id;
    generated.push({
      id:
        "site-cad-" +
        audit.assetId.slice(0, 10) +
        "-" +
        stableKey(sourceRef),
      kind,
      x: world[0],
      z: world[1],
      width: sizing.width,
      depth: sizing.depth,
      height: sizing.height,
      rotation: normalizedRotation(registration.rotationDeg),
      color: DEFAULTS[kind].color,
      reviewed: false,
      reviewState: ready ? "auto_ready" : "suggested",
      origin: "cad-auto",
      confidence,
      sourceAssetId: audit.assetId,
      sourceRef,
    });
  }

  for (const entry of document.inserts) {
    const descriptor = [entry.layer, entry.name, entry.kind].join(" ");
    const kind = classifySiteSemantic(descriptor);
    if (!kind || areaKind(kind)) continue;
    const world = applyCadRegistrationPoint(
      entry.point,
      registration.sourceCentre,
      registration.targetCentre,
      registration.rotationDeg,
    );
    const defaults = DEFAULTS[kind];
    const scaleX = Math.max(0.2, Math.min(5, Math.abs(entry.scale[0] || 1)));
    const scaleZ = Math.max(
      0.2,
      Math.min(5, Math.abs(entry.scale[1] || entry.scale[2] || 1)),
    );
    const confidence = Number(
      Math.min(
        0.94,
        (entry.confidence ?? 0.7) *
          (0.7 + registration.confidence * 0.3) *
          0.94,
      ).toFixed(3),
    );
    const sourceRef = "insert:" + entry.id;
    generated.push({
      id:
        "site-cad-" +
        audit.assetId.slice(0, 10) +
        "-" +
        stableKey(sourceRef),
      kind,
      x: world[0],
      z: world[1],
      width: Number((defaults.width * scaleX).toFixed(3)),
      depth: Number((defaults.depth * scaleZ).toFixed(3)),
      height: Number(
        (
          defaults.height *
          Math.max(
            0.2,
            Math.min(5, Math.abs(entry.scale[2] || entry.scale[1] || 1)),
          )
        ).toFixed(3),
      ),
      rotation: normalizedRotation(
        registration.rotationDeg + entry.rotationDeg,
      ),
      color: defaults.color,
      reviewed: false,
      reviewState: confidence >= 0.86 ? "auto_ready" : "suggested",
      origin: "cad-auto",
      confidence,
      sourceAssetId: audit.assetId,
      sourceRef,
    });
  }

  const created = dedupe(generated);
  const previous = scene.siteElements ?? [];
  const retained = previous.filter(
    (entry) =>
      entry.origin !== "cad-auto" ||
      entry.reviewed ||
      entry.sourceAssetId !== audit.assetId,
  );
  const replacedAutomatic = previous.length - retained.length;
  const nextScene: Scene = {
    ...scene,
    siteElements: [...retained, ...created],
  };

  return {
    scene: nextScene,
    created,
    replacedAutomatic,
    readyForReview: created.filter(
      (entry) => entry.reviewState === "auto_ready",
    ).length,
    reviewOnly: created.filter(
      (entry) => entry.reviewState !== "auto_ready",
    ).length,
    sourceAssetId: audit.assetId,
    issues,
  };
}
