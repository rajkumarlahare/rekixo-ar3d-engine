import * as THREE from "three";
import { floorForElevation, type FloorGeometryLevel } from "./floorGeometry";

type MeshFloorState = {
  mesh: THREE.Mesh;
  floor: number;
  order: number;
  originalWorldOrigin: THREE.Vector3;
};

function normalizedMaterialName(name: string) {
  return name.trim().toLowerCase().replaceAll(" ", "_");
}

function materialList(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function tuneTexture(texture: THREE.Texture | null | undefined, anisotropy: number) {
  if (!texture) return;
  texture.anisotropy = Math.max(texture.anisotropy || 1, anisotropy);
  texture.needsUpdate = true;
}

/**
 * Project-neutral architectural material tuning.
 *
 * Never place customer/source-specific material names, colors, texture data or
 * source fingerprints in this module. Those belong behind a verified profile
 * gate in modelProfiles.ts.
 */
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
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.userData.referenceFinish) continue;

      const name = normalizedMaterialName(material.name);
      tuneTexture(material.map, anisotropy);
      tuneTexture(material.normalMap, anisotropy);
      tuneTexture(material.roughnessMap, anisotropy);
      tuneTexture(material.metalnessMap, anisotropy);
      tuneTexture(material.aoMap, anisotropy);
      tuneTexture(material.emissiveMap, anisotropy);
      material.envMapIntensity = referenceVisual ? 0.5 : 0.72;

      if (/glass|window|translucent/.test(name) && !/tile/.test(name)) {
        material.roughness = Math.min(
          material.roughness,
          referenceVisual ? 0.09 : 0.14,
        );
        material.metalness = Math.min(material.metalness, 0.05);
        material.transparent = true;
        material.opacity = Math.min(
          material.opacity,
          referenceVisual ? 0.42 : 0.62,
        );
        material.depthWrite = false;
      } else if (/metal|steel|aluminium|aluminum|railing|panel/.test(name)) {
        material.metalness = Math.max(material.metalness, 0.55);
        material.roughness = Math.min(
          Math.max(material.roughness, 0.24),
          0.42,
        );
      } else if (/marble|granite|tile|slate/.test(name)) {
        material.metalness = Math.min(material.metalness, 0.08);
        material.roughness = Math.min(
          Math.max(material.roughness, 0.32),
          0.58,
        );
      } else if (/concrete|paver|plaster|wall/.test(name)) {
        material.metalness = Math.min(material.metalness, 0.03);
        material.roughness = Math.max(material.roughness, 0.62);
      }

      material.needsUpdate = true;
    }
  });
}

export function createFloorExploder(
  root: THREE.Object3D,
  bounds: THREE.Box3,
  floorGeometry: readonly FloorGeometryLevel[],
) {
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
    const level = floorForElevation(floorGeometry, center.y);
    if (!level) return;
    const order = floorGeometry.findIndex((item) => item.floor === level.floor);
    if (order < 0) return;

    states.push({
      mesh: object,
      floor: level.floor,
      order,
      originalWorldOrigin: object.getWorldPosition(new THREE.Vector3()),
    });
  });

  const apply = (enabled: boolean) => {
    root.updateMatrixWorld(true);
    const averageFloorHeight =
      floorGeometry.length > 0
        ? floorGeometry.reduce(
            (sum, item) => sum + (item.topElevationM - item.elevationM),
            0,
          ) / floorGeometry.length
        : totalHeight;
    const gap = Math.max(averageFloorHeight * 0.16, totalHeight * 0.006);

    for (const state of states) {
      const parent = state.mesh.parent;
      if (!parent) continue;

      const targetWorld = state.originalWorldOrigin.clone();
      if (enabled) targetWorld.y += state.order * gap;

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
