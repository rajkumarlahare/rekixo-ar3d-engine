import { validProjectSlug } from "../shared/project-slug-policy.js";

export const SOURCE_UPLOAD_PART_SIZE = 16 * 1024 * 1024;
export const SOURCE_UPLOAD_MAX_PARTS = 10_000;
export const SOURCE_UPLOAD_MAX_BYTES =
  SOURCE_UPLOAD_PART_SIZE * SOURCE_UPLOAD_MAX_PARTS;

export function validSourceIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

export function validSourceSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function sourceFileKey(slug, sourceFileId, sha256) {
  if (
    !validProjectSlug(slug) ||
    !validSourceIdentity(sourceFileId) ||
    !validSourceSha256(sha256)
  )
    throw Error("Invalid Source Pack V2 storage identity.");
  return `projects/${slug}/source-files/${sourceFileId}/${sha256}`;
}

export function sourcePartPlan(byteSize, partSize = SOURCE_UPLOAD_PART_SIZE) {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0)
    throw Error("Source file byte size must be a positive safe integer.");
  if (
    !Number.isSafeInteger(partSize) ||
    partSize < 5 * 1024 * 1024 ||
    partSize > 5 * 1024 * 1024 * 1024
  )
    throw Error("Invalid multipart part size.");
  const partCount = Math.ceil(byteSize / partSize);
  if (partCount > SOURCE_UPLOAD_MAX_PARTS)
    throw Error("Source file requires more than 10,000 multipart parts.");
  return { partSize, partCount };
}

export function expectedSourcePartSize(byteSize, partSize, partNumber) {
  const { partCount } = sourcePartPlan(byteSize, partSize);
  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > partCount
  )
    throw Error("Invalid multipart part number.");
  if (partNumber < partCount) return partSize;
  return byteSize - partSize * (partCount - 1);
}
