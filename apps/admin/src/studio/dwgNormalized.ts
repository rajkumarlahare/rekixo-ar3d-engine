import type { Asset } from "./domain";

export const DWG_NORMALIZED_CONTRACT = "rekixo-dwg-normalized";
export const DWG_NORMALIZED_VERSION = 1;
export const DWG_NORMALIZED_MIME =
  "application/vnd.rekixo.dwg-normalized+json";

export type DwgPlanKind =
  | "wall"
  | "door"
  | "window"
  | "stair"
  | "lift"
  | "column"
  | "slab"
  | "roof"
  | "duct"
  | "balcony"
  | "gate"
  | "room"
  | "other";

export type DwgPoint = [number, number];

export interface DwgNormalizedSegment {
  id: string;
  kind: "wall" | "door" | "window";
  layer: string;
  start: DwgPoint;
  end: DwgPoint;
  sourceEntity: string;
  confidence: number;
  widthM?: number;
}

export interface DwgNormalizedText {
  id: string;
  layer: string;
  text: string;
  point: DwgPoint;
  kind: "room" | "floor" | "dimension" | "note" | "other";
}

export interface DwgNormalizedDimension {
  id: string;
  layer: string;
  valueM?: number;
  text?: string;
  point?: DwgPoint;
  start?: DwgPoint;
  end?: DwgPoint;
}

export interface DwgNormalizedInsert {
  id: string;
  layer: string;
  name: string;
  point: DwgPoint;
  rotationDeg: number;
  scale: [number, number, number];
  kind: DwgPlanKind;
  confidence: number;
}

export interface DwgNormalizedObject {
  id: string;
  layer: string;
  sourceEntity: string;
  kind: DwgPlanKind;
  confidence: number;
  point?: DwgPoint;
  bounds?: { min: DwgPoint; max: DwgPoint };
}

export interface DwgNormalizedFloor {
  label: string;
  confidence: number;
  sourceTextId: string;
}

export interface DwgNormalizedLayer {
  name: string;
  semanticKind?: DwgPlanKind;
  entityCount: number;
}

export interface DwgNormalizedDocument {
  contract: typeof DWG_NORMALIZED_CONTRACT;
  version: typeof DWG_NORMALIZED_VERSION;
  source: {
    format: "dwg";
    assetId: string;
    name: string;
    sha256: string;
    byteSize: number;
    versionCode?: string;
  };
  processor: {
    engine: string;
    engineVersion: string;
    adapterVersion: string;
  };
  units: {
    code?: number;
    name?: string;
    metresPerUnit?: number;
    reviewed: boolean;
  };
  bounds?: { min: DwgPoint; max: DwgPoint };
  layers: DwgNormalizedLayer[];
  segments: DwgNormalizedSegment[];
  texts: DwgNormalizedText[];
  dimensions: DwgNormalizedDimension[];
  inserts: DwgNormalizedInsert[];
  objects: DwgNormalizedObject[];
  floors: DwgNormalizedFloor[];
  issues: string[];
}

const MAX_COORDINATE_METRES = 10_000_000;
const SHA256 = /^[a-f0-9]{64}$/i;
const PLAN_KINDS = new Set<DwgPlanKind>([
  "wall",
  "door",
  "window",
  "stair",
  "lift",
  "column",
  "slab",
  "roof",
  "duct",
  "balcony",
  "gate",
  "room",
  "other",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw Error(`DWG normalized contract has invalid ${label}.`);
  return value;
}

function safeText(value: unknown, label: string, max = 320) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error(`DWG normalized contract has invalid ${label}.`);
  return value.trim();
}

function optionalText(value: unknown, label: string, max = 320) {
  if (value === undefined || value === null || value === "") return undefined;
  return safeText(value, label, max);
}

function point(value: unknown, label: string): DwgPoint {
  if (!Array.isArray(value) || value.length !== 2)
    throw Error(`DWG normalized contract has invalid ${label}.`);
  const x = finite(value[0], `${label}.x`);
  const y = finite(value[1], `${label}.y`);
  if (
    Math.abs(x) > MAX_COORDINATE_METRES ||
    Math.abs(y) > MAX_COORDINATE_METRES
  )
    throw Error(`DWG normalized contract ${label} exceeds coordinate limits.`);
  return [x, y];
}

function optionalPoint(value: unknown, label: string) {
  return value === undefined || value === null ? undefined : point(value, label);
}

function planKind(value: unknown, label: string): DwgPlanKind {
  if (typeof value !== "string" || !PLAN_KINDS.has(value as DwgPlanKind))
    throw Error(`DWG normalized contract has invalid ${label}.`);
  return value as DwgPlanKind;
}

function confidence(value: unknown, label: string) {
  const number = finite(value, label);
  if (number < 0 || number > 1)
    throw Error(`DWG normalized contract ${label} must be between 0 and 1.`);
  return number;
}

function boundedArray<T>(
  value: unknown,
  label: string,
  max: number,
  mapper: (entry: unknown, index: number) => T,
) {
  if (!Array.isArray(value) || value.length > max)
    throw Error(`DWG normalized contract has invalid ${label}.`);
  return value.map(mapper);
}

function parseBounds(
  value: unknown,
  label: string,
): { min: DwgPoint; max: DwgPoint } | undefined {
  if (value === undefined || value === null) return undefined;
  const row = object(value);
  if (!row) throw Error(`DWG normalized contract has invalid ${label}.`);
  const min = point(row.min, `${label}.min`);
  const max = point(row.max, `${label}.max`);
  if (min[0] > max[0] || min[1] > max[1])
    throw Error(`DWG normalized contract has inverted ${label}.`);
  return { min, max };
}

export function parseDwgNormalizedDocument(
  value: unknown,
  source?: Asset,
): DwgNormalizedDocument {
  const root = object(value);
  if (
    root?.contract !== DWG_NORMALIZED_CONTRACT ||
    root.version !== DWG_NORMALIZED_VERSION
  )
    throw Error("Unsupported DWG normalized contract.");

  const sourceRow = object(root.source);
  const processor = object(root.processor);
  const units = object(root.units);
  if (!sourceRow || !processor || !units)
    throw Error("DWG normalized contract is missing source/processor/units.");

  const assetId = safeText(sourceRow.assetId, "source.assetId", 120);
  const name = safeText(sourceRow.name, "source.name", 260);
  const sha256 = safeText(sourceRow.sha256, "source.sha256", 64).toLowerCase();
  const byteSize = finite(sourceRow.byteSize, "source.byteSize");
  if (sourceRow.format !== "dwg" || !SHA256.test(sha256) || byteSize < 1)
    throw Error("DWG normalized source identity is invalid.");

  if (source) {
    if (
      source.id !== assetId ||
      source.hash.toLowerCase() !== sha256 ||
      source.size !== byteSize
    )
      throw Error("DWG normalized result does not match the source asset.");
  }

  const metresPerUnit =
    units.metresPerUnit === undefined
      ? undefined
      : finite(units.metresPerUnit, "units.metresPerUnit");
  if (metresPerUnit !== undefined && !(metresPerUnit > 0))
    throw Error("DWG normalized metresPerUnit must be positive.");

  const layers = boundedArray(root.layers, "layers", 10_000, (entry, index) => {
    const row = object(entry);
    if (!row) throw Error(`DWG normalized layer ${index} is invalid.`);
    const entityCount = finite(row.entityCount, `layers[${index}].entityCount`);
    if (!Number.isInteger(entityCount) || entityCount < 0)
      throw Error(`DWG normalized layer ${index} count is invalid.`);
    return {
      name: safeText(row.name, `layers[${index}].name`, 260),
      ...(row.semanticKind
        ? { semanticKind: planKind(row.semanticKind, `layers[${index}].semanticKind`) }
        : {}),
      entityCount,
    };
  });

  const segments = boundedArray(
    root.segments,
    "segments",
    60_000,
    (entry, index): DwgNormalizedSegment => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized segment ${index} is invalid.`);
      const kind = planKind(row.kind, `segments[${index}].kind`);
      if (kind !== "wall" && kind !== "door" && kind !== "window")
        throw Error(`DWG normalized segment ${index} kind is not segment-safe.`);
      const widthM =
        row.widthM === undefined
          ? undefined
          : finite(row.widthM, `segments[${index}].widthM`);
      return {
        id: safeText(row.id, `segments[${index}].id`, 160),
        kind,
        layer: safeText(row.layer, `segments[${index}].layer`, 260),
        start: point(row.start, `segments[${index}].start`),
        end: point(row.end, `segments[${index}].end`),
        sourceEntity: safeText(
          row.sourceEntity,
          `segments[${index}].sourceEntity`,
          120,
        ),
        confidence: confidence(
          row.confidence,
          `segments[${index}].confidence`,
        ),
        ...(widthM !== undefined && widthM > 0 && widthM <= 5
          ? { widthM }
          : {}),
      };
    },
  );

  const texts = boundedArray(
    root.texts,
    "texts",
    30_000,
    (entry, index): DwgNormalizedText => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized text ${index} is invalid.`);
      const kind = safeText(row.kind, `texts[${index}].kind`, 20);
      if (!["room", "floor", "dimension", "note", "other"].includes(kind))
        throw Error(`DWG normalized text ${index} kind is invalid.`);
      return {
        id: safeText(row.id, `texts[${index}].id`, 160),
        layer: safeText(row.layer, `texts[${index}].layer`, 260),
        text: safeText(row.text, `texts[${index}].text`, 500),
        point: point(row.point, `texts[${index}].point`),
        kind: kind as DwgNormalizedText["kind"],
      };
    },
  );

  const dimensions = boundedArray(
    root.dimensions,
    "dimensions",
    20_000,
    (entry, index): DwgNormalizedDimension => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized dimension ${index} is invalid.`);
      const valueM =
        row.valueM === undefined
          ? undefined
          : finite(row.valueM, `dimensions[${index}].valueM`);
      return {
        id: safeText(row.id, `dimensions[${index}].id`, 160),
        layer: safeText(row.layer, `dimensions[${index}].layer`, 260),
        ...(valueM !== undefined && valueM >= 0 ? { valueM } : {}),
        ...(optionalText(row.text, `dimensions[${index}].text`, 240)
          ? { text: optionalText(row.text, `dimensions[${index}].text`, 240) }
          : {}),
        ...(optionalPoint(row.point, `dimensions[${index}].point`)
          ? { point: optionalPoint(row.point, `dimensions[${index}].point`) }
          : {}),
        ...(optionalPoint(row.start, `dimensions[${index}].start`)
          ? { start: optionalPoint(row.start, `dimensions[${index}].start`) }
          : {}),
        ...(optionalPoint(row.end, `dimensions[${index}].end`)
          ? { end: optionalPoint(row.end, `dimensions[${index}].end`) }
          : {}),
      };
    },
  );

  const inserts = boundedArray(
    root.inserts,
    "inserts",
    30_000,
    (entry, index): DwgNormalizedInsert => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized insert ${index} is invalid.`);
      if (!Array.isArray(row.scale) || row.scale.length !== 3)
        throw Error(`DWG normalized insert ${index} scale is invalid.`);
      return {
        id: safeText(row.id, `inserts[${index}].id`, 160),
        layer: safeText(row.layer, `inserts[${index}].layer`, 260),
        name: safeText(row.name, `inserts[${index}].name`, 260),
        point: point(row.point, `inserts[${index}].point`),
        rotationDeg: finite(row.rotationDeg, `inserts[${index}].rotationDeg`),
        scale: [
          finite(row.scale[0], `inserts[${index}].scale.x`),
          finite(row.scale[1], `inserts[${index}].scale.y`),
          finite(row.scale[2], `inserts[${index}].scale.z`),
        ],
        kind: planKind(row.kind, `inserts[${index}].kind`),
        confidence: confidence(
          row.confidence,
          `inserts[${index}].confidence`,
        ),
      };
    },
  );

  const objects = boundedArray(
    root.objects,
    "objects",
    40_000,
    (entry, index): DwgNormalizedObject => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized object ${index} is invalid.`);
      return {
        id: safeText(row.id, `objects[${index}].id`, 160),
        layer: safeText(row.layer, `objects[${index}].layer`, 260),
        sourceEntity: safeText(
          row.sourceEntity,
          `objects[${index}].sourceEntity`,
          120,
        ),
        kind: planKind(row.kind, `objects[${index}].kind`),
        confidence: confidence(
          row.confidence,
          `objects[${index}].confidence`,
        ),
        ...(optionalPoint(row.point, `objects[${index}].point`)
          ? { point: optionalPoint(row.point, `objects[${index}].point`) }
          : {}),
        ...(parseBounds(row.bounds, `objects[${index}].bounds`)
          ? { bounds: parseBounds(row.bounds, `objects[${index}].bounds`) }
          : {}),
      };
    },
  );

  const floors = boundedArray(
    root.floors,
    "floors",
    200,
    (entry, index): DwgNormalizedFloor => {
      const row = object(entry);
      if (!row) throw Error(`DWG normalized floor ${index} is invalid.`);
      return {
        label: safeText(row.label, `floors[${index}].label`, 180),
        confidence: confidence(row.confidence, `floors[${index}].confidence`),
        sourceTextId: safeText(
          row.sourceTextId,
          `floors[${index}].sourceTextId`,
          160,
        ),
      };
    },
  );

  const issues = boundedArray(root.issues, "issues", 500, (entry, index) =>
    safeText(entry, `issues[${index}]`, 500),
  );

  return {
    contract: DWG_NORMALIZED_CONTRACT,
    version: DWG_NORMALIZED_VERSION,
    source: {
      format: "dwg",
      assetId,
      name,
      sha256,
      byteSize,
      ...(optionalText(sourceRow.versionCode, "source.versionCode", 20)
        ? { versionCode: optionalText(sourceRow.versionCode, "source.versionCode", 20) }
        : {}),
    },
    processor: {
      engine: safeText(processor.engine, "processor.engine", 120),
      engineVersion: safeText(
        processor.engineVersion,
        "processor.engineVersion",
        80,
      ),
      adapterVersion: safeText(
        processor.adapterVersion,
        "processor.adapterVersion",
        120,
      ),
    },
    units: {
      ...(units.code === undefined
        ? {}
        : { code: finite(units.code, "units.code") }),
      ...(optionalText(units.name, "units.name", 80)
        ? { name: optionalText(units.name, "units.name", 80) }
        : {}),
      ...(metresPerUnit !== undefined ? { metresPerUnit } : {}),
      reviewed: units.reviewed === true,
    },
    ...(parseBounds(root.bounds, "bounds")
      ? { bounds: parseBounds(root.bounds, "bounds") }
      : {}),
    layers,
    segments,
    texts,
    dimensions,
    inserts,
    objects,
    floors,
    issues,
  };
}

export function isDwgNormalizedAsset(asset: Asset) {
  return (
    asset.type === DWG_NORMALIZED_MIME ||
    /\.rekixo-dwg\.json$/i.test(asset.name)
  );
}

export function dwgNormalizedAssetName(sourceName: string) {
  return sourceName.replace(/\.dwg$/i, "") + ".rekixo-dwg.json";
}

export async function readDwgNormalizedAsset(
  asset: Asset,
  source?: Asset,
): Promise<DwgNormalizedDocument | undefined> {
  if (!isDwgNormalizedAsset(asset)) return undefined;
  if (asset.size > 12 * 1024 * 1024)
    throw Error("DWG normalized derivative exceeds the 12 MB safety limit.");
  const value = JSON.parse(await asset.blob.text()) as unknown;
  return parseDwgNormalizedDocument(value, source);
}

export async function findDwgNormalizedDocument(
  files: readonly Asset[],
  source: Asset,
) {
  for (const candidate of files) {
    if (!isDwgNormalizedAsset(candidate)) continue;
    try {
      const document = await readDwgNormalizedAsset(candidate, source);
      if (document) return { asset: candidate, document };
    } catch {
      // A derivative for a different source is normal. Invalid/mismatched
      // derivatives are ignored here and never become architectural truth.
    }
  }
  return undefined;
}
