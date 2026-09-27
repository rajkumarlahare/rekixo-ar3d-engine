import * as THREE from "three";
import { sourceTextureData } from "./sourceTextureData";

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
  ornate_tile_01: 0xcacaCA,
  basic_tile: 0xcbcecA,
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

// The FBX diffuse colors above remain the source-of-truth audit values.
// This second layer is a presentation calibration derived from the supplied
// brochure/exterior render. It intentionally changes only the
// web-viewer appearance so the live model reads like the approved warm facade
// instead of a flat white/grey CAD viewport.
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

const sourceTextureCache = new Map<string, THREE.Texture>();
const sourceTextureWaiters = new Map<string, THREE.MeshStandardMaterial[]>();

function applySourceTexture(
  material: THREE.MeshStandardMaterial,
  anisotropy: number,
  referenceVisual: boolean,
) {
  const key = material.name.replaceAll(" ", "_");
  const normalized = normalizedMaterialName(material.name);
  const tint = referenceVisual
    ? referenceFacadeTint[normalized] ?? sourceMaterialTint[normalized]
    : sourceMaterialTint[normalized];
  const dataUrl = sourceTextureData[key] ?? sourceTextureData[material.name];
  // Embedded model textures take priority. Only restore missing source maps.
  if (!dataUrl || material.map) return;

  const cached = sourceTextureCache.get(key);
  if (cached) {
    if (tint !== undefined) material.color.setHex(tint);
    material.map = cached;
    material.needsUpdate = true;
    return;
  }

  const waiters = sourceTextureWaiters.get(key) ?? [];
  waiters.push(material);
  sourceTextureWaiters.set(key, waiters);
  if (waiters.length > 1) return;

  new THREE.TextureLoader().load(
    dataUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.max(texture.anisotropy || 1, anisotropy);
      texture.needsUpdate = true;
      sourceTextureCache.set(key, texture);
      for (const target of sourceTextureWaiters.get(key) ?? []) {
        const normalizedTarget = normalizedMaterialName(target.name);
        const targetTint = referenceVisual
          ? referenceFacadeTint[normalizedTarget] ?? sourceMaterialTint[normalizedTarget]
          : sourceMaterialTint[normalizedTarget];
        if (targetTint !== undefined) target.color.setHex(targetTint);
        target.map = texture;
        target.needsUpdate = true;
      }
      sourceTextureWaiters.delete(key);
    },
    undefined,
    () => {
      sourceTextureWaiters.delete(key);
    },
  );
}

type MeshFloorState = {
  mesh: THREE.Mesh;
  floor: number;
  originalWorldOrigin: THREE.Vector3;
};

function materialList(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function tuneTexture(texture: THREE.Texture | null | undefined, anisotropy: number) {
  if (!texture) return;
  texture.anisotropy = Math.max(texture.anisotropy || 1, anisotropy);
  texture.needsUpdate = true;
}

export function enhanceArchitecturalModel(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  referenceVisual = false,
) {
  const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    object.castShadow = renderer.shadowMap.enabled;
    object.receiveShadow = true;

    for (const material of materialList(object.material)) {
      const name = normalizedMaterialName(material.name);
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.referenceFinish) continue;

      tuneTexture(material.map, anisotropy);
      tuneTexture(material.normalMap, anisotropy);
      tuneTexture(material.roughnessMap, anisotropy);
      tuneTexture(material.metalnessMap, anisotropy);
      tuneTexture(material.aoMap, anisotropy);
      tuneTexture(material.emissiveMap, anisotropy);
      applySourceTexture(material, anisotropy, referenceVisual);

      const displayTint = referenceVisual
        ? referenceFacadeTint[name] ?? sourceMaterialTint[name]
        : sourceMaterialTint[name];
      if (displayTint !== undefined && !material.map) {
        material.color.setHex(displayTint);
      }
      material.envMapIntensity = referenceVisual ? 0.50 : 0.72;

      if (name === "frontcolor") {
        material.roughness = referenceVisual ? 0.8 : 0.74;
        material.metalness = 0.01;
      } else if (name === "color_m06" || name === "slate_light_tile") {
        material.roughness = referenceVisual ? 0.44 : 0.48;
        material.metalness = referenceVisual ? 0.08 : 0.06;
      } else if (name === "color_m00") {
        material.roughness = referenceVisual ? 0.8 : 0.76;
        material.metalness = 0.01;
      } else if (name === "color_a06" || name === "tile_ceramic_multi" || name === "tile_large_brown") {
        material.roughness = referenceVisual ? 0.6 : 0.52;
        material.metalness = 0.02;
      } else if (name === "metal_panel") {
        // Warm cladding from the supplied reference; keep it matte enough to
        // avoid the silver/plastic look of the previous live pass.
        material.roughness = referenceVisual ? 0.58 : 0.5;
        material.metalness = referenceVisual ? 0.09 : 0.12;
      } else if (name === "color_j08") {
        material.roughness = referenceVisual ? 0.78 : 0.72;
        material.metalness = 0.01;
      }

      if (/glass|window|translucent/.test(name) && !/tile/.test(name)) {
        material.color.setHex(referenceVisual ? 0x829ba5 : 0x718c93);
        material.roughness = Math.min(material.roughness, referenceVisual ? 0.09 : 0.14);
        material.metalness = Math.min(material.metalness, 0.05);
        material.transparent = true;
        material.opacity = Math.min(material.opacity, referenceVisual ? 0.42 : 0.62);
        material.depthWrite = false;
        if (referenceVisual) {
          material.emissive.setHex(0x24150d);
          material.emissiveIntensity = 0.16;
        }
      } else if (/metal|steel|aluminium|aluminum|railing|panel/.test(name)) {
        material.metalness = Math.max(material.metalness, 0.55);
        material.roughness = Math.min(Math.max(material.roughness, 0.24), 0.42);
      } else if (/marble|granite|tile|slate/.test(name)) {
        material.metalness = Math.min(material.metalness, 0.08);
        material.roughness = Math.min(Math.max(material.roughness, 0.32), 0.58);
      } else if (/concrete|paver|plaster|wall|frontcolor/.test(name)) {
        material.metalness = Math.min(material.metalness, 0.03);
        material.roughness = Math.max(material.roughness, 0.62);
      }

      material.needsUpdate = true;
    }
  });
}

function floorForY(y: number, bounds: THREE.Box3, levels?: number[]) {
  if (levels && levels.length === 7) {
    if (y >= levels[6]) return null;
    for (let floor = 5; floor >= 0; floor--) if (y >= levels[floor]) return floor;
    return 0;
  }
  const total = Math.max(bounds.max.y - bounds.min.y, 0.001);
  const ratio = (y - bounds.min.y) / total;

  if (ratio < 0.12) return 0;
  if (ratio >= 0.79) return null;

  return THREE.MathUtils.clamp(
    Math.floor((ratio - 0.12) / 0.132) + 1,
    1,
    5,
  );
}

export function createFloorExploder(root: THREE.Object3D, bounds: THREE.Box3) {
  root.updateMatrixWorld(true);
  const totalHeight = Math.max(bounds.max.y - bounds.min.y, 1);
  const states: MeshFloorState[] = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.parent) return;
    if (object.userData.staticSiteContext) return;

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const meshHeight = box.max.y - box.min.y;
    // Long façade/core meshes stay fixed so the model never tears into nonsense.
    if (meshHeight > totalHeight * 0.22) return;

    const center = box.getCenter(new THREE.Vector3());
    const floor = floorForY(center.y, bounds, root.userData.architecturalFloorLevels);
    if (floor === null) return;

    states.push({
      mesh: object,
      floor,
      originalWorldOrigin: object.getWorldPosition(new THREE.Vector3()),
    });
  });

  const apply = (enabled: boolean) => {
    root.updateMatrixWorld(true);
    const gap = totalHeight * 0.035;

    for (const state of states) {
      const parent = state.mesh.parent;
      if (!parent) continue;

      const targetWorld = state.originalWorldOrigin.clone();
      if (enabled) targetWorld.y += state.floor * gap;

      parent.updateMatrixWorld(true);
      const targetLocal = parent.worldToLocal(targetWorld);
      state.mesh.position.copy(targetLocal);
    }

    root.updateMatrixWorld(true);
  };

  return {
    meshCount: states.length,
    setExploded: apply,
    reset: () => apply(false),
  };
}
