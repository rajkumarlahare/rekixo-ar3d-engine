export type ReferenceLightingMood =
  | "day"
  | "evening"
  | "night"
  | "unknown";

export interface ReferencePixelAnalysis {
  renderedPalette: string[];
  averageLuminance: number;
  warmFraction: number;
  darkFraction: number;
  highlightFraction: number;
  averageSaturation: number;
  verticalEdgeStrength: number;
  horizontalEdgeStrength: number;
  lightingMood: ReferenceLightingMood;
  confidence: number;
  sampleCount: number;
}

interface Bin {
  weight: number;
  r: number;
  g: number;
  b: number;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function luminance(r: number, g: number, b: number) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 0 ? 0 : (max - min) / max;
}

function hex(r: number, g: number, b: number) {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return ("#" + channel(r) + channel(g) + channel(b)).toLowerCase();
}

function colorDistance(left: string, right: string) {
  const rgb = (value: string) => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
  const a = rgb(left);
  const b = rgb(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function moodFor(
  averageLuminance: number,
  warmFraction: number,
  darkFraction: number,
  highlightFraction: number,
): ReferenceLightingMood {
  if (averageLuminance < 0.3 && darkFraction >= 0.48) return "night";
  if (
    averageLuminance < 0.64 &&
    warmFraction >= 0.14 &&
    highlightFraction >= 0.055
  )
    return "evening";
  if (averageLuminance >= 0.56 && darkFraction < 0.36) return "day";
  return "unknown";
}

export function analyzeReferencePixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
): ReferencePixelAnalysis {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    data.length < width * height * 4
  )
    throw Error("Reference image pixels are invalid.");

  const targetSamples = 30_000;
  const step = Math.max(
    1,
    Math.floor(Math.sqrt((width * height) / targetSamples)),
  );
  const bins = new Map<number, Bin>();

  let sampleCount = 0;
  let totalWeight = 0;
  let luminanceSum = 0;
  let saturationSum = 0;
  let warmWeight = 0;
  let darkWeight = 0;
  let highlightWeight = 0;
  let verticalEdge = 0;
  let horizontalEdge = 0;
  let verticalEdgeWeight = 0;
  let horizontalEdgeWeight = 0;

  const pixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    return [
      Number(data[offset] ?? 0),
      Number(data[offset + 1] ?? 0),
      Number(data[offset + 2] ?? 0),
      Number(data[offset + 3] ?? 255),
    ] as const;
  };

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const [r, g, b, a] = pixel(x, y);
      if (a < 180) continue;

      const nx = Math.abs(x / Math.max(1, width - 1) - 0.5) * 2;
      const ny = Math.abs(y / Math.max(1, height - 1) - 0.5) * 2;
      const centre = 1 - Math.min(1, Math.hypot(nx, ny) / Math.SQRT2);
      const weight = 0.72 + centre * 0.78;
      const lum = luminance(r, g, b);
      const sat = saturation(r, g, b);

      sampleCount += 1;
      totalWeight += weight;
      luminanceSum += lum * weight;
      saturationSum += sat * weight;
      if (r - b >= 18 && r - g >= 3 && sat >= 0.08)
        warmWeight += weight;
      if (lum < 0.25) darkWeight += weight;
      if (lum > 0.72) highlightWeight += weight;

      const qr = Math.min(7, Math.floor(r / 32));
      const qg = Math.min(7, Math.floor(g / 32));
      const qb = Math.min(7, Math.floor(b / 32));
      const key = (qr << 6) | (qg << 3) | qb;
      const bin = bins.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
      bin.weight += weight;
      bin.r += r * weight;
      bin.g += g * weight;
      bin.b += b * weight;
      bins.set(key, bin);

      if (x + step < width) {
        const right = pixel(x + step, y);
        if (right[3] >= 180) {
          verticalEdge +=
            Math.abs(lum - luminance(right[0], right[1], right[2])) * weight;
          verticalEdgeWeight += weight;
        }
      }
      if (y + step < height) {
        const down = pixel(x, y + step);
        if (down[3] >= 180) {
          horizontalEdge +=
            Math.abs(lum - luminance(down[0], down[1], down[2])) * weight;
          horizontalEdgeWeight += weight;
        }
      }
    }
  }

  if (!sampleCount || totalWeight <= 0)
    throw Error("Reference image has no usable opaque pixels.");

  const palette: string[] = [];
  const ranked = [...bins.values()]
    .filter((bin) => bin.weight / totalWeight >= 0.008)
    .sort((left, right) => right.weight - left.weight);

  for (const bin of ranked) {
    const candidate = hex(
      bin.r / bin.weight,
      bin.g / bin.weight,
      bin.b / bin.weight,
    );
    if (palette.some((existing) => colorDistance(existing, candidate) < 34))
      continue;
    palette.push(candidate);
    if (palette.length >= 8) break;
  }

  const averageLuminance = luminanceSum / totalWeight;
  const warmFraction = warmWeight / totalWeight;
  const darkFraction = darkWeight / totalWeight;
  const highlightFraction = highlightWeight / totalWeight;
  const averageSaturation = saturationSum / totalWeight;
  const verticalEdgeStrength =
    verticalEdgeWeight > 0 ? verticalEdge / verticalEdgeWeight : 0;
  const horizontalEdgeStrength =
    horizontalEdgeWeight > 0 ? horizontalEdge / horizontalEdgeWeight : 0;
  const lightingMood = moodFor(
    averageLuminance,
    warmFraction,
    darkFraction,
    highlightFraction,
  );
  const sampleFactor = Math.min(1, sampleCount / 12_000);
  const paletteFactor = Math.min(1, palette.length / 6);
  const confidence = clamp(
    0.46 + sampleFactor * 0.23 + paletteFactor * 0.16 +
      Math.min(0.1, (verticalEdgeStrength + horizontalEdgeStrength) * 0.25),
    0.35,
    0.95,
  );

  return {
    renderedPalette: palette,
    averageLuminance: Number(averageLuminance.toFixed(4)),
    warmFraction: Number(warmFraction.toFixed(4)),
    darkFraction: Number(darkFraction.toFixed(4)),
    highlightFraction: Number(highlightFraction.toFixed(4)),
    averageSaturation: Number(averageSaturation.toFixed(4)),
    verticalEdgeStrength: Number(verticalEdgeStrength.toFixed(4)),
    horizontalEdgeStrength: Number(horizontalEdgeStrength.toFixed(4)),
    lightingMood,
    confidence: Number(confidence.toFixed(3)),
    sampleCount,
  };
}
