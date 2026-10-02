import type { Asset } from "./domain";

export interface DrsVector3 {
  x: number;
  y: number;
  z: number;
}

export interface DrsRotation {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface DrsMetadataInspection {
  json: boolean;
  format: "d5-design" | "generic-json" | "unknown";
  title?: string;
  projectId?: string;
  source?: string;
  layoutId?: string;
  sketchUpRef?: string;
  resourceRefs: string[];
  resourceRoots: string[];
  productIds: string[];
  pluginVersions: string[];
  clientVersions: string[];
  saveTimestamp?: string;
  maxLength?: number;
  startLocation?: DrsVector3;
  startRotation?: DrsRotation;
  floorCenter?: DrsVector3;
  roomCenters: DrsVector3[];
  floorReference?: {
    width: number;
    height: number;
    angle: number;
    url?: string;
  };
  issues: string[];
}

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_REFS = 500;
const MAX_PRODUCTS = 500;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown, max = 500) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function unique(values: readonly string[], max = Number.POSITIVE_INFINITY) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= max) break;
  }
  return result;
}

function normalizeResourceRef(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").trim();
}

function resourceRoot(value: string) {
  const normalized = normalizeResourceRef(value);
  return normalized.split("/").filter(Boolean)[0] ?? normalized;
}

function parseVector(value: unknown): DrsVector3 | undefined {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value.map((entry) =>
      typeof entry === "number" ? entry : Number(entry),
    );
    if ([x, y, z].every(Number.isFinite)) return { x, y, z };
  }

  const row = record(value);
  if (row) {
    const x = Number(row.x ?? row.X);
    const y = Number(row.y ?? row.Y);
    const z = Number(row.z ?? row.Z);
    if ([x, y, z].every(Number.isFinite)) return { x, y, z };
  }

  if (typeof value !== "string") return undefined;
  const match = value.match(
    /X\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*Y\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*Z\s*=\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (!match) return undefined;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function parseRotation(value: unknown): DrsRotation | undefined {
  const row = record(value);
  if (row) {
    const pitch = Number(row.pitch ?? row.P ?? row.p);
    const yaw = Number(row.yaw ?? row.Y ?? row.y);
    const roll = Number(row.roll ?? row.R ?? row.r);
    if ([pitch, yaw, roll].every(Number.isFinite))
      return { pitch, yaw, roll };
  }

  if (typeof value !== "string") return undefined;
  const match = value.match(
    /P\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*Y\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*R\s*=\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (!match) return undefined;
  return {
    pitch: Number(match[1]),
    yaw: Number(match[2]),
    roll: Number(match[3]),
  };
}

function parseNestedObject(value: unknown) {
  if (record(value)) return record(value);
  if (typeof value !== "string") return undefined;
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function versions(
  value: unknown,
  fields: readonly string[],
) {
  if (!Array.isArray(value)) return [];
  const rows: string[] = [];
  for (const entry of value) {
    const item = record(entry);
    if (!item) continue;
    for (const field of fields) {
      const candidate = text(item[field], 160);
      if (candidate) {
        rows.push(candidate);
        break;
      }
    }
  }
  return unique(rows, 50);
}

function stringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map(normalizeResourceRef),
    max,
  );
}

function genericResourceRefs(source: string) {
  return unique(
    [
      ...source.matchAll(
        /(?:[A-Za-z]:)?[^\s"'<>]+\.(?:png|jpe?g|webp|tiff?|bmp|exr|hdr|dds|ktx2|pak|fbx|obj|glb|gltf|skp|skb)/gi,
      ),
    ]
      .map((match) => normalizeResourceRef(match[0]))
      .filter(Boolean),
    MAX_RESOURCE_REFS,
  );
}

export function parseDrsMetadataText(source: string): DrsMetadataInspection {
  const base: DrsMetadataInspection = {
    json: false,
    format: "unknown",
    resourceRefs: [],
    resourceRoots: [],
    productIds: [],
    pluginVersions: [],
    clientVersions: [],
    roomCenters: [],
    issues: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {
      ...base,
      resourceRefs: genericResourceRefs(source),
      issues: ["Metadata file is not valid JSON; only literal resource paths were inspected."],
    };
  }

  const root = record(parsed);
  if (!root)
    return {
      ...base,
      json: true,
      format: "generic-json",
      resourceRefs: genericResourceRefs(source),
      issues: ["JSON metadata root is not an object."],
    };

  const d5 =
    Object.hasOwn(root, "dependent_pak_list") ||
    Object.hasOwn(root, "pak_URL") ||
    Object.hasOwn(root, "dccPluginsData") ||
    Object.hasOwn(root, "d5ClientVerData");

  const structuredRefs = stringArray(
    root.dependent_pak_list ?? root.dependent_resources,
    MAX_RESOURCE_REFS,
  );
  const literalRefs = genericResourceRefs(source);
  const sketchUpRef = text(root.pak_URL, 1000);
  const resourceRefs = unique(
    [
      ...structuredRefs,
      ...(sketchUpRef ? [normalizeResourceRef(sketchUpRef)] : []),
      ...literalRefs,
    ],
    MAX_RESOURCE_REFS,
  );
  const productIds = stringArray(root.dependent_products, MAX_PRODUCTS);

  const detail = parseNestedObject(root.detail_Info ?? root.detailInfo);
  const roomCenters = Array.isArray(detail?.room_centers ?? detail?.roomCenters)
    ? (detail?.room_centers ?? detail?.roomCenters as unknown[])
        .map(parseVector)
        .filter((entry): entry is DrsVector3 => Boolean(entry))
        .slice(0, 200)
    : [];

  const floorRefWidth = finite(root.floor_ref_width ?? root.floorRefWidth);
  const floorRefHeight = finite(root.floor_ref_height ?? root.floorRefHeight);
  const floorRefAngle = finite(root.floor_ref_angle ?? root.floorRefAngle);
  const floorRefUrl = text(root.floor_ref_url ?? root.floorRefUrl, 1000);
  const hasFloorReference =
    (floorRefWidth ?? 0) > 0 ||
    (floorRefHeight ?? 0) > 0 ||
    Math.abs(floorRefAngle ?? 0) > 1e-8 ||
    Boolean(floorRefUrl);

  return {
    ...base,
    json: true,
    format: d5 ? "d5-design" : "generic-json",
    ...(text(root.title, 300) ? { title: text(root.title, 300) } : {}),
    ...(text(root.id, 200) ? { projectId: text(root.id, 200) } : {}),
    ...(text(root.source, 200) ? { source: text(root.source, 200) } : {}),
    ...(text(root.layout_id ?? root.layoutId, 200)
      ? { layoutId: text(root.layout_id ?? root.layoutId, 200) }
      : {}),
    ...(sketchUpRef ? { sketchUpRef: normalizeResourceRef(sketchUpRef) } : {}),
    resourceRefs,
    resourceRoots: unique(resourceRefs.map(resourceRoot), 50),
    productIds,
    pluginVersions: versions(root.dccPluginsData, ["version", "name"]),
    clientVersions: versions(root.d5ClientVerData, ["version", "region"]),
    ...(text(root.saveTimeStamp ?? root.save_timestamp, 100)
      ? { saveTimestamp: text(root.saveTimeStamp ?? root.save_timestamp, 100) }
      : {}),
    ...(finite(detail?.max_length ?? detail?.maxLength) !== undefined
      ? { maxLength: finite(detail?.max_length ?? detail?.maxLength) }
      : {}),
    ...(parseVector(detail?.start_location ?? detail?.startLocation)
      ? {
          startLocation: parseVector(
            detail?.start_location ?? detail?.startLocation,
          ),
        }
      : {}),
    ...(parseRotation(detail?.start_rotation ?? detail?.startRotation)
      ? {
          startRotation: parseRotation(
            detail?.start_rotation ?? detail?.startRotation,
          ),
        }
      : {}),
    ...(parseVector(detail?.floor_center ?? detail?.floorCenter)
      ? {
          floorCenter: parseVector(
            detail?.floor_center ?? detail?.floorCenter,
          ),
        }
      : {}),
    roomCenters,
    ...(hasFloorReference
      ? {
          floorReference: {
            width: floorRefWidth ?? 0,
            height: floorRefHeight ?? 0,
            angle: floorRefAngle ?? 0,
            ...(floorRefUrl ? { url: floorRefUrl } : {}),
          },
        }
      : {}),
  };
}

export async function inspectDrsMetadata(
  asset: Asset,
): Promise<DrsMetadataInspection> {
  if (!/\.(?:drs|json)$/i.test(asset.name))
    return {
      json: false,
      format: "unknown",
      resourceRefs: [],
      resourceRoots: [],
      productIds: [],
      pluginVersions: [],
      clientVersions: [],
      roomCenters: [],
      issues: ["Choose a DRS/JSON metadata source first."],
    };
  if (asset.size > MAX_METADATA_BYTES)
    return {
      json: false,
      format: "unknown",
      resourceRefs: [],
      resourceRoots: [],
      productIds: [],
      pluginVersions: [],
      clientVersions: [],
      roomCenters: [],
      issues: ["Metadata source exceeds the 8 MB inspection safety limit."],
    };
  return parseDrsMetadataText(await asset.blob.text());
}
