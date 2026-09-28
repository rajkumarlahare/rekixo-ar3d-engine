export const SOURCE_PACK_FORMAT = "rekixo-source-pack" as const;
export const SOURCE_PACK_VERSION = 1 as const;

export type SourceCapabilityV1 =
  | "geometry"
  | "dimensions"
  | "openings"
  | "materials"
  | "visual-style"
  | "marketing"
  | "location-context"
  | "render-dependencies"
  | "authoring-history";

export type SourceAuthorityV1 =
  | "primary"
  | "supporting"
  | "reference-only"
  | "metadata-only";

export type SourceClaimStatusV1 =
  | "source-stated"
  | "derived"
  | "reconstructed"
  | "conflicted";

export type SourceClaimValueV1 =
  | string
  | number
  | boolean
  | string[]
  | number[];

export interface ProjectSourceV1 {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  role: string;
  authority: SourceAuthorityV1;
  capabilities: SourceCapabilityV1[];
  notes?: string;
}

export interface SourcePrecedenceRuleV1 {
  capability: SourceCapabilityV1;
  orderedSourceIds: string[];
  note?: string;
}

export interface SourceClaimV1 {
  id: string;
  sourceId: string;
  key: string;
  value: SourceClaimValueV1;
  status: SourceClaimStatusV1;
  page?: number;
  note?: string;
}

export interface ProjectSourcePackV1 {
  format: typeof SOURCE_PACK_FORMAT;
  version: typeof SOURCE_PACK_VERSION;
  project: {
    id: string;
    slug: string;
    name: string;
  };
  sources: ProjectSourceV1[];
  precedence: SourcePrecedenceRuleV1[];
  claims: SourceClaimV1[];
}

const CAPABILITIES = new Set<SourceCapabilityV1>([
  "geometry",
  "dimensions",
  "openings",
  "materials",
  "visual-style",
  "marketing",
  "location-context",
  "render-dependencies",
  "authoring-history",
]);

const AUTHORITIES = new Set<SourceAuthorityV1>([
  "primary",
  "supporting",
  "reference-only",
  "metadata-only",
]);

const CLAIM_STATUSES = new Set<SourceClaimStatusV1>([
  "source-stated",
  "derived",
  "reconstructed",
  "conflicted",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isText = (value: unknown, max = 1000) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max;

const isFiniteNumber = (value: unknown, min = -1e15, max = 1e15) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

const hasUniqueIds = (items: unknown[]) => {
  const ids = new Set<string>();
  for (const item of items) {
    if (!isObject(item) || !isText(item.id, 200)) return false;
    const id = item.id as string;
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
};

function validClaimValue(value: unknown): value is SourceClaimValueV1 {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return true;

  if (!Array.isArray(value) || value.length > 500) return false;
  if (!value.length) return true;

  if (value.every((item) => typeof item === "string" && item.length <= 2000))
    return true;
  if (value.every((item) => typeof item === "number" && Number.isFinite(item)))
    return true;
  return false;
}

export function assertProjectSourcePackV1(
  value: unknown,
): asserts value is ProjectSourcePackV1 {
  if (!isObject(value)) throw Error("Source pack must be an object.");
  if (
    value.format !== SOURCE_PACK_FORMAT ||
    value.version !== SOURCE_PACK_VERSION
  )
    throw Error("Unsupported source pack version.");

  const project = value.project;
  if (
    !isObject(project) ||
    !isText(project.id, 200) ||
    !isText(project.name, 300) ||
    !isText(project.slug, 100) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug as string)
  )
    throw Error("Invalid source pack project.");

  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 500 ||
    !hasUniqueIds(value.sources)
  )
    throw Error("Invalid source list.");
  if (
    !Array.isArray(value.precedence) ||
    value.precedence.length > 100 ||
    !Array.isArray(value.claims) ||
    value.claims.length > 10000 ||
    !hasUniqueIds(value.claims)
  )
    throw Error("Invalid source pack rules or claims.");

  const sourceIds = new Set<string>();

  for (const item of value.sources) {
    if (!isObject(item)) throw Error("Invalid source item.");
    if (
      !isText(item.id, 200) ||
      !isText(item.filename, 500) ||
      typeof item.mediaType !== "string" ||
      item.mediaType.length > 300 ||
      !isFiniteNumber(item.byteSize, 0, 1024 ** 4) ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(item.sha256) ||
      !isText(item.role, 200) ||
      !AUTHORITIES.has(item.authority as SourceAuthorityV1) ||
      !Array.isArray(item.capabilities) ||
      !item.capabilities.length ||
      item.capabilities.length > CAPABILITIES.size ||
      new Set(item.capabilities as unknown[]).size !== item.capabilities.length ||
      item.capabilities.some(
        (capability) => !CAPABILITIES.has(capability as SourceCapabilityV1),
      ) ||
      (item.notes !== undefined &&
        (typeof item.notes !== "string" || item.notes.length > 5000))
    )
      throw Error("Invalid source item.");
    sourceIds.add(item.id as string);
  }

  const precedenceCapabilities = new Set<string>();
  for (const item of value.precedence) {
    if (
      !isObject(item) ||
      !CAPABILITIES.has(item.capability as SourceCapabilityV1) ||
      precedenceCapabilities.has(item.capability as string) ||
      !Array.isArray(item.orderedSourceIds) ||
      !item.orderedSourceIds.length ||
      new Set(item.orderedSourceIds as unknown[]).size !==
        item.orderedSourceIds.length ||
      item.orderedSourceIds.some((id) => !sourceIds.has(id as string)) ||
      (item.note !== undefined &&
        (typeof item.note !== "string" || item.note.length > 5000))
    )
      throw Error("Invalid source precedence rule.");
    precedenceCapabilities.add(item.capability as string);
  }

  for (const item of value.claims) {
    if (
      !isObject(item) ||
      !isText(item.id, 200) ||
      !sourceIds.has(item.sourceId as string) ||
      !isText(item.key, 500) ||
      !validClaimValue(item.value) ||
      !CLAIM_STATUSES.has(item.status as SourceClaimStatusV1) ||
      (item.page !== undefined &&
        (!Number.isInteger(item.page) || (item.page as number) < 1)) ||
      (item.note !== undefined &&
        (typeof item.note !== "string" || item.note.length > 5000))
    )
      throw Error("Invalid source claim.");
  }
}
