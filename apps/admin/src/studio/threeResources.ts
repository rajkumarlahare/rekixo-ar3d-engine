import * as T from "three";

/**
 * Dispose geometries, materials and texture properties owned by an Object3D tree.
 * Shared references are disposed once. Call only when the whole subtree is no
 * longer needed.
 */
export function disposeObjectResources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();

  root.traverse((node) => {
    if (node instanceof T.Mesh || node instanceof T.Line) {
      if (node.geometry) geometries.add(node.geometry);
      const nodeMaterials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of nodeMaterials)
        if (material) materials.add(material);
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof T.Texture) textures.add(value);
  }

  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
