import {
  projectSlug,
  validateProject,
  type Asset,
  type Project,
} from "./domain";
import type { CloudProjectSummary } from "./cloud";

export function rebindLocalProjectToEmptyCloud(
  project: Project,
  files: Asset[],
  cloudProject: CloudProjectSummary,
  options: { allowExplicitTarget?: boolean } = {},
) {
  const slug = projectSlug(project);
  if (slug !== cloudProject.slug && !options.allowExplicitTarget)
    throw Error("Local and cloud project slugs do not match.");
  if (cloudProject.draftRevision !== undefined)
    throw Error(
      "This cloud project already has a draft. Open the cloud project first instead of overwriting it.",
    );

  const rebound: Project = structuredClone(project);
  rebound.id = cloudProject.id;
  rebound.slug = cloudProject.slug;
  rebound.name = cloudProject.name;
  rebound.location = project.location || cloudProject.location || "";
  rebound.updated = new Date().toISOString();
  delete rebound.cloud;
  validateProject(rebound);

  const reboundFiles = files.map((asset) => ({
    ...asset,
    projectId: cloudProject.id,
  }));

  for (const asset of reboundFiles) {
    if (!rebound.assets.includes(asset.id))
      throw Error("Local asset list does not match the project before cloud adoption.");
  }

  return { project: rebound, files: reboundFiles };
}
