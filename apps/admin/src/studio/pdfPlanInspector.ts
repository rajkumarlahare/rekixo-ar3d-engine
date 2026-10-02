import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Asset } from "./domain";

export type PdfSpatialLabelKind =
  | "room"
  | "dimension"
  | "floor"
  | "unit"
  | "area"
  | "other";

export interface PdfSpatialLabel {
  text: string;
  kind: PdfSpatialLabelKind;
  /** Normalized page coordinates, origin at viewport top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfEmbeddedImageCandidate {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  pixelWidth?: number;
  pixelHeight?: number;
  confidence: number;
}

export interface PdfPlanPageEvidence {
  page: number;
  score: number;
  /** Page width / height at scale 1; keeps normalized label coordinates aspect-correct. */
  aspectRatio: number;
  roomLabels: string[];
  dimensionStrings: string[];
  hasFloorPlanLabel: boolean;
  textSample: string;
  spatialLabels: PdfSpatialLabel[];
  embeddedImages: PdfEmbeddedImageCandidate[];
}

export interface PdfPlanInspection {
  pages: PdfPlanPageEvidence[];
  bestPage?: number;
  pageCount: number;
  issues: string[];
}

type Matrix = [number, number, number, number, number, number];

const ROOM_LABELS = [
  "living",
  "bedroom",
  "bed room",
  "kitchen",
  "dining",
  "toilet",
  "bath",
  "balcony",
  "lobby",
  "lift",
  "stair",
  "utility",
  "store",
  "foyer",
  "terrace",
  "duct",
  "corridor",
];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizedText(items: Array<{ str?: string }>) {
  return items
    .map((item) => item.str ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function dimensions(text: string) {
  const matches = text.match(
    /\b\d{1,4}(?:\.\d{1,3})?\s*(?:x|×)\s*\d{1,4}(?:\.\d{1,3})?\b/gi,
  );
  return [
    ...new Set((matches ?? []).map((value) => value.replace(/\s+/g, " "))),
  ].slice(0, 120);
}

function roomLabels(text: string) {
  const lower = text.toLowerCase();
  return ROOM_LABELS.filter((label) =>
    new RegExp(`\\b${label.replace(" ", "\\s*")}s?\\b`, "i").test(lower),
  );
}

function labelKind(text: string): PdfSpatialLabelKind {
  if (
    /\b(?:living|kitchen|dining|bed\s*room|bedroom|toilet|bath|balcony|lobby|lift|stair|utility|store|foyer|terrace|duct|corridor|room)\b/i.test(
      text,
    )
  )
    return "room";
  if (
    /\b\d{1,4}(?:\.\d{1,3})?\s*(?:x|×)\s*\d{1,4}(?:\.\d{1,3})?\b/i.test(
      text,
    )
  )
    return "dimension";
  if (
    /\b(?:ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|\d+(?:st|nd|rd|th)?)\s+floor\b|\bfloor\s+(?:plan|level|lvl)\b/i.test(
      text,
    )
  )
    return "floor";
  if (/\b(?:flat|unit|apartment|apt)\s*(?:no\.?\s*)?[a-z0-9-]+\b/i.test(text))
    return "unit";
  if (/\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft|sqft|sqm|m2|m²)\b/i.test(text))
    return "area";
  return "other";
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ] as const;
}

function viewportPoint(
  viewport: { convertToViewportPoint(x: number, y: number): number[] },
  x: number,
  y: number,
): [number, number] {
  const value = viewportPoint(viewport, x, y);
  return [Number(value[0] ?? 0), Number(value[1] ?? 0)];
}

function imagePixels(args: unknown[]) {
  const directWidth = typeof args[1] === "number" ? args[1] : undefined;
  const directHeight = typeof args[2] === "number" ? args[2] : undefined;
  if (directWidth && directHeight)
    return { pixelWidth: directWidth, pixelHeight: directHeight };

  const data =
    args[0] && typeof args[0] === "object"
      ? (args[0] as { width?: unknown; height?: unknown })
      : undefined;
  const pixelWidth =
    typeof data?.width === "number" ? data.width : undefined;
  const pixelHeight =
    typeof data?.height === "number" ? data.height : undefined;
  return { pixelWidth, pixelHeight };
}

async function embeddedImageCandidates(
  page: {
    getOperatorList(): Promise<{
      fnArray: number[];
      argsArray: unknown[][];
    }>;
    getViewport(options: { scale: number }): {
      width: number;
      height: number;
      convertToViewportPoint(x: number, y: number): number[];
    };
  },
  OPS: Record<string, number>,
): Promise<PdfEmbeddedImageCandidate[]> {
  const list = await page.getOperatorList();
  const viewport = page.getViewport({ scale: 1 });
  const stack: Matrix[] = [];
  let current: Matrix = [1, 0, 0, 1, 0, 0];
  const images: PdfEmbeddedImageCandidate[] = [];

  for (let index = 0; index < list.fnArray.length; index += 1) {
    const fn = list.fnArray[index];
    const args = list.argsArray[index] ?? [];

    if (fn === OPS.save) {
      stack.push([...current] as Matrix);
      continue;
    }
    if (fn === OPS.restore) {
      current = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === OPS.transform && args.length >= 6) {
      const matrix = args.slice(0, 6).map(Number) as Matrix;
      if (matrix.every(Number.isFinite)) current = multiply(current, matrix);
      continue;
    }

    if (
      fn !== OPS.paintImageXObject &&
      fn !== OPS.paintInlineImageXObject
    )
      continue;

    const corners = [
      transformPoint(current, 0, 0),
      transformPoint(current, 1, 0),
      transformPoint(current, 0, 1),
      transformPoint(current, 1, 1),
    ].map(([x, y]) => viewportPoint(viewport, x, y));
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const x = clamp01(minX / Math.max(1, viewport.width));
    const y = clamp01(minY / Math.max(1, viewport.height));
    const width = clamp01((maxX - minX) / Math.max(1, viewport.width));
    const height = clamp01((maxY - minY) / Math.max(1, viewport.height));
    const area = width * height;
    if (area < 0.004 || width < 0.03 || height < 0.03) continue;

    const pixels = imagePixels(args);
    const largePixels =
      (pixels.pixelWidth ?? 0) >= 300 && (pixels.pixelHeight ?? 0) >= 300;
    const confidence = Number(
      Math.min(
        0.98,
        0.48 + Math.min(0.34, area * 1.25) + (largePixels ? 0.12 : 0),
      ).toFixed(3),
    );

    images.push({
      index: images.length + 1,
      x: Number(x.toFixed(5)),
      y: Number(y.toFixed(5)),
      width: Number(width.toFixed(5)),
      height: Number(height.toFixed(5)),
      area: Number(area.toFixed(5)),
      ...(pixels.pixelWidth ? { pixelWidth: pixels.pixelWidth } : {}),
      ...(pixels.pixelHeight ? { pixelHeight: pixels.pixelHeight } : {}),
      confidence,
    });
  }

  return images
    .sort(
      (left, right) =>
        right.area - left.area ||
        right.confidence - left.confidence ||
        left.index - right.index,
    )
    .slice(0, 40);
}

function spatialLabels(
  items: unknown[],
  viewport: {
    width: number;
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
  },
) {
  const labels: PdfSpatialLabel[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const row = item as {
      str?: unknown;
      transform?: unknown;
      width?: unknown;
      height?: unknown;
    };
    if (typeof row.str !== "string" || !row.str.trim()) continue;
    if (!Array.isArray(row.transform) || row.transform.length < 6) continue;
    const tx = Number(row.transform[4]);
    const ty = Number(row.transform[5]);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
    const [vx, vy] = viewportPoint(viewport, tx, ty);
    const width =
      typeof row.width === "number" && Number.isFinite(row.width)
        ? Math.abs(row.width) / Math.max(1, viewport.width)
        : 0;
    const height =
      typeof row.height === "number" && Number.isFinite(row.height)
        ? Math.abs(row.height) / Math.max(1, viewport.height)
        : 0;

    const text = row.str.replace(/\s+/g, " ").trim().slice(0, 180);
    labels.push({
      text,
      kind: labelKind(text),
      x: Number(clamp01(vx / Math.max(1, viewport.width)).toFixed(5)),
      y: Number(clamp01(vy / Math.max(1, viewport.height)).toFixed(5)),
      width: Number(clamp01(width).toFixed(5)),
      height: Number(clamp01(height).toFixed(5)),
    });
  }
  return labels
    .filter(
      (entry) =>
        entry.kind !== "other" ||
        /[a-z]/i.test(entry.text) ||
        /\d/.test(entry.text),
    )
    .slice(0, 800);
}

export async function inspectPdfPlans(
  source: Asset,
): Promise<PdfPlanInspection> {
  const result: PdfPlanInspection = { pages: [], pageCount: 0, issues: [] };
  if (
    source.type !== "application/pdf" &&
    !source.name.toLowerCase().endsWith(".pdf")
  )
    return result;
  if (source.size > 64 * 1024 * 1024) {
    result.issues.push("PDF is too large for automatic plan inspection.");
    return result;
  }

  const head = new TextDecoder("ascii").decode(
    new Uint8Array(await source.blob.slice(0, 8).arrayBuffer()),
  );
  if (!head.startsWith("%PDF")) {
    result.issues.push(
      "PDF signature is not readable; plan-page detection was skipped.",
    );
    return result;
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  result.pageCount = document.numPages;

  try {
    const limit = Math.min(document.numPages, 16);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textItems = content.items.filter(
        (item): item is typeof item & { str: string } =>
          "str" in item && typeof item.str === "string",
      );
      const text = normalizedText(textItems);
      const labels = roomLabels(text);
      const dims = dimensions(text);
      const hasFloorPlanLabel =
        /\b(?:floor\s*plan|typical\s*floor|ground\s*floor|first\s*floor|1st\s*floor)\b/i.test(
          text,
        );
      const spatial = spatialLabels(content.items as unknown[], viewport);
      let images: PdfEmbeddedImageCandidate[] = [];
      try {
        images = await embeddedImageCandidates(
          page as unknown as Parameters<typeof embeddedImageCandidates>[0],
          pdfjs.OPS as unknown as Record<string, number>,
        );
      } catch {
        // PDF text evidence stays usable if image operator inspection fails.
      }
      const strongestImage = images[0];
      const hasTextPlanEvidence =
        hasFloorPlanLabel || labels.length > 0 || dims.length > 0;
      const imageOnlyPlanBonus =
        images.length >= 2
          ? Math.min(5, images.length * 1.15 + (strongestImage?.confidence ?? 0))
          : strongestImage &&
              (strongestImage.pixelWidth ?? 0) >= 700 &&
              (strongestImage.pixelHeight ?? 0) >= 500
            ? 1.5
            : 0;
      const imagePlanBonus =
        strongestImage && hasTextPlanEvidence
          ? Math.min(6, strongestImage.area * 10 + strongestImage.confidence * 2)
          : imageOnlyPlanBonus;
      const spatialEvidence = spatial.filter(
        (entry) => entry.kind !== "other",
      ).length;
      const score =
        (hasFloorPlanLabel ? 10 : 0) +
        Math.min(8, labels.length * 1.25) +
        Math.min(8, dims.length * 0.75) +
        Math.min(4, spatialEvidence * 0.3) +
        imagePlanBonus +
        (/\b(?:sq\.?\s*ft|sqft|m2|sqm|m²|area)\b/i.test(text) ? 1.5 : 0);

      result.pages.push({
        page: pageNumber,
        score: Number(score.toFixed(2)),
        aspectRatio: Number(
          (viewport.width / Math.max(1, viewport.height)).toFixed(6),
        ),
        roomLabels: labels,
        dimensionStrings: dims,
        hasFloorPlanLabel,
        textSample: text.slice(0, 400),
        spatialLabels: spatial,
        embeddedImages: images,
      });
    }

    const best = [...result.pages].sort(
      (left, right) => right.score - left.score || left.page - right.page,
    )[0];
    if (best && best.score >= 3) result.bestPage = best.page;
    if (document.numPages > limit)
      result.issues.push(
        `Only the first ${limit} of ${document.numPages} PDF pages were inspected automatically.`,
      );
    if (!result.bestPage)
      result.issues.push(
        "No sufficiently strong floor-plan page was detected; manual page selection remains available.",
      );
    return result;
  } finally {
    await loadingTask.destroy();
  }
}
