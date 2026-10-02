import type { MaterialOverride } from "./domain";

export interface MaterialPreset {
  id: string;
  label: string;
  detail: string;
  override: Omit<MaterialOverride, "materialName">;
  match: RegExp;
}

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: "white-paint",
    label: "White paint",
    detail: "Soft architectural wall finish",
    override: {
      baseColor: "#f1efe9",
      roughness: 0.88,
      metalness: 0,
      opacity: 1,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /wall|paint|plaster|cement|concrete|white/i,
  },
  {
    id: "warm-paint",
    label: "Warm paint",
    detail: "Warm cream/off-white interior or facade paint",
    override: {
      baseColor: "#e5d8c4",
      roughness: 0.86,
      metalness: 0,
      opacity: 1,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /cream|beige|sand|warm|wall|paint/i,
  },
  {
    id: "glass",
    label: "Glass",
    detail: "Clean blue-neutral glazing",
    override: {
      baseColor: "#b9d7df",
      roughness: 0.12,
      metalness: 0,
      opacity: 0.42,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /glass|glazing|window|translucent/i,
  },
  {
    id: "dark-metal",
    label: "Dark metal",
    detail: "Frames, fins and dark metal panels",
    override: {
      baseColor: "#3b4145",
      roughness: 0.32,
      metalness: 0.72,
      opacity: 1,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /metal|steel|aluminium|aluminum|frame|fin|rail/i,
  },
  {
    id: "wood",
    label: "Wood",
    detail: "Warm wood/cladding baseline",
    override: {
      baseColor: "#8a6043",
      roughness: 0.64,
      metalness: 0,
      opacity: 1,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /wood|timber|veneer|cladding|brown/i,
  },
  {
    id: "stone",
    label: "Stone",
    detail: "Stone, marble, granite and tile baseline",
    override: {
      baseColor: "#b8b1a7",
      roughness: 0.52,
      metalness: 0,
      opacity: 1,
      emissive: "#000000",
      emissiveIntensity: 0,
    },
    match: /stone|marble|granite|tile|slate|paver/i,
  },
];

export function suggestedMaterialPreset(materialName: string) {
  return MATERIAL_PRESETS.find((preset) => preset.match.test(materialName));
}
