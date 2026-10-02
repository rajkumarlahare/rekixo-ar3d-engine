import * as T from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { id, type Asset } from "./domain";
import { disposeObjectResources } from "./threeResources";
import { MAX_STUDIO_ASSET_BYTES } from "./storage";
import {
  resolveSketchUpMaterialStyle,
  resolveSketchUpMaterialTexture,
  type SketchUpMaterialStyleBinding,
  type SketchUpMaterialTextureBinding,
} from "./sketchUpMaterialResolver";

export interface FbxWebModelOptions {
  textureAssets?: readonly Asset[];
  materialBindings?: readonly SketchUpMaterialTextureBinding[];
  materialStyles?: readonly SketchUpMaterialStyleBinding[];
}

export interface WebModelPreparationResult {
  asset: Asset;
  meshCount: number;
  materialCount: number;
  triangleCount: number;
  externalTexturesBlocked: boolean;
  resolvedExternalTextures: number;
  unresolvedExternalTextures: number;
  materialTexturesApplied: number;
  materialStylesApplied: number;
  textureLoadErrors: number;
}

const OPAQUE_WHITE_PIXEL =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="white"/></svg>',
  );

function sha256Hex(bytes: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
}

function safeLeaf(value: string) {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // Keep the original URL if percent-decoding is invalid.
  }
  return decoded.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
}

function normalizedStem(value: string) {
  return safeLeaf(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isTextureAsset(asset: Asset) {
  return (
    /^image\//i.test(asset.type) ||
    /\.(?:png|jpe?g|webp|bmp|tiff?)$/i.test(asset.name)
  );
}

function textureLookup(assets: readonly Asset[]) {
  const exact = new Map<string, Asset | null>();
  const stem = new Map<string, Asset | null>();
  for (const asset of assets.filter(isTextureAsset)) {
    const leaf = safeLeaf(asset.name);
    if (leaf) {
      const previous = exact.get(leaf);
      if (previous === undefined) exact.set(leaf, asset);
      else if (previous?.id !== asset.id) exact.set(leaf, null);
    }
    const key = normalizedStem(asset.name);
    if (!key) continue;
    const previous = stem.get(key);
    if (previous === undefined) stem.set(key, asset);
    else if (previous?.id !== asset.id) stem.set(key, null);
  }
  return { exact, stem };
}

function resolveTextureAsset(
  requestedUrl: string,
  lookup: ReturnType<typeof textureLookup>,
) {
  const leaf = safeLeaf(requestedUrl);
  if (leaf && lookup.exact.has(leaf)) return lookup.exact.get(leaf) || undefined;
  const key = normalizedStem(requestedUrl);
  const byStem = key ? lookup.stem.get(key) : undefined;
  return byStem || undefined;
}

function standardizeMaterial(source: T.Material) {
  if (source instanceof T.MeshStandardMaterial) return source.clone();

  const candidate = source as T.Material & {
    color?: T.Color;
    opacity?: number;
    transparent?: boolean;
    side?: T.Side;
    map?: T.Texture | null;
    normalMap?: T.Texture | null;
    emissive?: T.Color;
    emissiveIntensity?: number;
  };
  const material = new T.MeshStandardMaterial({
    name: source.name,
    color: candidate.color?.clone() ?? new T.Color("#d7d7d7"),
    opacity: candidate.opacity ?? 1,
    transparent: candidate.transparent ?? false,
    side: candidate.side ?? T.FrontSide,
    roughness: 0.72,
    metalness: 0,
    map: candidate.map ?? null,
    normalMap: candidate.normalMap ?? null,
    emissive: candidate.emissive?.clone() ?? new T.Color("#000000"),
    emissiveIntensity: candidate.emissiveIntensity ?? 1,
  });
  material.userData = structuredClone(source.userData ?? {});
  return material;
}

function standardizeModel(root: T.Object3D) {
  let meshCount = 0;
  let triangleCount = 0;
  const materialNames = new Set<string>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    meshCount += 1;
    const positionCount = node.geometry.attributes.position?.count ?? 0;
    triangleCount += Math.floor(
      (node.geometry.index?.count ?? positionCount) / 3,
    );
    const sourceMaterials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    const converted = sourceMaterials.map((material) => {
      const next = standardizeMaterial(material);
      materialNames.add(next.name || next.uuid);
      return next;
    });
    node.material = Array.isArray(node.material) ? converted : converted[0];
    node.castShadow = true;
    node.receiveShadow = true;
  });
  return { meshCount, triangleCount, materialCount: materialNames.size };
}

function loadTextureAsset(asset: Asset, objectUrls: Set<string>) {
  const url = URL.createObjectURL(asset.blob);
  objectUrls.add(url);
  return new Promise<T.Texture>((resolve, reject) => {
    new T.TextureLoader().load(
      url,
      (texture) => {
        texture.name = asset.name;
        texture.colorSpace = T.SRGBColorSpace;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      () => reject(Error(`Could not decode recovered texture: ${asset.name}`)),
    );
  });
}

function applyRecoveredMaterialStyles(
  root: T.Object3D,
  bindings: readonly SketchUpMaterialStyleBinding[],
) {
  if (!bindings.length) return 0;
  const seen = new Set<string>();
  let applied = 0;

  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      if (seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const resolved = resolveSketchUpMaterialStyle(material.name, bindings);
      if (!resolved) continue;

      if (resolved.binding.baseColor)
        material.color.set(resolved.binding.baseColor);
      if (resolved.binding.opacity !== undefined) {
        material.opacity = resolved.binding.opacity;
        material.transparent = resolved.binding.opacity < 0.999;
        material.depthWrite = resolved.binding.opacity >= 0.999;
      }
      material.userData = {
        ...material.userData,
        rekixoMaterialStyleSource: {
          kind: "sketchup-material-definition",
          sourceArchiveId: resolved.binding.sourceArchiveId,
          archivePath: resolved.binding.archivePath,
          confidence: resolved.binding.confidence,
          matchScore: resolved.score,
          ...(resolved.binding.xScale !== undefined
            ? { xScale: resolved.binding.xScale }
            : {}),
          ...(resolved.binding.yScale !== undefined
            ? { yScale: resolved.binding.yScale }
            : {}),
        },
      };
      material.needsUpdate = true;
      applied += 1;
    }
  });

  return applied;
}

async function applyRecoveredMaterialTextures(
  root: T.Object3D,
  files: readonly Asset[],
  bindings: readonly SketchUpMaterialTextureBinding[],
  objectUrls: Set<string>,
) {
  if (!bindings.length) return { applied: 0, errors: 0 };

  const materials = new Map<string, T.MeshStandardMaterial>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const key = material.uuid;
      if (!materials.has(key)) materials.set(key, material);
    }
  });

  const textureCache = new Map<string, Promise<T.Texture>>();
  let applied = 0;
  let errors = 0;
  for (const material of materials.values()) {
    const resolved = resolveSketchUpMaterialTexture(material.name, bindings, files);
    if (!resolved) continue;
    try {
      let texturePromise = textureCache.get(resolved.asset.id);
      if (!texturePromise) {
        texturePromise = loadTextureAsset(resolved.asset, objectUrls);
        textureCache.set(resolved.asset.id, texturePromise);
      }
      const texture = await texturePromise;
      material.map = texture;
      material.needsUpdate = true;
      material.userData = {
        ...material.userData,
        rekixoMaterialSource: {
          kind: "sketchup-recovered-texture",
          sourceArchiveId: resolved.binding.sourceArchiveId,
          textureAssetId: resolved.asset.id,
          archivePath: resolved.binding.archivePath,
          confidence: resolved.binding.confidence,
          matchScore: resolved.score,
        },
      };
      applied += 1;
    } catch {
      errors += 1;
    }
  }
  return { applied, errors };
}

export async function prepareFbxWebModel(
  source: Asset,
  projectId: string,
  options: FbxWebModelOptions = {},
): Promise<WebModelPreparationResult> {
  if (!/\.fbx$/i.test(source.name))
    throw Error("Choose an FBX authoring model before preparing a web GLB.");
  if (source.projectId !== projectId)
    throw Error("FBX source does not belong to this project.");

  const bytes = await source.blob.arrayBuffer();
  const manager = new T.LoadingManager();
  const lookup = textureLookup(options.textureAssets ?? []);
  const objectUrls = new Set<string>();
  let textureRequests = 0;
  let resolvedExternalTextures = 0;
  let unresolvedExternalTextures = 0;
  let textureLoadErrors = 0;
  let finishManagerLoad: (() => void) | undefined;
  const managerLoaded = new Promise<void>((resolve) => {
    finishManagerLoad = resolve;
  });

  manager.onLoad = () => finishManagerLoad?.();
  manager.onError = () => {
    textureLoadErrors += 1;
  };
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    textureRequests += 1;
    const matched = resolveTextureAsset(url, lookup);
    if (matched) {
      resolvedExternalTextures += 1;
      const objectUrl = URL.createObjectURL(matched.blob);
      objectUrls.add(objectUrl);
      return objectUrl;
    }
    unresolvedExternalTextures += 1;
    return OPAQUE_WHITE_PIXEL;
  });

  let root: T.Object3D | undefined;
  try {
    root = new FBXLoader(manager).parse(bytes, "");
    if (textureRequests > 0) {
      await Promise.race([
        managerLoaded,
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
    }

    root.name = root.name || source.name.replace(/\.fbx$/i, "");
    const summary = standardizeModel(root);
    const materialStylesApplied = applyRecoveredMaterialStyles(
      root,
      options.materialStyles ?? [],
    );
    const materialRecovery = await applyRecoveredMaterialTextures(
      root,
      options.textureAssets ?? [],
      options.materialBindings ?? [],
      objectUrls,
    );
    textureLoadErrors += materialRecovery.errors;

    root.userData.rekixoSource = {
      assetId: source.id,
      sha256: source.hash,
      conversion: "browser-fbx-to-glb-v2-material-fusion",
      resolvedExternalTextures,
      unresolvedExternalTextures,
      materialTexturesApplied: materialRecovery.applied,
      materialStylesApplied,
    };
    root.updateMatrixWorld(true);

    const exporter = new GLTFExporter();
    const exported = await exporter.parseAsync(root, {
      binary: true,
      onlyVisible: false,
      trs: false,
    });
    if (!(exported instanceof ArrayBuffer))
      throw Error("FBX conversion did not produce a binary GLB.");

    if (exported.byteLength > MAX_STUDIO_ASSET_BYTES)
      throw Error(
        "Generated GLB exceeds the current 64 MB Studio asset limit. Optimize the source model before publishing.",
      );

    const blob = new Blob([exported], { type: "model/gltf-binary" });
    const hash = await sha256Hex(exported);
    const asset: Asset = {
      id: id(),
      projectId,
      name: source.name.replace(/\.fbx$/i, "-web.glb"),
      type: "model/gltf-binary",
      size: blob.size,
      hash,
      blob,
    };
    return {
      asset,
      ...summary,
      externalTexturesBlocked: unresolvedExternalTextures > 0,
      resolvedExternalTextures,
      unresolvedExternalTextures,
      materialTexturesApplied: materialRecovery.applied,
      materialStylesApplied,
      textureLoadErrors,
    };
  } finally {
    if (root) disposeObjectResources(root);
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}
