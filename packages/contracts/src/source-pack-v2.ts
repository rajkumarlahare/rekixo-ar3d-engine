export const SOURCE_PACK_V2_FORMAT = "rekixo-source-pack" as const;
export const SOURCE_PACK_V2_VERSION = 2 as const;

/**
 * V2 separates geometry authority from evidence and presentation inputs.
 * Exactly one file establishes Building geometry. Supporting files may improve
 * material recovery, confidence, content or visual presentation, but they never
 * silently reconstruct/replace the authority geometry.
 */
export type SourceRoleV2 =
  | "geometry-authority"
  | "material-recovery"
  | "evidence"
  | "presentation-reference"
  | "content-reference";

export type SourceClassificationOriginV2 = "automatic" | "operator";

export type SourceCapabilityV2 =
  | "geometry"
  | "dimensions"
  | "materials"
  | "textures"
  | "floor-plan"
  | "visual-style"
  | "marketing"
  | "location-context"
  | "render-dependencies"
  | "authoring-history";

export interface ProjectSourceFileV2 {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  roles: SourceRoleV2[];
  capabilities: SourceCapabilityV2[];
  classification: {
    origin: SourceClassificationOriginV2;
    confidence: number;
  };
  notes?: string;
}

export interface ProjectSourcePackV2 {
  format: typeof SOURCE_PACK_V2_FORMAT;
  version: typeof SOURCE_PACK_V2_VERSION;
  project: {
    id: string;
    slug: string;
    name: string;
  };
  /** The one immutable original whose geometry becomes canonical Building truth. */
  geometryAuthorityFileId: string;
  sources: ProjectSourceFileV2[];
  /** Operator approval is required before the pack may enter durable processing. */
  operatorApproved: boolean;
}

const ROLES = new Set<SourceRoleV2>([
  "geometry-authority",
  "material-recovery",
  "evidence",
  "presentation-reference",
  "content-reference",
]);

const CAPABILITIES = new Set<SourceCapabilityV2>([
  "geometry",
  "dimensions",
  "materials",
  "textures",
  "floor-plan",
  "visual-style",
  "marketing",
  "location-context",
  "render-dependencies",
  "authoring-history",
]);

const ORIGINS = new Set<SourceClassificationOriginV2>([
  "automatic",
  "operator",
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isText = (value: unknown, max = 1000) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

function validPortableRelativeFilename(value: unknown) {
  if (!isText(value, 500)) return false;
  const filename = value as string;
  if (
    filename.includes("\0") ||
    filename.includes("\\") ||
    filename.startsWith("/") ||
    /^[A-Za-z]:/.test(filename)
  )
    return false;
  const segments = filename.split("/");
  return (
    segments.length <= 32 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment.length <= 240,
    )
  );
}

function uniqueStrings(values: unknown[], max: number) {
  return (
    values.length <= max &&
    values.every((value) => typeof value === "string") &&
    new Set(values).size === values.length
  );
}

export function assertProjectSourcePackV2(
  value: unknown,
): asserts value is ProjectSourcePackV2 {
  if (!isObject(value)) throw Error("Source pack V2 must be an object.");
  if (
    value.format !== SOURCE_PACK_V2_FORMAT ||
    value.version !== SOURCE_PACK_V2_VERSION
  )
    throw Error("Unsupported source pack V2 version.");

  const project = value.project;
  if (
    !isObject(project) ||
    !isText(project.id, 200) ||
    !isText(project.name, 300) ||
    !isText(project.slug, 100) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug as string)
  )
    throw Error("Invalid source pack V2 project.");

  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 500 ||
    !isText(value.geometryAuthorityFileId, 200) ||
    typeof value.operatorApproved !== "boolean"
  )
    throw Error("Invalid source pack V2 structure.");

  const ids = new Set<string>();
  let geometryAuthorityCount = 0;
  let declaredAuthorityFound = false;

  for (const item of value.sources) {
    if (!isObject(item) || !isText(item.id, 200))
      throw Error("Invalid source pack V2 file.");
    const id = item.id as string;
    if (ids.has(id)) throw Error("Source pack V2 file IDs must be unique.");
    ids.add(id);

    if (
      !validPortableRelativeFilename(item.filename) ||
      typeof item.mediaType !== "string" ||
      item.mediaType.length > 300 ||
      typeof item.byteSize !== "number" ||
      !Number.isFinite(item.byteSize) ||
      item.byteSize < 0 ||
      item.byteSize > 1024 ** 4 ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(item.sha256) ||
      !Array.isArray(item.roles) ||
      !item.roles.length ||
      !uniqueStrings(item.roles, ROLES.size) ||
      item.roles.some((role) => !ROLES.has(role as SourceRoleV2)) ||
      !Array.isArray(item.capabilities) ||
      !item.capabilities.length ||
      !uniqueStrings(item.capabilities, CAPABILITIES.size) ||
      item.capabilities.some(
        (capability) => !CAPABILITIES.has(capability as SourceCapabilityV2),
      ) ||
      !isObject(item.classification) ||
      !ORIGINS.has(
        item.classification.origin as SourceClassificationOriginV2,
      ) ||
      typeof item.classification.confidence !== "number" ||
      !Number.isFinite(item.classification.confidence) ||
      item.classification.confidence < 0 ||
      item.classification.confidence > 1 ||
      (item.notes !== undefined &&
        (typeof item.notes !== "string" || item.notes.length > 5000))
    )
      throw Error("Invalid source pack V2 file.");

    const roles = item.roles as SourceRoleV2[];
    const capabilities = item.capabilities as SourceCapabilityV2[];
    if (roles.includes("geometry-authority")) {
      geometryAuthorityCount += 1;
      if (!capabilities.includes("geometry"))
        throw Error("Geometry authority must declare geometry capability.");
      if (id === value.geometryAuthorityFileId) declaredAuthorityFound = true;
    }
  }

  if (geometryAuthorityCount !== 1 || !declaredAuthorityFound)
    throw Error(
      "Source pack V2 must contain exactly one declared geometry authority.",
    );

  if (!ids.has(value.geometryAuthorityFileId as string))
    throw Error("Source pack V2 geometry authority file is missing.");
}
