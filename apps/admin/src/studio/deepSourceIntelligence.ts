import type { Asset } from "./domain";
import type { SmartCadAudit, SmartProjectAnalysis } from "./projectAnalyzer";
import { inspectDrsMetadata } from "./drsInspector";
import { inspectPdfPlans, type PdfPlanPageEvidence } from "./pdfPlanInspector";
import { looksLikeGeneratedPlanReference } from "./referenceImageInspector";

export type DeepSourceKind =
  | "model"
  | "cad"
  | "sketchup"
  | "drawing"
  | "visual"
  | "metadata"
  | "data"
  | "other";

export type DeepEvidenceDomain =
  | "metric-geometry"
  | "dimensions"
  | "floor-identity"
  | "room-semantics"
  | "openings"
  | "materials"
  | "visual-style"
  | "metadata";

export type PdfPageRole =
  | "floor-plan"
  | "site-plan"
  | "elevation"
  | "section"
  | "schedule"
  | "brochure"
  | "unknown";

export type VisualReferenceRole =
  | "facade"
  | "exterior"
  | "interior"
  | "site"
  | "plan-reference"
  | "unknown";

export interface FloorIdentityEvidence {
  sourceAssetId: string;
  sourceName: string;
  sourceKind: "cad" | "pdf";
  page?: number;
  floorIndices: number[];
  labels: string[];
  confidence: number;
  status: "resolved" | "multi-floor" | "ambiguous";
  basis: string;
}

export interface PdfPageIntelligence {
  sourceAssetId: string;
  sourceName: string;
  page: number;
  role: PdfPageRole;
  score: number;
  confidence: number;
  floorIndices: number[];
  floorLabels: string[];
  roomLabels: number;
  dimensions: number;
  spatialLabels: number;
  embeddedImages: number;
  basis: string[];
}

export interface CadSourceIntelligence {
  sourceAssetId: string;
  sourceName: string;
  kind: "dwg" | "dxf";
  geometryReady: boolean;
  semanticReady: boolean;
  floorIndices: number[];
  floorLabels: string[];
  wallSegments: number;
  openingSegments: number;
  textLabels: number;
  confidence: number;
}

export interface VisualSourceIntelligence {
  sourceAssetId: string;
  sourceName: string;
  role: VisualReferenceRole;
  confidence: number;
  metricAuthority: false;
}

export interface MetadataSourceIntelligence {
  sourceAssetId: string;
  sourceName: string;
  readable: boolean;
  resourceReferences: number;
  dependentProducts: number;
  roomCenterHints: number;
  materialResourceHints: number;
  modelResourceHints: number;
  confidence: number;
}

export interface EvidenceAuthorityCandidate {
  sourceAssetId: string;
  sourceName: string;
  sourceKind: DeepSourceKind;
  score: number;
  basis: string;
}

export interface EvidenceAuthorityDecision {
  domain: DeepEvidenceDomain;
  status: "selected" | "review" | "unavailable";
  selectedAssetId?: string;
  score: number;
  candidates: EvidenceAuthorityCandidate[];
  reason: string;
}

export interface DeepSourceConflict {
  id: string;
  severity: "review" | "warning";
  domain: DeepEvidenceDomain;
  sourceAssetIds: string[];
  message: string;
}

export interface DeepSourceIntelligenceReport {
  version: 1;
  createdAt: string;
  pdfPages: PdfPageIntelligence[];
  cadSources: CadSourceIntelligence[];
  visualSources: VisualSourceIntelligence[];
  metadataSources: MetadataSourceIntelligence[];
  floorAssignments: FloorIdentityEvidence[];
  authorityMatrix: EvidenceAuthorityDecision[];
  conflicts: DeepSourceConflict[];
  issues: string[];
  counts: {
    sources: number;
    classifiedPdfPages: number;
    resolvedFloorAssignments: number;
    ambiguousFloorAssignments: number;
    authoritySelected: number;
    authorityReview: number;
    conflicts: number;
  };
}

const FLOOR_WORDS: Record<string, number> = {
  ground: 0,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
};

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function sourceKind(asset: Asset): DeepSourceKind {
  const ext = extension(asset.name);
  if (ext === "fbx" || ext === "glb") return "model";
  if (ext === "dwg" || ext === "dxf") return "cad";
  if (ext === "skp" || ext === "skb") return "sketchup";
  if (ext === "pdf") return "drawing";
  if (["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"].includes(ext))
    return "visual";
  if (ext === "drs" || ext === "json") return "metadata";
  if (["csv", "tsv", "xls", "xlsx"].includes(ext)) return "data";
  return "other";
}

function normalizeFloorText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9 -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandRange(start: number, end: number) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
  if (start < -10 || end > 100 || start > end || end - start > 30) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/**
 * Returns only explicit floor identities. It intentionally does not infer a
 * floor from page order, model elevation or filename sequence.
 */
export function inferExplicitFloorIndices(value: string) {
  const text = normalizeFloorText(value);
  const indices: number[] = [];

  const basementMatches = [...text.matchAll(/\b(?:basement|b)\s*([1-9]\d?)\b/g)];
  for (const match of basementMatches) indices.push(-Number(match[1]));
  if (/\b(?:basement|basement floor|b floor)\b/.test(text) && !basementMatches.length)
    indices.push(-1);
  if (/\b(?:ground floor|ground|gf|g floor)\b/.test(text)) indices.push(0);

  const ordinalRange = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|through|-)\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:floor|floors|level|levels)\b/,
  );
  if (ordinalRange)
    indices.push(...expandRange(Number(ordinalRange[1]), Number(ordinalRange[2])));

  const wordRange = text.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s*(?:to|through|-)\s*(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s*(?:floor|floors|level|levels)\b/,
  );
  if (wordRange)
    indices.push(...expandRange(FLOOR_WORDS[wordRange[1]], FLOOR_WORDS[wordRange[2]]));

  for (const [word, index] of Object.entries(FLOOR_WORDS))
    if (new RegExp(`\\b${word}\\s+(?:floor|level)\\b`).test(text)) indices.push(index);

  for (const match of text.matchAll(
    /\b(?:floor|level|lvl)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s*(?:floor|level)\b|\bf\s*(\d{1,2})\b/g,
  )) {
    const value = Number(match[1] ?? match[2] ?? match[3]);
    if (Number.isInteger(value) && value >= 0 && value <= 100) indices.push(value);
  }

  return unique(indices).sort((left, right) => left - right);
}

function explicitFloorLabels(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const matches = [
    ...text.matchAll(
      /\b(?:basement(?:\s*\d+)?|ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th)?)(?:\s*(?:to|through|[-–—])\s*(?:\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth))?\s+(?:floor|floors|level|levels)\b/gi,
    ),
  ];
  return unique(matches.map((match) => match[0].trim())).slice(0, 24);
}

function pdfEvidenceText(page: PdfPlanPageEvidence) {
  return [page.textSample, ...page.spatialLabels.map((entry) => entry.text)].join(" ");
}

function classifyPdfPage(page: PdfPlanPageEvidence): Omit<PdfPageIntelligence, "sourceAssetId" | "sourceName"> {
  const text = pdfEvidenceText(page);
  const normalized = normalizeFloorText(text);
  const floorIndices = inferExplicitFloorIndices(text);
  const floorLabels = explicitFloorLabels(text);
  const usefulSpatial = page.spatialLabels.filter((entry) => entry.kind !== "other").length;
  const basis: string[] = [];

  const site = /\b(?:site plan|master plan|plot layout|site layout|key plan)\b/.test(normalized);
  const elevation = /\b(?:front|rear|side|north|south|east|west)?\s*elevation\b/.test(normalized);
  const section = /\bsection\s*[a-z0-9-]*\b/.test(normalized);
  const schedule = /\b(?:schedule|area statement|door schedule|window schedule|legend|specification)\b/.test(normalized);
  const floorPlan =
    page.hasFloorPlanLabel ||
    page.roomLabels.length >= 2 ||
    (page.dimensionStrings.length >= 2 && usefulSpatial >= 2) ||
    (page.score >= 5 && floorIndices.length > 0);
  const brochure =
    !floorPlan &&
    !site &&
    !elevation &&
    !section &&
    (page.embeddedImages.length > 0 || /\b(?:amenities|location|overview|highlights|lifestyle)\b/.test(normalized));

  let role: PdfPageRole = "unknown";
  if (site) role = "site-plan";
  else if (elevation) role = "elevation";
  else if (section) role = "section";
  else if (floorPlan) role = "floor-plan";
  else if (schedule) role = "schedule";
  else if (brochure) role = "brochure";

  if (page.hasFloorPlanLabel) basis.push("explicit floor-plan label");
  if (page.roomLabels.length) basis.push(`${page.roomLabels.length} room label(s)`);
  if (page.dimensionStrings.length) basis.push(`${page.dimensionStrings.length} dimension string(s)`);
  if (floorIndices.length) basis.push(`explicit floor identity: ${floorIndices.join(", ")}`);
  if (page.embeddedImages.length) basis.push(`${page.embeddedImages.length} embedded image candidate(s)`);
  if (!basis.length) basis.push("weak page evidence");

  const roleBoost = role === "floor-plan" || role === "site-plan" ? 0.18 : role === "unknown" ? 0 : 0.1;
  const confidence = Number(
    Math.min(0.98, 0.35 + Math.min(0.42, page.score / 30) + roleBoost).toFixed(3),
  );

  return {
    page: page.page,
    role,
    score: page.score,
    confidence,
    floorIndices,
    floorLabels,
    roomLabels: page.roomLabels.length,
    dimensions: page.dimensionStrings.length,
    spatialLabels: usefulSpatial,
    embeddedImages: page.embeddedImages.length,
    basis,
  };
}

function cadText(audit: SmartCadAudit) {
  return [
    audit.name,
    ...audit.layerHints.map((entry) => entry.layer),
    ...(audit.textLabels ?? []).map((entry) => entry.text),
    ...(audit.normalizedDwg?.floors ?? []).map((entry) => entry.label),
  ].join(" ");
}

function inspectCad(audit: SmartCadAudit): CadSourceIntelligence | undefined {
  if (audit.kind !== "dwg" && audit.kind !== "dxf") return undefined;
  const text = cadText(audit);
  const floorIndices = inferExplicitFloorIndices(text);
  const floorLabels = explicitFloorLabels(text);
  const segments = audit.semanticSegments ?? [];
  const wallSegments = segments.filter((entry) => entry.kind === "wall").length;
  const openingSegments = segments.filter(
    (entry) => entry.kind === "door" || entry.kind === "window",
  ).length;
  const confidence = Number(
    Math.min(
      0.99,
      (audit.geometryReady ? 0.68 : 0.28) +
        (audit.semanticReady ? 0.12 : 0) +
        (floorIndices.length ? 0.1 : 0) +
        ((audit.textLabels?.length ?? 0) >= 3 ? 0.07 : 0),
    ).toFixed(3),
  );
  return {
    sourceAssetId: audit.assetId,
    sourceName: audit.name,
    kind: audit.kind,
    geometryReady: Boolean(audit.geometryReady),
    semanticReady: audit.semanticReady,
    floorIndices,
    floorLabels,
    wallSegments,
    openingSegments,
    textLabels: audit.textLabels?.length ?? 0,
    confidence,
  };
}

function classifyVisual(asset: Asset): VisualSourceIntelligence {
  const name = asset.name.toLowerCase();
  let role: VisualReferenceRole = "unknown";
  let confidence = 0.48;
  if (looksLikeGeneratedPlanReference(asset.name) || /(?:plan|drawing|layout|blueprint)/.test(name)) {
    role = "plan-reference";
    confidence = 0.82;
  } else if (/(?:facade|façade|front view|front elevation)/.test(name)) {
    role = "facade";
    confidence = 0.9;
  } else if (/(?:exterior|outside|building render|perspective)/.test(name)) {
    role = "exterior";
    confidence = 0.84;
  } else if (/(?:interior|living|bedroom|kitchen|lobby|room render)/.test(name)) {
    role = "interior";
    confidence = 0.82;
  } else if (/(?:site|landscape|garden|parking|entrance|gate)/.test(name)) {
    role = "site";
    confidence = 0.78;
  }
  return {
    sourceAssetId: asset.id,
    sourceName: asset.name,
    role,
    confidence,
    metricAuthority: false,
  };
}

function addCandidate(
  rows: Map<DeepEvidenceDomain, EvidenceAuthorityCandidate[]>,
  domain: DeepEvidenceDomain,
  candidate: EvidenceAuthorityCandidate,
) {
  const values = rows.get(domain) ?? [];
  const existing = values.find((entry) => entry.sourceAssetId === candidate.sourceAssetId);
  if (!existing || candidate.score > existing.score) {
    rows.set(
      domain,
      existing
        ? values.map((entry) =>
            entry.sourceAssetId === candidate.sourceAssetId ? candidate : entry,
          )
        : [...values, candidate],
    );
  }
}

function authorityMatrix(
  files: readonly Asset[],
  analysis: SmartProjectAnalysis,
  pdfPages: readonly PdfPageIntelligence[],
  cadSources: readonly CadSourceIntelligence[],
  visualSources: readonly VisualSourceIntelligence[],
  metadataSources: readonly MetadataSourceIntelligence[],
): EvidenceAuthorityDecision[] {
  const rows = new Map<DeepEvidenceDomain, EvidenceAuthorityCandidate[]>();
  const byId = new Map(files.map((asset) => [asset.id, asset]));
  const candidate = (
    asset: Asset,
    domain: DeepEvidenceDomain,
    score: number,
    basis: string,
  ) =>
    addCandidate(rows, domain, {
      sourceAssetId: asset.id,
      sourceName: asset.name,
      sourceKind: sourceKind(asset),
      score,
      basis,
    });

  for (const cad of cadSources) {
    const asset = byId.get(cad.sourceAssetId);
    if (!asset) continue;
    candidate(asset, "metric-geometry", cad.geometryReady ? 100 : 42, cad.geometryReady ? "normalized CAD geometry" : "raw CAD evidence only");
    candidate(asset, "dimensions", cad.geometryReady ? 100 : 55, cad.geometryReady ? "decoded CAD units/entities" : "CAD not normalized");
    if (cad.floorIndices.length)
      candidate(asset, "floor-identity", cad.geometryReady ? 98 : 72, "explicit CAD floor text/layers");
    if (cad.textLabels)
      candidate(asset, "room-semantics", cad.geometryReady ? 96 : 65, "CAD text labels");
    if (cad.openingSegments)
      candidate(asset, "openings", 100, "normalized CAD door/window segments");
    candidate(asset, "metadata", cad.semanticReady ? 70 : 48, "CAD layers/text metadata");
  }

  const selectedModel = analysis.modelAssetId ? byId.get(analysis.modelAssetId) : undefined;
  for (const asset of files.filter((entry) => sourceKind(entry) === "model")) {
    const selected = asset.id === selectedModel?.id;
    candidate(asset, "metric-geometry", selected ? 90 : 72, selected ? "selected authoring model" : "secondary model candidate");
    candidate(asset, "openings", selected ? 82 : 66, "model architectural candidates");
    candidate(asset, "materials", selected ? 90 : 76, "model materials");
    if (selected && analysis.floorCandidates.length)
      candidate(asset, "floor-identity", 78, "model storey/elevation clustering");
  }

  for (const asset of files.filter((entry) => sourceKind(entry) === "sketchup")) {
    candidate(asset, "materials", 100, "SketchUp material definitions and recovered textures");
    candidate(asset, "metadata", 78, "SketchUp tags/components/metadata evidence");
    candidate(asset, "visual-style", 80, "SketchUp material/style evidence");
  }

  for (const page of pdfPages) {
    const asset = byId.get(page.sourceAssetId);
    if (!asset) continue;
    if (page.role === "floor-plan") {
      candidate(asset, "dimensions", Math.min(82, 64 + page.confidence * 18), `PDF floor-plan page ${page.page}`);
      candidate(asset, "room-semantics", Math.min(86, 68 + page.confidence * 18), `PDF room/spatial labels on page ${page.page}`);
      if (page.floorIndices.length)
        candidate(asset, "floor-identity", Math.min(90, 70 + page.confidence * 20), `explicit PDF floor identity on page ${page.page}`);
      candidate(asset, "openings", 58, "PDF corroboration only; not geometry truth");
    }
  }

  for (const asset of files.filter((entry) => sourceKind(entry) === "data")) {
    candidate(asset, "dimensions", 96, "structured room/data sheet");
    candidate(asset, "room-semantics", 96, "structured room/data sheet");
  }

  for (const visual of visualSources) {
    const asset = byId.get(visual.sourceAssetId);
    if (!asset || visual.role === "plan-reference") continue;
    candidate(asset, "visual-style", visual.role === "facade" || visual.role === "exterior" ? 100 : 94, `${visual.role} visual reference; non-metric`);
  }

  for (const metadata of metadataSources) {
    const asset = byId.get(metadata.sourceAssetId);
    if (!asset) continue;
    candidate(asset, "metadata", metadata.readable ? 100 : 35, metadata.readable ? "structured metadata" : "unreadable metadata");
    if (metadata.materialResourceHints)
      candidate(asset, "materials", 74, "metadata material dependency hints only");
    if (metadata.roomCenterHints)
      candidate(asset, "room-semantics", 44, "metadata room-center hints; non-authoritative");
  }

  const domains: DeepEvidenceDomain[] = [
    "metric-geometry",
    "dimensions",
    "floor-identity",
    "room-semantics",
    "openings",
    "materials",
    "visual-style",
    "metadata",
  ];
  return domains.map((domain) => {
    const candidates = [...(rows.get(domain) ?? [])].sort(
      (left, right) => right.score - left.score || left.sourceAssetId.localeCompare(right.sourceAssetId),
    );
    if (!candidates.length)
      return {
        domain,
        status: "unavailable" as const,
        score: 0,
        candidates: [],
        reason: `No usable ${domain.replaceAll("-", " ")} evidence is attached.`,
      };
    const top = candidates[0];
    const tied = candidates.filter((entry) => entry.score === top.score);
    if (tied.length > 1)
      return {
        domain,
        status: "review" as const,
        score: top.score,
        candidates,
        reason: `Multiple equally authoritative ${domain.replaceAll("-", " ")} sources are attached; Rekixo will not silently choose one.`,
      };
    return {
      domain,
      status: "selected" as const,
      selectedAssetId: top.sourceAssetId,
      score: top.score,
      candidates,
      reason: `${top.sourceName} is the strongest available ${domain.replaceAll("-", " ")} evidence under the source-authority policy.`,
    };
  });
}

function floorAssignments(
  cadSources: readonly CadSourceIntelligence[],
  pdfPages: readonly PdfPageIntelligence[],
): FloorIdentityEvidence[] {
  const rows: FloorIdentityEvidence[] = [];
  for (const cad of cadSources) {
    const count = cad.floorIndices.length;
    rows.push({
      sourceAssetId: cad.sourceAssetId,
      sourceName: cad.sourceName,
      sourceKind: "cad",
      floorIndices: cad.floorIndices,
      labels: cad.floorLabels,
      confidence: cad.floorIndices.length ? Math.max(0.72, cad.confidence) : 0.35,
      status: count === 1 ? "resolved" : count > 1 ? "multi-floor" : "ambiguous",
      basis: cad.floorIndices.length
        ? "Explicit floor identity found in CAD filename/layers/text."
        : "No explicit CAD floor identity; page/file order was not used as a guess.",
    });
  }
  for (const page of pdfPages.filter((entry) => entry.role === "floor-plan")) {
    const count = page.floorIndices.length;
    rows.push({
      sourceAssetId: page.sourceAssetId,
      sourceName: page.sourceName,
      sourceKind: "pdf",
      page: page.page,
      floorIndices: page.floorIndices,
      labels: page.floorLabels,
      confidence: count ? page.confidence : Math.min(0.55, page.confidence),
      status: count === 1 ? "resolved" : count > 1 ? "multi-floor" : "ambiguous",
      basis: count
        ? "Explicit floor identity found in PDF text/spatial labels."
        : "Floor-plan evidence exists, but no explicit floor identity was found.",
    });
  }
  return rows;
}

function buildConflicts(
  cadSources: readonly CadSourceIntelligence[],
  pdfPages: readonly PdfPageIntelligence[],
  matrix: readonly EvidenceAuthorityDecision[],
): DeepSourceConflict[] {
  const conflicts: DeepSourceConflict[] = [];

  const cadByFloor = new Map<number, CadSourceIntelligence[]>();
  for (const cad of cadSources.filter((entry) => entry.geometryReady))
    for (const floor of cad.floorIndices) {
      const values = cadByFloor.get(floor) ?? [];
      values.push(cad);
      cadByFloor.set(floor, values);
    }
  for (const [floor, values] of cadByFloor) {
    const uniqueSources = [...new Map(values.map((entry) => [entry.sourceAssetId, entry])).values()];
    if (uniqueSources.length < 2) continue;
    conflicts.push({
      id: `cad-floor-authority:${floor}`,
      severity: "review",
      domain: "metric-geometry",
      sourceAssetIds: uniqueSources.map((entry) => entry.sourceAssetId),
      message: `${uniqueSources.length} normalized CAD sources explicitly claim floor ${floor}. Rekixo kept the conflict reviewable instead of silently choosing geometry.`,
    });
  }

  const pdfByFloor = new Map<number, PdfPageIntelligence[]>();
  for (const page of pdfPages.filter((entry) => entry.role === "floor-plan"))
    for (const floor of page.floorIndices) {
      const values = pdfByFloor.get(floor) ?? [];
      values.push(page);
      pdfByFloor.set(floor, values);
    }
  for (const [floor, values] of pdfByFloor) {
    if (values.length < 2) continue;
    const sorted = [...values].sort((left, right) => right.score - left.score);
    if (sorted[0].score - sorted[1].score >= 4) continue;
    conflicts.push({
      id: `pdf-floor-role:${floor}`,
      severity: "warning",
      domain: "floor-identity",
      sourceAssetIds: unique(values.map((entry) => entry.sourceAssetId)),
      message: `Multiple similarly strong PDF plan pages explicitly claim floor ${floor}; keep page selection reviewable until CAD/model evidence corroborates one.`,
    });
  }

  for (const decision of matrix.filter((entry) => entry.status === "review"))
    conflicts.push({
      id: `authority:${decision.domain}`,
      severity: "review",
      domain: decision.domain,
      sourceAssetIds: decision.candidates
        .filter((entry) => entry.score === decision.score)
        .map((entry) => entry.sourceAssetId),
      message: decision.reason,
    });

  return [...new Map(conflicts.map((entry) => [entry.id, entry])).values()];
}

export async function buildDeepSourceIntelligence(
  files: readonly Asset[],
  analysis: SmartProjectAnalysis,
): Promise<DeepSourceIntelligenceReport> {
  const pdfPages: PdfPageIntelligence[] = [];
  const issues: string[] = [];

  for (const asset of files.filter((entry) => /\.pdf$/i.test(entry.name))) {
    try {
      const inspection = await inspectPdfPlans(asset);
      for (const page of inspection.pages) {
        const classified = classifyPdfPage(page);
        pdfPages.push({
          sourceAssetId: asset.id,
          sourceName: asset.name,
          ...classified,
        });
      }
      issues.push(
        ...inspection.issues.map((issue) => `PDF ${asset.name}: ${issue}`),
      );
    } catch (error) {
      issues.push(
        `PDF ${asset.name}: ${error instanceof Error ? error.message : "deep inspection could not complete"}`,
      );
    }
  }

  const cadSources = (analysis.cadAudits ?? [])
    .map(inspectCad)
    .filter((entry): entry is CadSourceIntelligence => Boolean(entry));

  const visualSources = files
    .filter((asset) => sourceKind(asset) === "visual")
    .map(classifyVisual);

  const metadataSources: MetadataSourceIntelligence[] = [];
  for (const asset of files.filter((entry) => /\.(?:drs|json)$/i.test(entry.name))) {
    if (!/\.drs$/i.test(asset.name)) {
      metadataSources.push({
        sourceAssetId: asset.id,
        sourceName: asset.name,
        readable: true,
        resourceReferences: 0,
        dependentProducts: 0,
        roomCenterHints: 0,
        materialResourceHints: 0,
        modelResourceHints: 0,
        confidence: 0.72,
      });
      continue;
    }
    try {
      const inspection = await inspectDrsMetadata(asset);
      const materialResourceHints = inspection.resources.filter((entry) =>
        ["basecolor", "normal", "height", "roughness", "metalness", "ambientOcclusion", "emissive", "opacity", "texture"].includes(entry.role),
      ).length;
      const modelResourceHints = inspection.resources.filter((entry) => entry.role === "model").length;
      metadataSources.push({
        sourceAssetId: asset.id,
        sourceName: asset.name,
        readable: inspection.json,
        resourceReferences: inspection.uniqueResourceCount,
        dependentProducts: inspection.dependentProducts.length,
        roomCenterHints: inspection.roomCenters.length,
        materialResourceHints,
        modelResourceHints,
        confidence: inspection.json ? 0.96 : 0.35,
      });
      issues.push(...inspection.issues.map((issue) => `Metadata ${asset.name}: ${issue}`));
    } catch (error) {
      metadataSources.push({
        sourceAssetId: asset.id,
        sourceName: asset.name,
        readable: false,
        resourceReferences: 0,
        dependentProducts: 0,
        roomCenterHints: 0,
        materialResourceHints: 0,
        modelResourceHints: 0,
        confidence: 0.2,
      });
      issues.push(
        `Metadata ${asset.name}: ${error instanceof Error ? error.message : "inspection could not complete"}`,
      );
    }
  }

  const assignments = floorAssignments(cadSources, pdfPages);
  const matrix = authorityMatrix(
    files,
    analysis,
    pdfPages,
    cadSources,
    visualSources,
    metadataSources,
  );
  const conflicts = buildConflicts(cadSources, pdfPages, matrix);
  if (conflicts.some((entry) => entry.severity === "review"))
    issues.push(
      `Deep source intelligence found ${conflicts.filter((entry) => entry.severity === "review").length} unresolved source-authority conflict(s); no source value was guessed.`,
    );

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    pdfPages,
    cadSources,
    visualSources,
    metadataSources,
    floorAssignments: assignments,
    authorityMatrix: matrix,
    conflicts,
    issues: unique(issues),
    counts: {
      sources: files.length,
      classifiedPdfPages: pdfPages.filter((entry) => entry.role !== "unknown").length,
      resolvedFloorAssignments: assignments.filter((entry) => entry.status !== "ambiguous").length,
      ambiguousFloorAssignments: assignments.filter((entry) => entry.status === "ambiguous").length,
      authoritySelected: matrix.filter((entry) => entry.status === "selected").length,
      authorityReview: matrix.filter((entry) => entry.status === "review").length,
      conflicts: conflicts.length,
    },
  };
}
