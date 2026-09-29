import {
  DEFAULT_SCENE_APPEARANCE,
  type SceneAppearance,
} from "./domain";

export type AppearancePresetId =
  | "reference-match"
  | "clean-day"
  | "warm-evening"
  | "night-lights";

export interface AppearancePreset {
  id: AppearancePresetId;
  label: string;
  shortDescription: string;
  detail: string;
  appearance: SceneAppearance;
}

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  {
    id: "reference-match",
    label: "Reference Match",
    shortDescription: "Source-first",
    detail:
      "Keeps the verified source/reference material treatment with balanced daylight.",
    appearance: { ...DEFAULT_SCENE_APPEARANCE },
  },
  {
    id: "clean-day",
    label: "Clean Day",
    shortDescription: "Bright exterior",
    detail:
      "Crisp daylight with stronger sun and open-sky fill for a clean customer preview.",
    appearance: {
      exposure: 1.08,
      sunIntensity: 4.2,
      hemisphereIntensity: 3.15,
      background: "#dce8f2",
      referenceVisual: false,
      nightMode: false,
    },
  },
  {
    id: "warm-evening",
    label: "Warm Evening",
    shortDescription: "Golden ambience",
    detail:
      "Warmer architectural-light mode with enough ambient fill to preserve facade detail.",
    appearance: {
      exposure: 1,
      sunIntensity: 1.8,
      hemisphereIntensity: 2.05,
      background: "#b77b61",
      referenceVisual: false,
      nightMode: true,
    },
  },
  {
    id: "night-lights",
    label: "Night Lights",
    shortDescription: "Architectural glow",
    detail:
      "Lower daylight contribution with architectural lights emphasized for a night presentation.",
    appearance: {
      exposure: 0.9,
      sunIntensity: 0.35,
      hemisphereIntensity: 1.35,
      background: "#11192d",
      referenceVisual: false,
      nightMode: true,
    },
  },
];

const close = (left: number, right: number) =>
  Math.abs(left - right) < 0.000001;

export function activeAppearancePreset(
  appearance: SceneAppearance,
): AppearancePreset | undefined {
  return APPEARANCE_PRESETS.find(
    (preset) =>
      close(preset.appearance.exposure, appearance.exposure) &&
      close(preset.appearance.sunIntensity, appearance.sunIntensity) &&
      close(
        preset.appearance.hemisphereIntensity,
        appearance.hemisphereIntensity,
      ) &&
      preset.appearance.background.toLowerCase() ===
        appearance.background.toLowerCase() &&
      preset.appearance.referenceVisual === appearance.referenceVisual &&
      preset.appearance.nightMode === appearance.nightMode,
  );
}

export function appearancePreset(
  id: AppearancePresetId,
): AppearancePreset {
  const preset = APPEARANCE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw Error("Unknown visual realism preset.");
  return preset;
}
