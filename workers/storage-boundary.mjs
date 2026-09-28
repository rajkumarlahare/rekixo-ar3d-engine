const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function projectAssetPrefix(slug) {
  if (typeof slug !== "string" || !VALID_SLUG.test(slug))
    throw Error("Invalid project slug for storage boundary.");
  return `projects/${slug}/`;
}

export function assertProjectAssetKey(slug, key, area) {
  const prefix = projectAssetPrefix(slug);
  if (typeof key !== "string" || !key.startsWith(prefix))
    throw Error("Project asset key escapes its project storage prefix.");
  const relative = key.slice(prefix.length);
  const segments = relative.split("/");
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.includes("\\") ||
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  )
    throw Error("Invalid project asset key.");
  if (area && segments[0] !== area)
    throw Error(`Project asset key is outside the ${area} prefix.`);
  return key;
}

export function assertDraftAssetKey(slug, assetId, key) {
  if (typeof assetId !== "string" || !VALID_SEGMENT.test(assetId))
    throw Error("Invalid draft asset ID.");
  const expected = `${projectAssetPrefix(slug)}draft-assets/${assetId}`;
  if (key !== expected)
    throw Error("Draft asset key does not match project ownership.");
  return key;
}

export function assertReleaseAssetKey(
  slug,
  releaseId,
  kind,
  logicalId,
  key,
) {
  if (
    typeof releaseId !== "string" ||
    !VALID_SEGMENT.test(releaseId) ||
    !["model", "media", "studio"].includes(kind) ||
    typeof logicalId !== "string" ||
    !logicalId ||
    logicalId.includes("/") ||
    logicalId.includes("\\")
  )
    throw Error("Invalid immutable release asset identity.");

  const folder =
    kind === "model" ? "models" : kind === "media" ? "media" : "studio";
  const expected =
    `${projectAssetPrefix(slug)}releases/${releaseId}/${folder}/${logicalId}`;
  if (key !== expected)
    throw Error("Immutable release asset key does not match release ownership.");
  return key;
}
