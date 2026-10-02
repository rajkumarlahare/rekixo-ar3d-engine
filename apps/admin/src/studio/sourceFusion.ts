import type { Asset } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import type { SmartProjectAnalysis } from "./projectAnalyzer";
import type { RoomSheetRow } from "./roomSheet";
import { inspectSketchUpArchive } from "./sketchUpArchive";
import { inspectDwgEvidence } from "./dwgEvidence";
import { isDwgNormalizedAsset } from "./dwgNormalized";
import { inspectDrsMetadata } from "./drsMetadata";
import {
  detectSourceFusionConflicts,
  type SourceFusionConflict,
} from "./sourceConflicts";

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

export interface SourceFusionReport {
  createdAt: string;
  items: SourceFusionItem[];
  facts: SourceFusionFact[];
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
      capabilities: ["dimensions", "visual-style"],
      findings: ["PDF pages can be rasterized and calibrated for plan alignment."],
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

export async function buildSourceFusionReport(
  files: Asset[],
  analysis?: SmartProjectAnalysis,
  audits: FbxSourceAudit[] = [],
  roomSheetRows: RoomSheetRow[] = [],
): Promise<SourceFusionReport> {
  const items = files.filter((asset) => !isDwgNormalizedAsset(asset)).map(itemFor);
  const facts: SourceFusionFact[] = [];

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

  for (const asset of files.filter((entry) => /\.(drs|json)$/i.test(entry.name))) {
    const inspection = await inspectDrsMetadata(asset);
    const item = items.find((entry) => entry.assetId === asset.id);
    if (!item) continue;

    if (inspection.json) item.findings.push("Readable JSON metadata detected.");
    if (inspection.format === "d5-design") {
      item.findings.push("Structured D5 Design metadata detected.");
      item.support = "partial";
    }
    item.warnings.push(...inspection.issues);

    if (inspection.title)
      facts.push(
        fact(
          asset.id,
          "metadata.title",
          inspection.title,
          1,
          "Literal metadata title",
        ),
      );
    if (inspection.source)
      facts.push(
        fact(
          asset.id,
          "metadata.authoring-source",
          inspection.source,
          1,
          "Literal metadata authoring source",
        ),
      );
    if (inspection.sketchUpRef) {
      item.findings.push("Metadata links a SketchUp design source.");
      facts.push(
        fact(
          asset.id,
          "metadata.sketchup-ref",
          inspection.sketchUpRef,
          1,
          "Literal SketchUp package reference from metadata",
        ),
      );
    }

    if (inspection.resourceRefs.length) {
      item.findings.push(
        `${inspection.resourceRefs.length} resource reference(s) discovered.`,
      );
      facts.push(
        fact(
          asset.id,
          "metadata.resource-count",
          inspection.resourceRefs.length,
          1,
          "Structured/literal metadata resource references",
        ),
        fact(
          asset.id,
          "metadata.resource-refs",
          inspection.resourceRefs,
          inspection.format === "d5-design" ? 0.99 : 0.9,
          inspection.format === "d5-design"
            ? "D5 dependency list and literal metadata resource paths"
            : "Literal resource paths found in metadata",
        ),
      );
    }
    if (inspection.resourceRoots.length)
      facts.push(
        fact(
          asset.id,
          "metadata.resource-roots",
          inspection.resourceRoots,
          0.98,
          "Top-level resource namespaces observed in metadata",
        ),
      );
    if (inspection.productIds.length) {
      item.findings.push(
        `${inspection.productIds.length} dependent product reference(s) discovered.`,
      );
      facts.push(
        fact(
          asset.id,
          "metadata.product-count",
          inspection.productIds.length,
          1,
          "Structured metadata product dependency list",
        ),
      );
    }
    if (inspection.pluginVersions.length)
      facts.push(
        fact(
          asset.id,
          "metadata.plugin-versions",
          inspection.pluginVersions,
          1,
          "Literal DCC plugin version metadata",
        ),
      );
    if (inspection.clientVersions.length)
      facts.push(
        fact(
          asset.id,
          "metadata.client-versions",
          inspection.clientVersions,
          1,
          "Literal client version metadata",
        ),
      );
    if (inspection.maxLength !== undefined)
      facts.push(
        fact(
          asset.id,
          "metadata.max-length",
          inspection.maxLength,
          0.95,
          "Literal metadata detail_Info value; not geometry truth",
        ),
      );
    if (inspection.startLocation)
      facts.push(
        fact(
          asset.id,
          "metadata.start-location",
          [
            inspection.startLocation.x,
            inspection.startLocation.y,
            inspection.startLocation.z,
          ],
          0.95,
          "Literal D5 start location; coordinate-system evidence only",
        ),
      );
    if (inspection.floorCenter)
      facts.push(
        fact(
          asset.id,
          "metadata.floor-center",
          [
            inspection.floorCenter.x,
            inspection.floorCenter.y,
            inspection.floorCenter.z,
          ],
          0.95,
          "Literal D5 floor center; coordinate-system evidence only",
        ),
      );
    inspection.roomCenters.forEach((centre, index) =>
      facts.push(
        fact(
          asset.id,
          `metadata.room-center.${index + 1}`,
          [centre.x, centre.y, centre.z],
          0.9,
          "Literal D5 room center; semantic metadata, not room geometry",
          "suggested",
        ),
      ),
    );
    if (inspection.floorReference)
      facts.push(
        fact(
          asset.id,
          "metadata.floor-reference",
          [
            inspection.floorReference.width,
            inspection.floorReference.height,
            inspection.floorReference.angle,
          ],
          0.95,
          "Literal floor-reference width/height/angle metadata",
        ),
      );

    const attachedLeaves = new Set(
      files
        .filter((candidate) => candidate.id !== asset.id)
        .map((candidate) =>
          candidate.name.replaceAll("\\", "/").split("/").pop()?.toLowerCase(),
        )
        .filter((value): value is string => Boolean(value)),
    );
    const attachedResourceRefs = inspection.resourceRefs.filter((value) => {
      const leaf = value.replaceAll("\\", "/").split("/").pop()?.toLowerCase();
      return Boolean(leaf && attachedLeaves.has(leaf));
    });
    if (attachedResourceRefs.length)
      facts.push(
        fact(
          asset.id,
          "metadata.attached-resource-refs",
          attachedResourceRefs,
          1,
          "Metadata dependency leaf matches an attached project source",
        ),
      );
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
    item.warnings.push(...inspection.issues);
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
      "Run the controlled SketchUp processor to recover component/material metadata.",
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

  const conflicts = detectSourceFusionConflicts(files, items, facts, audits);

  return {
    createdAt: new Date().toISOString(),
    items,
    facts,
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
