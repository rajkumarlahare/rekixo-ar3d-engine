import type { Project, ReferenceImageEvidence, SceneAppearance } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";

export type VisualFacadeMatchStatus =
  | "unavailable"
  | "needs-review"
  | "auto-ready";

export type VisualMaterialRole =
  | "paint"
  | "glass"
  | "metal"
  | "wood"
  | "stone";

export interface VisualAppearanceSuggestion {
  status: "needs-review" | "auto-ready";
  confidence: number;
  sourceAssetId: string;
  appearance: SceneAppearance;
  reasons: string[];
}

export interface VisualMaterialSuggestion {
  materialName: string;
  role: VisualMaterialRole;
  baseColor: string;
  confidence: number;
  sourceAssetId: string;
  /** Visual evidence may guide appearance, but never becomes metric truth. */
  reviewRequired: true;
  reason: string;
}

export interface VisualFacadeMatchPlan {
  status: VisualFacadeMatchStatus;
  sourceAssetId?: string;
  evidenceConfidence: number;
  appearance?: VisualAppearanceSuggestion;
  materials: VisualMaterialSuggestion[];
  counts: {
    sourceMaterials: number;
    classifiedMaterials: number;
    suggestedMaterials: number;
    reviewRequired: number;
  };
  issues: string[];
  invariants: readonly [
    "visual-non-metric",
    "source-material-names-only",
    "geometry-immutable",
  ];
}

interface Rgb {
  hex: string;
  r: number;
  g: number;
  b: number;
  luminance: number;
  saturation: number;
  warmth: number;
}

const VISUAL_CONFIDENCE_FLOOR = 0.55;
const AUTO_APPEARANCE_CONFIDENCE = 0.72;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(clamp(value).toFixed(3));
}

function color(hex: string): Rgb | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return {
    hex: hex.toLowerCase(),
    r,
    g,
    b,
    luminance: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
    saturation: max <= 0 ? 0 : (max - min) / max,
    warmth: (r - b) / 255,
  };
}

function classifyMaterial(name: string): VisualMaterialRole | undefined {
  if (/glass|glaz|window|translucent/i.test(name)) return "glass";
  if (/metal|steel|alum(?:inium|inum)?|frame|fin|rail/i.test(name))
    return "metal";
  if (/wood|timber|veneer|cladding|brown/i.test(name)) return "wood";
  if (/stone|marble|granite|tile|slate|paver/i.test(name)) return "stone";
  if (/wall|paint|plaster|cement|concrete|cream|beige|sand|facade/i.test(name))
    return "paint";
  return undefined;
}

function choosePaletteColor(
  role: VisualMaterialRole,
  palette: readonly Rgb[],
): Rgb | undefined {
  if (!palette.length) return undefined;
  const ranked = [...palette];
  if (role === "glass")
    ranked.sort(
      (left, right) =>
        right.b - right.r - (left.b - left.r) ||
        right.luminance - left.luminance ||
        left.hex.localeCompare(right.hex),
    );
  else if (role === "metal")
    ranked.sort(
      (left, right) =>
        left.luminance - right.luminance || left.hex.localeCompare(right.hex),
    );
  else if (role === "wood")
    ranked.sort(
      (left, right) =>
        right.warmth - left.warmth ||
        right.saturation - left.saturation ||
        left.hex.localeCompare(right.hex),
    );
  else if (role === "stone")
    ranked.sort(
      (left, right) =>
        Math.abs(left.saturation - 0.18) - Math.abs(right.saturation - 0.18) ||
        Math.abs(left.luminance - 0.58) - Math.abs(right.luminance - 0.58) ||
        left.hex.localeCompare(right.hex),
    );
  else
    ranked.sort(
      (left, right) =>
        Math.abs(left.luminance - 0.72) - Math.abs(right.luminance - 0.72) ||
        left.saturation - right.saturation ||
        left.hex.localeCompare(right.hex),
    );
  return ranked[0];
}

function appearanceFromEvidence(
  evidence: ReferenceImageEvidence,
  palette: readonly Rgb[],
): VisualAppearanceSuggestion {
  const confidence = round(evidence.confidence);
  const status =
    confidence >= AUTO_APPEARANCE_CONFIDENCE && evidence.lightingMood !== "unknown"
      ? "auto-ready"
      : "needs-review";
  const fallbackBackground = "#dbe3e7";
  const paletteBackground = [...palette].sort(
    (left, right) =>
      left.luminance - right.luminance || left.hex.localeCompare(right.hex),
  )[0]?.hex;

  let appearance: SceneAppearance;
  if (evidence.lightingMood === "night") {
    appearance = {
      exposure: 0.9,
      sunIntensity: 1.15,
      hemisphereIntensity: 1.6,
      background: paletteBackground ?? "#101722",
      referenceVisual: true,
      nightMode: true,
    };
  } else if (evidence.lightingMood === "evening") {
    appearance = {
      exposure: 1.02,
      sunIntensity: 2.5,
      hemisphereIntensity: 2.35,
      background: paletteBackground ?? "#5f6670",
      referenceVisual: true,
      nightMode: false,
    };
  } else {
    appearance = {
      exposure: evidence.averageLuminance < 0.48 ? 1.08 : 1,
      sunIntensity: 3.2,
      hemisphereIntensity: 2.8,
      background: fallbackBackground,
      referenceVisual: true,
      nightMode: false,
    };
  }

  return {
    status,
    confidence,
    sourceAssetId: evidence.assetId,
    appearance,
    reasons: [
      `Reference lighting mood: ${evidence.lightingMood}.`,
      `Visual evidence confidence: ${Math.round(confidence * 100)}%.`,
      "Appearance settings affect presentation only; geometry and dimensions remain source-controlled.",
    ],
  };
}

function sourceMaterialNames(audits: readonly FbxSourceAudit[]) {
  return [...new Set(audits.flatMap((audit) => audit.materialNames).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * Builds a deterministic, non-destructive visual matching plan.
 *
 * Reference images are appearance evidence only. The planner never creates or
 * moves geometry, never infers dimensions/openings/floors, and only proposes
 * material changes for material names already present in audited source FBX.
 */
export function buildVisualFacadeMatchPlan(
  project: Project,
  audits: readonly FbxSourceAudit[],
): VisualFacadeMatchPlan {
  const evidence = project.scene.referenceImageEvidence;
  const materialNames = sourceMaterialNames(audits);
  const invariants = [
    "visual-non-metric",
    "source-material-names-only",
    "geometry-immutable",
  ] as const;

  if (!evidence) {
    return {
      status: "unavailable",
      evidenceConfidence: 0,
      materials: [],
      counts: {
        sourceMaterials: materialNames.length,
        classifiedMaterials: 0,
        suggestedMaterials: 0,
        reviewRequired: 0,
      },
      issues: ["No analyzed visual reference image is available for facade matching."],
      invariants,
    };
  }

  const palette = evidence.renderedPalette
    .map(color)
    .filter((entry): entry is Rgb => Boolean(entry));
  const classified = materialNames
    .map((materialName) => ({ materialName, role: classifyMaterial(materialName) }))
    .filter(
      (entry): entry is { materialName: string; role: VisualMaterialRole } =>
        Boolean(entry.role),
    );
  const materials: VisualMaterialSuggestion[] = [];

  if (evidence.confidence >= VISUAL_CONFIDENCE_FLOOR && palette.length) {
    for (const entry of classified) {
      const target = choosePaletteColor(entry.role, palette);
      if (!target) continue;
      const roleFactor = entry.role === "paint" || entry.role === "stone" ? 0.9 : 0.82;
      materials.push({
        materialName: entry.materialName,
        role: entry.role,
        baseColor: target.hex,
        confidence: round(evidence.confidence * roleFactor),
        sourceAssetId: evidence.assetId,
        reviewRequired: true,
        reason: `${entry.role} role is source-name-backed; ${target.hex} is selected only from the analyzed reference palette.`,
      });
    }
  }

  const appearance = appearanceFromEvidence(evidence, palette);
  const issues: string[] = [];
  if (evidence.confidence < VISUAL_CONFIDENCE_FLOOR)
    issues.push(
      "Visual reference confidence is too low for material suggestions; keep manual review.",
    );
  if (!palette.length)
    issues.push("Visual reference contains no valid rendered palette colors.");
  if (materialNames.length && !classified.length)
    issues.push(
      "Source materials are present, but none have a safely classifiable facade/material role.",
    );
  if (materials.length)
    issues.push(
      `${materials.length} source material suggestion${materials.length === 1 ? "" : "s"} require human review before application.`,
    );

  return {
    status:
      appearance.status === "auto-ready" ? "auto-ready" : "needs-review",
    sourceAssetId: evidence.assetId,
    evidenceConfidence: round(evidence.confidence),
    appearance,
    materials,
    counts: {
      sourceMaterials: materialNames.length,
      classifiedMaterials: classified.length,
      suggestedMaterials: materials.length,
      reviewRequired: materials.length + (appearance.status === "needs-review" ? 1 : 0),
    },
    issues,
    invariants,
  };
}
