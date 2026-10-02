import type { Asset } from "./domain";

export interface SketchUpMaterialTextureBinding {
  sourceArchiveId: string;
  archivePath: string;
  materialName: string;
  textureAssetId: string;
  textureName: string;
  confidence: number;
}

export interface ResolvedMaterialTexture {
  binding: SketchUpMaterialTextureBinding;
  asset: Asset;
  score: number;
}

export interface SketchUpMaterialStyleBinding {
  sourceArchiveId: string;
  archivePath: string;
  materialName: string;
  baseColor?: string;
  opacity?: number;
  xScale?: number;
  yScale?: number;
  confidence: number;
}

export interface ResolvedMaterialStyle {
  binding: SketchUpMaterialStyleBinding;
  score: number;
}

export function normalizedMaterialKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/^material::/i, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function materialNameFromArchivePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const materialIndex = parts.findIndex((part) => /^materials?$/i.test(part));
  if (materialIndex < 0 || materialIndex + 1 >= parts.length) return undefined;
  const raw = parts[materialIndex + 1].trim();
  const unwrapped = raw.replace(/^\[|\]$/g, "").trim();
  return unwrapped || undefined;
}

function textureStem(value: string) {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? value;
}

function textureRoleScore(value: string) {
  const normalized = value.toLowerCase();
  if (/(?:base.?color|diffuse|albedo|color|colour)/.test(normalized)) return 12;
  if (/(?:normal|roughness|metallic|metalness|bump|height|displacement|ao|ambient.?occlusion|opacity|alpha)/.test(normalized))
    return -24;
  return 0;
}

export function resolveSketchUpMaterialStyle(
  materialName: string,
  bindings: readonly SketchUpMaterialStyleBinding[],
): ResolvedMaterialStyle | undefined {
  const materialKey = normalizedMaterialKey(materialName);
  if (!materialKey) return undefined;

  const ranked = bindings
    .map((binding) => {
      const bindingKey = normalizedMaterialKey(binding.materialName);
      let score = 0;
      if (bindingKey === materialKey) score = 100;
      else if (
        bindingKey &&
        (bindingKey.includes(materialKey) || materialKey.includes(bindingKey))
      )
        score = 78;
      return { binding, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.binding.confidence - left.binding.confidence ||
        left.binding.archivePath.localeCompare(right.binding.archivePath),
    );

  if (!ranked.length) return undefined;
  if (
    ranked.length > 1 &&
    ranked[0].score === ranked[1].score &&
    normalizedMaterialKey(ranked[0].binding.materialName) !==
      normalizedMaterialKey(ranked[1].binding.materialName)
  )
    return undefined;
  return ranked[0];
}

export function resolveSketchUpMaterialTexture(
  materialName: string,
  bindings: readonly SketchUpMaterialTextureBinding[],
  files: readonly Asset[],
): ResolvedMaterialTexture | undefined {
  const materialKey = normalizedMaterialKey(materialName);
  if (!materialKey) return undefined;

  const ranked = bindings
    .map((binding) => {
      const bindingKey = normalizedMaterialKey(binding.materialName);
      const textureKey = normalizedMaterialKey(textureStem(binding.textureName));
      let score = 0;
      if (bindingKey === materialKey) score = 100;
      else if (
        bindingKey &&
        materialKey &&
        (bindingKey.includes(materialKey) || materialKey.includes(bindingKey))
      )
        score = 82;
      else if (textureKey === materialKey) score = 76;
      else if (
        textureKey &&
        materialKey &&
        (textureKey.includes(materialKey) || materialKey.includes(textureKey))
      )
        score = 64;
      if (score > 0) score += textureRoleScore(binding.textureName);
      return { binding, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.binding.confidence - left.binding.confidence ||
        left.binding.archivePath.localeCompare(right.binding.archivePath),
    );

  if (!ranked.length) return undefined;
  if (
    ranked.length > 1 &&
    ranked[0].score === ranked[1].score &&
    normalizedMaterialKey(ranked[0].binding.materialName) !==
      normalizedMaterialKey(ranked[1].binding.materialName)
  )
    return undefined;

  const asset = files.find(
    (candidate) => candidate.id === ranked[0].binding.textureAssetId,
  );
  if (!asset) return undefined;
  return {
    binding: ranked[0].binding,
    asset,
    score: ranked[0].score,
  };
}
