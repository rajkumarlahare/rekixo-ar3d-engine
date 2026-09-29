import * as T from "three";
import type { Scene as SceneData } from "./domain";

export interface ModelMaterialSummary {
  name: string;
  type: string;
  meshCount: number;
  baseColor: string;
  roughness: number;
  metalness: number;
  opacity: number;
  emissive: string;
  emissiveIntensity: number;
}

type MaterialBase = {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissive: string;
  emissiveIntensity: number;
};

function materialBase(material: T.MeshStandardMaterial): MaterialBase {
  const stored = material.userData.studioMaterialBase as
    | MaterialBase
    | undefined;
  if (stored) return stored;
  const base: MaterialBase = {
    color: `#${material.color.getHexString()}`,
    roughness: material.roughness,
    metalness: material.metalness,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: material.emissiveIntensity,
  };
  material.userData.studioMaterialBase = base;
  return base;
}

export function applyModelMaterialOverrides(
  root: T.Object3D,
  scene: SceneData,
) {
  const overrides = new Map(
    (scene.materialOverrides ?? []).map((item) => [item.materialName, item]),
  );
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const base = materialBase(material);
      material.color.set(base.color);
      material.roughness = base.roughness;
      material.metalness = base.metalness;
      material.opacity = base.opacity;
      material.transparent = base.transparent;
      material.depthWrite = base.depthWrite;
      material.emissive.set(base.emissive);
      material.emissiveIntensity = base.emissiveIntensity;

      const override = overrides.get(material.name);
      if (override) {
        if (override.baseColor) material.color.set(override.baseColor);
        if (override.roughness !== undefined)
          material.roughness = override.roughness;
        if (override.metalness !== undefined)
          material.metalness = override.metalness;
        if (override.opacity !== undefined) {
          material.opacity = override.opacity;
          material.transparent = override.opacity < 0.999;
          material.depthWrite = override.opacity >= 0.999;
        }
        if (override.emissive) material.emissive.set(override.emissive);
        if (override.emissiveIntensity !== undefined)
          material.emissiveIntensity = override.emissiveIntensity;
      }
      material.needsUpdate = true;
    }
  });
}

export function applyModelNodeVisibility(
  root: T.Object3D,
  scene: SceneData,
  isolateFloorId?: string,
) {
  const tags = new Map(
    (scene.modelNodeTags ?? []).map((tag) => [
      `${tag.nodeName}\u0000${tag.occurrence}`,
      tag,
    ]),
  );
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    const name = node.userData.studioNodeName as string | undefined;
    const occurrence = node.userData.studioNodeOccurrence as number | undefined;
    if (!name || !occurrence) return;
    const tag = tags.get(`${name}\u0000${occurrence}`);
    node.visible =
      !isolateFloorId || !tag?.floorId || tag.floorId === isolateFloorId;
  });
}

export function summarizeModelMaterials(
  root: T.Object3D,
): ModelMaterialSummary[] {
  const rows = new Map<string, ModelMaterialSummary>();
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      const name = material.name || "Unnamed material";
      const current = rows.get(name);
      if (current) {
        current.meshCount += 1;
        continue;
      }
      rows.set(name, {
        name,
        type: material.type,
        meshCount: 1,
        baseColor: `#${material.color.getHexString()}`,
        roughness: material.roughness,
        metalness: material.metalness,
        opacity: material.opacity,
        emissive: `#${material.emissive.getHexString()}`,
        emissiveIntensity: material.emissiveIntensity,
      });
    }
  });
  return [...rows.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
