import type { Asset } from "./domain";
import type {
  DxfCadAnchor,
  DxfCadDimension,
  DxfPlanGeometry,
  DxfSemanticSegment,
  DxfTextLabel,
} from "./dxfArchitecture";

export interface DwgProcessorResult {
  format: "rekixo-cad-architecture";
  version: 1;
  processor: {
    engine: string;
    engineVersion: string;
  };
  source: {
    name: string;
    sha256?: string;
    dwgVersion?: string;
  };
  units: {
    code?: number;
    name: string;
    metresPerUnit: number | null;
  };
  geometryReady: boolean;
  segments: DxfSemanticSegment[];
  anchors: DxfCadAnchor[];
  dimensions: DxfCadDimension[];
  labels: DxfTextLabel[];
  floorHints: string[];
  bounds?: {
    min: [number, number];
    max: [number, number];
  };
  issues: string[];
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function point(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finite(value[0]) &&
    finite(value[1]) &&
    Math.abs(value[0]) <= 1e7 &&
    Math.abs(value[1]) <= 1e7
  );
}

const CAD_KINDS = new Set([
  "wall",
  "door",
  "window",
  "stair",
  "lift",
  "column",
  "slab",
]);

export function validateDwgProcessorResult(
  value: unknown,
): DwgProcessorResult {
  if (!value || typeof value !== "object")
    throw Error("CAD processor returned an invalid payload.");
  const data = value as Record<string, unknown>;
  if (data.format !== "rekixo-cad-architecture" || data.version !== 1)
    throw Error("CAD processor contract version is not supported.");

  const segments = Array.isArray(data.segments) ? data.segments : [];
  const anchors = Array.isArray(data.anchors) ? data.anchors : [];
  const dimensions = Array.isArray(data.dimensions) ? data.dimensions : [];
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const floorHints = Array.isArray(data.floorHints) ? data.floorHints : [];
  if (
    segments.length > 30_000 ||
    anchors.length > 10_000 ||
    dimensions.length > 5_000 ||
    labels.length > 5_000 ||
    floorHints.length > 50
  )
    throw Error("CAD processor payload exceeds safety limits.");

  for (const raw of segments) {
    const segment = raw as Record<string, unknown>;
    if (
      !CAD_KINDS.has(String(segment.kind || "")) ||
      typeof segment.layer !== "string" ||
      segment.layer.length > 240 ||
      !point(segment.start) ||
      !point(segment.end) ||
      !finite(segment.confidence)
    )
      throw Error("CAD processor returned an invalid semantic segment.");
  }
  for (const raw of anchors) {
    const anchor = raw as Record<string, unknown>;
    if (
      !CAD_KINDS.has(String(anchor.kind || "")) ||
      typeof anchor.layer !== "string" ||
      !point(anchor.point) ||
      !finite(anchor.confidence)
    )
      throw Error("CAD processor returned an invalid block anchor.");
  }
  for (const raw of dimensions) {
    const dimension = raw as Record<string, unknown>;
    if (
      typeof dimension.layer !== "string" ||
      (dimension.point !== undefined && !point(dimension.point)) ||
      (dimension.valueMetres !== undefined && !finite(dimension.valueMetres))
    )
      throw Error("CAD processor returned an invalid dimension.");
  }
  for (const raw of labels) {
    const label = raw as Record<string, unknown>;
    if (
      typeof label.layer !== "string" ||
      typeof label.text !== "string" ||
      label.text.length > 500 ||
      !point(label.point)
    )
      throw Error("CAD processor returned an invalid text label.");
  }

  const units = data.units as Record<string, unknown> | undefined;
  if (
    !units ||
    typeof units.name !== "string" ||
    (units.metresPerUnit !== null &&
      (!finite(units.metresPerUnit) || Number(units.metresPerUnit) <= 0))
  )
    throw Error("CAD processor returned invalid drawing units.");

  return value as DwgProcessorResult;
}

export async function processDwgAsset(asset: Asset): Promise<DwgProcessorResult> {
  if (!/\.dwg$/i.test(asset.name))
    throw Error("Choose a DWG source before running the CAD processor.");

  const response = await fetch(
    "/3Dprojects/api/cloud/cad/process?name=" +
      encodeURIComponent(asset.name),
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": asset.type || "application/octet-stream",
        "x-rekixo-sha256": asset.hash,
      },
      body: asset.blob,
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Controlled DWG processing failed.",
    );
  return validateDwgProcessorResult(payload);
}

export function processorResultAsPlan(
  result: DwgProcessorResult,
): DxfPlanGeometry {
  return {
    ascii: true,
    insUnitsCode: result.units.code,
    unitName: result.units.name,
    metresPerUnit: result.units.metresPerUnit ?? undefined,
    geometryReady: result.geometryReady,
    segments: result.segments,
    labels: result.labels,
    anchors: result.anchors,
    dimensions: result.dimensions,
    floorHints: result.floorHints,
    bounds: result.bounds,
    issues: result.issues,
  };
}
