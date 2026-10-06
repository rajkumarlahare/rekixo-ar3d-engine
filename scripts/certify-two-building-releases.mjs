import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error(`Client-ready Building certification failed: ${message}`);
}

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function sameTextSet(left, right) {
  return Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value) => right.includes(value));
}

export function certifyBuildingRelease(manifest) {
  if (!manifest || manifest.format !== "rekixo-release-manifest" || manifest.version !== 1)
    fail("release manifest V1 is required");
  if (!manifest.release?.id || !manifest.project?.id || !manifest.project?.slug)
    fail("release/project identity is incomplete");

  const presentation = manifest.experience?.buildingPresentation;
  if (!presentation || presentation.format !== "rekixo-building-presentation" || presentation.version !== 1)
    fail(`${manifest.project.slug}: immutable Building presentation manifest is missing`);
  if (presentation.model?.metresPerUnit !== 1 || !sha256(presentation.model?.canonicalSha256))
    fail(`${manifest.project.slug}: canonical metre model identity is invalid`);

  const model = manifest.experience?.model;
  if (!model?.releaseAssetId)
    fail(`${manifest.project.slug}: immutable release model is missing`);
  const modelAsset = manifest.assets?.find(
    (asset) => asset?.id === model.releaseAssetId && asset.kind === "model",
  );
  if (!modelAsset || !sha256(modelAsset.sha256))
    fail(`${manifest.project.slug}: release model checksum is missing`);
  if (modelAsset.sha256 !== presentation.model.canonicalSha256)
    fail(`${manifest.project.slug}: presentation is not pinned to release model bytes`);

  const sourceEvidence = manifest.sourceEvidence ?? {};
  if (!sameTextSet(
    presentation.provenance?.sourcePackSourceIds,
    sourceEvidence.sourcePackSourceIds,
  ) || !sameTextSet(
    presentation.provenance?.sourceClaimIds,
    sourceEvidence.sourceClaimIds,
  ))
    fail(`${manifest.project.slug}: presentation provenance diverges from release evidence`);

  if (!Array.isArray(presentation.cameras?.shots) || presentation.cameras.shots.length < 3)
    fail(`${manifest.project.slug}: automatic camera set is incomplete`);
  if (!presentation.cameras.shots.some((shot) => shot.kind === "hero"))
    fail(`${manifest.project.slug}: hero camera is missing`);
  if (!Array.isArray(presentation.tour?.steps) || presentation.tour.enabled !== true || presentation.tour.steps.length < 2)
    fail(`${manifest.project.slug}: guided tour is incomplete`);
  if (!presentation.environment || typeof presentation.environment.genericDressing !== "boolean")
    fail(`${manifest.project.slug}: environment policy is missing`);

  return {
    slug: manifest.project.slug,
    projectId: manifest.project.id,
    releaseId: manifest.release.id,
    releaseVersion: manifest.release.version,
    canonicalSha256: presentation.model.canonicalSha256,
    sourceIds: [...(sourceEvidence.sourcePackSourceIds ?? [])].sort(),
    cameraCount: presentation.cameras.shots.length,
    tourStepCount: presentation.tour.steps.length,
  };
}

export function certifyTwoDistinctBuildings(leftManifest, rightManifest) {
  const left = certifyBuildingRelease(leftManifest);
  const right = certifyBuildingRelease(rightManifest);
  if (left.projectId === right.projectId || left.slug === right.slug)
    fail("the second certification target must be a distinct Engine project");
  if (left.canonicalSha256 === right.canonicalSha256)
    fail("the second certification target must use different canonical model bytes");
  if (
    left.sourceIds.length &&
    right.sourceIds.length &&
    sameTextSet(left.sourceIds, right.sourceIds)
  )
    fail("the two certification targets cannot reuse the same complete source identity set");
  return { left, right, genericity: "passed" };
}

function readManifest(file) {
  const resolved = path.resolve(file);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    fail(`${resolved}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  return value;
}

const invokedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const [leftPath, rightPath] = process.argv.slice(2);
  if (!leftPath || !rightPath) {
    console.error("Usage: node scripts/certify-two-building-releases.mjs <building-a-release.json> <building-b-release.json>");
    process.exitCode = 2;
  } else {
    try {
      const report = certifyTwoDistinctBuildings(
        readManifest(leftPath),
        readManifest(rightPath),
      );
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
