export const SOURCE_PACK_REVIEW_VERSION = "source-pack-review-v1";

export const SOURCE_PACK_ROLES = Object.freeze([
  "geometry-authority",
  "material-recovery",
  "evidence",
  "content-reference",
  "presentation-reference",
]);

export const SOURCE_PACK_CAPABILITIES = Object.freeze([
  "geometry",
  "materials",
  "textures",
  "authoring-history",
  "dimensions",
  "floor-plan",
  "render-dependencies",
  "marketing",
  "location-context",
  "visual-style",
]);

const ROLE_SET = new Set(SOURCE_PACK_ROLES);
const CAPABILITY_SET = new Set(SOURCE_PACK_CAPABILITIES);

function cleanArray(value, allowed, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const output = [];
  for (const item of value) {
    if (typeof item !== "string" || !allowed.has(item))
      throw new Error(`Unsupported ${label} value.`);
    if (!output.includes(item)) output.push(item);
  }
  return output.sort();
}

export function normalizeSourcePackReviewFiles(files) {
  if (!Array.isArray(files) || files.length === 0)
    throw new Error("Source pack review requires at least one file.");

  const ids = new Set();
  const normalized = files.map((item) => {
    const sourceFileId = typeof item?.sourceFileId === "string" ? item.sourceFileId.trim() : "";
    if (!sourceFileId) throw new Error("Every source pack file requires sourceFileId.");
    if (ids.has(sourceFileId)) throw new Error("Duplicate source file in source pack review.");
    ids.add(sourceFileId);

    const roles = cleanArray(item.roles, ROLE_SET, "role");
    const capabilities = cleanArray(item.capabilities, CAPABILITY_SET, "capability");
    const notes = item.notes == null ? null : String(item.notes).trim();
    if (notes && notes.length > 1000) throw new Error("Source pack notes are too long.");

    return {
      sourceFileId,
      roles,
      capabilities,
      notes: notes || null,
    };
  });

  const authorities = normalized.filter((item) => item.roles.includes("geometry-authority"));
  if (authorities.length !== 1)
    throw new Error("Exactly one geometry authority must be selected before saving review.");
  if (!authorities[0].capabilities.includes("geometry"))
    throw new Error("Geometry authority must be a geometry-capable source file.");

  return normalized.sort((a, b) => a.sourceFileId.localeCompare(b.sourceFileId));
}

export function sourcePackReviewReadiness({ verifiedSourceIds, files }) {
  const verified = new Set(verifiedSourceIds || []);
  const reviewed = new Set((files || []).map((item) => item.sourceFileId));
  const authorities = (files || []).filter((item) =>
    Array.isArray(item.roles) && item.roles.includes("geometry-authority"),
  );
  const authorityHasGeometry =
    authorities.length === 1 &&
    Array.isArray(authorities[0].capabilities) &&
    authorities[0].capabilities.includes("geometry");
  const missingSourceIds = [...verified].filter((id) => !reviewed.has(id)).sort();
  const staleSourceIds = [...reviewed].filter((id) => !verified.has(id)).sort();
  const geometryAuthorityFileId = authorityHasGeometry ? authorities[0].sourceFileId : null;

  return {
    ready:
      verified.size > 0 &&
      missingSourceIds.length === 0 &&
      staleSourceIds.length === 0 &&
      authorities.length === 1 &&
      authorityHasGeometry,
    verifiedSourceCount: verified.size,
    reviewedSourceCount: reviewed.size,
    geometryAuthorityFileId,
    missingSourceIds,
    staleSourceIds,
  };
}

export function canonicalSourcePackManifest({
  project,
  pack,
  geometryAuthorityFileId,
  files,
}) {
  const manifest = {
    schema: SOURCE_PACK_REVIEW_VERSION,
    project: {
      id: String(project.id),
      slug: String(project.slug),
    },
    sourcePack: {
      id: String(pack.id),
      version: Number(pack.version),
    },
    geometryAuthorityFileId: String(geometryAuthorityFileId),
    files: [...files]
      .map((item) => ({
        sourceFileId: String(item.sourceFileId),
        filename: String(item.filename),
        mediaType: String(item.mediaType),
        byteSize: Number(item.byteSize),
        sha256: String(item.sha256).toLowerCase(),
        roles: [...item.roles].sort(),
        capabilities: [...item.capabilities].sort(),
        classificationOrigin: String(item.classificationOrigin),
        classificationConfidence: Number(item.classificationConfidence),
        notes: item.notes || null,
      }))
      .sort((a, b) => a.sourceFileId.localeCompare(b.sourceFileId)),
  };
  return JSON.stringify(manifest);
}
