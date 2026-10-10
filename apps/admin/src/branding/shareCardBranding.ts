import { GLOBAL_SHARE_BRAND, GLOBAL_SHARE_BRAND_DATA_URL } from "./globalShareBrand";

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PUBLIC_SHARE_IMAGE_BYTES = 550 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PreparedBrandedShareCard = { sourceFile: File; cardFile: File };

function fileFromBlob(blob: Blob, name: string, type: string) {
  return new File([blob], name, { type, lastModified: Date.now() });
}

function validateSourceImage(file: File) {
  if (!IMAGE_TYPES.has(file.type))
    throw new Error("Share poster JPG, PNG ya WebP me choose karein.");
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new Error("Original poster 8 MB se chhota hona chahiye.");
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadGlobalShareBrandBitmap() {
  const response = await fetch(GLOBAL_SHARE_BRAND_DATA_URL);
  if (!response.ok) throw new Error("AR3D branding logo load nahi hua");
  return createImageBitmap(await response.blob());
}

function clampShareColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lightenShareColor(color: readonly [number, number, number], amount: number) {
  return [
    clampShareColor(color[0] + amount),
    clampShareColor(color[1] + amount),
    clampShareColor(color[2] + amount),
  ] as const;
}

function shareColorCss(color: readonly [number, number, number]) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function footerCornerColors(bitmap: ImageBitmap) {
  const sourceSampleWidth = Math.max(
    GLOBAL_SHARE_BRAND.footerMinSamplePx,
    Math.round(bitmap.width * GLOBAL_SHARE_BRAND.footerCornerSampleWidthRatio),
  );
  const sourceSampleHeight = Math.max(
    GLOBAL_SHARE_BRAND.footerMinSamplePx,
    Math.round(bitmap.height * GLOBAL_SHARE_BRAND.footerCornerSampleHeightRatio),
  );
  const sourceX = Math.max(0, bitmap.width - sourceSampleWidth);
  const sourceY = Math.max(0, bitmap.height - sourceSampleHeight);
  const sampleSize = GLOBAL_SHARE_BRAND.footerAnalysisSizePx;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleSize;
  sampleCanvas.height = sampleSize;
  const sampleContext = sampleCanvas.getContext("2d", {
    alpha: true,
    willReadFrequently: true,
  });

  if (!sampleContext) {
    return {
      base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
    };
  }

  // Match the Platform builder: derive the footer tone only from the image's bottom-right corner.
  sampleContext.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceSampleWidth,
    sourceSampleHeight,
    0,
    0,
    sampleSize,
    sampleSize,
  );

  try {
    const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
    const visible: Array<[number, number, number, number]> = [];
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] / 255;
      if (alpha < 0.08) continue;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      visible.push([red, green, blue, luminance]);
    }

    if (!visible.length) {
      return {
        base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
        lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      };
    }

    visible.sort((left, right) => left[3] - right[3]);
    const trim = Math.floor(visible.length * GLOBAL_SHARE_BRAND.footerOutlierTrimRatio);
    const stable =
      trim > 0 && visible.length - trim * 2 >= 8
        ? visible.slice(trim, visible.length - trim)
        : visible;

    let red = 0;
    let green = 0;
    let blue = 0;
    for (const pixel of stable) {
      red += pixel[0];
      green += pixel[1];
      blue += pixel[2];
    }
    const baseTuple = [
      clampShareColor(red / stable.length),
      clampShareColor(green / stable.length),
      clampShareColor(blue / stable.length),
    ] as const;
    const liftTuple = lightenShareColor(baseTuple, GLOBAL_SHARE_BRAND.footerGradientLift);
    return { base: shareColorCss(baseTuple), lift: shareColorCss(liftTuple) };
  } catch {
    return {
      base: GLOBAL_SHARE_BRAND.footerFallbackBackground,
      lift: GLOBAL_SHARE_BRAND.footerFallbackBackground,
    };
  }
}

function drawImageDerivedFooter(
  context: CanvasRenderingContext2D,
  sourceBitmap: ImageBitmap,
  width: number,
  imageHeight: number,
  footerHeight: number,
) {
  const colors = footerCornerColors(sourceBitmap);
  const gradient = context.createLinearGradient(
    0,
    imageHeight,
    0,
    imageHeight + footerHeight,
  );
  gradient.addColorStop(0, colors.lift);
  gradient.addColorStop(1, colors.base);
  context.fillStyle = gradient;
  context.fillRect(0, imageHeight, width, footerHeight);
}

async function encodeBrandedCard(canvas: HTMLCanvasElement) {
  // Try broadly supported JPEG first, then WebP; both remain under the existing upload contract.
  for (const quality of [0.86, 0.78, 0.70, 0.62, 0.54, 0.46]) {
    const blob = await canvasBlob(canvas, "image/jpeg", quality);
    if (blob?.type === "image/jpeg" && blob.size <= MAX_PUBLIC_SHARE_IMAGE_BYTES)
      return fileFromBlob(blob, "ar3d-share-card.jpg", "image/jpeg");
  }
  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const blob = await canvasBlob(canvas, "image/webp", quality);
    if (blob?.type === "image/webp" && blob.size <= MAX_PUBLIC_SHARE_IMAGE_BYTES)
      return fileFromBlob(blob, "ar3d-share-card.webp", "image/webp");
  }
  throw new Error("Share card 550 KB ke andar optimize nahi hui. Chhoti ya less detailed image choose karein.");
}

export async function prepareBrandedShareCard(file: File): Promise<PreparedBrandedShareCard> {
  validateSourceImage(file);
  const sourceBitmap = await createImageBitmap(file);
  let brandBitmap: ImageBitmap | undefined;
  try {
    if (
      sourceBitmap.width < 1 ||
      sourceBitmap.height < 1 ||
      sourceBitmap.width * sourceBitmap.height > 100_000_000
    ) throw new Error("Poster dimensions supported range me nahi hain.");

    const scale = Math.min(
      1,
      GLOBAL_SHARE_BRAND.maxOutputDimension / Math.max(sourceBitmap.width, sourceBitmap.height),
      Math.sqrt(GLOBAL_SHARE_BRAND.maxOutputPixels / (sourceBitmap.width * sourceBitmap.height)),
    );
    const width = Math.max(1, Math.round(sourceBitmap.width * scale));
    const height = Math.max(1, Math.round(sourceBitmap.height * scale));
    brandBitmap = await loadGlobalShareBrandBitmap();

    const logoCeiling = Math.max(
      1,
      Math.min(
        GLOBAL_SHARE_BRAND.maxLogoPx,
        Math.round(width * GLOBAL_SHARE_BRAND.maxWidthRatio),
        Math.round(height * GLOBAL_SHARE_BRAND.heightLimitRatio),
      ),
    );
    const logoWidth = Math.max(
      1,
      Math.min(
        logoCeiling,
        Math.max(
          GLOBAL_SHARE_BRAND.minLogoPx,
          Math.round(width * GLOBAL_SHARE_BRAND.widthRatio),
        ),
      ),
    );
    const logoHeight = Math.max(1, Math.round(logoWidth * (brandBitmap.height / brandBitmap.width)));
    const footerPadding = Math.max(
      GLOBAL_SHARE_BRAND.minFooterPaddingPx,
      Math.round(width * GLOBAL_SHARE_BRAND.footerPaddingRatio),
    );
    const footerHeight = Math.max(
      GLOBAL_SHARE_BRAND.minFooterHeightPx,
      logoHeight + footerPadding * 2,
    );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height + footerHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Share image process nahi ho payi");

    // Never crop or paint over the uploaded poster. The AR3D mark gets its own footer.
    context.drawImage(sourceBitmap, 0, 0, width, height);
    drawImageDerivedFooter(context, sourceBitmap, width, height, footerHeight);
    context.fillStyle = GLOBAL_SHARE_BRAND.dividerColor;
    context.fillRect(0, height, width, GLOBAL_SHARE_BRAND.dividerHeightPx);

    // The source mark includes alpha; transparent pixels reveal the generated footer beneath it.
    const logoX = Math.round((width - logoWidth) / 2);
    const logoY = height + Math.round((footerHeight - logoHeight) / 2);
    context.drawImage(brandBitmap, logoX, logoY, logoWidth, logoHeight);

    const cardFile = await encodeBrandedCard(canvas);
    return { sourceFile: file, cardFile };
  } finally {
    sourceBitmap.close();
    brandBitmap?.close();
  }
}
