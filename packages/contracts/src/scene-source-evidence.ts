import {
  assertSceneManifestV2,
  type SceneManifestV2,
} from "./scene-manifest-v2";
import {
  assertProjectSourcePackV1,
  type ProjectSourcePackV1,
} from "./source-pack-v1";

export function assertSceneSourceEvidenceV2(
  scene: unknown,
  sourcePack: unknown,
): asserts scene is SceneManifestV2 {
  assertSceneManifestV2(scene);
  assertProjectSourcePackV1(sourcePack);

  const manifest = scene as SceneManifestV2;
  const pack = sourcePack as ProjectSourcePackV1;

  if (
    manifest.project.id !== pack.project.id ||
    manifest.project.slug !== pack.project.slug
  )
    throw Error("Scene manifest and source pack project identity do not match.");

  const sourceById = new Map(pack.sources.map((item) => [item.id, item]));
  const claimById = new Map(pack.claims.map((item) => [item.id, item]));
  const assetById = new Map(manifest.assets.map((item) => [item.id, item]));

  for (const room of manifest.rooms) {
    const evidence = room.evidence;
    if (!evidence.sourcePackSourceId) {
      if (evidence.sourceClaimIds?.length)
        throw Error("Scene evidence claims require a source-pack source.");
      continue;
    }

    const source = sourceById.get(evidence.sourcePackSourceId);
    if (!source)
      throw Error(`Scene evidence references unknown source ${evidence.sourcePackSourceId}.`);

    if (evidence.sourceAssetId) {
      const asset = assetById.get(evidence.sourceAssetId);
      if (!asset || asset.sha256.toLowerCase() !== source.sha256.toLowerCase())
        throw Error("Scene evidence asset fingerprint does not match its source pack.");
    }

    for (const claimId of evidence.sourceClaimIds ?? []) {
      const claim = claimById.get(claimId);
      if (!claim || claim.sourceId !== source.id)
        throw Error(`Scene evidence references invalid claim ${claimId}.`);
      if (room.evidence.status === "reviewed" && claim.status === "conflicted")
        throw Error("Reviewed scene evidence cannot depend on a conflicted claim.");
    }
  }
}
