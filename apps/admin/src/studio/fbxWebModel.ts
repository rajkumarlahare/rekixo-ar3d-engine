import * as T from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { id, type Asset } from "./domain";
import { disposeObjectResources } from "./threeResources";
import { MAX_STUDIO_ASSET_BYTES } from "./storage";

export interface WebModelPreparationResult {
  asset: Asset;
  meshCount: number;
  materialCount: number;
  triangleCount: number;
  externalTexturesBlocked: boolean;
}

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function sha256Hex(bytes: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join(""),
  );
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

export async function prepareFbxWebModel(
  source: Asset,
  projectId: string,
): Promise<WebModelPreparationResult> {
  if (!/\.fbx$/i.test(source.name))
    throw Error("Choose an FBX authoring model before preparing a web GLB.");
  if (source.projectId !== projectId)
    throw Error("FBX source does not belong to this project.");

  const bytes = await source.blob.arrayBuffer();
  const manager = new T.LoadingManager();
  let externalTexturesBlocked = false;
  manager.setURLModifier((url) => {
    if (
      url.startsWith("blob:") ||
      url.startsWith("data:") ||
      url.startsWith("file:")
    )
      return url;
    externalTexturesBlocked = true;
    return TRANSPARENT_PIXEL;
  });

  let root: T.Object3D | undefined;
  try {
    root = new FBXLoader(manager).parse(bytes, "");
    root.name = root.name || source.name.replace(/\.fbx$/i, "");
    root.userData.rekixoSource = {
      assetId: source.id,
      sha256: source.hash,
      conversion: "browser-fbx-to-glb-v1",
      externalTexturesBlocked,
    };

    const summary = standardizeModel(root);
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
      externalTexturesBlocked,
    };
  } finally {
    if (root) disposeObjectResources(root);
  }
}
