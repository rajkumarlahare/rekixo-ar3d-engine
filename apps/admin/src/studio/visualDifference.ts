import type { ReferenceImageEvidence } from "./domain";
import type { ReferencePixelAnalysis } from "./referenceImagePalette";
import { referenceColorDistance } from "./referenceImagePalette";

export type VisualDifferenceStatus =
  | "viewpoint-required"
  | "close"
  | "review"
  | "far";

export interface VisualDifferenceResult {
  status: VisualDifferenceStatus;
  viewpointAligned: boolean;
  similarityPercent?: number;
  difference?: number;
  components?: {
    palette: number;
    luminance: number;
    saturation: number;
    edgeStructure: number;
    lightingMood: number;
  };
  referenceAssetId: string;
  detail: string;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const rounded = (value: number) => Number(clamp(value).toFixed(4));

function paletteDistance(
  left: readonly string[],
  right: readonly string[],
) {
  if (!left.length || !right.length) return 1;
  const directed = (source: readonly string[], target: readonly string[]) =>
    source.reduce((sum, color) => {
      const nearest = Math.min(
        ...target.map((candidate) => referenceColorDistance(color, candidate)),
      );
      return sum + clamp(nearest / Math.sqrt(3 * 255 * 255));
    }, 0) / source.length;
  return clamp((directed(left, right) + directed(right, left)) / 2);
}

/**
 * Presentation-only diagnostic. This compares color/lighting/edge statistics of
 * one user-confirmed aligned render and one visual reference. Camera framing,
 * sky/background and occlusion can change the result, so it is never geometry,
 * dimensional or publish-certification evidence.
 */
export function compareVisualAppearance(
  reference: ReferenceImageEvidence,
  rendered: ReferencePixelAnalysis,
  options: { viewpointAligned: boolean },
): VisualDifferenceResult {
  if (!options.viewpointAligned) {
    return {
      status: "viewpoint-required",
      viewpointAligned: false,
      referenceAssetId: reference.assetId,
      detail:
        "Align the current camera/view with the reference before scoring. Camera framing and background affect this diagnostic.",
    };
  }

  const palette = paletteDistance(
    reference.renderedPalette,
    rendered.renderedPalette,
  );
  const luminance = Math.abs(
    reference.averageLuminance - rendered.averageLuminance,
  );
  const saturation = Math.abs(
    reference.averageSaturation - rendered.averageSaturation,
  );
  const edgeStructure =
    (Math.abs(
      reference.verticalEdgeStrength - rendered.verticalEdgeStrength,
    ) +
      Math.abs(
        reference.horizontalEdgeStrength - rendered.horizontalEdgeStrength,
      )) /
    2;
  const lightingMood =
    reference.lightingMood === "unknown" || rendered.lightingMood === "unknown"
      ? 0.25
      : reference.lightingMood === rendered.lightingMood
        ? 0
        : 1;

  const difference = clamp(
    palette * 0.46 +
      luminance * 0.18 +
      saturation * 0.12 +
      edgeStructure * 0.16 +
      lightingMood * 0.08,
  );
  const similarityPercent = Math.round((1 - difference) * 100);
  const status =
    similarityPercent >= 80
      ? "close"
      : similarityPercent >= 60
        ? "review"
        : "far";

  return {
    status,
    viewpointAligned: true,
    similarityPercent,
    difference: Number(difference.toFixed(4)),
    components: {
      palette: rounded(palette),
      luminance: rounded(luminance),
      saturation: rounded(saturation),
      edgeStructure: rounded(edgeStructure),
      lightingMood: rounded(lightingMood),
    },
    referenceAssetId: reference.assetId,
    detail:
      "Appearance-only score. It does not certify dimensions, geometry or source fidelity; camera/background differences can lower the score.",
  };
}
