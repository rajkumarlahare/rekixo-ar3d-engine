import type { Asset, Project } from "./domain";

export type AutoBuildMode = "model-backed" | "cad-only";
export type AutoBuildSourceRole =
  | "model"
  | "cad"
  | "sketchup"
  | "drawing"
  | "visual"
  | "metadata"
  | "structured"
  | "texture"
  | "other";

export interface AutoBuildSourceGroup {
  role: AutoBuildSourceRole;
  assetIds: string[];
  names: string[];
}

export interface AutoBuildSourcePlan {
  mode: AutoBuildMode;
  sourceCount: number;
  selectedModelAssetId?: string;
  groups: AutoBuildSourceGroup[];
  completeSixRoleSupportPack: boolean;
  structuredEvidenceCount: number;
  planningIssues: string[];
}

const TEXTURE_NAME =
  /(?:texture|diffuse|albedo|normal|rough|metal|marble|tile|glass|wood|granite|ceramic|bump|height|displace|opacity|emissive|ao)(?:[^a-z0-9]|$)/i;

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

export function autoBuildSourceRole(asset: Asset): AutoBuildSourceRole {
  const ext = extension(asset.name);
  if (ext === "fbx" || ext === "glb") return "model";
  if (ext === "dwg" || ext === "dxf") return "cad";
  if (ext === "skp" || ext === "skb") return "sketchup";
  if (ext === "pdf") return "drawing";
  if (ext === "drs" || ext === "json") return "metadata";
  if (ext === "csv" || ext === "tsv") return "structured";
  if (["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp"].includes(ext))
    return TEXTURE_NAME.test(asset.name) ? "texture" : "visual";
  return "other";
}

function groupSources(files: readonly Asset[]) {
  const grouped = new Map<AutoBuildSourceRole, Asset[]>();
  for (const file of files) {
    const role = autoBuildSourceRole(file);
    grouped.set(role, [...(grouped.get(role) ?? []), file]);
  }
  const order: AutoBuildSourceRole[] = [
    "model",
    "cad",
    "sketchup",
    "drawing",
    "visual",
    "metadata",
    "structured",
    "texture",
    "other",
  ];
  return order.map((role) => ({
    role,
    assetIds: (grouped.get(role) ?? []).map((asset) => asset.id),
    names: (grouped.get(role) ?? []).map((asset) => asset.name),
  }));
}

function selectedModel(project: Project, models: readonly Asset[]) {
  const explicit = project.scene.modelId
    ? models.find((asset) => asset.id === project.scene.modelId)
    : undefined;
  if (explicit) return explicit;
  if (models.length === 1) return models[0];
  const fbx = models.filter((asset) => /\.fbx$/i.test(asset.name));
  return fbx.length === 1 ? fbx[0] : undefined;
}

/**
 * One shared, side-effect-free description of the source pack used by every
 * AutoBuild path. It deliberately does not invent source authority; the
 * downstream fusion/review layers still decide whether evidence is trustworthy.
 */
export function buildAutoBuildSourcePlan(
  project: Project,
  files: readonly Asset[],
): AutoBuildSourcePlan {
  const groups = groupSources(files);
  const assetsFor = (role: AutoBuildSourceRole) => {
    const ids = new Set(
      groups.find((group) => group.role === role)?.assetIds ?? [],
    );
    return files.filter((asset) => ids.has(asset.id));
  };
  const models = assetsFor("model");
  const cad = assetsFor("cad");
  const selected = selectedModel(project, models);
  const planningIssues: string[] = [];

  if (!models.length && !cad.length)
    planningIssues.push(
      "AutoBuild needs an FBX/GLB model or DWG/DXF architectural plan.",
    );
  if (models.length > 1 && !selected)
    planningIssues.push(
      "Multiple 3D authoring models are attached; select one model before AutoBuild.",
    );
  if (cad.length > 30)
    planningIssues.push(
      "More than 30 CAD sources are attached; split the project source pack before AutoBuild.",
    );

  const required: AutoBuildSourceRole[] = [
    "model",
    "cad",
    "sketchup",
    "drawing",
    "visual",
    "metadata",
  ];
  const completeSixRoleSupportPack = required.every(
    (role) => (groups.find((group) => group.role === role)?.assetIds.length ?? 0) > 0,
  );
  const structuredEvidenceCount =
    groups.find((group) => group.role === "structured")?.assetIds.length ?? 0;

  return {
    mode: models.length ? "model-backed" : "cad-only",
    sourceCount: files.length,
    ...(selected ? { selectedModelAssetId: selected.id } : {}),
    groups,
    completeSixRoleSupportPack,
    structuredEvidenceCount,
    planningIssues,
  };
}
