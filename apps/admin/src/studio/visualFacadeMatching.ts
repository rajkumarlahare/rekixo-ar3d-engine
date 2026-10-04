import type {
  Project,
  ReferenceColorRegion,
  ReferenceImageEvidence,
  SceneAppearance,
} from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import { referenceColorDistance } from "./referenceImagePalette";

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

export interface VisualReferenceDecision {
  sourceAssetId: string;
  selected: boolean;
  confidence: number;
  rankScore: number;
  lightingMood: ReferenceImageEvidence["lightingMood"];
  regionCount: number;
  reason: string;
}

export interface VisualAppearanceSuggestion {
  status: "needs-review" | "auto-ready";
  confidence: number;
  sourceAssetId: string;
  appearance: SceneAppearance;
  reasons: string[];
}

export interface VisualMaterialCandidate {
  sourceAssetId: string;
  regionId?: string;
  baseColor: string;
  coverage?: number;
  centroidX?: number;
  centroidY?: number;
  confidence: number;
  correspondence: "region" | "palette";
  reason: string;
}

export interface VisualMaterialSuggestion {
  materialName: string;
  role: VisualMaterialRole;
  baseColor: string;
  confidence: number;
  sourceAssetId: string;
  regionId?: string;
  correspondence: "region" | "palette";
  conflict: boolean;
  candidates: VisualMaterialCandidate[];
  /** Visual evidence may guide appearance, but never becomes metric truth. */
  reviewRequired: true;
  reason: string;
}

export interface VisualFacadeMatchPlan {
  status: VisualFacadeMatchStatus;
  /** Backwards-compatible alias for the selected primary reference. */
  sourceAssetId?: string;
  primarySourceAssetId?: string;
  evidenceConfidence: number;
  references: VisualReferenceDecision[];
  lightingConflict: boolean;
  appearance?: VisualAppearanceSuggestion;
  materials: VisualMaterialSuggestion[];
  counts: {
    references: number;
    regions: number;
    sourceMaterials: number;
    classifiedMaterials: number;
    suggestedMaterials: number;
    regionMatches: number;
    conflicts: number;
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
const MATERIAL_CONFLICT_DISTANCE = 78;

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

function roleSuitability(role: VisualMaterialRole, region: ReferenceColorRegion) {
  const lum = region.luminance;
  const sat = region.saturation;
  const warmth = region.warmth;
  if (role === "glass")
    return clamp(0.42 + Math.max(0, -warmth) * 0.4 + lum * 0.25 - sat * 0.08);
  if (role === "metal")
    return clamp(0.75 - sat * 0.48 + (1 - Math.abs(lum - 0.38)) * 0.18);
  if (role === "wood")
    return clamp(0.35 + Math.max(0, warmth) * 0.5 + sat * 0.28);
  if (role === "stone")
    return clamp(0.72 - Math.abs(sat - 0.16) * 0.75 - Math.abs(lum - 0.58) * 0.28);
  return clamp(0.76 - Math.abs(lum - 0.72) * 0.48 - sat * 0.22);
}

function evidenceRank(evidence: ReferenceImageEvidence) {
  const regionFactor = Math.min(1, (evidence.regions?.length ?? 0) / 8);
  const edgeFactor = Math.min(
    1,
    (evidence.verticalEdgeStrength + evidence.horizontalEdgeStrength) * 3,
  );
  return round(evidence.confidence * 0.72 + regionFactor * 0.12 + edgeFactor * 0.16);
}

export function visualReferenceEvidence(project: Project) {
  const rows = [
    ...(project.scene.referenceImageEvidenceSet ?? []),
    ...(project.scene.referenceImageEvidence
      ? [project.scene.referenceImageEvidence]
      : []),
  ];
  const byAsset = new Map<string, ReferenceImageEvidence>();
  for (const row of rows) {
    if (!project.assets.includes(row.assetId)) continue;
    const current = byAsset.get(row.assetId);
    if (!current || evidenceRank(row) > evidenceRank(current)) byAsset.set(row.assetId, row);
  }
  return [...byAsset.values()].sort(
    (left, right) =>
      evidenceRank(right) - evidenceRank(left) ||
      right.confidence - left.confidence ||
      left.assetId.localeCompare(right.assetId),
  );
}

export function choosePrimaryVisualReference(
  evidence: readonly ReferenceImageEvidence[],
) {
  return [...evidence].sort(
    (left, right) =>
      evidenceRank(right) - evidenceRank(left) ||
      right.confidence - left.confidence ||
      left.assetId.localeCompare(right.assetId),
  )[0];
}

function strongLightingConflict(evidence: readonly ReferenceImageEvidence[]) {
  const moods = new Set(
    evidence
      .filter((row) => row.confidence >= 0.65 && row.lightingMood !== "unknown")
      .map((row) => row.lightingMood),
  );
  return moods.size > 1;
}

function appearanceFromEvidence(
  evidence: ReferenceImageEvidence,
  palette: readonly Rgb[],
  forceReview: boolean,
): VisualAppearanceSuggestion {
  const confidence = round(evidence.confidence);
  const status =
    !forceReview &&
    confidence >= AUTO_APPEARANCE_CONFIDENCE &&
    evidence.lightingMood !== "unknown"
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
      `Primary reference lighting mood: ${evidence.lightingMood}.`,
      `Visual evidence confidence: ${Math.round(confidence * 100)}%.`,
      ...(forceReview
        ? ["Strong reference images disagree on lighting, so automatic lighting selection is blocked until review."]
        : []),
      "Appearance settings affect presentation only; geometry and dimensions remain source-controlled.",
    ],
  };
}

function sourceMaterialNames(audits: readonly FbxSourceAudit[]) {
  return [...new Set(audits.flatMap((audit) => audit.materialNames).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function regionCandidate(
  role: VisualMaterialRole,
  evidence: ReferenceImageEvidence,
): VisualMaterialCandidate | undefined {
  const regions = (evidence.regions ?? []).filter(
    (region) => region.coverage >= 0.006 && region.confidence >= 0.4,
  );
  if (!regions.length) return undefined;
  const ranked = regions
    .map((region) => {
      const suitability = roleSuitability(role, region);
      const coverageFactor = Math.min(1, region.coverage / 0.12);
      const score =
        suitability * 0.55 +
        region.confidence * 0.25 +
        coverageFactor * 0.15 +
        Math.min(1, region.edgeStrength * 3) * 0.05;
      return { region, suitability, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.region.coverage - left.region.coverage ||
        left.region.id.localeCompare(right.region.id),
    );
  const best = ranked[0];
  if (!best || best.suitability < 0.38) return undefined;
  return {
    sourceAssetId: evidence.assetId,
    regionId: best.region.id,
    baseColor: best.region.color.toLowerCase(),
    coverage: best.region.coverage,
    centroidX: best.region.centroidX,
    centroidY: best.region.centroidY,
    confidence: round(
      evidence.confidence *
        (0.58 + best.suitability * 0.22 + best.region.confidence * 0.2),
    ),
    correspondence: "region",
    reason: `${role} role is source-name-backed; region ${best.region.id} covers ${Math.round(best.region.coverage * 100)}% of this reference and is the strongest appearance-only correspondence.`,
  };
}

function paletteCandidate(
  role: VisualMaterialRole,
  evidence: ReferenceImageEvidence,
): VisualMaterialCandidate | undefined {
  const palette = evidence.renderedPalette
    .map(color)
    .filter((entry): entry is Rgb => Boolean(entry));
  const target = choosePaletteColor(role, palette);
  if (!target) return undefined;
  const roleFactor = role === "paint" || role === "stone" ? 0.9 : 0.82;
  return {
    sourceAssetId: evidence.assetId,
    baseColor: target.hex,
    confidence: round(evidence.confidence * roleFactor),
    correspondence: "palette",
    reason: `${role} role is source-name-backed; ${target.hex} is selected from the whole-image palette because this evidence has no spatial region data.`,
  };
}

function candidatesForRole(
  role: VisualMaterialRole,
  evidence: readonly ReferenceImageEvidence[],
) {
  return evidence
    .filter((row) => row.confidence >= VISUAL_CONFIDENCE_FLOOR)
    .map((row) => regionCandidate(role, row) ?? paletteCandidate(role, row))
    .filter((row): row is VisualMaterialCandidate => Boolean(row))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.sourceAssetId.localeCompare(right.sourceAssetId) ||
        (left.regionId ?? "").localeCompare(right.regionId ?? ""),
    );
}

function materialConflict(candidates: readonly VisualMaterialCandidate[]) {
  if (candidates.length < 2) return false;
  const strongest = candidates[0];
  return candidates.slice(1).some(
    (candidate) =>
      candidate.confidence >= 0.5 &&
      referenceColorDistance(strongest.baseColor, candidate.baseColor) >=
        MATERIAL_CONFLICT_DISTANCE,
  );
}

/**
 * Builds a deterministic, non-destructive visual matching plan across every
 * analyzed raster reference. Reference images are appearance evidence only.
 * Spatial color regions can suggest correspondence to already-audited source
 * materials, but they never create/move geometry or infer metric truth.
 */
export function buildVisualFacadeMatchPlan(
  project: Project,
  audits: readonly FbxSourceAudit[],
): VisualFacadeMatchPlan {
  const evidence = visualReferenceEvidence(project);
  const primary = choosePrimaryVisualReference(evidence);
  const materialNames = sourceMaterialNames(audits);
  const invariants = [
    "visual-non-metric",
    "source-material-names-only",
    "geometry-immutable",
  ] as const;
  const emptyCounts = {
    references: evidence.length,
    regions: evidence.reduce((sum, row) => sum + (row.regions?.length ?? 0), 0),
    sourceMaterials: materialNames.length,
    classifiedMaterials: 0,
    suggestedMaterials: 0,
    regionMatches: 0,
    conflicts: 0,
    reviewRequired: 0,
  };

  if (!primary) {
    return {
      status: "unavailable",
      evidenceConfidence: 0,
      references: [],
      lightingConflict: false,
      materials: [],
      counts: emptyCounts,
      issues: ["No analyzed visual reference image is available for facade matching."],
      invariants,
    };
  }

  const lightingConflict = strongLightingConflict(evidence);
  const references = evidence.map((row, index) => ({
    sourceAssetId: row.assetId,
    selected: row.assetId === primary.assetId,
    confidence: round(row.confidence),
    rankScore: evidenceRank(row),
    lightingMood: row.lightingMood,
    regionCount: row.regions?.length ?? 0,
    reason:
      index === 0
        ? "Highest deterministic visual-evidence rank; selected as the primary appearance reference."
        : "Retained as corroborating appearance evidence; conflicts remain reviewable instead of being averaged away.",
  }));
  const primaryPalette = primary.renderedPalette
    .map(color)
    .filter((entry): entry is Rgb => Boolean(entry));
  const appearance = appearanceFromEvidence(
    primary,
    primaryPalette,
    lightingConflict,
  );
  const classified = materialNames
    .map((materialName) => ({ materialName, role: classifyMaterial(materialName) }))
    .filter(
      (entry): entry is { materialName: string; role: VisualMaterialRole } =>
        Boolean(entry.role),
    );
  const materials: VisualMaterialSuggestion[] = [];

  for (const entry of classified) {
    const candidates = candidatesForRole(entry.role, evidence);
    const selected = candidates[0];
    if (!selected) continue;
    const conflict = materialConflict(candidates);
    materials.push({
      materialName: entry.materialName,
      role: entry.role,
      baseColor: selected.baseColor,
      confidence: selected.confidence,
      sourceAssetId: selected.sourceAssetId,
      ...(selected.regionId ? { regionId: selected.regionId } : {}),
      correspondence: selected.correspondence,
      conflict,
      candidates,
      reviewRequired: true,
      reason: conflict
        ? `${entry.role} has materially different strong reference candidates. Choose the intended reference region explicitly before applying.`
        : selected.reason,
    });
  }

  const materialConflicts = materials.filter((row) => row.conflict).length;
  const issues: string[] = [];
  if (primary.confidence < VISUAL_CONFIDENCE_FLOOR)
    issues.push(
      "Primary visual reference confidence is too low for material suggestions; keep manual review.",
    );
  if (!primaryPalette.length)
    issues.push("Primary visual reference contains no valid rendered palette colors.");
  if (materialNames.length && !classified.length)
    issues.push(
      "Source materials are present, but none have a safely classifiable facade/material role.",
    );
  if (evidence.length > 1)
    issues.push(
      `${evidence.length} visual references were analyzed and deterministically arbitrated; disagreements are preserved for review.`,
    );
  if (lightingConflict)
    issues.push(
      "Strong visual references disagree on lighting mood; lighting remains review-required.",
    );
  if (materialConflicts)
    issues.push(
      `${materialConflicts} material suggestion${materialConflicts === 1 ? " has" : "s have"} conflicting strong reference regions and require an explicit source choice.`,
    );
  if (materials.length)
    issues.push(
      `${materials.length} source material suggestion${materials.length === 1 ? "" : "s"} require human review before application.`,
    );

  const regionMatches = materials.filter(
    (row) => row.correspondence === "region",
  ).length;
  return {
    status:
      appearance.status === "auto-ready" && !lightingConflict
        ? "auto-ready"
        : "needs-review",
    sourceAssetId: primary.assetId,
    primarySourceAssetId: primary.assetId,
    evidenceConfidence: round(primary.confidence),
    references,
    lightingConflict,
    appearance,
    materials,
    counts: {
      references: evidence.length,
      regions: evidence.reduce((sum, row) => sum + (row.regions?.length ?? 0), 0),
      sourceMaterials: materialNames.length,
      classifiedMaterials: classified.length,
      suggestedMaterials: materials.length,
      regionMatches,
      conflicts: materialConflicts + Number(lightingConflict),
      reviewRequired:
        materials.length +
        (appearance.status === "needs-review" ? 1 : 0) +
        materialConflicts,
    },
    issues,
    invariants,
  };
}
