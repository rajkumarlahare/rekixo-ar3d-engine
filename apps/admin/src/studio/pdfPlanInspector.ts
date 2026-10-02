import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Asset } from "./domain";

export interface PdfPlanPageEvidence {
  page: number;
  score: number;
  roomLabels: string[];
  dimensionStrings: string[];
  hasFloorPlanLabel: boolean;
  textSample: string;
}

export interface PdfPlanInspection {
  pages: PdfPlanPageEvidence[];
  bestPage?: number;
  pageCount: number;
  issues: string[];
}

const ROOM_LABELS = [
  "living",
  "bedroom",
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
];

function normalizedText(items: Array<{ str?: string }>) {
  return items
    .map((item) => item.str ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function dimensions(text: string) {
  const matches = text.match(
    /\b\d{1,3}(?:\.\d{1,3})?\s*(?:x|×)\s*\d{1,3}(?:\.\d{1,3})?\b/gi,
  );
  return [...new Set((matches ?? []).map((value) => value.replace(/\s+/g, " ")))].slice(0, 80);
}

function roomLabels(text: string) {
  const lower = text.toLowerCase();
  return ROOM_LABELS.filter((label) => new RegExp(`\\b${label}s?\\b`, "i").test(lower));
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
    result.issues.push("PDF is too large for automatic plan-text inspection.");
    return result;
  }

  const head = new TextDecoder("ascii").decode(
    new Uint8Array(await source.blob.slice(0, 8).arrayBuffer()),
  );
  if (!head.startsWith("%PDF")) {
    result.issues.push("PDF signature is not readable; plan-page detection was skipped.");
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
      const content = await page.getTextContent();
      const text = normalizedText(
        content.items.filter(
          (item): item is typeof item & { str: string } =>
            "str" in item && typeof item.str === "string",
        ),
      );
      const labels = roomLabels(text);
      const dims = dimensions(text);
      const hasFloorPlanLabel =
        /\b(?:floor\s*plan|typical\s*floor|ground\s*floor|first\s*floor|1st\s*floor)\b/i.test(
          text,
        );
      const score =
        (hasFloorPlanLabel ? 10 : 0) +
        Math.min(8, labels.length * 1.25) +
        Math.min(8, dims.length * 0.75) +
        (/\b(?:sq\.?\s*ft|sqft|m2|sqm|area)\b/i.test(text) ? 1.5 : 0);
      result.pages.push({
        page: pageNumber,
        score: Number(score.toFixed(2)),
        roomLabels: labels,
        dimensionStrings: dims,
        hasFloorPlanLabel,
        textSample: text.slice(0, 400),
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
        "No sufficiently strong floor-plan text page was detected; manual page selection remains available.",
      );
    return result;
  } finally {
    await loadingTask.destroy();
  }
}
