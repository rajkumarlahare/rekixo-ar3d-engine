import type { Project } from "./domain";
import type { FbxSourceAudit } from "./sourceAudit";
import { buildVisualFacadeMatchPlan } from "./visualFacadeMatching";

export function buildVisualFacadeReview(
  project: Project,
  audits: readonly FbxSourceAudit[],
) {
  // A material name in a different attached model is not evidence for this model.
  const activeAudits = audits.filter(
    (audit) =>
      audit.assetId === project.scene.modelId &&
      project.assets.includes(audit.assetId),
  );
  const plan = buildVisualFacadeMatchPlan(project, activeAudits);
  const sourceAvailable = Boolean(
    plan.sourceAssetId && project.assets.includes(plan.sourceAssetId),
  );
  const key = JSON.stringify([
    project.id,
    project.scene.modelId,
    project.scene.referenceImageEvidence,
    project.scene.referenceImageEvidenceSet,
    plan,
  ]);
  return { plan, key, sourceAvailable };
}

export type VisualReviewAction =
  | { key: string; kind: "appearance" }
  | {
      key: string;
      kind: "material";
      materialName: string;
      sourceAssetId?: string;
      regionId?: string;
    };

/** Apply one explicitly reviewed suggestion; never accept colors from a stale UI. */
export function applyVisualFacadeReview(
  project: Project,
  audits: readonly FbxSourceAudit[],
  loadedMaterialNames: readonly string[],
  action: VisualReviewAction,
): Project {
  const { plan, key, sourceAvailable } = buildVisualFacadeReview(project, audits);
  if (!sourceAvailable || action.key !== key) return project;
  if (action.kind === "appearance") {
    if (!plan.appearance) return project;
    const appearance = plan.appearance.appearance;
    if (
      Object.entries(appearance).every(
        ([field, value]) =>
          project.scene.appearance?.[field as keyof typeof appearance] === value,
      )
    )
      return project;
    return {
      ...project,
      scene: { ...project.scene, appearance: { ...appearance } },
    };
  }

  const suggestion = plan.materials.find(
    (item) => item.materialName === action.materialName,
  );
  if (!suggestion || !loadedMaterialNames.includes(suggestion.materialName))
    return project;

  const requestedCandidate =
    action.sourceAssetId || action.regionId
      ? suggestion.candidates.find(
          (candidate) =>
            (!action.sourceAssetId ||
              candidate.sourceAssetId === action.sourceAssetId) &&
            (!action.regionId || candidate.regionId === action.regionId),
        )
      : suggestion.conflict
        ? undefined
        : suggestion.candidates[0];
  if (!requestedCandidate) return project;
  if (!project.assets.includes(requestedCandidate.sourceAssetId)) return project;

  const evidence = [
    ...(project.scene.referenceImageEvidenceSet ?? []),
    ...(project.scene.referenceImageEvidence
      ? [project.scene.referenceImageEvidence]
      : []),
  ].find((row) => row.assetId === requestedCandidate.sourceAssetId);
  if (!evidence) return project;
  if (
    requestedCandidate.regionId &&
    !evidence.regions?.some((region) => region.id === requestedCandidate.regionId)
  )
    return project;

  const previous = project.scene.materialOverrides ?? [];
  const existing = previous.find(
    (item) => item.materialName === suggestion.materialName,
  );
  if (
    existing?.baseColor?.toLowerCase() === requestedCandidate.baseColor ||
    (!existing && previous.length >= 250)
  )
    return project;
  const override = {
    ...existing,
    materialName: suggestion.materialName,
    baseColor: requestedCandidate.baseColor,
  };
  const materialOverrides = existing
    ? previous.map((item) =>
        item.materialName === suggestion.materialName ? override : item,
      )
    : [...previous, override];
  return { ...project, scene: { ...project.scene, materialOverrides } };
}
