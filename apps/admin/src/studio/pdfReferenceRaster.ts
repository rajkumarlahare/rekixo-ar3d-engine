import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Asset } from "./domain";

export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfReferenceRasterOptions {
  page: number;
  crop?: NormalizedCrop;
  label?: string;
}

export interface PdfReferenceRasterResult {
  file: File;
  widthPx: number;
  heightPx: number;
  crop: NormalizedCrop;
}

function clampCrop(crop?: NormalizedCrop): NormalizedCrop {
  if (!crop) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(0.98, Math.max(0, crop.x));
  const y = Math.min(0.98, Math.max(0, crop.y));
  const width = Math.min(1 - x, Math.max(0.02, crop.width));
  const height = Math.min(1 - y, Math.max(0.02, crop.height));
  return { x, y, width, height };
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(Error("Could not create the plan alignment image."));
      },
      "image/png",
    );
  });
}

export async function rasterPdfReferenceWithMetadata(
  source: Asset,
  options: PdfReferenceRasterOptions,
): Promise<PdfReferenceRasterResult> {
  if (
    source.type !== "application/pdf" &&
    !source.name.toLowerCase().endsWith(".pdf")
  )
    throw Error("Choose a PDF source before creating an alignment image.");

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const bytes = new Uint8Array(await source.blob.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdfDocument = await loadingTask.promise;
  try {
    const pageNumber = Math.max(
      1,
      Math.min(pdfDocument.numPages, Math.round(options.page || 1)),
    );
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const targetLongEdge = 2200;
    const scale = Math.min(
      2.25,
      Math.max(
        1,
        targetLongEdge / Math.max(baseViewport.width, baseViewport.height),
      ),
    );
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw Error("Canvas rendering is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const crop = clampCrop(options.crop);
    const sx = Math.round(canvas.width * crop.x);
    const sy = Math.round(canvas.height * crop.y);
    const sw = Math.max(1, Math.round(canvas.width * crop.width));
    const sh = Math.max(1, Math.round(canvas.height * crop.height));
    const output = window.document.createElement("canvas");
    output.width = sw;
    output.height = sh;
    const outputContext = output.getContext("2d", { alpha: false });
    if (!outputContext)
      throw Error("Canvas export is unavailable in this browser.");
    outputContext.fillStyle = "#ffffff";
    outputContext.fillRect(0, 0, sw, sh);
    outputContext.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const blob = await canvasBlob(output);
    const base = source.name.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "-");
    const label = (options.label ?? "floor-plan")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const file = new File(
      [blob],
      `${base}-page-${pageNumber}-${label || "reference"}.png`,
      { type: "image/png" },
    );
    return {
      file,
      widthPx: output.width,
      heightPx: output.height,
      crop,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function rasterPdfReference(
  source: Asset,
  options: PdfReferenceRasterOptions,
): Promise<File> {
  return (await rasterPdfReferenceWithMetadata(source, options)).file;
}

