import type { Asset, Project } from "./domain";

export const GOLDEN_SOURCE_ROLES = [
  "model",
  "cad",
  "sketchup",
  "drawing",
  "visual",
  "metadata",
] as const;

export type GoldenSourceRole = (typeof GOLDEN_SOURCE_ROLES)[number];

export interface GoldenSourceExpectation {
  role: GoldenSourceRole;
  sha256: string;
  size: number;
  fileName?: string;
  required?: boolean;
}

export interface GoldenSourceManifest {
  schema: 1;
  key: string;
  sources: GoldenSourceExpectation[];
}

export type GoldenSourceVerificationState =
  | "matched"
  | "missing"
  | "ambiguous"
  | "hash-mismatch"
  | "size-mismatch"
  | "project-mismatch"
  | "format-mismatch";

export interface GoldenSourceVerificationEntry {
  expectation: GoldenSourceExpectation;
  state: GoldenSourceVerificationState;
  assetId?: string;
  actualName?: string;
  detail: string;
}

export interface GoldenSourceVerificationReport {
  manifestKey: string;
  requiredCount: number;
  matchedRequiredCount: number;
  complete: boolean;
  entries: GoldenSourceVerificationEntry[];
  blockers: string[];
  untrackedAssetIds: string[];
}

const SHA256 = /^[a-f0-9]{64}$/i;

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function assetMatchesGoldenRole(asset: Pick<Asset, "name">, role: GoldenSourceRole) {
  const ext = extension(asset.name);
  if (role === "model") return ext === "fbx" || ext === "glb";
  if (role === "cad") return ext === "dwg" || ext === "dxf";
  if (role === "sketchup") return ext === "skp" || ext === "skb";
  if (role === "drawing") return ext === "pdf";
  if (role === "visual")
    return ["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"].includes(ext);
  return ext === "drs" || ext === "json";
}

function normalizeExpectation(expectation: GoldenSourceExpectation) {
  return {
    ...expectation,
    sha256: expectation.sha256.trim().toLowerCase(),
    fileName: expectation.fileName?.trim() || undefined,
    required: expectation.required ?? true,
  };
}

export function validateGoldenSourceManifest(manifest: GoldenSourceManifest) {
  const issues: string[] = [];
  if (manifest.schema !== 1) issues.push("Golden source manifest schema must be 1.");
  if (!manifest.key.trim()) issues.push("Golden source manifest key is required.");
  const seenRoles = new Set<GoldenSourceRole>();
  const seenHashes = new Set<string>();
  for (const raw of manifest.sources) {
    const source = normalizeExpectation(raw);
    if (!GOLDEN_SOURCE_ROLES.includes(source.role))
      issues.push(`Unsupported golden source role: ${String(source.role)}.`);
    if (seenRoles.has(source.role))
      issues.push(`Golden source role ${source.role} is duplicated.`);
    seenRoles.add(source.role);
    if (!SHA256.test(source.sha256))
      issues.push(`Golden source ${source.role} has an invalid SHA-256 fingerprint.`);
    if (!Number.isSafeInteger(source.size) || source.size <= 0)
      issues.push(`Golden source ${source.role} must record a positive byte size.`);
    if (seenHashes.has(source.sha256))
      issues.push(`Golden source SHA-256 is duplicated for role ${source.role}.`);
    seenHashes.add(source.sha256);
  }
  for (const role of GOLDEN_SOURCE_ROLES)
    if (!seenRoles.has(role)) issues.push(`Golden source role ${role} is missing.`);
  return issues;
}

export function buildGoldenSourceManifest(
  key: string,
  assignments: Record<GoldenSourceRole, Pick<Asset, "name" | "size" | "hash">>,
): GoldenSourceManifest {
  const manifest: GoldenSourceManifest = {
    schema: 1,
    key: key.trim(),
    sources: GOLDEN_SOURCE_ROLES.map((role) => ({
      role,
      fileName: assignments[role].name,
      sha256: assignments[role].hash.trim().toLowerCase(),
      size: assignments[role].size,
      required: true,
    })),
  };
  const issues = validateGoldenSourceManifest(manifest);
  if (issues.length) throw Error(issues.join(" "));
  return manifest;
}

function entry(
  expectation: GoldenSourceExpectation,
  state: GoldenSourceVerificationState,
  detail: string,
  asset?: Asset,
): GoldenSourceVerificationEntry {
  return {
    expectation,
    state,
    detail,
    ...(asset ? { assetId: asset.id, actualName: asset.name } : {}),
  };
}

export function verifyGoldenSourceManifest(
  project: Pick<Project, "id">,
  files: readonly Asset[],
  manifest: GoldenSourceManifest,
): GoldenSourceVerificationReport {
  const manifestIssues = validateGoldenSourceManifest(manifest);
  if (manifestIssues.length)
    throw Error(`Invalid golden source manifest: ${manifestIssues.join(" ")}`);

  const entries = manifest.sources.map((rawExpectation) => {
    const expectation = normalizeExpectation(rawExpectation);
    const hashMatches = files.filter(
      (file) => file.hash.trim().toLowerCase() === expectation.sha256,
    );
    const projectHashMatches = hashMatches.filter(
      (file) => file.projectId === project.id,
    );

    if (projectHashMatches.length > 1)
      return entry(
        expectation,
        "ambiguous",
        `More than one project asset has the expected ${expectation.role} fingerprint.`,
      );

    if (projectHashMatches.length === 1) {
      const asset = projectHashMatches[0];
      if (asset.size !== expectation.size || asset.blob.size !== expectation.size)
        return entry(
          expectation,
          "size-mismatch",
          `SHA-256 matched, but expected ${expectation.size} bytes and found asset/blob sizes ${asset.size}/${asset.blob.size}.`,
          asset,
        );
      if (!assetMatchesGoldenRole(asset, expectation.role))
        return entry(
          expectation,
          "format-mismatch",
          `Fingerprint matched, but ${asset.name} is not a valid ${expectation.role} source format.`,
          asset,
        );
      return entry(
        expectation,
        "matched",
        expectation.fileName && expectation.fileName !== asset.name
          ? `Fingerprint and byte size matched. Source was renamed from ${expectation.fileName} to ${asset.name}.`
          : "Fingerprint, byte size, project ownership and source role matched.",
        asset,
      );
    }

    if (hashMatches.length)
      return entry(
        expectation,
        "project-mismatch",
        `Expected ${expectation.role} fingerprint exists, but not under project ${project.id}.`,
        hashMatches[0],
      );

    const roleCandidates = files.filter(
      (file) => file.projectId === project.id && assetMatchesGoldenRole(file, expectation.role),
    );
    const namedCandidate = expectation.fileName
      ? roleCandidates.find((file) => file.name === expectation.fileName)
      : undefined;
    const candidate = namedCandidate ?? (roleCandidates.length === 1 ? roleCandidates[0] : undefined);

    if (!candidate && roleCandidates.length > 1)
      return entry(
        expectation,
        "ambiguous",
        `${roleCandidates.length} ${expectation.role} candidates exist, but none matches the recorded fingerprint.`,
      );
    if (!candidate)
      return entry(
        expectation,
        "missing",
        `Expected ${expectation.role} source is not attached to this project.`,
      );
    if (candidate.size !== expectation.size || candidate.blob.size !== expectation.size)
      return entry(
        expectation,
        "size-mismatch",
        `Expected ${expectation.size} bytes for ${expectation.role}, found ${candidate.size}/${candidate.blob.size}.`,
        candidate,
      );
    return entry(
      expectation,
      "hash-mismatch",
      `Expected SHA-256 ${expectation.sha256}, found ${candidate.hash.toLowerCase()}.`,
      candidate,
    );
  });

  const matchedAssetIds = new Set(
    entries
      .filter((candidate) => candidate.state === "matched" && candidate.assetId)
      .map((candidate) => candidate.assetId!),
  );
  const required = entries.filter((candidate) => candidate.expectation.required ?? true);
  const matchedRequired = required.filter((candidate) => candidate.state === "matched");
  const blockers = required
    .filter((candidate) => candidate.state !== "matched")
    .map((candidate) => `${candidate.expectation.role}: ${candidate.detail}`);

  return {
    manifestKey: manifest.key,
    requiredCount: required.length,
    matchedRequiredCount: matchedRequired.length,
    complete: blockers.length === 0,
    entries,
    blockers,
    untrackedAssetIds: files
      .filter((file) => !matchedAssetIds.has(file.id))
      .map((file) => file.id),
  };
}
