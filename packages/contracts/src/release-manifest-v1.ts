import {
  assertBuildingPresentationManifestV1,
  type BuildingPresentationManifestV1,
} from "./building-presentation-manifest-v1";

export type ReleaseAssetKindV1 = "model" | "media" | "studio";

export interface ReleaseAssetV1 {
  id: string;
  kind: ReleaseAssetKindV1;
  logicalId: string;
  name: string;
  mimeType: string;
  byteSize: number;
  sha256?: string;
  sourceEtag?: string;
}

export interface ReleaseManifestV1 {
  format: "rekixo-release-manifest";
  version: 1;
  release: {
    id: string;
    projectId: string;
    projectSlug: string;
    version: number;
    createdAt: string;
    sourceDraftRevision?: number;
  };
  project: {
    id: string;
    slug: string;
    name: string;
    location?: string;
    status: "published";
    coverAssetKey?: string;
  };
  experience: {
    scenes: Array<Record<string, unknown>>;
    camera?: Record<string, unknown>;
    model?: Record<string, unknown> & { releaseAssetId: string };
    mediaFiles: string[];
    buildingPresentation?: BuildingPresentationManifestV1;
  };
  studio?: {
    project: Record<string, unknown>;
  };
  sourceEvidence: {
    sourcePackSourceIds: string[];
    sourceClaimIds: string[];
  };
  assets: ReleaseAssetV1[];
}

const text = (value: unknown, max = 500) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const id = (value: unknown) =>
  text(value, 160) && /^[A-Za-z0-9_-]+$/.test(value as string);
const slug = (value: unknown) =>
  text(value, 80) &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value as string);
const uniqueTextArray = (value: unknown, maxItems = 500) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => text(item, 240)) &&
  new Set(value).size === value.length;

function sameTextSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

export function assertReleaseManifestV1(
  value: unknown,
): asserts value is ReleaseManifestV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid release manifest.");
  const manifest = value as Record<string, any>;
  if (manifest.format !== "rekixo-release-manifest" || manifest.version !== 1)
    throw Error("Unsupported release manifest.");

  const release = manifest.release;
  const project = manifest.project;
  const experience = manifest.experience;
  const sourceEvidence = manifest.sourceEvidence;
  const assets = manifest.assets;

  if (
    !release ||
    !id(release.id) ||
    !id(release.projectId) ||
    !slug(release.projectSlug) ||
    !Number.isInteger(release.version) ||
    release.version < 1 ||
    !text(release.createdAt, 100) ||
    (release.sourceDraftRevision !== undefined &&
      (!Number.isInteger(release.sourceDraftRevision) ||
        release.sourceDraftRevision < 1))
  )
    throw Error("Invalid release identity.");

  if (
    !project ||
    project.id !== release.projectId ||
    project.slug !== release.projectSlug ||
    !text(project.name, 200) ||
    project.status !== "published" ||
    (project.location !== undefined && !text(project.location, 180)) ||
    (project.coverAssetKey !== undefined && !text(project.coverAssetKey, 500))
  )
    throw Error("Invalid release project snapshot.");

  if (
    !experience ||
    !Array.isArray(experience.scenes) ||
    experience.scenes.length > 1000 ||
    !uniqueTextArray(experience.mediaFiles, 1000)
  )
    throw Error("Invalid release public experience.");

  if (experience.buildingPresentation !== undefined)
    assertBuildingPresentationManifestV1(experience.buildingPresentation);

  if (
    !sourceEvidence ||
    !uniqueTextArray(sourceEvidence.sourcePackSourceIds, 1000) ||
    !uniqueTextArray(sourceEvidence.sourceClaimIds, 5000)
  )
    throw Error("Invalid release source evidence.");

  if (experience.buildingPresentation) {
    const provenance = experience.buildingPresentation.provenance;
    if (
      !sameTextSet(
        provenance.sourcePackSourceIds,
        sourceEvidence.sourcePackSourceIds,
      ) ||
      !sameTextSet(provenance.sourceClaimIds, sourceEvidence.sourceClaimIds)
    )
      throw Error("Building presentation provenance does not match release source evidence.");
  }

  if (!Array.isArray(assets) || assets.length > 5000)
    throw Error("Invalid release assets.");

  const assetIds = new Set<string>();
  const assetKeys = new Set<string>();
  for (const asset of assets) {
    if (
      !asset ||
      !id(asset.id) ||
      !["model", "media", "studio"].includes(asset.kind) ||
      !text(asset.logicalId, 500) ||
      !text(asset.name, 500) ||
      !text(asset.mimeType, 200) ||
      !Number.isInteger(asset.byteSize) ||
      asset.byteSize < 0 ||
      (asset.sha256 !== undefined &&
        (typeof asset.sha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(asset.sha256))) ||
      (asset.sourceEtag !== undefined && !text(asset.sourceEtag, 300))
    )
      throw Error("Invalid release asset.");
    if (
      assetIds.has(asset.id) ||
      assetKeys.has(`${asset.kind}:${asset.logicalId}`)
    )
      throw Error("Duplicate release asset.");
    assetIds.add(asset.id);
    assetKeys.add(`${asset.kind}:${asset.logicalId}`);
  }

  if (
    experience.model &&
    (!id(experience.model.releaseAssetId) ||
      !assetIds.has(experience.model.releaseAssetId))
  )
    throw Error("Release model asset is missing.");

  if (experience.buildingPresentation && experience.model) {
    const modelAsset = assets.find(
      (asset) => asset.id === experience.model.releaseAssetId,
    );
    if (
      modelAsset?.sha256 &&
      modelAsset.sha256 !== experience.buildingPresentation.model.canonicalSha256
    )
      throw Error("Building presentation model checksum does not match immutable release model.");
  }

  if (manifest.studio !== undefined) {
    const studioProject = manifest.studio?.project;
    if (
      !studioProject ||
      studioProject.schema !== 1 ||
      studioProject.id !== release.projectId ||
      studioProject.slug !== release.projectSlug ||
      !text(studioProject.name, 200) ||
      !Array.isArray(studioProject.assets) ||
      studioProject.assets.some((assetId: unknown) => !id(assetId))
    )
      throw Error("Invalid release Studio snapshot.");
    const studioAssets = new Set(
      assets
        .filter((asset: ReleaseAssetV1) => asset.kind === "studio")
        .map((asset: ReleaseAssetV1) => asset.logicalId),
    );
    if (
      studioProject.assets.some(
        (assetId: string) => !studioAssets.has(assetId),
      )
    )
      throw Error("Release Studio asset is missing.");
  }
}
