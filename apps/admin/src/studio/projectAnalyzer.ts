import * as T from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Asset } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";

export type SmartSourceRole =
  | "model"
  | "cad"
  | "drawing"
  | "visual"
  | "texture"
  | "metadata"
  | "data"
  | "other";

export interface SmartSourceItem {
  assetId: string;
  name: string;
  role: SmartSourceRole;
  size: number;
}

export interface SmartMeshAnalysis {
  name: string;
  occurrence: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  centreX: number;
  centreY: number;
  centreZ: number;
  width: number;
  height: number;
  depth: number;
  materialNames: string[];
}

export type SmartArchitecturalKind = "wall" | "door" | "window";

export interface SmartArchitecturalCandidate {
  nodeName: string;
  occurrence: number;
  kind: SmartArchitecturalKind;
  confidence: number;
  floorIndex?: number;
  position: [number, number, number];
  size: [number, number, number];
  reasons: string[];
}

export interface SmartCadAudit {
  assetId: string;
  name: string;
  kind: "dxf" | "dwg" | "skp" | "skb";
  semanticReady: boolean;
  layerHints: Array<{
    layer: string;
    kind: SmartArchitecturalKind;
  }>;
  note: string;
}

export interface SmartFloorCandidate {
  elevation: number;
  confidence: number;
  evidenceCount: number;
}

export interface SmartNodeAssignment {
  nodeName: string;
  occurrence: number;
  floorIndex?: number;
  confidence: number;
  reason: "floor" | "multi-floor" | "outside";
}

export interface SmartProjectAnalysis {
  createdAt: string;
  sources: SmartSourceItem[];
  modelAssetId?: string;
  modelName?: string;
  meshCount: number;
  materialCount: number;
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  floorCandidates: SmartFloorCandidate[];
  nodeAssignments: SmartNodeAssignment[];
  architecturalCandidates: SmartArchitecturalCandidate[];
  cadAudits: SmartCadAudit[];
  highConfidenceAssignments: number;
  reviewAssignments: number;
  commonAssignments: number;
  externalTextureRefs: number;
  matchedTextureRefs: number;
  issues: string[];
}

const MODEL = /\.(glb|fbx)$/i;
const CAD = /\.(dwg|dxf|skp|skb)$/i;
const DRAWING = /\.pdf$/i;
const IMAGE = /\.(png|jpe?g|webp|tiff?)$/i;
const TEXTURE = /(?:texture|diffuse|albedo|normal|rough|metal|marble|tile|glass|wood|granite|ceramic)/i;
const META = /\.(drs|json)$/i;
const DATA = /\.(csv|tsv|xlsx?)$/i;

export function classifySmartSource(
  asset: Asset,
  textureNames: Set<string> = new Set(),
): SmartSourceRole {
  const name = asset.name.toLowerCase();
  const base = name.replaceAll("\\", "/").split("/").pop() ?? name;
  if (MODEL.test(name)) return "model";
  if (CAD.test(name)) return "cad";
  if (DRAWING.test(name)) return "drawing";
  if (META.test(name)) return "metadata";
  if (DATA.test(name)) return "data";
  if (IMAGE.test(name)) {
    if (textureNames.has(base) || TEXTURE.test(name)) return "texture";
    return "visual";
  }
  return "other";
}

function disposeObject(root: T.Object3D) {
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.geometry?.dispose();
    const nodeMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of nodeMaterials)
      if (material) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

async function parseModel(asset: Asset) {
  const bytes = await asset.blob.arrayBuffer();
  const manager = new T.LoadingManager();
  const transparentPixel =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  manager.setURLModifier((url) =>
    url.startsWith("blob:") || url.startsWith("data:")
      ? url
      : transparentPixel,
  );
  if (asset.name.toLowerCase().endsWith(".fbx"))
    return new FBXLoader(manager).parse(bytes, "");
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return (await loader.parseAsync(bytes, "")).scene;
}

function clusterValues(
  values: number[],
  tolerance: number,
): Array<{ value: number; count: number }> {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: Array<{ sum: number; count: number; last: number }> = [];
  for (const value of sorted) {
    const current = clusters.at(-1);
    if (!current || value - current.last > tolerance)
      clusters.push({ sum: value, count: 1, last: value });
    else {
      current.sum += value;
      current.count += 1;
      current.last = value;
    }
  }
  return clusters.map((entry) => ({
    value: entry.sum / entry.count,
    count: entry.count,
  }));
}

function modeSpacing(
  peaks: Array<{ value: number; count: number }>,
  height: number,
) {
  const minSpacing = Math.max(2, Math.min(2.4, height / 20));
  const maxSpacing = Math.min(6, Math.max(4.8, height / 3));
  const bucket = 0.08;
  const scores = new Map<number, number>();
  const top = [...peaks]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.min(28, peaks.length));
  for (let left = 0; left < top.length; left += 1)
    for (let right = left + 1; right < top.length; right += 1) {
      const diff = Math.abs(top[left].value - top[right].value);
      if (diff < minSpacing || diff > maxSpacing) continue;
      const key = Math.round(diff / bucket) * bucket;
      scores.set(
        key,
        (scores.get(key) ?? 0) + Math.min(top[left].count, top[right].count),
      );
    }
  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function inferFloorCandidates(
  nodes: SmartMeshAnalysis[],
): SmartFloorCandidate[] {
  if (!nodes.length) return [];
  const minY = Math.min(...nodes.map((node) => node.minY));
  const maxY = Math.max(...nodes.map((node) => node.maxY));
  const height = maxY - minY;
  if (!(height > 1)) return [{ elevation: minY, confidence: 0.5, evidenceCount: 1 }];

  const tolerance = Math.max(0.035, Math.min(0.18, height / 250));
  const samples: number[] = [];
  for (const node of nodes) {
    samples.push(node.minY, node.maxY);
    if (node.height <= Math.max(0.7, height * 0.04)) {
      samples.push(node.centreY, node.centreY);
    }
  }
  const clusters = clusterValues(samples, tolerance);
  const threshold = Math.max(3, Math.round(nodes.length * 0.008));
  const peaks = clusters.filter((entry) => entry.count >= threshold);
  const spacing = modeSpacing(peaks, height);

  if (!spacing) {
    const fallback = peaks
      .sort((a, b) => a.value - b.value)
      .filter(
        (entry, index, list) =>
          index === 0 || entry.value - list[index - 1].value >= 2,
      )
      .slice(0, 24);
    return fallback.map((entry) => ({
      elevation: Number(entry.value.toFixed(4)),
      confidence: Math.min(0.86, 0.45 + entry.count / Math.max(8, nodes.length * 0.08)),
      evidenceCount: entry.count,
    }));
  }

  const lowerPeaks = peaks.filter(
    (entry) => entry.value <= minY + Math.max(height * 0.22, spacing * 1.5),
  );
  const base =
    [...lowerPeaks].sort((a, b) => b.count - a.count)[0]?.value ??
    peaks.sort((a, b) => a.value - b.value)[0]?.value ??
    minY;
  const snapTolerance = Math.min(0.55, spacing * 0.2);
  const result: SmartFloorCandidate[] = [];
  for (
    let target = base, guard = 0;
    target <= maxY - Math.min(0.45, spacing * 0.12) && guard < 30;
    target += spacing, guard += 1
  ) {
    const nearest = [...clusters].sort(
      (left, right) =>
        Math.abs(left.value - target) - Math.abs(right.value - target),
    )[0];
    const snapped =
      nearest && Math.abs(nearest.value - target) <= snapTolerance
        ? nearest
        : { value: target, count: 0 };
    const confidence = Math.max(
      0.42,
      Math.min(
        0.97,
        0.58 +
          snapped.count / Math.max(10, nodes.length * 0.06) -
          Math.abs(snapped.value - target) / Math.max(spacing, 0.1),
      ),
    );
    result.push({
      elevation: Number(snapped.value.toFixed(4)),
      confidence,
      evidenceCount: snapped.count,
    });
  }
  return result;
}

export function suggestNodeFloorAssignments(
  nodes: SmartMeshAnalysis[],
  floors: SmartFloorCandidate[],
): SmartNodeAssignment[] {
  if (!floors.length) return [];
  const sorted = floors
    .map((floor, index) => ({ ...floor, originalIndex: index }))
    .sort((a, b) => a.elevation - b.elevation);
  const typical =
    sorted.length > 1
      ? sorted
          .slice(1)
          .map((floor, index) => floor.elevation - sorted[index].elevation)
          .sort((a, b) => a - b)[Math.floor((sorted.length - 1) / 2)]
      : 3;

  return nodes.map((node) => {
    let floorIndex = -1;
    for (let index = 0; index < sorted.length; index += 1) {
      const lower =
        index === 0
          ? sorted[index].elevation - typical * 0.35
          : (sorted[index - 1].elevation + sorted[index].elevation) / 2;
      const upper =
        index === sorted.length - 1
          ? sorted[index].elevation + typical * 1.25
          : (sorted[index].elevation + sorted[index + 1].elevation) / 2;
      if (node.centreY >= lower && node.centreY < upper) {
        floorIndex = index;
        break;
      }
    }
    if (floorIndex < 0)
      return {
        nodeName: node.name,
        occurrence: node.occurrence,
        confidence: 0.2,
        reason: "outside" as const,
      };

    const floor = sorted[floorIndex];
    const next = sorted[floorIndex + 1];
    const bandHeight = next
      ? next.elevation - floor.elevation
      : typical;
    const spansMultiple = node.height > Math.max(4.8, bandHeight * 1.65);
    if (spansMultiple)
      return {
        nodeName: node.name,
        occurrence: node.occurrence,
        confidence: 0.35,
        reason: "multi-floor" as const,
      };

    const distance = Math.abs(node.centreY - (floor.elevation + bandHeight * 0.45));
    const confidence = Math.max(
      0.55,
      Math.min(
        0.97,
        0.9 - distance / Math.max(bandHeight * 2.5, 0.5) - node.height / Math.max(bandHeight * 8, 1),
      ),
    );
    return {
      nodeName: node.name,
      occurrence: node.occurrence,
      floorIndex: floor.originalIndex,
      confidence,
      reason: "floor" as const,
    };
  });
}

function typicalFloorSpacing(floors: SmartFloorCandidate[], nodes: SmartMeshAnalysis[]) {
  const sorted = [...floors].sort((left, right) => left.elevation - right.elevation);
  const spacings = sorted
    .slice(1)
    .map((floor, index) => floor.elevation - sorted[index].elevation)
    .filter((value) => value > 0.01)
    .sort((left, right) => left - right);
  if (spacings.length)
    return spacings[Math.floor(spacings.length / 2)];
  if (!nodes.length) return 3;
  const minY = Math.min(...nodes.map((node) => node.minY));
  const maxY = Math.max(...nodes.map((node) => node.maxY));
  return Math.max((maxY - minY) / Math.max(floors.length, 1), 0.1);
}

function semanticWords(node: SmartMeshAnalysis) {
  return [node.name, ...node.materialNames]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

export function suggestArchitecturalCandidates(
  nodes: SmartMeshAnalysis[],
  floors: SmartFloorCandidate[],
  assignments: SmartNodeAssignment[],
): SmartArchitecturalCandidate[] {
  if (!nodes.length) return [];
  const spacing = Math.max(typicalFloorSpacing(floors, nodes), 0.1);
  const assignmentByKey = new Map(
    assignments.map((entry) => [
      `${entry.nodeName}\u0000${entry.occurrence}`,
      entry,
    ]),
  );
  const candidates: SmartArchitecturalCandidate[] = [];

  for (const node of nodes) {
    const text = semanticWords(node);
    const assignment = assignmentByKey.get(
      `${node.name}\u0000${node.occurrence}`,
    );
    const floor =
      assignment?.floorIndex !== undefined
        ? floors[assignment.floorIndex]
        : undefined;
    const horizontalMin = Math.min(node.width, node.depth);
    const horizontalMax = Math.max(node.width, node.depth);
    const heightRatio = node.height / spacing;
    const thicknessRatio = horizontalMin / spacing;
    const spanRatio = horizontalMax / spacing;
    const bottomRatio = floor ? (node.minY - floor.elevation) / spacing : 0;
    const scores: Record<SmartArchitecturalKind, number> = {
      wall: 0,
      door: 0,
      window: 0,
    };
    const reasons: Record<SmartArchitecturalKind, string[]> = {
      wall: [],
      door: [],
      window: [],
    };

    if (/\b(wall|partition|parapet|masonry|brick)\b/.test(text)) {
      scores.wall += 0.88;
      reasons.wall.push("source name/material says wall");
    }
    if (/\b(door|doors|gate|entry door|shutter)\b/.test(text)) {
      scores.door += 0.94;
      reasons.door.push("source name/material says door");
    }
    if (/\b(window|windows|glazing|glazed|fenestration)\b/.test(text)) {
      scores.window += 0.94;
      reasons.window.push("source name/material says window");
    }
    if (/\b(glass|glazing)\b/.test(text) && !/\b(railing|balustrade|balcony)\b/.test(text)) {
      scores.window += 0.28;
      reasons.window.push("glass-like material");
    }

    if (
      heightRatio >= 0.55 &&
      heightRatio <= 1.35 &&
      thicknessRatio <= 0.2 &&
      spanRatio >= 0.45
    ) {
      scores.wall += 0.58;
      reasons.wall.push("thin vertical storey-scale geometry");
    }

    if (
      floor &&
      heightRatio >= 0.48 &&
      heightRatio <= 1.05 &&
      thicknessRatio <= 0.22 &&
      spanRatio >= 0.18 &&
      spanRatio <= 1.15 &&
      bottomRatio >= -0.12 &&
      bottomRatio <= 0.18
    ) {
      scores.door += 0.52;
      reasons.door.push("opening-sized geometry starts near floor");
    }

    if (
      floor &&
      heightRatio >= 0.18 &&
      heightRatio <= 0.78 &&
      thicknessRatio <= 0.22 &&
      spanRatio >= 0.16 &&
      bottomRatio >= 0.08 &&
      bottomRatio <= 0.72
    ) {
      scores.window += 0.47;
      reasons.window.push("opening-sized geometry has a sill");
    }

    if (/\b(column|beam|slab|floor|ceiling|roof|stair|railing|balustrade)\b/.test(text)) {
      scores.door *= 0.35;
      scores.window *= 0.35;
    }
    if (/\b(railing|balustrade|balcony)\b/.test(text))
      scores.window *= 0.35;

    const ranked = (Object.entries(scores) as Array<[SmartArchitecturalKind, number]>)
      .sort((left, right) => right[1] - left[1]);
    const [kind, rawScore] = ranked[0];
    const second = ranked[1]?.[1] ?? 0;
    if (rawScore < 0.55 || rawScore - second < 0.08) continue;
    const floorFactor =
      kind === "wall" || assignment?.floorIndex !== undefined ? 1 : 0.82;
    candidates.push({
      nodeName: node.name,
      occurrence: node.occurrence,
      kind,
      confidence: Number(
        Math.max(0.5, Math.min(0.98, rawScore * floorFactor)).toFixed(3),
      ),
      floorIndex: assignment?.floorIndex,
      position: [node.centreX, node.centreY, node.centreZ],
      size: [node.width, node.height, node.depth],
      reasons: reasons[kind].slice(0, 3),
    });
  }

  return candidates.sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.nodeName.localeCompare(right.nodeName),
  );
}

function semanticLayerKind(layer: string): SmartArchitecturalKind | undefined {
  const normalized = layer.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(door|doors|gate)\b/.test(normalized)) return "door";
  if (/\b(window|windows|glazing|fenestration)\b/.test(normalized))
    return "window";
  if (/\b(wall|walls|partition|masonry)\b/.test(normalized)) return "wall";
  return undefined;
}

async function auditCadSources(files: Asset[]): Promise<SmartCadAudit[]> {
  const cad = files.filter((file) => /\.(dxf|dwg|skp|skb)$/i.test(file.name));
  const result: SmartCadAudit[] = [];
  for (const file of cad) {
    const extension = file.name.toLowerCase().split(".").pop() as
      | "dxf"
      | "dwg"
      | "skp"
      | "skb";
    if (extension !== "dxf") {
      result.push({
        assetId: file.id,
        name: file.name,
        kind: extension,
        semanticReady: false,
        layerHints: [],
        note:
          extension === "dwg"
            ? "DWG is preserved as source evidence. Convert/export to ASCII DXF for safe browser-side layer detection."
            : "SketchUp source is preserved as evidence; semantic layer extraction is not enabled in-browser.",
      });
      continue;
    }
    if (file.size > 25 * 1024 * 1024) {
      result.push({
        assetId: file.id,
        name: file.name,
        kind: "dxf",
        semanticReady: false,
        layerHints: [],
        note: "DXF is too large for safe in-browser semantic scanning; use a reduced/exported drawing.",
      });
      continue;
    }
    const text = await file.blob.text();
    if (!/\bSECTION\b/i.test(text)) {
      result.push({
        assetId: file.id,
        name: file.name,
        kind: "dxf",
        semanticReady: false,
        layerHints: [],
        note: "DXF does not look like readable ASCII DXF; no CAD semantics were guessed.",
      });
      continue;
    }
    const lines = text.split(/\r?\n/);
    const layers = new Set<string>();
    for (let index = 0; index + 1 < lines.length; index += 2) {
      const code = lines[index].trim();
      const value = lines[index + 1].trim();
      if (code === "8" && value) layers.add(value);
    }
    const layerHints = [...layers]
      .map((layer) => {
        const kind = semanticLayerKind(layer);
        return kind ? { layer, kind } : undefined;
      })
      .filter(
        (entry): entry is { layer: string; kind: SmartArchitecturalKind } =>
          Boolean(entry),
      );
    result.push({
      assetId: file.id,
      name: file.name,
      kind: "dxf",
      semanticReady: true,
      layerHints,
      note: layerHints.length
        ? `${layerHints.length} wall/door/window layer hint(s) found. They are hints only until geometry is reviewed.`
        : "ASCII DXF is readable, but no clearly named wall/door/window layers were found.",
    });
  }
  return result;
}

export async function analyzeProjectFiles(
  files: Asset[],
  modelAssetId: string | undefined,
  audits: FbxSourceAudit[] = [],
): Promise<SmartProjectAnalysis> {
  const textureNames = new Set(
    audits.flatMap((audit) =>
      audit.externalTextureFiles.map(
        (path) => path.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "",
      ),
    ),
  );
  const sources = files.map((asset) => ({
    assetId: asset.id,
    name: asset.name,
    role: classifySmartSource(asset, textureNames),
    size: asset.size,
  }));
  const issues: string[] = [];
  const models = files.filter((asset) => MODEL.test(asset.name));
  const selected =
    files.find((asset) => asset.id === modelAssetId) ??
    (models.length === 1 ? models[0] : undefined);

  const textureAudit = audits.find((audit) => audit.assetId === selected?.id);
  const externalTextureRefs = textureAudit?.externalTextureFiles.length ?? 0;
  const matchedTextureRefs = textureAudit?.matchedTextureFiles.length ?? 0;
  if (externalTextureRefs > matchedTextureRefs)
    issues.push(
      `${externalTextureRefs - matchedTextureRefs} referenced texture file(s) are not attached.`,
    );
  if (!selected && models.length > 1)
    issues.push("Multiple model candidates found. Choose the publish/authoring model.");
  if (!selected && !models.length)
    issues.push("No GLB/FBX model found. You can still keep drawings as project evidence.");

  let meshCount = 0;
  let materialCount = 0;
  let bounds: SmartProjectAnalysis["bounds"];
  let floorCandidates: SmartFloorCandidate[] = [];
  let nodeAssignments: SmartNodeAssignment[] = [];
  let architecturalCandidates: SmartArchitecturalCandidate[] = [];
  const cadAudits = await auditCadSources(files);

  if (selected) {
    let root: T.Object3D | undefined;
    try {
      root = await parseModel(selected);
      root.updateWorldMatrix(true, true);
      const meshNodes: SmartMeshAnalysis[] = [];
      const materialNames = new Set<string>();
      const occurrences = new Map<string, number>();
      let meshIndex = 0;
      root.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        meshIndex += 1;
        const name = node.name || `Mesh ${meshIndex}`;
        const occurrence = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, occurrence);
        const box = new T.Box3().setFromObject(node);
        if (box.isEmpty()) return;
        const centre = box.getCenter(new T.Vector3());
        const size = box.getSize(new T.Vector3());
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        const nodeMaterialNames = materials.map(
          (material) => material?.name || material?.uuid || "Unnamed",
        );
        meshNodes.push({
          name,
          occurrence,
          minX: box.min.x,
          minY: box.min.y,
          minZ: box.min.z,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
          centreX: centre.x,
          centreY: centre.y,
          centreZ: centre.z,
          width: size.x,
          height: size.y,
          depth: size.z,
          materialNames: nodeMaterialNames,
        });
        for (const materialName of nodeMaterialNames)
          materialNames.add(materialName);
      });
      meshCount = meshNodes.length;
      materialCount = materialNames.size;
      const modelBounds = new T.Box3().setFromObject(root);
      if (!modelBounds.isEmpty())
        bounds = {
          min: [modelBounds.min.x, modelBounds.min.y, modelBounds.min.z],
          max: [modelBounds.max.x, modelBounds.max.y, modelBounds.max.z],
        };
      floorCandidates = inferFloorCandidates(meshNodes);
      nodeAssignments = suggestNodeFloorAssignments(meshNodes, floorCandidates);
      architecturalCandidates = suggestArchitecturalCandidates(
        meshNodes,
        floorCandidates,
        nodeAssignments,
      );
      if (floorCandidates.length < 2 && meshNodes.length)
        issues.push("Floor levels were not confidently detected; review them manually.");
    } catch (error) {
      issues.push(
        error instanceof Error
          ? `Model analysis could not complete: ${error.message}`
          : "Model analysis could not complete.",
      );
    } finally {
      if (root) disposeObject(root);
    }
  }

  const highConfidenceAssignments = nodeAssignments.filter(
    (entry) => entry.floorIndex !== undefined && entry.confidence >= 0.78,
  ).length;
  const reviewAssignments = nodeAssignments.filter(
    (entry) => entry.floorIndex !== undefined && entry.confidence < 0.78,
  ).length;
  const commonAssignments = nodeAssignments.filter(
    (entry) => entry.floorIndex === undefined,
  ).length;

  return {
    createdAt: new Date().toISOString(),
    sources,
    modelAssetId: selected?.id,
    modelName: selected?.name,
    meshCount,
    materialCount,
    bounds,
    floorCandidates,
    nodeAssignments,
    architecturalCandidates,
    cadAudits,
    highConfidenceAssignments,
    reviewAssignments,
    commonAssignments,
    externalTextureRefs,
    matchedTextureRefs,
    issues,
  };
}
