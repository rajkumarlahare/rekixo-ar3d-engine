import type { Asset, ReferenceImageEvidence } from "./domain";
import { analyzeReferencePixels } from "./referenceImagePalette";

const RASTER_IMAGE = /\.(?:png|jpe?g|webp|bmp)$/i;

function imageCandidate(asset: Asset) {
  return (
    asset.type.startsWith("image/") ||
    RASTER_IMAGE.test(asset.name.toLowerCase())
  );
}

export async function inspectReferenceImage(
  asset: Asset,
): Promise<ReferenceImageEvidence> {
  if (!imageCandidate(asset))
    throw Error("Choose a supported raster reference image.");

  if (
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  )
    throw Error("Reference image decoding is unavailable in this browser.");

  const bitmap = await createImageBitmap(asset.blob);
  try {
    if (bitmap.width < 2 || bitmap.height < 2)
      throw Error("Reference image is too small to analyze.");

    const maxEdge = 640;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(2, Math.round(bitmap.width * scale));
    const height = Math.max(2, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!context)
      throw Error("Reference image canvas analysis is unavailable in this browser.");

    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    const analysis = analyzeReferencePixels(pixels.data, width, height);

    return {
      assetId: asset.id,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      sampledWidth: width,
      sampledHeight: height,
      renderedPalette: analysis.renderedPalette,
      regions: analysis.regions,
      averageLuminance: analysis.averageLuminance,
      warmFraction: analysis.warmFraction,
      darkFraction: analysis.darkFraction,
      highlightFraction: analysis.highlightFraction,
      averageSaturation: analysis.averageSaturation,
      verticalEdgeStrength: analysis.verticalEdgeStrength,
      horizontalEdgeStrength: analysis.horizontalEdgeStrength,
      lightingMood: analysis.lightingMood,
      confidence: analysis.confidence,
      sampleCount: analysis.sampleCount,
    };
  } finally {
    bitmap.close();
  }
}

export function looksLikeGeneratedPlanReference(name: string) {
  return /-page-\d+-(?:auto-plan-image|auto-plan-page|floor-plan|reference)\.png$/i.test(
    name,
  );
}
