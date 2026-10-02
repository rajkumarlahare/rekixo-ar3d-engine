import type { PdfPlanPageEvidence, PdfSpatialLabel } from "./pdfPlanInspector";
import type { SmartCadAudit } from "./projectAnalyzer";
import type { SourceFusionCapability, SourceFusionItem } from "./sourceFusion";

export interface SourceAuthorityDecision {
  capability: SourceFusionCapability;
  status: "selected" | "review";
  sourceAssetId?: string;
  sourceKind?: SourceFusionItem["kind"];
  score: number;
  reason: string;
}

export interface PdfCadLabelMatch {
  key: string;
  pdf: [number, number];
  cad: [number, number];
}

export interface PdfCadRegistration {
  compatible: boolean;
  matches: number;
  scaleMetresPerPdfUnit?: number;
  rotationDeg?: number;
  translateX?: number;
  translateZ?: number;
  normalizedRms?: number;
  confidence: number;
  reason: string;
  matchedKeys: string[];
}

const CAPABILITIES: SourceFusionCapability[] = [
  "geometry",
  "floors",
  "walls",
  "openings",
  "dimensions",
  "rooms",
  "materials",
  "visual-style",
  "metadata",
];

const BASE_PRIORITY: Record<
  SourceFusionCapability,
  Partial<Record<SourceFusionItem["kind"], number>>
> = {
  geometry: {
    cad: 100,
    "authoring-model": 92,
    "web-model": 86,
    sketchup: 70,
    drawing: 35,
  },
  floors: {
    cad: 100,
    "authoring-model": 86,
    "web-model": 80,
    drawing: 68,
    sketchup: 55,
    metadata: 35,
  },
  walls: {
    cad: 100,
    "authoring-model": 82,
    "web-model": 76,
    drawing: 55,
    sketchup: 50,
  },
  openings: {
    cad: 100,
    "authoring-model": 82,
    "web-model": 76,
    drawing: 58,
    sketchup: 50,
  },
  dimensions: {
    cad: 100,
    "room-sheet": 96,
    drawing: 74,
    sketchup: 45,
    metadata: 30,
  },
  rooms: {
    cad: 98,
    "room-sheet": 96,
    drawing: 78,
    metadata: 42,
    "authoring-model": 38,
    sketchup: 36,
  },
  materials: {
    sketchup: 100,
    "authoring-model": 90,
    "web-model": 82,
    metadata: 76,
    texture: 74,
    "visual-reference": 60,
  },
  "visual-style": {
    "visual-reference": 100,
    sketchup: 82,
    metadata: 74,
    "authoring-model": 70,
    "web-model": 68,
    drawing: 45,
  },
  metadata: {
    metadata: 100,
    sketchup: 78,
    cad: 70,
    drawing: 60,
    "authoring-model": 45,
    "web-model": 40,
  },
};

function supportAdjustment(item: SourceFusionItem) {
  if (item.support === "ready") return 0;
  if (item.support === "partial") return -12;
  if (item.support === "evidence-only") return -24;
  return -45;
}

export function chooseSourceAuthorities(
  items: readonly SourceFusionItem[],
): SourceAuthorityDecision[] {
  return CAPABILITIES.flatMap((capability) => {
    const candidates = items
      .filter((item) => item.capabilities.includes(capability))
      .map((item) => ({
        item,
        score:
          (BASE_PRIORITY[capability][item.kind] ?? 0) +
          supportAdjustment(item),
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.item.assetId.localeCompare(right.item.assetId),
      );
    if (!candidates.length) return [];
    const top = candidates[0];
    const tied = candidates.filter(
      (candidate) => candidate.score === top.score,
    );
    if (tied.length > 1)
      return [
        {
          capability,
          status: "review" as const,
          score: top.score,
          reason: `Multiple equally authoritative ${capability} sources are attached; Rekixo will not silently choose one.`,
        },
      ];
    return [
      {
        capability,
        status: "selected" as const,
        sourceAssetId: top.item.assetId,
        sourceKind: top.item.kind,
        score: top.score,
        reason: `${top.item.kind} is the strongest available ${capability} source under the six-file authority policy.`,
      },
    ];
  });
}

function normalizedLabel(value: string) {
  const base = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/bed\s*room/g, "bedroom")
    .replace(/toilet\s*\/\s*bath/g, "toilet")
    .replace(/[^a-z0-9.×x]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const dimension = base.match(
    /^(\d{1,4}(?:\.\d{1,3})?)\s*[x×]\s*(\d{1,4}(?:\.\d{1,3})?)$/,
  );
  if (!dimension) return base;
  const values = [Number(dimension[1]), Number(dimension[2])]
    .sort((left, right) => left - right)
    .map((entry) => Number(entry.toFixed(3)));
  return `dimension:${values[0]}x${values[1]}`;
}

function uniqueLabels<T extends { text: string }>(
  values: readonly T[],
) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = normalizedLabel(value.text);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result = new Map<string, T>();
  for (const value of values) {
    const key = normalizedLabel(value.text);
    if (key && counts.get(key) === 1) result.set(key, value);
  }
  return result;
}

function usablePdfLabel(entry: PdfSpatialLabel) {
  return ["room", "floor", "unit", "dimension"].includes(entry.kind);
}

function fitSimilarity(matches: readonly PdfCadLabelMatch[]) {
  const sourceCx =
    matches.reduce((sum, entry) => sum + entry.pdf[0], 0) / matches.length;
  const sourceCz =
    matches.reduce((sum, entry) => sum + entry.pdf[1], 0) / matches.length;
  const targetCx =
    matches.reduce((sum, entry) => sum + entry.cad[0], 0) / matches.length;
  const targetCz =
    matches.reduce((sum, entry) => sum + entry.cad[1], 0) / matches.length;

  let denominator = 0;
  let real = 0;
  let imaginary = 0;
  for (const entry of matches) {
    const sx = entry.pdf[0] - sourceCx;
    const sz = entry.pdf[1] - sourceCz;
    const tx = entry.cad[0] - targetCx;
    const tz = entry.cad[1] - targetCz;
    denominator += sx * sx + sz * sz;
    real += sx * tx + sz * tz;
    imaginary += sx * tz - sz * tx;
  }
  if (denominator < 1e-8) return undefined;

  const a = real / denominator;
  const b = imaginary / denominator;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const rotationDeg = (Math.atan2(b, a) * 180) / Math.PI;
  const translateX = targetCx - (a * sourceCx - b * sourceCz);
  const translateZ = targetCz - (b * sourceCx + a * sourceCz);

  let squared = 0;
  for (const entry of matches) {
    const x = a * entry.pdf[0] - b * entry.pdf[1] + translateX;
    const z = b * entry.pdf[0] + a * entry.pdf[1] + translateZ;
    squared += (x - entry.cad[0]) ** 2 + (z - entry.cad[1]) ** 2;
  }
  return {
    scale,
    rotationDeg,
    translateX,
    translateZ,
    rms: Math.sqrt(squared / matches.length),
  };
}

export function applyPdfCadPoint(
  point: [number, number],
  registration: PdfCadRegistration,
) {
  if (
    !registration.compatible ||
    registration.scaleMetresPerPdfUnit === undefined ||
    registration.rotationDeg === undefined ||
    registration.translateX === undefined ||
    registration.translateZ === undefined
  )
    return undefined;
  const radians = (registration.rotationDeg * Math.PI) / 180;
  const a = Math.cos(radians) * registration.scaleMetresPerPdfUnit;
  const b = Math.sin(radians) * registration.scaleMetresPerPdfUnit;
  return [
    a * point[0] - b * point[1] + registration.translateX,
    b * point[0] + a * point[1] + registration.translateZ,
  ] as [number, number];
}

export function estimatePdfCadRegistration(
  page: PdfPlanPageEvidence,
  cad: SmartCadAudit,
): PdfCadRegistration {
  const aspect =
    typeof page.aspectRatio === "number" &&
    Number.isFinite(page.aspectRatio) &&
    page.aspectRatio > 0
      ? page.aspectRatio
      : 1;
  const pdf = uniqueLabels(
    page.spatialLabels.filter(usablePdfLabel).map((entry) => ({
      ...entry,
      point: [entry.x * aspect, entry.y] as [number, number],
    })),
  );
  const cadLabels = uniqueLabels(cad.textLabels ?? []);
  const matches: PdfCadLabelMatch[] = [];
  for (const [key, left] of pdf) {
    const right = cadLabels.get(key);
    if (!right) continue;
    matches.push({
      key,
      pdf: left.point,
      cad: right.point,
    });
  }
  if (matches.length < 3)
    return {
      compatible: false,
      matches: matches.length,
      confidence: 0,
      reason:
        "PDF/CAD registration needs at least three unique shared spatial labels; the plan remains a review reference.",
      matchedKeys: matches.map((entry) => entry.key),
    };

  const sourceXs = matches.map((entry) => entry.pdf[0]);
  const sourceZs = matches.map((entry) => entry.pdf[1]);
  const targetXs = matches.map((entry) => entry.cad[0]);
  const targetZs = matches.map((entry) => entry.cad[1]);
  const sourceSpan = Math.hypot(
    Math.max(...sourceXs) - Math.min(...sourceXs),
    Math.max(...sourceZs) - Math.min(...sourceZs),
  );
  const targetSpan = Math.hypot(
    Math.max(...targetXs) - Math.min(...targetXs),
    Math.max(...targetZs) - Math.min(...targetZs),
  );
  if (sourceSpan < 0.12 || targetSpan < 0.75)
    return {
      compatible: false,
      matches: matches.length,
      confidence: 0.2,
      reason:
        "Shared PDF/CAD labels do not span enough of the plan for a trustworthy automatic transform.",
      matchedKeys: matches.map((entry) => entry.key),
    };

  const fit = fitSimilarity(matches);
  if (!fit)
    return {
      compatible: false,
      matches: matches.length,
      confidence: 0,
      reason: "PDF/CAD label geometry is degenerate.",
      matchedKeys: matches.map((entry) => entry.key),
    };

  const normalizedRms = fit.rms / Math.max(1, targetSpan);
  const coverage = Math.min(1, matches.length / 6);
  const confidence = Number(
    Math.max(
      0,
      Math.min(0.98, coverage * 0.35 + (1 - normalizedRms / 0.12) * 0.65),
    ).toFixed(3),
  );
  const compatible =
    matches.length >= 3 && normalizedRms <= 0.055 && confidence >= 0.72;

  return {
    compatible,
    matches: matches.length,
    scaleMetresPerPdfUnit: Number(fit.scale.toFixed(6)),
    rotationDeg: Number(fit.rotationDeg.toFixed(4)),
    translateX: Number(fit.translateX.toFixed(5)),
    translateZ: Number(fit.translateZ.toFixed(5)),
    normalizedRms: Number(normalizedRms.toFixed(5)),
    confidence,
    reason: compatible
      ? "PDF plan registered to CAD from unique shared spatial labels."
      : "PDF/CAD shared labels disagree too much for automatic placement; keep the plan review-only.",
    matchedKeys: matches.map((entry) => entry.key),
  };
}

function materialKey(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/^material::/, "")
    .replace(/^\[|\]$/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function sketchUpFbxMaterialOverlap(
  sketchUpMaterials: readonly string[],
  fbxMaterials: readonly string[],
) {
  const left = new Set(
    sketchUpMaterials.map(materialKey).filter(Boolean),
  );
  const right = new Set(fbxMaterials.map(materialKey).filter(Boolean));
  if (!left.size || !right.size)
    return { matched: 0, denominator: Math.max(left.size, right.size), ratio: 0 };
  let matched = 0;
  for (const key of left) if (right.has(key)) matched += 1;
  const denominator = Math.min(left.size, right.size);
  return {
    matched,
    denominator,
    ratio: Number((matched / Math.max(1, denominator)).toFixed(4)),
  };
}
