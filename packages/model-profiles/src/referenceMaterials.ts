import * as THREE from "three";
import sourceTextureAssetUrl from "../../../project-profiles/reference-source-v9/source-textures.json?url";
import { JYOTI_SOURCE_MODEL_SHA256 } from "./referenceSourceRuntime";

const sourceMaterialTint: Record<string, number> = {
  frontcolor: 0xffffff,
  tile_canvas: 0xc7c0ad,
  marble_carrara_floor_tile: 0xccd0db,
  slate_light_tile: 0x363636,
  square_glass_tile_02: 0x78b78c,
  square_glass_tile_01: 0x7b8e97,
  square_glass_tile_04: 0xddc57a,
  square_glass_tile_03: 0xa0a38d,
  slate: 0x666e6c,
  metal_panel: 0x8f9d9e,
  marble_carrara_gold_floor_tile: 0xe1dfd9,
  mosaic_hexagonal_tile: 0xa8c2df,
  ornate_tile_02: 0xc9c9c9,
  ornate_tile_01: 0xcacaca,
  basic_tile: 0xcbceca,
  concrete_pavers_block_multi: 0x7c8c91,
  encaustic_tile_circular_01: 0x7b7b7a,
  color_004: 0x8e8e8e,
  color_a06: 0xc29b7a,
  translucent_glass_blue: 0x626b68,
  tile_mosaic_multi: 0x876760,
  roofing_slate_tan: 0xc8af80,
  encaustic_tile_circular_02: 0xbbaea2,
  tile_border_travertine: 0xa08e70,
  white_subway_tile: 0xf3fcfd,
  tile_grey: 0x858585,
  color_m06: 0x565656,
  color_j08: 0x330066,
  color_m00: 0xffffff,
  granite_tile: 0x9b9490,
  field_square_tile: 0xd9c9a9,
  herringbone: 0x828282,
  tile_ceramic_multi: 0xa57354,
  tile_ceramic_natural: 0xbdb486,
  field_rectangle_tile: 0xc4bdb3,
  concrete_tile: 0xcbbfa4,
  tile_large_brown: 0xc3b29f,
};

const referenceFacadeTint: Record<string, number> = {
  frontcolor: 0xdcd5cc,
  color_m00: 0xe9e3da,
  color_m06: 0x2a3035,
  slate_light_tile: 0x2f3438,
  slate: 0x474d52,
  metal_panel: 0x68483c,
  color_a06: 0x8a5742,
  color_j08: 0xb2beb2,
  translucent_glass_blue: 0x829ba5,
  tile_mosaic_multi: 0x704d44,
  tile_ceramic_multi: 0x7b5243,
  tile_large_brown: 0x8a6251,
  roofing_slate_tan: 0x704f43,
};

function normalizedMaterialName(name: string) {
  return name.trim().toLowerCase().replaceAll(" ", "_");
}

function hasReferenceSource(root: THREE.Object3D) {
  let matched = false;
  root.traverse((node) => {
    if (node.userData.sourceGeometry?.sha256 === JYOTI_SOURCE_MODEL_SHA256)
      matched = true;
  });
  return matched;
}

type SourceTextureData = Record<string, string>;

let sourceTextureDataPromise: Promise<SourceTextureData> | null = null;
const disposedProfileMaterials = new WeakSet<THREE.Material>();

function sourceTextureData() {
  if (!sourceTextureDataPromise) {
    sourceTextureDataPromise = fetch(sourceTextureAssetUrl, {
      cache: "force-cache",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Reference source texture asset failed (${response.status}).`,
          );
        const payload = (await response.json()) as unknown;
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new Error("Reference source texture asset is invalid.");
        const entries = Object.entries(payload);
        if (
          !entries.length ||
          entries.some(
            ([key, value]) =>
              !key ||
              typeof value !== "string" ||
              !value.startsWith("data:image/"),
          )
        )
          throw new Error("Reference source texture payload is invalid.");
        return Object.fromEntries(entries) as SourceTextureData;
      })
      .catch((error) => {
        sourceTextureDataPromise = null;
        throw error;
      });
  }
  return sourceTextureDataPromise;
}

function applySourceTexture(
  material: THREE.MeshStandardMaterial,
  anisotropy: number,
  referenceVisual: boolean,
  sourceTextureCache: Map<string, THREE.Texture>,
  sourceTextureWaiters: Map<string, THREE.MeshStandardMaterial[]>,
) {
  if (material.map) return;

  const key = material.name.replaceAll(" ", "_");
  const normalized = normalizedMaterialName(material.name);
  const tint = referenceVisual
    ? referenceFacadeTint[normalized] ?? sourceMaterialTint[normalized]
    : sourceMaterialTint[normalized];

  const cached = sourceTextureCache.get(key);
  if (cached) {
    if (tint !== undefined) material.color.setHex(tint);
    material.map = cached;
    material.needsUpdate = true;
    return;
  }

  const onMaterialDispose = () => {
    disposedProfileMaterials.add(material);
    material.removeEventListener("dispose", onMaterialDispose);
  };
  material.addEventListener("dispose", onMaterialDispose);

  const waiters = sourceTextureWaiters.get(key) ?? [];
  waiters.push(material);
  sourceTextureWaiters.set(key, waiters);
  if (waiters.length > 1) return;

  void sourceTextureData()
    .then((data) => {
      const dataUrl = data[key] ?? data[material.name];
      if (!dataUrl) {
        sourceTextureWaiters.delete(key);
        return;
      }

      new THREE.TextureLoader().load(
        dataUrl,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.anisotropy = Math.max(texture.anisotropy || 1, anisotropy);
          texture.needsUpdate = true;

          const liveTargets = (sourceTextureWaiters.get(key) ?? []).filter(
            (target) => !disposedProfileMaterials.has(target),
          );
          sourceTextureWaiters.delete(key);

          if (!liveTargets.length) {
            texture.dispose();
            return;
          }

          sourceTextureCache.set(key, texture);
          for (const target of liveTargets) {
            const normalizedTarget = normalizedMaterialName(target.name);
            const targetTint = referenceVisual
              ? referenceFacadeTint[normalizedTarget] ??
                sourceMaterialTint[normalizedTarget]
              : sourceMaterialTint[normalizedTarget];
            if (targetTint !== undefined) target.color.setHex(targetTint);
            target.map = texture;
            target.needsUpdate = true;
          }
        },
        undefined,
        () => {
          sourceTextureWaiters.delete(key);
        },
      );
    })
    .catch((error) => {
      sourceTextureWaiters.delete(key);
      console.error("Reference source texture asset load failed", error);
    });
}

/**
 * Project-specific restoration for the verified Reference Source V9 model.
 *
 * This function is intentionally source-SHA gated. A different tenant can use
 * identical material names without receiving these source textures or tints.
 */
export function enhanceReferenceSourceV9Model(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  referenceVisual = false,
) {
  if (!hasReferenceSource(root)) return false;

  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  // Cache belongs to this model instance. Generic model disposal owns the
  // resulting GPU textures; no module-global THREE.Texture survives a project switch.
  const sourceTextureCache = new Map<string, THREE.Texture>();
  const sourceTextureWaiters = new Map<string, THREE.MeshStandardMaterial[]>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.referenceFinish) continue;

      const name = normalizedMaterialName(material.name);
      applySourceTexture(
        material,
        anisotropy,
        referenceVisual,
        sourceTextureCache,
        sourceTextureWaiters,
      );

      const displayTint = referenceVisual
        ? referenceFacadeTint[name] ?? sourceMaterialTint[name]
        : sourceMaterialTint[name];
      if (displayTint !== undefined && !material.map)
        material.color.setHex(displayTint);

      if (name === "frontcolor") {
        material.roughness = referenceVisual ? 0.8 : 0.74;
        material.metalness = 0.01;
      } else if (name === "color_m06" || name === "slate_light_tile") {
        material.roughness = referenceVisual ? 0.44 : 0.48;
        material.metalness = referenceVisual ? 0.08 : 0.06;
      } else if (name === "color_m00") {
        material.roughness = referenceVisual ? 0.8 : 0.76;
        material.metalness = 0.01;
      } else if (
        name === "color_a06" ||
        name === "tile_ceramic_multi" ||
        name === "tile_large_brown"
      ) {
        material.roughness = referenceVisual ? 0.6 : 0.52;
        material.metalness = 0.02;
      } else if (name === "metal_panel") {
        material.roughness = referenceVisual ? 0.58 : 0.5;
        material.metalness = referenceVisual ? 0.09 : 0.12;
      } else if (name === "color_j08") {
        material.roughness = referenceVisual ? 0.78 : 0.72;
        material.metalness = 0.01;
      }

      if (referenceVisual && /glass|window|translucent/.test(name) && !/tile/.test(name)) {
        material.color.setHex(0x829ba5);
        material.emissive.setHex(0x24150d);
        material.emissiveIntensity = 0.16;
      }

      material.needsUpdate = true;
    }
  });

  return true;
}
