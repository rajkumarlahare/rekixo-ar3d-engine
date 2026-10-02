import type { Asset } from "./domain";

export type DrsResourceRole =
  | "basecolor"
  | "normal"
  | "height"
  | "roughness"
  | "metalness"
  | "ambientOcclusion"
  | "emissive"
  | "opacity"
  | "texture"
  | "model"
  | "package"
  | "binary"
  | "other";

export interface DrsResourceReference {
  path: string;
  role: DrsResourceRole;
  extension: string;
  group?: string;
}

export interface DrsPoint3 {
  x: number;
  y: number;
  z: number;
}

export interface DrsSceneInspection {
  json: boolean;
  title?: string;
  source?: string;
  pakUrl?: string;
  designFileUrl?: string;
  pluginVersions: string[];
  clientVersions: string[];
  dependentProducts: string[];
  resources: DrsResourceReference[];
  uniqueResourceCount: number;
  roomCenters: DrsPoint3[];
  floorCenter?: DrsPoint3;
  startLocation?: DrsPoint3;
  maxLength?: number;
  issues: string[];
}

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_REFS = 5000;
const MAX_PRODUCT_IDS = 5000;

function clean(value: unknown, max = 500) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
}

function extension(path: string) {
  const match = path.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] ?? "";
}

function basename(path: string) {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

function groupName(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0] : undefined;
}

export function classifyDrsResourceRole(path: string): DrsResourceRole {
  const lower = basename(path).toLowerCase();
  const ext = extension(path);
  if (/normal|(?:^|[_ -])nrm(?:[_ .-]|$)/.test(lower)) return "normal";
  if (/bump|height|displace(?:ment)?/.test(lower)) return "height";
  if (/rough/.test(lower)) return "roughness";
  if (/metalness|metallic/.test(lower)) return "metalness";
  if (
    /ambient.?occlusion|occlusion|(?:^|[_ -])ao(?:[_ .-]|$)/.test(lower)
  )
    return "ambientOcclusion";
  if (/emissive|emission|glow/.test(lower)) return "emissive";
  if (/opacity|alpha|transparen/.test(lower)) return "opacity";
  if (/base.?color|diffuse|albedo|(?:^|[_ -])color(?:[_ .-]|$)/.test(lower))
    return "basecolor";
  if (["fbx", "obj", "glb", "gltf", "skp", "skb"].includes(ext))
    return "model";
  if (ext === "pak") return "package";
  if (ext === "bin") return "binary";
  if (
    [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "bmp",
      "tif",
      "tiff",
      "exr",
      "hdr",
      "dds",
      "ktx2",
    ].includes(ext)
  )
    return "texture";
  return "other";
}

function resourceReference(path: string): DrsResourceReference {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return {
    path: normalized,
    role: classifyDrsResourceRole(normalized),
    extension: extension(normalized),
    ...(groupName(normalized) ? { group: groupName(normalized) } : {}),
  };
}

function parsePoint(value: unknown): DrsPoint3 | undefined {
  if (typeof value !== "string") return undefined;
  const x = value.match(/(?:^|[,\s])X\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const y = value.match(/(?:^|[,\s])Y\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const z = value.match(/(?:^|[,\s])Z\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (!x || !y || !z) return undefined;
  const point = {
    x: Number.parseFloat(x[1]),
    y: Number.parseFloat(y[1]),
    z: Number.parseFloat(z[1]),
  };
  return [point.x, point.y, point.z].every(Number.isFinite)
    ? point
    : undefined;
}

function parseDetailInfo(value: unknown) {
  let detail = object(value);
  if (!detail && typeof value === "string") {
    try {
      detail = object(JSON.parse(value));
    } catch {
      detail = undefined;
    }
  }
  if (!detail)
    return {
      roomCenters: [] as DrsPoint3[],
      issues: [] as string[],
    };

  const roomCenters = Array.isArray(detail.room_centers)
    ? detail.room_centers
        .map(parsePoint)
        .filter((entry): entry is DrsPoint3 => Boolean(entry))
        .slice(0, 500)
    : [];
  const maxLength =
    typeof detail.max_length === "number" && Number.isFinite(detail.max_length)
      ? detail.max_length
      : undefined;

  return {
    startLocation: parsePoint(detail.start_location),
    floorCenter: parsePoint(detail.floor_center),
    roomCenters,
    maxLength,
    issues: [] as string[],
  };
}

function versionRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((entry) => {
          const row = object(entry);
          return clean(row?.version, 120) ?? clean(row?.name, 120) ?? clean(row?.region, 120);
        })
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ].slice(0, 50);
}

function collectLiteralResourceRefs(
  value: unknown,
  output: string[],
  depth = 0,
) {
  if (output.length >= MAX_RESOURCE_REFS || depth > 6) return;
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /(?:[A-Za-z]:)?[^\s"'<>]+\.(?:png|jpe?g|webp|bmp|tiff?|exr|hdr|dds|ktx2|fbx|obj|glb|gltf|skp|skb|pak|bin)/gi,
    )) {
      output.push(match[0].replaceAll("\\", "/"));
      if (output.length >= MAX_RESOURCE_REFS) break;
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLiteralResourceRefs(entry, output, depth + 1);
      if (output.length >= MAX_RESOURCE_REFS) break;
    }
    return;
  }
  const row = object(value);
  if (!row) return;
  for (const entry of Object.values(row)) {
    collectLiteralResourceRefs(entry, output, depth + 1);
    if (output.length >= MAX_RESOURCE_REFS) break;
  }
}

function resourceStrings(root: Record<string, unknown>) {
  const direct = stringArray(root.dependent_pak_list, MAX_RESOURCE_REFS);
  const extra = stringArray(root.dependent_resources, MAX_RESOURCE_REFS);
  const pak = clean(root.pak_URL, 1000);
  const design = clean(root.design_File_URL, 1000);
  const literal: string[] = [];
  collectLiteralResourceRefs(root, literal);
  return [
    ...direct,
    ...extra,
    ...(pak ? [pak] : []),
    ...(design ? [design] : []),
    ...literal,
  ]
    .filter((entry) => /[\\/]|\.[a-z0-9]{1,8}$/i.test(entry))
    .slice(0, MAX_RESOURCE_REFS);
}

export async function inspectDrsMetadata(
  asset: Asset,
): Promise<DrsSceneInspection> {
  const base: DrsSceneInspection = {
    json: false,
    pluginVersions: [],
    clientVersions: [],
    dependentProducts: [],
    resources: [],
    uniqueResourceCount: 0,
    roomCenters: [],
    issues: [],
  };
  if (!/\.(?:drs|json)$/i.test(asset.name)) return base;
  if (asset.size > MAX_METADATA_BYTES) {
    base.issues.push("Render metadata exceeds the 8 MB safe inspection limit.");
    return base;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await asset.blob.text());
  } catch {
    base.issues.push("Render metadata is not valid JSON.");
    return base;
  }
  const root = object(parsed);
  if (!root) {
    base.issues.push("Render metadata root must be a JSON object.");
    return base;
  }

  const detail = parseDetailInfo(root.detail_Info);
  const resources = resourceStrings(root).map(resourceReference);
  const uniqueResources = [
    ...new Map(resources.map((entry) => [entry.path.toLowerCase(), entry])).values(),
  ];

  return {
    json: true,
    ...(clean(root.title, 300) ? { title: clean(root.title, 300) } : {}),
    ...(clean(root.source, 120) ? { source: clean(root.source, 120) } : {}),
    ...(clean(root.pak_URL, 1000) ? { pakUrl: clean(root.pak_URL, 1000) } : {}),
    ...(clean(root.design_File_URL, 1000)
      ? { designFileUrl: clean(root.design_File_URL, 1000) }
      : {}),
    pluginVersions: versionRows(root.dccPluginsData),
    clientVersions: versionRows(root.d5ClientVerData),
    dependentProducts: [
      ...new Set(stringArray(root.dependent_products, MAX_PRODUCT_IDS)),
    ],
    resources: uniqueResources,
    uniqueResourceCount: uniqueResources.length,
    roomCenters: detail.roomCenters,
    ...(detail.floorCenter ? { floorCenter: detail.floorCenter } : {}),
    ...(detail.startLocation ? { startLocation: detail.startLocation } : {}),
    ...(detail.maxLength !== undefined ? { maxLength: detail.maxLength } : {}),
    issues: detail.issues,
  };
}
