import type { Asset } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import type { SmartProjectAnalysis } from "./projectAnalyzer";
import type { RoomSheetRow } from "./roomSheet";
import {
  extractSketchUpMaterialDefinitions,
  inspectSketchUpArchive,
  inspectSketchUpSemanticEvidence,
} from "./sketchUpArchive";
import { inspectDrsMetadata } from "./drsInspector";
import { inspectDwgEvidence } from "./dwgEvidence";
import { isDwgNormalizedAsset } from "./dwgNormalized";
import {
  detectSourceFusionConflicts,
  type SourceFusionConflict,
} from "./sourceConflicts";
import {
  chooseSourceAuthorities,
  estimatePdfCadRegistration,
  sketchUpFbxMaterialOverlap,
  type PdfCadRegistration,
  type SourceAuthorityDecision,
} from "./crossSourceFusion";

export type SourceFusionKind =
  | "authoring-model"
  | "web-model"
  | "cad"
  | "sketchup"
  | "drawing"
  | "visual-reference"
  | "metadata"
  | "room-sheet"
  | "texture"
  | "other";

export type SourceFusionSupport =
  | "ready"
  | "partial"
  | "evidence-only"
  | "needs-conversion";

export type SourceFusionCapability =
  | "geometry"
  | "floors"
  | "walls"
  | "openings"
  | "dimensions"
  | "rooms"
  | "materials"
  | "visual-style"
  | "metadata";

export interface SourceFusionItem {
  assetId: string;
  name: string;
  extension: string;
  kind: SourceFusionKind;
  support: SourceFusionSupport;
  capabilities: SourceFusionCapability[];
  findings: string[];
  warnings: string[];
}

export interface SourceFusionFact {
  id: string;
  sourceAssetId: string;
  key: string;
  value: string | number | boolean | string[] | number[];
  confidence: number;
  basis: string;
  status: "observed" | "suggested";
}

export interface SourceFusionRegistration {
  kind: "pdf-cad";
  sourceAssetId: string;
  targetAssetId: string;
  compatible: boolean;
  confidence: number;
  matches: number;
  reason: string;
}

export interface SourceFusionReport {
  createdAt: string;
  items: SourceFusionItem[];
  facts: SourceFusionFact[];
  authorityDecisions: SourceAuthorityDecision[];
  registrations: SourceFusionRegistration[];
  readySources: number;
  partialSources: number;
  evidenceOnlySources: number;
  needsConversionSources: number;
  reviewCount: number;
  conflicts: SourceFusionConflict[];
  recommendedActions: string[];
}

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function itemFor(asset: Asset): SourceFusionItem {
  const ext = extension(asset.name);
  if (ext === "glb")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "web-model",
      support: "ready",
      capabilities: ["geometry", "floors", "walls", "openings", "materials"],
      findings: ["Self-contained web model candidate."],
      warnings: [],
    };
  if (ext === "fbx")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "authoring-model",
      support: "partial",
      capabilities: ["geometry", "floors", "walls", "openings", "materials"],
      findings: ["Authoring geometry can be analyzed in Studio."],
      warnings: ["A web GLB derivative is required before customer publication."],
    };
  if (ext === "dxf")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "cad",
      support: "partial",
      capabilities: ["dimensions", "walls", "openings"],
      findings: ["ASCII DXF layer semantics can be inspected safely."],
      warnings: [],
    };
  if (ext === "dwg")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "cad",
      support: "needs-conversion",
      capabilities: ["dimensions", "walls", "openings"],
      findings: ["Binary DWG is retained as checksum-addressed source evidence."],
      warnings: ["DWG architectural entities require the controlled CAD processor before they can become editable geometry."],
    };
  if (ext === "skp" || ext === "skb")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "sketchup",
      support: "needs-conversion",
      capabilities: ["geometry", "materials", "metadata"],
      findings: ["SketchUp source is retained as project evidence."],
      warnings: ["SketchUp components/materials require the controlled SketchUp processor before fusion."],
    };
  if (ext === "pdf")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "drawing",
      support: "evidence-only",
      capabilities: ["dimensions", "rooms", "visual-style"],
      findings: [
        "PDF pages can provide spatial room/dimension evidence and rasterized plan references.",
      ],
      warnings: [],
    };
  if (["jpg", "jpeg", "png", "webp", "tif", "tiff"].includes(ext))
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: /texture|diffuse|albedo|normal|rough|metal|marble|tile|glass|wood|granite/i.test(asset.name)
        ? "texture"
        : "visual-reference",
      support: "evidence-only",
      capabilities: /texture|diffuse|albedo|normal|rough|metal|marble|tile|glass|wood|granite/i.test(asset.name)
        ? ["materials"]
        : ["visual-style"],
      findings: ["Raster source is available for visual comparison/alignment."],
      warnings: [],
    };
  if (ext === "csv" || ext === "tsv")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "room-sheet",
      support: "ready",
      capabilities: ["rooms", "dimensions"],
      findings: ["Structured room measurements can feed exact-size room placement."],
      warnings: [],
    };
  if (ext === "drs" || ext === "json")
    return {
      assetId: asset.id,
      name: asset.name,
      extension: ext,
      kind: "metadata",
      support: "partial",
      capabilities: ["metadata", "materials"],
      findings: ["Metadata/resource references can be inspected without treating them as geometry truth."],
      warnings: [],
    };
  return {
    assetId: asset.id,
    name: asset.name,
    extension: ext,
    kind: "other",
    support: "evidence-only",
    capabilities: [],
    findings: ["Source is retained with checksum provenance."],
    warnings: ["No automatic processor is registered for this format yet."],
  };
}

function fact(
  assetId: string,
  key: string,
  value: SourceFusionFact["value"],
  confidence: number,
  basis: string,
  status: SourceFusionFact["status"] = "observed",
): SourceFusionFact {
  return {
    id: `${assetId}:${key}`,
    sourceAssetId: assetId,
    key,
    value,
    confidence,
    basis,
    status,
  };
}

async function inspectGenericJsonMetadata(asset: Asset) {
  if (asset.size > 8 * 1024 * 1024)
    return { resourceRefs: [] as string[], json: false };
  const text = await asset.blob.text();
  let json = false;
  try {
    JSON.parse(text);
    json = true;
  } catch {}
  const refs = unique(
    [
      ...text.matchAll(
        /(?:[A-Za-z]:)?[^\s"'<>]+\.(?:png|jpe?g|webp|tiff?|exr|hdr|dds|ktx2|fbx|obj|glb|gltf|skp|skb)/gi,
      ),
    ]
      .map((match) => match[0].replaceAll("\\", "/"))
      .slice(0, 500),
  );
  return { resourceRefs: refs, json };
}

export async function buildSourceFusionReport(
  files: Asset[],
  analysis?: SmartProjectAnalysis,
  audits: FbxSourceAudit[] = [],
  roomSheetRows: RoomSheetRow[] = [],
): Promise<SourceFusionReport> {
  const items = files.filter((asset) => !isDwgNormalizedAsset(asset)).map(itemFor);
  const facts: SourceFusionFact[] = [];
  const registrations: SourceFusionRegistration[] = [];

  if (analysis?.modelAssetId) {
    facts.push(
      fact(
        analysis.modelAssetId,
        "model.mesh-count",
        analysis.meshCount,
        1,
        "Parsed source geometry",
      ),
      fact(
        analysis.modelAssetId,
        "model.material-count",
        analysis.materialCount,
        1,
        "Parsed source materials",
      ),
      fact(
        analysis.modelAssetId,
        "model.floor-candidates",
        analysis.floorCandidates.map((entry) => Number(entry.elevation.toFixed(4))),
        analysis.floorCandidates.length ? 0.78 : 0.2,
        "Geometry clustering and storey-spacing inference",
        "suggested",
      ),
      fact(
        analysis.modelAssetId,
        "model.architectural-candidates",
        analysis.architecturalCandidates.length,
        analysis.architecturalCandidates.length ? 0.72 : 0.3,
        "Source names/materials plus geometric proportions",
        "suggested",
      ),
    );
    if (analysis.bounds)
      facts.push(
        fact(
          analysis.modelAssetId,
          "model.bounds",
          [...analysis.bounds.min, ...analysis.bounds.max].map((value) =>
            Number(value.toFixed(4)),
          ),
          1,
          "Parsed model world bounds",
        ),
      );
  }

  for (const audit of audits) {
    const item = items.find((entry) => entry.assetId === audit.assetId);
    if (!item) continue;
    if (audit.meshCount !== undefined)
      item.findings.push(`${audit.meshCount} FBX mesh declaration(s) detected.`);
    if (audit.materialNames.length)
      item.findings.push(`${audit.materialNames.length} material name(s) detected.`);
    if (audit.externalTextureFiles.length) {
      item.findings.push(
        `${audit.matchedTextureFiles.length}/${audit.externalTextureFiles.length} referenced texture file(s) attached.`,
      );
      if (audit.matchedTextureFiles.length < audit.externalTextureFiles.length)
        item.warnings.push(
          `${audit.externalTextureFiles.length - audit.matchedTextureFiles.length} external texture reference(s) are missing.`,
        );
    }
  }

  for (const cad of analysis?.cadAudits ?? []) {
    const item = items.find((entry) => entry.assetId === cad.assetId);
    if (!item) continue;

    if (cad.kind === "dwg" && cad.normalizedDwg) {
      const document = cad.normalizedDwg;
      item.support = "ready";
      item.capabilities = unique([
        ...item.capabilities,
        "geometry",
        "floors",
        "rooms",
      ]);
      item.warnings = item.warnings.filter(
        (warning) => !/controlled CAD processor/i.test(warning),
      );
      item.findings.push(
        `Controlled DWG processor decoded ${document.segments.length} wall/door/window segment${document.segments.length === 1 ? "" : "s"}, ${document.dimensions.length} dimension${document.dimensions.length === 1 ? "" : "s"}, ${document.inserts.length} block insert${document.inserts.length === 1 ? "" : "s"} and ${document.objects.length} architectural object${document.objects.length === 1 ? "" : "s"}.`,
      );
      if (document.units.name)
        item.findings.push(
          `DWG units normalized to metres from ${document.units.name}.`,
        );
      if (document.floors.length)
        item.findings.push(
          `${document.floors.length} floor label${document.floors.length === 1 ? "" : "s"} decoded from drawing text.`,
        );
      item.warnings.push(...document.issues);

      facts.push(
        fact(
          cad.assetId,
          "dwg.normalized-segments",
          document.segments.length,
          document.segments.length ? 0.96 : 0.4,
          `${document.processor.engine} ${document.processor.engineVersion} → Rekixo normalized DWG v${document.version}`,
          "suggested",
        ),
        fact(
          cad.assetId,
          "dwg.dimension-count",
          document.dimensions.length,
          0.96,
          "Decoded DIMENSION entities",
          "observed",
        ),
        fact(
          cad.assetId,
          "dwg.architectural-object-count",
          document.objects.length + document.inserts.length,
          0.93,
          "Decoded semantic entities and block inserts",
          "suggested",
        ),
      );
      if (document.floors.length)
        facts.push(
          fact(
            cad.assetId,
            "dwg.floor-labels",
            document.floors.map((entry) => entry.label),
            0.9,
            "Decoded DWG text entities",
            "suggested",
          ),
        );
    }

    if (cad.semanticReady && cad.layerHints.length) {
      item.findings.push(
        `${cad.layerHints.length} architectural CAD layer hint(s) detected.`,
      );
      facts.push(
        fact(
          cad.assetId,
          "cad.layer-hints",
          cad.layerHints.map((entry) => `${entry.layer}:${entry.kind}`),
          0.7,
          cad.kind === "dwg"
            ? "Controlled normalized DWG layer semantics"
            : "ASCII DXF layer names",
          "suggested",
        ),
      );
    }
    if (cad.geometryReady && cad.semanticSegments?.length) {
      const wallCount = cad.semanticSegments.filter(
        (segment) => segment.kind === "wall",
      ).length;
      const openingCount = cad.semanticSegments.filter(
        (segment) => segment.kind === "door" || segment.kind === "window",
      ).length;
      item.findings.push(
        `${cad.semanticSegments.length} normalized CAD segment${cad.semanticSegments.length === 1 ? "" : "s"} ready${cad.unitName ? ` in ${cad.unitName}` : ""}.`,
      );
      facts.push(
        fact(
          cad.assetId,
          "cad.geometry-ready",
          true,
          0.95,
          "ASCII DXF entities plus declared drawing units",
        ),
        fact(
          cad.assetId,
          "cad.wall-segment-count",
          wallCount,
          0.95,
          "Normalized LINE/LWPOLYLINE wall entities",
        ),
        fact(
          cad.assetId,
          "cad.opening-segment-count",
          openingCount,
          0.9,
          "Normalized LINE/LWPOLYLINE door/window entities",
          "suggested",
        ),
      );
      if (cad.unitName)
        facts.push(
          fact(
            cad.assetId,
            "cad.unit",
            cad.unitName,
            1,
            "DXF $INSUNITS header",
          ),
        );
      if (cad.textLabels?.length)
        facts.push(
          fact(
            cad.assetId,
            "cad.text-labels",
            cad.textLabels.slice(0, 120).map(
              (label) =>
                `${label.text}@${label.point[0].toFixed(3)},${label.point[1].toFixed(3)}`,
            ),
            0.9,
            "DXF TEXT/MTEXT entities",
          ),
        );
    }
  }

  const roomSourceIds = unique(
    roomSheetRows
      .map((row) => row.assetId)
      .filter((assetId): assetId is string => Boolean(assetId)),
  );
  for (const assetId of roomSourceIds) {
    const rows = roomSheetRows.filter((row) => row.assetId === assetId);
    facts.push(
      fact(
        assetId,
        "room-sheet.rows",
        rows.length,
        1,
        "Structured CSV/TSV room measurements",
      ),
    );
    const item = items.find((entry) => entry.assetId === assetId);
    if (item) item.findings.push(`${rows.length} valid room measurement row(s) parsed.`);
  }

  for (const asset of files.filter((entry) => /\.(?:drs|json)$/i.test(entry.name))) {
    const item = items.find((entry) => entry.assetId === asset.id);
    if (!item) continue;

    if (/\.drs$/i.test(asset.name)) {
      const inspection = await inspectDrsMetadata(asset);
      if (inspection.json) item.findings.push("Readable D5/DRS JSON metadata detected.");
      if (inspection.source)
        item.findings.push(`Render source: ${inspection.source}.`);
      if (inspection.resources.length)
        item.findings.push(
          `${inspection.resources.length} unique render dependency reference${inspection.resources.length === 1 ? "" : "s"} classified.`,
        );
      if (inspection.dependentProducts.length)
        item.findings.push(
          `${inspection.dependentProducts.length} dependent product ID${inspection.dependentProducts.length === 1 ? "" : "s"} found.`,
        );
      if (inspection.roomCenters.length)
        item.findings.push(
          `${inspection.roomCenters.length} D5 room-center hint${inspection.roomCenters.length === 1 ? "" : "s"} found.`,
        );

      if (inspection.resources.length) {
        facts.push(
          fact(
            asset.id,
            "metadata.resource-refs",
            inspection.resources.map((entry) => entry.path).slice(0, 500),
            0.96,
            "Structured DRS dependency lists",
          ),
          fact(
            asset.id,
            "drs.resource-count",
            inspection.uniqueResourceCount,
            1,
            "Structured DRS dependency lists",
          ),
        );
        const roleCounts = new Map<string, number>();
        for (const resource of inspection.resources)
          roleCounts.set(
            resource.role,
            (roleCounts.get(resource.role) ?? 0) + 1,
          );
        facts.push(
          fact(
            asset.id,
            "drs.resource-roles",
            [...roleCounts.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([role, count]) => `${role}:${count}`),
            0.9,
            "DRS resource filename classification",
            "suggested",
          ),
        );
      }
      if (inspection.dependentProducts.length)
        facts.push(
          fact(
            asset.id,
            "drs.dependent-products",
            inspection.dependentProducts.slice(0, 300),
            1,
            "Structured DRS dependent_products",
          ),
        );
      if (inspection.source)
        facts.push(
          fact(
            asset.id,
            "drs.source",
            inspection.source,
            1,
            "Structured DRS source field",
          ),
        );
      if (inspection.pluginVersions.length)
        facts.push(
          fact(
            asset.id,
            "drs.plugin-versions",
            inspection.pluginVersions,
            1,
            "Structured DRS DCC plugin metadata",
          ),
        );
      if (inspection.clientVersions.length)
        facts.push(
          fact(
            asset.id,
            "drs.client-versions",
            inspection.clientVersions,
            1,
            "Structured DRS client metadata",
          ),
        );
      if (inspection.roomCenters.length)
        facts.push(
          fact(
            asset.id,
            "drs.room-centers",
            inspection.roomCenters.map(
              (point) => `${point.x},${point.y},${point.z}`,
            ),
            0.65,
            "DRS detail_Info room-center hints; not geometry truth",
            "suggested",
          ),
        );
      if (inspection.resources.length)
        item.warnings.push(
          "DRS dependency paths are metadata only; resource bytes not present in the six-file pack cannot be reconstructed or published automatically.",
        );
      item.warnings.push(...inspection.issues);
      continue;
    }

    const inspection = await inspectGenericJsonMetadata(asset);
    if (inspection.json) item.findings.push("Readable JSON metadata detected.");
    if (inspection.resourceRefs.length) {
      item.findings.push(
        `${inspection.resourceRefs.length} resource reference(s) discovered.`,
      );
      facts.push(
        fact(
          asset.id,
          "metadata.resource-refs",
          inspection.resourceRefs,
          0.9,
          "Literal resource paths found in JSON metadata",
        ),
      );
    }
  }

  for (const asset of files.filter((entry) => /\.dwg$/i.test(entry.name))) {
    const inspection = await inspectDwgEvidence(asset);
    const item = items.find((entry) => entry.assetId === asset.id);
    if (!item) continue;
    if (inspection.versionCode)
      item.findings.push(
        `${inspection.versionCode} · ${inspection.versionLabel ?? "DWG"}`,
      );
    if (inspection.aecTokens.length) {
      item.findings.push(
        `${inspection.aecTokens.length} architectural token${inspection.aecTokens.length === 1 ? "" : "s"} detected.`,
      );
      facts.push(
        fact(
          asset.id,
          "dwg.architectural-tokens",
          inspection.aecTokens,
          0.62,
          "Literal DWG binary text evidence; not decoded geometry",
          "suggested",
        ),
      );
    }
    if (inspection.drawingTextHints.length)
      facts.push(
        fact(
          asset.id,
          "dwg.text-hints",
          inspection.drawingTextHints,
          0.55,
          "Readable drawing strings found in DWG bytes",
          "suggested",
        ),
      );
    item.warnings.push(...inspection.issues);
  }

  for (const asset of files.filter((entry) => /\.(?:skb|skp)$/i.test(entry.name))) {
    const inspection = await inspectSketchUpArchive(asset);
    const semantic = await inspectSketchUpSemanticEvidence(asset);
    const materialDefinitions = await extractSketchUpMaterialDefinitions(asset);
    const item = items.find((entry) => entry.assetId === asset.id);
    if (!item) continue;
    if (inspection.zipLike) {
      item.findings.push(
        `${inspection.entryCount} SketchUp archive entr${inspection.entryCount === 1 ? "y" : "ies"} inspected.`,
      );
      if (inspection.materialDefinitionFiles.length)
        item.findings.push(
          `${inspection.materialDefinitionFiles.length} material definition file${inspection.materialDefinitionFiles.length === 1 ? "" : "s"} found.`,
        );
      if (inspection.textureFiles.length)
        item.findings.push(
          `${inspection.textureFiles.length} material texture file${inspection.textureFiles.length === 1 ? "" : "s"} found.`,
        );
      facts.push(
        fact(
          asset.id,
          "sketchup.archive-summary",
          [
            `entries:${inspection.entryCount}`,
            `materials:${inspection.materialDefinitionFiles.length}`,
            `textures:${inspection.textureFiles.length}`,
            `models:${inspection.modelFiles.length}`,
          ],
          0.95,
          "ZIP central-directory inspection",
        ),
      );
      if (inspection.textureFiles.length)
        facts.push(
          fact(
            asset.id,
            "sketchup.texture-files",
            inspection.textureFiles.slice(0, 250),
            0.95,
            "SketchUp archive file table",
          ),
        );
    }
    if (semantic.architecturalTokens.length) {
      item.findings.push(
        `${semantic.architecturalTokens.length} readable architectural string hint${semantic.architecturalTokens.length === 1 ? "" : "s"} found in SketchUp model data.`,
      );
      facts.push(
        fact(
          asset.id,
          "sketchup.architectural-tokens",
          semantic.architecturalTokens.slice(0, 220),
          0.58,
          "Literal printable strings from SketchUp model.dat; not decoded geometry",
          "suggested",
        ),
      );
    }
    if (semantic.tagCandidates.length)
      facts.push(
        fact(
          asset.id,
          "sketchup.tag-candidates",
          semantic.tagCandidates.slice(0, 180),
          0.62,
          "Literal SketchUp model.dat tag/layer-like strings",
          "suggested",
        ),
      );
    if (semantic.componentCandidates.length)
      facts.push(
        fact(
          asset.id,
          "sketchup.component-candidates",
          semantic.componentCandidates.slice(0, 180),
          0.55,
          "Literal SketchUp model.dat component/group-like strings",
          "suggested",
        ),
      );
    const selectedAudit =
      audits.find((audit) => audit.assetId === analysis?.modelAssetId) ??
      (audits.length === 1 ? audits[0] : undefined);
    if (selectedAudit && materialDefinitions.definitions.length) {
      const overlap = sketchUpFbxMaterialOverlap(
        materialDefinitions.definitions.map((entry) => entry.name),
        selectedAudit.materialNames,
      );
      facts.push(
        fact(
          asset.id,
          "fusion.sketchup-fbx-material-overlap",
          overlap.ratio,
          overlap.denominator >= 5 ? 0.94 : 0.72,
          `${overlap.matched}/${overlap.denominator} normalized material names shared with selected FBX; identity/material evidence only, not a spatial transform`,
          "suggested",
        ),
      );
      if (overlap.ratio >= 0.6)
        item.findings.push(
          `SketchUp ↔ FBX source-family link is strong: ${overlap.matched}/${overlap.denominator} normalized material names overlap.`,
        );
    }
    item.warnings.push(
      ...inspection.issues,
      ...semantic.issues,
      ...materialDefinitions.issues,
    );
  }

  for (const asset of files.filter((entry) => /\.pdf$/i.test(entry.name))) {
    if (asset.size < 8) continue;
    const item = items.find((entry) => entry.assetId === asset.id);
    if (!item) continue;
    try {
      const { inspectPdfPlans } = await import("./pdfPlanInspector");
      const inspection = await inspectPdfPlans(asset);
      const best = inspection.pages.find(
        (page) => page.page === inspection.bestPage,
      );
      if (best) {
        item.findings.push(
          `PDF page ${best.page} is the strongest floor-plan candidate (score ${best.score}).`,
        );
        facts.push(
          fact(
            asset.id,
            "pdf.plan-page",
            best.page,
            Math.min(0.95, 0.55 + best.score / 40),
            "PDF text-layer floor-plan/room/dimension evidence",
            "suggested",
          ),
        );
        if (best.roomLabels.length)
          facts.push(
            fact(
              asset.id,
              "pdf.room-labels",
              best.roomLabels,
              0.72,
              `PDF page ${best.page} text layer`,
              "suggested",
            ),
          );
        if (best.dimensionStrings.length)
          facts.push(
            fact(
              asset.id,
              "pdf.dimension-text",
              best.dimensionStrings,
              0.7,
              `PDF page ${best.page} text layer`,
              "suggested",
            ),
          );
      }
      if (best?.spatialLabels.length) {
        const useful = best.spatialLabels
          .filter((entry) => entry.kind !== "other")
          .slice(0, 180);
        if (useful.length)
          facts.push(
            fact(
              asset.id,
              "pdf.spatial-labels",
              useful.map(
                (entry) =>
                  `${entry.kind}:${entry.text}@${entry.x.toFixed(4)},${entry.y.toFixed(4)}`,
              ),
              0.78,
              `PDF page ${best.page} text positions normalized to page coordinates`,
              "suggested",
            ),
          );
      }
      const cadForRegistration = (analysis?.cadAudits ?? []).find(
        (audit) =>
          audit.kind === "dwg" &&
          audit.geometryReady &&
          (audit.textLabels?.length ?? 0) >= 3,
      );
      if (best && cadForRegistration) {
        const registration: PdfCadRegistration = estimatePdfCadRegistration(
          best,
          cadForRegistration,
        );
        registrations.push({
          kind: "pdf-cad",
          sourceAssetId: asset.id,
          targetAssetId: cadForRegistration.assetId,
          compatible: registration.compatible,
          confidence: registration.confidence,
          matches: registration.matches,
          reason: registration.reason,
        });
        facts.push(
          fact(
            asset.id,
            "fusion.pdf-cad-registration-confidence",
            registration.confidence,
            registration.matches >= 3 ? 0.95 : 0.6,
            `${registration.matches} unique shared PDF/CAD spatial labels; ${registration.reason}`,
            "suggested",
          ),
        );
        if (registration.compatible) {
          facts.push(
            fact(
              asset.id,
              "fusion.pdf-cad-registration",
              [
                `target:${cadForRegistration.assetId}`,
                `matches:${registration.matches}`,
                `scale:${registration.scaleMetresPerPdfUnit?.toFixed(6) ?? "?"}`,
                `rotation:${registration.rotationDeg?.toFixed(4) ?? "?"}`,
                `tx:${registration.translateX?.toFixed(5) ?? "?"}`,
                `tz:${registration.translateZ?.toFixed(5) ?? "?"}`,
                `rms:${registration.normalizedRms?.toFixed(5) ?? "?"}`,
              ],
              registration.confidence,
              "Unique spatial text correspondences between PDF plan and normalized DWG",
              "suggested",
            ),
          );
          item.findings.push(
            `PDF plan can be registered to normalized DWG from ${registration.matches} unique shared labels (confidence ${registration.confidence.toFixed(2)}).`,
          );
        } else if (registration.matches > 0) {
          item.warnings.push(registration.reason);
        }
      }

      if (best?.embeddedImages.length) {
        const candidates = best.embeddedImages.slice(0, 20);
        item.findings.push(
          `${candidates.length} embedded image candidate${candidates.length === 1 ? "" : "s"} detected on PDF plan page ${best.page}.`,
        );
        facts.push(
          fact(
            asset.id,
            "pdf.embedded-image-candidates",
            candidates.map(
              (entry) =>
                `page:${best.page};crop:${entry.x.toFixed(4)},${entry.y.toFixed(4)},${entry.width.toFixed(4)},${entry.height.toFixed(4)};confidence:${entry.confidence.toFixed(3)}${entry.pixelWidth && entry.pixelHeight ? `;pixels:${entry.pixelWidth}x${entry.pixelHeight}` : ""}`,
            ),
            Math.max(...candidates.map((entry) => entry.confidence)),
            "PDF image XObject placement and intrinsic-size evidence",
            "suggested",
          ),
        );
        const strongest = candidates[0];
        if (strongest)
          facts.push(
            fact(
              asset.id,
              "pdf.plan-image-crop",
              `${best.page}:${strongest.x.toFixed(5)},${strongest.y.toFixed(5)},${strongest.width.toFixed(5)},${strongest.height.toFixed(5)}`,
              strongest.confidence,
              "Largest plan-page embedded image candidate",
              "suggested",
            ),
          );
      }
      item.warnings.push(...inspection.issues);
    } catch (error) {
      item.warnings.push(
        error instanceof Error
          ? `PDF plan inspection skipped: ${error.message}`
          : "PDF plan inspection skipped.",
      );
    }
  }

  const recommendedActions: string[] = [];
  const selected = analysis?.modelAssetId
    ? files.find((file) => file.id === analysis.modelAssetId)
    : undefined;
  const hasWebGlb = files.some((file) => /\.glb$/i.test(file.name));
  if (selected && /\.fbx$/i.test(selected.name) && !hasWebGlb)
    recommendedActions.push(
      "Prepare a web GLB derivative from the selected FBX before publication.",
    );
  if (
    items.some((item) => item.extension === "dwg") &&
    !(analysis?.cadAudits ?? []).some(
      (audit) => audit.kind === "dwg" && Boolean(audit.normalizedDwg),
    )
  )
    recommendedActions.push(
      "Run the controlled DWG processor to extract architectural entities before automatic wall/room reconstruction.",
    );
  if (items.some((item) => item.kind === "sketchup"))
    recommendedActions.push(
      "Use recovered SketchUp materials/semantic hints now; run the controlled SketchUp processor only when native component geometry is required.",
    );
  const planFact = facts.find((entry) => entry.key === "pdf.plan-page");
  if (planFact && typeof planFact.value === "number")
    recommendedActions.push(
      `Use PDF page ${planFact.value} as the first visual-alignment candidate.`,
    );
  if (analysis?.floorCandidates.length)
    recommendedActions.push(
      "Review detected floor levels, then build the draft structure.",
    );
  if (roomSheetRows.length)
    recommendedActions.push(
      "Use the parsed room sheet to place exact-size rooms with mouse/touch.",
    );

  const authorityDecisions = chooseSourceAuthorities(items);
  const conflicts = detectSourceFusionConflicts(files, items, facts, audits);

  return {
    createdAt: new Date().toISOString(),
    items,
    facts,
    authorityDecisions,
    registrations,
    conflicts,
    readySources: items.filter((item) => item.support === "ready").length,
    partialSources: items.filter((item) => item.support === "partial").length,
    evidenceOnlySources: items.filter((item) => item.support === "evidence-only").length,
    needsConversionSources: items.filter((item) => item.support === "needs-conversion").length,
    reviewCount:
      items.reduce((sum, item) => sum + item.warnings.length, 0) +
      (analysis?.issues.length ?? 0) +
      conflicts.length,
    recommendedActions,
  };
}
